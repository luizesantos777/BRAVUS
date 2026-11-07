import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PortalStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { exclusiveCheckoutId } from '../server/partner-checkouts.ts';
import { businessToday, calculateFinance, calculateMarketing } from '../src/domain.ts';

const owner = 'fixture_ads_admin_012345678901234567890123456789';
const token = 'fixture_ads_exclusive_012345678901234567890';
const ordinaryToken = 'fixture_ads_ordinary_012345678901234567890';
const partnerToken = 'fixture_ads_partner_012345678901234567890';
const receipt = { name: 'ads.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const before = (days: number) => { const date = new Date(businessToday() + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-partner-ads-')), store = await PortalStore.open(join(directory, 'portal.sqlite'));
  const account = await store.createPartner('Parceiro com ADS próprio', token);
  const ordinary = await store.createAttendant('Atendente comum', 5000, ordinaryToken);
  const partner = await store.createPartner('Parceiro nativo', partnerToken), checkoutId = exclusiveCheckoutId(account.id);
  await store.sql.prepare('INSERT INTO checkouts (id, name, fee_bps, fixed_fee_cents, min_amount_cents, max_amount_cents) VALUES (?, ?, ?, ?, ?, ?)').run(checkoutId, 'Gateway exclusivo', 1200, 0, 1, 300000);
  const server = createPortalServer(store, { adminKey: owner }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); resolve(); }); server.closeAllConnections(); }));
  const call = (path: string, credential = token, body?: unknown) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const save = (ads: string, date = businessToday(), credential = token) => call('/api/partner/ads', credential, { date, ads });
  const portal = async (credential = token, period = 'today') => { const response = await call('/api/portal?period=' + period, credential); assert.equal(response.status, 200); return response.json(); };
  const sale = (amount = '100', date = businessToday()) => ({ date, sales: [{ amount, checkoutId, time: '12:00', note: '', receipt }] });
  return { store, call, save, portal, sale, account, ordinary, partner, directory };
}

test('ADS próprio altera lucro e ROI; saldo, custos administrativos e taxas de saque permanecem separados', async t => {
  const { store, call, save, portal, sale, account } = await fixture(t);
  await store.setCosts(account.id, businessToday(), 1000, 200);
  await store.recordSales({ id: account.id }, sale(), 'fixture_ads_pending_sale');
  const balanceBefore = (await portal()).finance.availableCents;
  assert.equal((await save('25')).status, 200);
  let data = await portal();
  assert.equal(data.finance.availableCents, balanceBefore); assert.equal(data.marketing.roiPercent, -100); assert.equal(data.marketing.totalAdsCents, 3500); assert.equal(data.marketing.earningsCents, 0);
  await store.reviewSale(data.sales[0].id, { status: 'approved', note: '' });
  data = await portal();
  assert.equal(data.finance.availableCents, 7600); assert.equal(data.finance.adsCents, 1000);
  assert.equal(data.marketing.earningsCents, 8800); assert.equal(data.marketing.profitCents, 5300); assert.equal(data.marketing.roiPercent, 5300 / 3500 * 100);
  assert.deepEqual(await (await call('/api/partner/ads?date=' + businessToday())).json(), { date: businessToday(), adsCents: 2500 });
  assert.equal((await save('15')).status, 200); data = await portal();
  assert.equal(data.finance.availableCents, 7600); assert.equal(data.marketing.roiPercent, 252); assert.equal(data.marketing.history.length, 1);
  await Promise.all([store.setCosts(account.id, businessToday(), 2000, 300), store.savePartnerAds({ id: account.id }, { date: businessToday(), ads: '20' })]);
  assert.deepEqual({ ...await store.adminCosts(account.id, businessToday()) }, { date: businessToday(), adsCents: 2000, withdrawalFeeCents: 300 });
  data = await portal(); assert.equal(data.marketing.ownAdsCents, 2000); assert.equal(data.finance.availableCents, 6500);
  assert.equal((await save('0')).status, 200); data = await portal();
  assert.equal(data.marketing.ownAdsCents, 0); assert.equal(data.marketing.roiPercent, 340); assert.equal(data.finance.availableCents, 6500);
});

