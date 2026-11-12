import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createPortalServer } from '../server/http.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { readAudit, readFinancialReport } from '../server/admin-controls.ts';
import { businessToday } from '../src/domain.ts';
import { calculatePartnerBusiness, partnerGatewayCost, recordedPartnerGatewayCost } from '../src/partner-business.ts';

const today = businessToday(), migration = 'partner-provider-cost-599-199-2026-11-11-v1';
const receipt = { name: 'custo.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = (amounts: string[], checkoutId?: string) => ({ date: today, sales: amounts.map(amount => ({ amount, checkoutId, time: '12:00', note: 'Transação sintética', receipt, gatewayCostCents: 0 })) });
const privateSales = async (store: PortalStore, id: string) => (await store.adminSales('all', id)).sales;

test('5,99% + R$ 1,99 é um custo por transação; vendas pequenas podem ter margem negativa', () => {
  for (const [amount, expected] of [[10000, 798], [21900, 1511], [50000, 3194], [300000, 18169], [500, 229], [5, 199]]) assert.equal(partnerGatewayCost(amount), expected);
  for (const amount of [0, -1, 1.1, NaN, Infinity]) assert.throws(() => partnerGatewayCost(amount));
  const five = calculatePartnerBusiness(Array.from({ length: 5 }, () => ({ amountCents: 10000, feeCents: 1200, status: 'approved' as const, date: today })), 'all', today);
  assert.deepEqual(five, { saleCount: 5, partnerFeeCents: 6000, gatewayCostCents: 3990, profitCents: 2010 });
  const one = calculatePartnerBusiness([{ amountCents: 50000, feeCents: 6000, status: 'approved', date: today }], 'all', today);
  assert.equal(one.gatewayCostCents, 3194);assert.equal(one.profitCents, 2806);
  assert.equal(calculatePartnerBusiness([{ amountCents: 500, feeCents: 60, status: 'approved', date: today }], 'all', today).profitCents, -169);
  assert.equal(recordedPartnerGatewayCost({ amountCents: 10000, gatewayCostCents: 777 }), 777);
  assert.equal(recordedPartnerGatewayCost({ amountCents: 10000, gatewayCostCents: 0 }), 0);
});

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: custo histórico é registrado uma vez, sem alterar vendas, pagamentos ou dados públicos`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-provider-cost-')), file = join(directory, 'portal.sqlite');
  const open = () => driver === 'sqlite' ? PortalStore.open(file) : PortalStore.open(libsqlDatabase(createClient({ url: `file:${file}`, intMode: 'number' })));
  let store = await open();
  try {
    const account = await store.createPartner('Parceiro custo'), auth = { id: account.id }, ordinary = await store.createAttendant('Atendente original', 5000);
    await store.recordSales(auth, batch(['219', '100', '5', '50']), 'fixture_provider_cost_history');
    const initial = await store.sales(auth);
    for (const sale of initial) {
      if (sale.amountCents === 21900 || sale.amountCents === 5000) await store.reviewSale(sale.id, { status: 'approved', note: 'Original' });
      if (sale.amountCents === 500) await store.reviewSale(sale.id, { status: 'rejected', note: 'Original' });
    }
    await store.cancelSale(initial.find(sale => sale.amountCents === 5000)!.id, { note: 'Cancelamento original' });
    await store.recordSales({ id: ordinary.id }, batch(['100'], 'main'), 'fixture_provider_cost_ordinary');
    await store.setCosts(account.id, today, 5000, 0);await store.savePartnerAds(auth, { date: today, ads: '10' });
    await store.saveProfile(auth, { name: 'Parceiro custo', email: '', phone: '', pixType: 'email', pixKey: 'fixture@example.test', pixOwner: 'Parceiro custo' });
    await store.recordManualPayout({ attendantId: account.id, amount: '20', note: 'PIX já realizado simulado' }, 'fixture_provider_cost_payment');
    const publicBefore = await store.portal(auth, 'all'), ordinaryBefore = await store.portal({ id: ordinary.id }, 'all');
    const receiptBefore = await store.receipt(auth, initial[0].receiptId);
    // Simulate the old schema's missing snapshots. Preserve an explicitly saved cost.
    await store.sql.prepare('UPDATE sales SET gateway_cost_cents=NULL WHERE attendant_id=?').run(account.id);
    const pending = initial.find(sale => sale.amountCents === 10000)!;
    await store.sql.prepare('UPDATE sales SET gateway_cost_cents=777 WHERE id=?').run(pending.id);
    await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    store.close();store = await open();
    const sales = await privateSales(store, account.id);
    assert.equal(sales.find(sale => sale.amountCents === 21900)!.gatewayCostCents, 1511);
    assert.equal(sales.find(sale => sale.amountCents === 500)!.gatewayCostCents, 229);
    assert.equal(sales.find(sale => sale.amountCents === 5000)!.gatewayCostCents, 499);
    assert.equal(sales.find(sale => sale.id === pending.id)!.gatewayCostCents, 777);
    assert.equal((await privateSales(store, ordinary.id))[0].gatewayCostCents, null);
    assert.deepEqual(await store.portal(auth, 'all'), publicBefore);
    assert.deepEqual(await store.portal({ id: ordinary.id }, 'all'), ordinaryBefore);
    assert.deepEqual(await store.receipt(auth, initial[0].receiptId), receiptBefore);
    const accountAdmin = (await store.adminDashboard()).attendants.find(row => row.id === account.id)!;
    assert.deepEqual(accountAdmin.business, { saleCount: 1, partnerFeeCents: 2828, gatewayCostCents: 1511, profitCents: 1317 });
    const report = await readFinancialReport(store, today, today, account.id);
    assert.equal(report.totals.gatewayFeeCents, 2828);assert.equal(report.totals.gatewayCostCents, 1511);assert.equal(report.totals.businessProfitCents, 1317);
    assert.equal(report.totals.netCommissionCents, 19072);assert.equal(report.totals.cashMovementCents, 18389);
    const audits = await readAudit(store, new URLSearchParams({ action: 'partner.gateway_cost_recorded' }));assert.equal(audits.total, 3);
    assert.ok(audits.entries.every(row => row.before?.gatewayCostCents === null && row.after?.feeBps === 599 && row.after?.fixedFeeCents === 199));
    await store.rotateToken(account.id);store.close();store = await open();
    assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.gateway_cost_recorded' }))).total, 3);
    assert.equal((await privateSales(store, account.id)).find(sale => sale.id === pending.id)!.gatewayCostCents, 777);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('falha de migração desfaz custo e auditoria juntos, permitindo nova tentativa', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cost-rollback-')), file = join(directory, 'portal.sqlite');
  let store = await PortalStore.open(file);
  try {
    const account = await store.createPartner('Parceiro rollback');await store.recordSales({ id: account.id }, batch(['100']), 'fixture_provider_cost_rollback');
    await store.sql.exec('UPDATE sales SET gateway_cost_cents=NULL');await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    await store.sql.exec("CREATE TRIGGER stop_cost BEFORE UPDATE OF gateway_cost_cents ON sales BEGIN SELECT RAISE(ABORT,'synthetic cost failure'); END;");
    store.close();await assert.rejects(PortalStore.open(file), /synthetic cost failure/);
    const raw = new DatabaseSync(file);
    try {
      assert.equal(raw.prepare('SELECT gateway_cost_cents FROM sales').get()!.gateway_cost_cents, null);
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='partner.gateway_cost_recorded'").get()!.n, 0);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id=?').get(migration)!.n, 0);
      raw.exec('DROP TRIGGER stop_cost');
    } finally { raw.close(); }
    store = await PortalStore.open(file);assert.equal((await privateSales(store, account.id))[0].gatewayCostCents, 798);
    assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.gateway_cost_recorded' }))).total, 1);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('API guarda custo por venda, ignora custo adulterado e mantém margem privada no admin', async t => {
  const store = await PortalStore.open(':memory:'), token = 'fixture_provider_cost_token_01234567890123456789', key = 'fixture_provider_admin_01234567890123456789';
  const account = await store.createPartner('Parceiro API', token), server = createPortalServer(store, { adminKey: key });server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close();resolve(); });server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const submit = () => fetch(base + '/api/sales', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture_provider_five_sales' }, body: JSON.stringify(batch(['100', '100', '100', '100', '100'])) });
  assert.equal((await submit()).status, 200);assert.equal((await (await submit()).json()).duplicate, true);
  for (const sale of await store.sales({ id: account.id })) await store.reviewSale(sale.id, { status: 'approved', note: '' });
  const call = (path: string, credential: string) => fetch(base + path, { headers: { Authorization: `Bearer ${credential}` } });
  for (const path of ['/api/portal?period=all', '/api/portal?period=today']) {
    const response = await call(path, token);assert.equal(response.status, 200);const data = await response.json();
    assert.ok(!JSON.stringify(data).includes('gatewayCostCents'));assert.ok(!JSON.stringify(data).includes('partnerFeeCents'));
  }
  const adminResponse = await call('/api/admin/dashboard', key);assert.equal(adminResponse.status, 200);
  const admin = await adminResponse.json();assert.deepEqual(admin.attendants[0].business, { saleCount: 5, partnerFeeCents: 7000, gatewayCostCents: 3990, profitCents: 3010 });
  assert.equal(admin.attendants[0].finance.availableCents, 43000);
  assert.ok((await privateSales(store, account.id)).every(sale => sale.gatewayCostCents === 798));
  assert.equal((await call('/api/admin/dashboard', token)).status, 401);
});

test('backups preservam custo salvo e aceitam arquivos antigos sem a coluna de custo', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cost-backup-')), destinationFile = join(directory, 'restored.sqlite');
  const source = await PortalStore.open(':memory:'), full = await PortalStore.open(':memory:');let old = await PortalStore.open(destinationFile);
  try {
    const account = await source.createPartner('Parceiro backup');await source.recordSales({ id: account.id }, batch(['100']), 'fixture_provider_backup');
    await source.sql.exec('UPDATE sales SET gateway_cost_cents=777');
    const bytes = await createArchive(source);await restoreArchive(bytes, full);
    assert.equal((await privateSales(full, account.id))[0].gatewayCostCents, 777);
    const archive = JSON.parse(gunzipSync(bytes).toString());
    const sales = archive.tables.find((table: { name: string }) => table.name === 'sales'), column = sales.columns.indexOf('gateway_cost_cents');
    sales.columns.splice(column, 1);sales.rows.forEach((row: unknown[]) => row.splice(column, 1));
    const migrations = archive.tables.find((table: { name: string }) => table.name === 'schema_migrations');migrations.rows = migrations.rows.filter((row: unknown[]) => row[0] !== migration);
    await restoreArchive(gzipSync(JSON.stringify(archive)), old);
    assert.equal((await privateSales(old, account.id))[0].gatewayCostCents, null);
    old.close();old = await PortalStore.open(destinationFile);
    assert.equal((await privateSales(old, account.id))[0].gatewayCostCents, 798);
    assert.equal((await readAudit(old, new URLSearchParams({ action: 'partner.gateway_cost_recorded' }))).total, 1);
    assert.equal((await old.sales({ id: account.id }))[0].feeCents, 1400);
  } finally { source.close();full.close();old.close();rmSync(directory, { recursive: true, force: true }); }
});
