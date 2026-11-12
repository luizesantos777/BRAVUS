import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createPortalServer } from '../server/http.ts';
import { businessToday } from '../src/domain.ts';
import { inRankingRange, rankingRange } from '../src/ranking-domain.ts';

const receipt = { name: 'ranking.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
function shift(day: string, offset: number) { const date = new Date(day + 'T12:00:00Z');date.setUTCDate(date.getUTCDate() + offset);return date.toISOString().slice(0, 10); }

test('ranking conta dias corridos inclusive hoje, atravessa meses e anos e valida o calendário', () => {
  assert.deepEqual(rankingRange('today', '2026-03-01'), { start: '2026-03-01', end: '2026-03-01' });
  assert.deepEqual(rankingRange('week', '2026-03-01'), { start: '2026-02-23', end: '2026-03-01' });
  assert.deepEqual(rankingRange('last30', '2026-03-01'), { start: '2026-01-31', end: '2026-03-01' });
  assert.deepEqual(rankingRange('last30', '2024-03-01'), { start: '2024-02-01', end: '2024-03-01' });
  assert.deepEqual(rankingRange('last30', '2026-01-01'), { start: '2025-12-03', end: '2026-01-01' });
  const custom = rankingRange('custom', '2026-03-01', '2026-02-10', '2026-02-15');
  assert.equal(inRankingRange('2026-02-10', custom), true);assert.equal(inRankingRange('2026-02-15', custom), true);
  assert.equal(inRankingRange('2026-02-09', custom), false);assert.equal(inRankingRange('2026-02-16', custom), false);
  for (const [start, end] of [['', ''], ['2026-02-30', '2026-03-01'], ['2026-02-20', '2026-02-10'], ['2026-02-20', '2026-03-02']]) assert.throws(() => rankingRange('custom', '2026-03-01', start, end));
});

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: API recalcula os períodos com atendentes e parceiros ativos, sem expor dados financeiros privados`, async t => {
  const store = await (driver === 'sqlite' ? PortalStore.open(':memory:') : PortalStore.open(libsqlDatabase(createClient({ url: 'file::memory:', intMode: 'number' }))));
  const a = await store.createAttendant('Raposo', 5000), b = await store.createAttendant('Luis', 5000), c = await store.createAttendant('MG', 5000);
  const inactive = await store.createAttendant('Revogado', 5000), partner = await store.createPartner('Parceiro'), noSales = await store.createAttendant('Sem vendas', 5000), future = await store.createAttendant('Futuro inválido', 5000);
  const today = businessToday();let request = 0;
  async function sale(id: string, amount: string, offset: number, status: 'approved' | 'pending' | 'rejected' | 'cancelled' = 'approved') {
    await store.recordSales({ id }, { date: shift(today, offset), sales: [{ amount, checkoutId: 'main', time: '12:00', note: '', receipt }] }, `fixture_ranking_${++request}`);
    const current = (await store.sales({ id })).find(row => row.status === 'pending')!;
    if (status !== 'pending') await store.reviewSale(current.id, { status: status === 'rejected' ? 'rejected' : 'approved', note: 'Conferência de teste' });
    if (status === 'cancelled') await store.cancelSale(current.id, { note: 'Não participa do ranking' });
  }
  await sale(a.id, '100', 0);await sale(a.id, '200', -6);await sale(a.id, '300', -29);await sale(a.id, '900', -30);
  await sale(a.id, '500', 0, 'cancelled');await sale(a.id, '600', 0, 'rejected');await sale(a.id, '700', 0, 'pending');
  await sale(b.id, '500', 0);await sale(c.id, '600', 0);await sale(inactive.id, '1000', 0);await sale(partner.id, '3000', 0);
  await store.setAttendantActive(inactive.id, { active: false });
  await sale(future.id, '1000', 0);await store.sql.prepare('UPDATE sales SET date=? WHERE attendant_id=?').run(shift(today, 1), future.id);
  const server = createPortalServer(store);server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close();resolve(); });server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, call = (query = '', token = a.token, path = '/api/ranking') => fetch(base + path + query, { headers: { Authorization: `Bearer ${token}` } });
  const daily = await (await call('?period=today')).json();assert.deepEqual(daily.map((row: { id: string }) => row.id), [partner.id, c.id, b.id, a.id]);assert.equal(daily[3].grossCents, 10000);
  const week = await (await call('?period=week')).json();assert.equal(week.find((row: { id: string }) => row.id === a.id).grossCents, 30000);
  const month = await (await call('?period=last30')).json();assert.deepEqual(month.map((row: { id: string }) => row.id), [partner.id, a.id, c.id, b.id]);
  assert.equal(month[1].grossCents, 60000);assert.equal(month[1].count, 3);assert.equal(month[1].mine, true);assert.equal(month[0].mine, false);
  assert.deepEqual(await (await call()).json(), month);
  const custom = await (await call(`?period=custom&start=${shift(today, -29)}&end=${shift(today, -6)}`)).json();assert.equal(custom.length, 1);assert.equal(custom[0].grossCents, 50000);assert.equal(custom[0].count, 2);
  const excluded = new Set<string>([inactive.id, noSales.id, future.id]);assert.ok(!month.some((row: { id: string }) => excluded.has(row.id)));
  assert.deepEqual(Object.keys(month[0]).sort(), ['count', 'grossCents', 'id', 'mine', 'name', 'photoUrl']);
  const partnerRanking = await (await call('?period=last30', partner.token)).json();
  assert.equal(partnerRanking[0].mine, true);assert.equal(partnerRanking[1].mine, false);
  assert.deepEqual(partnerRanking.map((row: { id: string }) => ({ ...row, mine: row.id === a.id })), month);
  for (const token of [a.token, partner.token]) assert.ok(!JSON.stringify(month).includes(token));
  for (const query of ['?period=unknown', '?period=custom', `?period=custom&start=${today}&end=${shift(today, -1)}`, `?period=custom&start=${today}&end=${shift(today, 1)}`]) assert.equal((await call(query)).status, 400);
  assert.equal((await call('?period=last30', a.token, '/api/portal')).status, 400);
  assert.equal((await call('?period=last30', '')).status, 401);
});
