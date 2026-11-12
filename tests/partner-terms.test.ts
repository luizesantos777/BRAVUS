import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { exclusiveCheckoutId } from '../server/partner-checkouts.ts';
import { readAudit, readFinancialReport } from '../server/admin-controls.ts';
import { businessToday, PARTNER_CHECKOUT, saleEarnings, withdrawalFees, validatePayoutAmount, payoutExpectedNet } from '../src/domain.ts';

const migration = 'partners-twelve-percent-history-2026-11-11-v1';
const receipt = { name: 'historico.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = (amounts = ['100'], checkoutId?: string) => ({ date: businessToday(), sales: amounts.map(amount => ({ amount, ...(checkoutId === undefined ? {} : { checkoutId }), time: '12:00', note: 'Venda histórica sintética', receipt })) });
const token = (kind: string) => `fixture_partner_terms_${kind}_01234567890123456789`;
const pix = (name: string) => ({ name, email: '', phone: '', pixType: 'email', pixKey: 'fixture@example.test', pixOwner: name });

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: migra todas as vendas antigas dos parceiros, preserva pagamentos e isola os atendentes`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-terms-')), file = join(directory, 'portal.sqlite');
  const open = () => driver === 'sqlite' ? PortalStore.open(file) : PortalStore.open(libsqlDatabase(createClient({ url: `file:${file}`, intMode: 'number' })));
  let store = await open();
  try {
    const first = await store.createPartner('Parceiro ativo', token('first'));
    const second = await store.createPartner('Parceiro inativo', token('second'));
    const legacy = await store.createAttendant('Parceiro legado', 5000, token('legacy'));
    const ordinary = await store.createAttendant('Atendente', 5000, token('ordinary'));
    const checkoutId = exclusiveCheckoutId(legacy.id);
    await store.sql.prepare('INSERT INTO checkouts (id,name,fee_bps,fixed_fee_cents,min_amount_cents,max_amount_cents) VALUES (?,?,1000,169,1,300000)').run(checkoutId, 'Gateway legado');
    const originalBatch = batch(['100', '199.99', '0.05', '55', '88']);
    await store.recordSales({ id: first.id }, originalBatch, 'fixture_terms_original_batch');
    let firstSales = await store.sales({ id: first.id });
    for (const sale of firstSales.filter(sale => [10000, 19999, 8800].includes(sale.amountCents))) await store.reviewSale(sale.id, { status: 'approved', note: 'Aprovação original' });
    await store.reviewSale(firstSales.find(sale => sale.amountCents === 5500)!.id, { status: 'rejected', note: 'Recusa original' });
    await store.cancelSale(firstSales.find(sale => sale.amountCents === 8800)!.id, { note: 'Cancelamento original' });
    await store.recordSales({ id: second.id }, batch(['150']), 'fixture_terms_second_batch');
    await store.recordSales({ id: legacy.id }, batch(['100'], checkoutId), 'fixture_terms_legacy_batch');
    await store.recordSales({ id: ordinary.id }, batch(['100'], 'main'), 'fixture_terms_regular_batch');
    for (const account of [second, legacy, ordinary]) for (const sale of await store.sales({ id: account.id })) await store.reviewSale(sale.id, { status: 'approved', note: '' });
    await store.saveProfile({ id: first.id }, pix('Parceiro ativo'));
    await store.recordManualPayout({ attendantId: first.id, amount: '20', note: 'PIX histórico real simulado' }, 'fixture_terms_old_paid_payout');
    await store.sql.prepare('UPDATE payouts SET withdrawal_fee_cents=250,gateway_fee_cents=500 WHERE attendant_id=?').run(first.id);
    await store.setCosts(first.id, businessToday(), 1000, 200);
    await store.savePartnerAds({ id: first.id }, { date: businessToday(), ads: '30' });
    await store.sql.prepare('UPDATE attendants SET active=0 WHERE id=?').run(second.id);
    // Reproduce pre-update snapshots, including partial fees and a 50% share.
    await store.sql.exec(`UPDATE sales SET fee_cents=CAST((amount_cents*1000+5000)/10000 AS INTEGER)+169,attendant_fee_cents=CAST((amount_cents*1000+5000)/10000 AS INTEGER),commission_bps=5000,commission_mode='net-share' WHERE attendant_id IN ('${first.id}','${second.id}')`);
    firstSales = await store.sales({ id: first.id });
    const oldPayments = await store.payouts({ id: first.id }), oldCosts = await store.costs({ id: first.id }), oldRegular = await store.portal({ id: ordinary.id }, 'all');
    const oldReceipt = await store.receipt({ id: first.id }, firstSales[0].receiptId);
    await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    store.close();store = await open();
    const partner = await store.portal({ id: first.id }, 'all');
    assert.deepEqual(partner.checkouts, [PARTNER_CHECKOUT]);
    for (const account of [first, second, legacy]) {
      const current = await store.portal({ id: account.id }, 'all');
      assert.equal(current.profile.accountKind, 'partner');assert.equal(current.profile.commissionBps, 10000);
      for (const sale of current.sales) {
        const fee = Math.floor((sale.amountCents * 1200 + 5000) / 10000);
        assert.equal(sale.feeCents, fee);assert.equal(sale.attendantFeeCents, fee);assert.equal(sale.commissionBps, 10000);assert.equal(sale.commissionMode, 'gross-share-less-fees');
      }
    }
    for (const old of firstSales) {
      const current = partner.sales.find(sale => sale.id === old.id)!;
      assert.deepEqual({ ...current, feeCents: old.feeCents, attendantFeeCents: old.attendantFeeCents, commissionBps: old.commissionBps, commissionMode: old.commissionMode }, { ...old });
    }
    assert.deepEqual(await store.payouts({ id: first.id }), oldPayments);assert.deepEqual(await store.costs({ id: first.id }), oldCosts);
    assert.deepEqual(await store.receipt({ id: first.id }, firstSales[0].receiptId), oldReceipt);
    assert.equal((await store.sql.prepare('SELECT active FROM attendants WHERE id=?').get(second.id))!.active, 0);
    assert.deepEqual(await store.portal({ id: ordinary.id }, 'all'), oldRegular);
    const earnings = partner.sales.filter(sale => sale.status === 'approved').reduce((sum, sale) => sum + saleEarnings(sale), 0);
    assert.equal(partner.finance.commissionCents, earnings);assert.equal(partner.finance.availableCents, earnings - 200 - 2000);
    assert.equal(partner.finance.paidPayoutNetCents, 1750);assert.equal(partner.marketing!.ownAdsCents, 3000);
    assert.equal(partner.marketing!.profitCents, earnings - 4000);
    assert.equal((await store.adminDashboard()).attendants.find(account => account.id === first.id)!.finance.availableCents, partner.finance.availableCents);
    const report = await readFinancialReport(store, businessToday(), businessToday(), first.id);assert.equal(report.totals.commissionCents, earnings);
    const audit = await readAudit(store, new URLSearchParams({ action: 'partner.sale_repriced' }));assert.equal(audit.total, 7);
    assert.ok(audit.entries.every(entry => entry.before?.feeCents !== entry.after?.feeCents || entry.before?.commissionBps !== entry.after?.commissionBps));
    assert.equal((await store.recordSales({ id: first.id }, originalBatch, 'fixture_terms_original_batch')).duplicate, true);
    const rotated = await store.rotateToken(first.id);store.close();store = await open();
    assert.equal((await store.authenticate(rotated.token)).id, first.id);assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.sale_repriced' }))).total, 7);
    assert.deepEqual((await store.portal({ id: first.id }, 'all')).finance, partner.finance);
    const payout = { attendantId: first.id, amount: '1', note: 'PIX sem taxa' };
    assert.equal((await store.recordManualPayout(payout, 'fixture_terms_free_payout')).duplicate, false);
    assert.equal((await store.recordManualPayout(payout, 'fixture_terms_free_payout')).duplicate, true);
    const paid = (await store.payouts({ id: first.id })).find(p => p.note === payout.note)!;
    assert.equal(paid.amountCents, 100);assert.equal(paid.withdrawalFeeCents, 0);assert.equal(paid.gatewayFeeCents, 0);
    const legacyPending = await store.requestPayout({ id: first.id }, { amount: '1' });await store.markPayout(legacyPending.id, 'paid', 'Quitação sem taxa');
    assert.equal((await store.payouts({ id: first.id })).find(p => p.id === legacyPending.id)!.withdrawalFeeCents, 0);
    assert.equal((await store.payouts({ id: first.id })).find(p => p.id === legacyPending.id)!.gatewayFeeCents, 0);
    await assert.rejects(store.adminSetCheckout('partner', { name: 'Alteração indevida', fee: '0' }), /padrão de 12%/);
    await assert.rejects(store.adminSetCheckout(checkoutId, { name: 'Alteração indevida', fee: '0' }), /padrão de 12%/);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('falha durante recálculo desfaz taxas, auditoria e marcador antes de tentar novamente', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-terms-rollback-')), file = join(directory, 'portal.sqlite');
  let store = await PortalStore.open(file);
  try {
    const account = await store.createPartner('Parceiro rollback', token('rollback'));
    await store.recordSales({ id: account.id }, batch(), 'fixture_terms_rollback_batch');
    await store.sql.prepare('UPDATE sales SET fee_cents=1000,attendant_fee_cents=1000').run();
    await store.sql.prepare('DELETE FROM schema_migrations WHERE id=?').run(migration);
    await store.sql.exec("CREATE TRIGGER stop_repricing BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END;");
    store.close();await assert.rejects(PortalStore.open(file), /synthetic migration failure/);
    const raw = new DatabaseSync(file);
    try {
      assert.equal(raw.prepare('SELECT fee_cents FROM sales').get()!.fee_cents, 1000);
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='partner.sale_repriced'").get()!.n, 0);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id=?').get(migration)!.n, 0);
      raw.exec('DROP TRIGGER stop_repricing');
    } finally { raw.close(); }
    store = await PortalStore.open(file);assert.equal((await store.sales({ id: account.id }))[0].feeCents, 1200);
    assert.equal((await readAudit(store, new URLSearchParams({ action: 'partner.sale_repriced' }))).total, 1);
  } finally { store.close();rmSync(directory, { recursive: true, force: true }); }
});

test('parceiros têm saque zero, sem permitir valores inválidos nem retirar taxas históricas reais', () => {
  assert.deepEqual(withdrawalFees('partner'), { withdrawalFeeCents: 0, gatewayFeeCents: 0 });
  assert.deepEqual(withdrawalFees('attendant'), { withdrawalFeeCents: 250, gatewayFeeCents: 500 });
  validatePayoutAmount(1, 1, 'partner');assert.throws(() => validatePayoutAmount(250, 300, 'attendant'));
  for (const value of [0, -1, 1.1, NaN, Infinity]) assert.throws(() => validatePayoutAmount(value, 10000, 'partner'));
  assert.throws(() => validatePayoutAmount(101, 100, 'partner'));
  assert.equal(payoutExpectedNet({ amountCents: 1000, status: 'pending', withdrawalFeeCents: 0 }, 'partner'), 1000);
  assert.equal(payoutExpectedNet({ amountCents: 1000, status: 'paid', withdrawalFeeCents: 250 }, 'partner'), 750);
});