test('somente parceiros editam seu próprio ADS, sem alterar outras contas, taxas ou permissões administrativas', async t => {
  const { call, save, portal, account, ordinary } = await fixture(t);
  assert.equal((await save('10', businessToday(), ordinaryToken)).status, 403);
  assert.equal((await call('/api/partner/ads?date=' + businessToday(), ordinaryToken)).status, 403);
  assert.equal((await save('10', businessToday(), '')).status, 401);
  assert.equal((await save('30', businessToday(), partnerToken)).status, 200);
  assert.equal((await save('10')).status, 200);
  for (const extra of [{ attendantId: ordinary.id }, { adsCents: 0 }, { withdrawalFee: '0' }, { feeBps: 0 }, { accountKind: 'partner' }]) {
    assert.equal((await call('/api/partner/ads', token, { date: businessToday(), ads: '999', ...extra })).status, 400);
  }
  assert.equal((await call(`/api/admin/attendants/${account.id}/costs`, token, { date: businessToday(), ads: '0', withdrawalFee: '0' })).status, 401);
  assert.equal((await portal()).marketing.ownAdsCents, 1000); assert.equal((await portal(partnerToken)).marketing.ownAdsCents, 3000); assert.equal((await portal(ordinaryToken)).marketing, undefined);
  assert.deepEqual(await (await call(`/api/partner/ads?date=${businessToday()}&attendantId=${ordinary.id}`)).json(), { date: businessToday(), adsCents: 1000 });
  const audit = await (await call('/api/admin/audit?action=partner.ads_updated', owner)).json();
  assert.equal(audit.total, 2); assert.ok(audit.entries.some((entry: { targetId: string; actorName: string; after: { partnerAdsCents: number } }) => entry.targetId === account.id && entry.actorName === 'Parceiro com ADS próprio' && entry.after.partnerAdsCents === 1000));
});

test('ADS valida valores e datas, respeita o período e permite zerar o total diário sem descontar do saldo', async t => {
  const { call, save, portal } = await fixture(t);
  for (const ads of ['-1', 'NaN', 'Infinity', '1000000.01', '1,001', '']) assert.equal((await save(ads)).status, 400);
  for (const date of ['', '2026-02-30', before(-1)]) assert.equal((await save('10', date)).status, 400);
  assert.equal((await call('/api/partner/ads?date=not-a-date')).status, 400);
  assert.equal((await save('40', before(1))).status, 200); assert.equal((await save('10')).status, 200);
  assert.equal((await portal()).marketing.ownAdsCents, 1000); assert.equal((await portal(token, 'yesterday')).marketing.ownAdsCents, 4000); assert.equal((await portal(token, 'all')).marketing.ownAdsCents, 5000);
  assert.equal((await save('0')).status, 200);
  const current = await portal(); assert.equal(current.marketing.roiPercent, null); assert.equal(current.finance.availableCents, 0);
});

test('ROI não depende de repasses ou ajustes, e os totais consideram mais de 100 dias mesmo com histórico limitado', () => {
  const costs = Array.from({ length: 105 }, (_, index) => ({ date: before(index), adsCents: 100 }));
  const finance = calculateFinance([], [], [], 'all', businessToday()); finance.commissionCents = 21000;
  const report = calculateMarketing(finance, costs, 'all', businessToday());
  assert.equal(report.ownAdsCents, 10500); assert.equal(report.history.length, 100); assert.equal(report.roiPercent, 100);
  const paid = { ...finance, availableCents: -1000, paidPayoutCents: 20000, withdrawalFeeCents: 500 };
  assert.deepEqual(calculateMarketing(paid, costs, 'all', businessToday()), report);
  assert.equal(calculateMarketing(finance, [], 'today', businessToday()).roiPercent, null);
});

test('backup conserva ADS próprio e arquivos antigos sem a nova coluna restauram o valor zero', async t => {
  const { store, save, portal, account, directory } = await fixture(t);
  await store.setCosts(account.id, businessToday(), 1200, 50); assert.equal((await save('35')).status, 200);
  const source = await portal(), bytes = await createArchive(store);
  const copy = await PortalStore.open(join(directory, 'copy.sqlite')), legacy = await PortalStore.open(join(directory, 'legacy.sqlite'));
  try {
    await restoreArchive(bytes, copy);
    const restored = await copy.portal({ id: account.id }); assert.deepEqual(restored.marketing, source.marketing); assert.deepEqual(restored.finance, source.finance);
    const archive = JSON.parse(gunzipSync(bytes).toString('utf8'));
    const costs = archive.tables.find((table: { name: string }) => table.name === 'costs'), column = costs.columns.indexOf('partner_ads_cents');
    costs.columns.splice(column, 1); costs.rows.forEach((row: unknown[]) => row.splice(column, 1));
    await restoreArchive(gzipSync(JSON.stringify(archive)), legacy);
    const old = await legacy.portal({ id: account.id }); assert.equal(old.marketing!.ownAdsCents, 0); assert.deepEqual(old.finance, source.finance);
  } finally { copy.close(); legacy.close(); }
});
