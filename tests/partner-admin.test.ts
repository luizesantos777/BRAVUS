import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createPortalServer } from '../server/http.ts';
import { readFinancialReport } from '../server/admin-controls.ts';
import { financialCsv } from '../src/admin-domain.ts';
import { businessToday } from '../src/domain.ts';
const today = businessToday(), date = new Date(today + 'T12:00:00Z');date.setUTCDate(date.getUTCDate() - 1);const yesterday = date.toISOString().slice(0, 10);
const receipt = { name: 'financeiro.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const key = 'fixture_admin_partner_profit_01234567890123456789';
const token = 'fixture_partner_profit_01234567890123456789';
function batch(amount: string, day = today) { return { date: day, sales: [{ amount, time: '12:00', note: '', receipt }] }; }

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: admin confere a taxa única e lucro dos parceiros com todos os ADS, períodos e repasses`, async () => {
  const store = await (driver === 'sqlite' ? PortalStore.open(':memory:') : PortalStore.open(libsqlDatabase(createClient({ url: 'file::memory:', intMode: 'number' }))));
  try {
    const partner = await store.createPartner('Parceiro relatório', token), auth = { id: partner.id };
    const normal = await store.createAttendant('Atendente sem lucro de parceiro', 5000);
    const second = await store.createPartner('Parceiro com prejuízo');
    const add = async (amount: string, request: string, status: 'approved' | 'pending' | 'rejected' | 'cancelled', day = today) => {
      await store.recordSales(auth, batch(amount, day), request);
      const sale = (await store.sales(auth)).find(sale => sale.amountCents === Math.round(Number(amount) * 100))!;
      if (status !== 'pending') await store.reviewSale(sale.id, { status: status === 'rejected' ? 'rejected' : 'approved', note: 'Conferência' });
      if (status === 'cancelled') await store.cancelSale(sale.id, { note: 'Cancelamento conferido' });
      return sale.id;
    };
    const saleId = await add('219', 'fixture_report_approved_219', 'approved');await add('100', 'fixture_report_yesterday_100', 'approved', yesterday);
    await add('1000', 'fixture_report_pending_1000', 'pending');await add('50', 'fixture_report_rejected_50', 'rejected');await add('70', 'fixture_report_cancelled_70', 'cancelled');
    await store.setCosts(partner.id, today, 1000, 0);await store.setCosts(partner.id, yesterday, 500, 0);
    await store.savePartnerAds(auth, { date: today, ads: '50' });await store.savePartnerAds(auth, { date: yesterday, ads: '20' });
    await store.savePartnerAds({ id: second.id }, { date: today, ads: '10' });
    await store.saveProfile(auth, { name: 'Parceiro relatório', email: '', phone: '', pixType: 'email', pixKey: 'test@example.test', pixOwner: 'Parceiro' });
    const before = await store.portal(auth, 'all');assert.equal(before.marketing!.profitCents, 19572);
    const pending = await store.adminSales('all', partner.id);
    const sale = pending.sales.find(item => item.id === saleId)!;assert.equal(sale.accountKind, 'partner');assert.equal(sale.amountCents, 21900);assert.equal(sale.feeCents, 2628);assert.equal(sale.attendantFeeCents, 2628);
    const dashboard = await store.adminDashboard(), account = dashboard.attendants.find(item => item.id === partner.id)!;
    assert.deepEqual(account.marketing, before.marketing);assert.equal(account.finance.commissionCents, 28072);
    assert.equal(dashboard.attendants.find(item => item.id === normal.id)!.marketing, undefined);
    assert.equal(dashboard.attendants.find(item => item.id === second.id)!.marketing!.profitCents, -1000);
    const report = await readFinancialReport(store, today, today, partner.id);
    assert.equal(report.totals.count, 1);assert.equal(report.totals.pendingCount, 1);assert.equal(report.totals.rejectedCount, 2);assert.equal(report.totals.commissionCents, 19272);
    const { roiPercent, ...summary } = report.marketing!;assert.deepEqual(summary, { earningsCents: 19272, chargedAdsCents: 1000, ownAdsCents: 5000, totalAdsCents: 6000, profitCents: 13272 });assert.ok(Math.abs(roiPercent! - 221.2) < 1e-8);
    assert.deepEqual(report.attendants[0].marketing, report.marketing);assert.equal(report.attendants[0].accountKind, 'partner');
    const csv = financialCsv(report);assert.match(csv, /Lucro do parceiro após ADS/);assert.match(csv, /132,72;221,20/);assert.ok(!csv.includes('test@example.test'));
    await store.recordManualPayout({ attendantId: partner.id, amount: '100', note: 'PIX de teste' }, 'fixture_report_manual_payout');
    const settled = await store.adminDashboard();assert.equal(settled.attendants.find(item => item.id === partner.id)!.marketing!.profitCents, 19572);assert.equal(settled.attendants.find(item => item.id === partner.id)!.finance.availableCents, 16572);
    const paidReport = await readFinancialReport(store, today, today, partner.id);assert.equal(paidReport.marketing!.profitCents, 13272);assert.equal(paidReport.totals.paidPayoutNetCents, 10000);
    const old = await readFinancialReport(store, yesterday, yesterday, partner.id);assert.equal(old.marketing!.profitCents, 6300);assert.equal(old.marketing!.roiPercent, 252);
    const all = await readFinancialReport(store, yesterday, today);assert.equal(all.marketing!.profitCents, 18572);assert.equal(all.marketing!.ownAdsCents, 8000);assert.equal(all.marketing!.totalAdsCents, 9500);
    const regular = await readFinancialReport(store, today, today, normal.id);assert.equal(regular.attendants[0].marketing, undefined);assert.equal(regular.marketing!.profitCents, 0);
    const preserved = await store.sales(auth);await store.savePartnerAds(auth, { date: today, ads: '70' });
    const updated = (await store.adminDashboard()).attendants.find(item => item.id === partner.id)!;assert.equal(updated.marketing!.profitCents, 17572);assert.equal(updated.finance.availableCents, 16572);assert.deepEqual(await store.sales(auth), preserved);
    assert.equal((await store.adminSales('all', partner.id)).sales.length, 5);
  } finally { store.close(); }
});

test('lucro inclui ADS antigos além da paginação; a conta do parceiro não acessa o admin', async t => {
  const store = await PortalStore.open(':memory:'), partner = await store.createPartner('Parceiro histórico', token), auth = { id: partner.id };
  const server = createPortalServer(store, { adminKey: key });server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close();resolve(); });server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, credential: string) => fetch(base + path, { headers: { Authorization: `Bearer ${credential}` } });
  for (let i = 0; i < 125; i++) {
    const day = new Date(today + 'T12:00:00Z');day.setUTCDate(day.getUTCDate() - i);
    await store.savePartnerAds(auth, { date: day.toISOString().slice(0, 10), ads: '1' });
  }
  const dashboard = await (await call('/api/admin/dashboard', key)).json();assert.equal(dashboard.attendants[0].marketing.profitCents, -12500);assert.equal(dashboard.attendants[0].marketing.history.length, 100);
  assert.deepEqual(dashboard.attendants[0].marketing, (await store.portal(auth, 'all')).marketing);
  for (const path of ['/api/admin/dashboard', '/api/admin/sales?status=all', `/api/admin/reports/financial?start=${today}&end=${today}`]) assert.equal((await call(path, token)).status, 401);
  assert.ok(!JSON.stringify(dashboard).includes(token));
});
