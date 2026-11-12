import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { readAudit, readFinancialReport } from '../server/admin-controls.ts';
import { businessToday, checkoutFee, PARTNER_CHECKOUT, saleEarnings } from '../src/domain.ts';

const migration = 'partners-twelve-percent-plus-two-history-2026-11-12-v1';
const receipt = { name: 'historico.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = (amounts: string[], checkoutId?: string) => ({ date: businessToday(), sales: amounts.map(amount => ({ amount, checkoutId, time: '12:00', note: 'Histórico sintético', receipt })) });

test('parceiro paga 12% + R$ 2 em cada venda, sem agregar tickets nem limitar perdas históricas', () => {
  assert.equal(checkoutFee(10000, PARTNER_CHECKOUT), 1400);
  assert.equal(checkoutFee(21900, PARTNER_CHECKOUT), 2828);
  assert.equal(checkoutFee(300000, PARTNER_CHECKOUT), 36200);
  assert.equal(checkoutFee(5, PARTNER_CHECKOUT), 201);
  assert.equal(Array.from({ length: 5 }, () => checkoutFee(10000, PARTNER_CHECKOUT)).reduce((a, b) => a + b), 7000);
  assert.equal(checkoutFee(50000, PARTNER_CHECKOUT), 6200);
});

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: novas taxas recalculam só o histórico dos parceiros, uma vez, preservando PIX e custo real`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-partner-fixed-')), file = join(directory, 'portal.sqlite');
  const open = () => driver === 'sqlite' ? PortalStore.open(file) : PortalStore.open(libsqlDatabase(createClient({ url: `file:${file}`, intMode: 'number' })));
  let store = await open();
  try {
    const first = await store.createPartner('Parceiro ativo'), second = await store.createPartner('Parceiro revogado');
    const normal = await store.createAttendant('Atendente preservado', 3700), auth = { id: first.id };
    const input = batch(['100', '219', '0.05', '50', '88']);
    await store.recordSales(auth, input, 'fixture_fixed_original_batch');
    const initial = await store.sales(auth);
    for (const sale of initial.filter(sale => [10000, 21900, 8800].includes(sale.amountCents))) await store.reviewSale(sale.id, { status: 'approved', note: 'Conferência original' });
    await store.cancelSale(initial.find(sale => sale.amountCents === 8800)!.id, { note: 'Cancelamento original' });
    await store.reviewSale(initial.find(sale => sale.amountCents === 5000)!.id, { status: 'rejected', note: 'Recusa original' });
    await store.recordSales({ id: second.id }, batch(['3000', '199.99']), 'fixture_fixed_revoked_batch');
    await store.sql.prepare('INSERT INTO checkouts (id,name,fee_bps,fixed_fee_cents,min_amount_cents,max_amount_cents) VALUES (?,?,1200,0,1,300000)').run('exclusive_' + second.id, 'Gateway exclusivo');
    await store.adminSetCheckout('main', { name: 'Tarifa do atendente', fee: '17', fixedFee: '3', higherTier: null });
    await store.recordSales({ id: normal.id }, batch(['100'], 'main'), 'fixture_fixed_attendant_batch');
    await store.reviewSale((await store.sales({ id: normal.id }))[0].id, { status: 'approved', note: 'Atendente aprovado' });
    await store.saveProfile(auth, { name: 'Parceiro ativo', email: '', phone: '', pixType: 'email', pixKey: 'fixture@example.test', pixOwner: 'Parceiro ativo' });
    await store.recordManualPayout({ attendantId: first.id, amount: '20', note: 'PIX já pago' }, 'fixture_fixed_paid_pix');
    await store.sql.prepare('UPDATE payouts SET withdrawal_fee_cents=250,gateway_fee_cents=500 WHERE attendant_id=?').run(first.id);
    await store.setCosts(first.id, businessToday(), 1000, 200);
    await store.savePartnerAds(auth, { date: businessToday(), ads: '30' });
    await store.sql.prepare('UPDATE attendants SET active=0 WHERE id=?').run(second.id);
    // Reproduce the previous 12%-only snapshots in every partner sale status.
    await store.sql.exec("UPDATE sales SET fee_cents=CAST((amount_cents*1200+5000)/10000 AS INTEGER),attendant_fee_cents=CAST((amount_cents*1200+5000)/10000 AS INTEGER) WHERE attendant_id IN (SELECT id FROM attendants WHERE account_kind='partner')");
    await store.sql.prepare('UPDATE sales SET gateway_cost_cents=777 WHERE id=?').run(initial.find(sale => sale.amountCents === 21900)!.id);
    await store.sql.prepare("UPDATE checkouts SET fixed_fee_cents=0 WHERE id='partner'").run();
    const oldNormal = await store.portal({ id: normal.id }, 'all');
    const oldSales = await store.sql.prepare('SELECT * FROM sales ORDER BY id').all();
    const oldPayments = await store.payouts(auth), oldCosts = await store.costs(auth);
    const oldReceipt = await store.receipt(auth, initial[0].receiptId);
    await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    store.close();store = await open();
    const after = await store.sql.prepare('SELECT * FROM sales ORDER BY id').all();
    const partnerIds = new Set<string>([first.id, second.id]);
    for (const before of oldSales) {
      const current = after.find(sale => sale.id === before.id)!;
      if (!partnerIds.has(String(before.attendant_id))) { assert.deepEqual(current, before);continue; }
      const fee = Math.floor((Number(before.amount_cents) * 1200 + 5000) / 10000) + 200;
      assert.equal(current.fee_cents, fee);assert.equal(current.attendant_fee_cents, fee);
      assert.deepEqual({ ...current, fee_cents: before.fee_cents, attendant_fee_cents: before.attendant_fee_cents }, { ...before });
    }
    assert.deepEqual(await store.portal({ id: normal.id }, 'all'), oldNormal);
    assert.deepEqual(await store.payouts(auth), oldPayments);
    assert.deepEqual(await store.costs(auth), oldCosts);
    assert.deepEqual(await store.receipt(auth, initial[0].receiptId), oldReceipt);
    assert.equal((await store.sql.prepare('SELECT active FROM attendants WHERE id=?').get(second.id))!.active, 0);
    assert.equal((await store.checkouts()).find(checkout => checkout.id === 'partner')!.fixedFeeCents, 200);
    assert.equal((await store.portal(auth)).checkouts[0].fixedFeeCents, 200);
    assert.equal((await store.checkoutsFor({ id: second.id }))[0].fixedFeeCents, 200);
    const publicData = await store.portal(auth, 'all');
    assert.equal(publicData.finance.commissionCents, 27672);assert.equal(publicData.finance.availableCents, 25472);
    assert.equal(publicData.marketing!.profitCents, 23672);assert.equal(publicData.marketing!.ownAdsCents, 3000);
    assert.ok(!JSON.stringify(publicData).includes('gatewayCostCents'));
    const small = publicData.sales.find(sale => sale.amountCents === 5)!;assert.equal(saleEarnings(small), -196);
    const report = await readFinancialReport(store, businessToday(), businessToday(), first.id);
    assert.equal(report.totals.gatewayFeeCents, 4228);assert.equal(report.totals.gatewayCostCents, 1575);assert.equal(report.totals.businessProfitCents, 2403);
    assert.equal(report.totals.paidPayoutNetCents, 1750);
    const audits = await readAudit(store, new URLSearchParams({ action: 'partner.sale_tariff_updated' }));assert.equal(audits.total, 7);
    assert.ok(audits.entries.every(entry => Number(entry.after?.feeCents) - Number(entry.before?.feeCents) === 200));
    assert.equal((await store.recordSales(auth, input, 'fixture_fixed_original_batch')).duplicate, true);
    const rotated = await store.rotateToken(first.id);store.close();store = await open();
    assert.equal((await store.authenticate(rotated.token)).id, first.id);
    assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.sale_tariff_updated' }))).total, 7);
    assert.deepEqual((await store.portal(auth, 'all')).finance, publicData.finance);
    await store.recordManualPayout({ attendantId: first.id, amount: '1', note: 'Sem saque' }, 'fixture_fixed_new_payment');
    const paid = (await store.payouts(auth)).find(item => item.note === 'Sem saque')!;
    assert.equal(paid.withdrawalFeeCents, 0);assert.equal(paid.gatewayFeeCents, 0);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('falha no recálculo reverte snapshots, auditoria e marcador; nova tentativa conclui', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-fixed-rollback-')), file = join(directory, 'portal.sqlite');let store = await PortalStore.open(file);
  try {
    const account = await store.createPartner('Rollback');await store.recordSales({ id: account.id }, batch(['100']), 'fixture_fixed_rollback');
    await store.sql.exec('UPDATE sales SET fee_cents=1200,attendant_fee_cents=1200');await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    await store.sql.exec("CREATE TRIGGER stop_fixed BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'synthetic fixed failure'); END;");
    store.close();await assert.rejects(PortalStore.open(file), /synthetic fixed failure/);
    const raw = new DatabaseSync(file);
    try {
      assert.equal(raw.prepare('SELECT fee_cents FROM sales').get()!.fee_cents, 1200);
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='partner.sale_tariff_updated'").get()!.n, 0);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id=?').get(migration)!.n, 0);raw.exec('DROP TRIGGER stop_fixed');
    } finally { raw.close(); }
    store = await PortalStore.open(file);assert.equal((await store.sales({ id: account.id }))[0].feeCents, 1400);
    assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.sale_tariff_updated' }))).total, 1);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('backup anterior conserva os registros na restauração e aplica 12% + R$ 2 ao reiniciar a API', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-fixed-backup-')), file = join(directory, 'restored.sqlite');
  const source = await PortalStore.open(':memory:');let restored = await PortalStore.open(file);
  try {
    const account = await source.createPartner('Backup'), auth = { id: account.id };
    await source.recordSales(auth, batch(['100']), 'fixture_fixed_backup');
    await source.sql.exec('UPDATE sales SET fee_cents=1200,attendant_fee_cents=1200,gateway_cost_cents=777');
    await source.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    await restoreArchive(await createArchive(source), restored);
    assert.equal((await restored.sales(auth))[0].feeCents, 1200);
    restored.close();restored = await PortalStore.open(file);
    assert.equal((await restored.sales(auth))[0].feeCents, 1400);
    assert.equal((await restored.adminSales('all', account.id)).sales[0].gatewayCostCents, 777);
    assert.equal((await readAudit(restored, new URLSearchParams({ action: 'partner.sale_tariff_updated' }))).total, 1);
  } finally { source.close();restored.close();rmSync(directory, { recursive: true, force: true }); }
});
