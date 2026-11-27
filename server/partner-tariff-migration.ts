import { partnerTariffAt } from '../src/domain.ts';
import type { PartnerFeeRule } from '../src/domain.ts';
import type { SqlDatabase } from './database.ts';
import { appendAudit } from './controls-schema.ts';

export const REQUESTED_PARTNER_TARIFF = {
  migration: 'named-parceiro-14-percent-from-2026-11-13-v2',
  name: 'parceiro', effectiveFrom: '2026-11-13', feeBps: 1400, fixedFeeCents: 200,
  // This account already appears in the owner's report through November 12.
  // Do not attach the request to a similarly named account created afterwards.
  accountCreatedBefore: '2026-11-13T03:00:00.000Z',
} as const;

export const CAPITAL_PARTNER_TARIFF = {
  migration: 'named-capital-15-percent-200-all-sales-v7',
  name: 'capital', effectiveFrom: '0001-01-01', feeBps: 1500, fixedFeeCents: 200,
  allSales: true,
  accountCreatedBefore: '2026-11-18T03:00:00.000Z',
} as const;

// Solicitado em 27/11/2026: parceiro Techninho passa para 17% + R$ 2,00 em
// todas as vendas dele (retroativo, com repricing do histórico — mesmo padrão
// da tarifa do capital). O nome exato evita colisão com contas homônimas.
export const TECNINHO_PARTNER_TARIFF = {
  migration: 'named-techninho-17-percent-200-all-sales-v1',
  name: 'techninho', effectiveFrom: '0001-01-01', feeBps: 1700, fixedFeeCents: 200,
  allSales: true,
  accountCreatedBefore: '2999-12-31T23:59:59.999Z',
} as const;

/** Called inside initialize's write transaction, after earlier default migrations. */
export async function applyRequestedPartnerTariff(db: SqlDatabase) {
  await applyTariff(db, REQUESTED_PARTNER_TARIFF);
  await applyTariff(db, CAPITAL_PARTNER_TARIFF);
  await applyTariff(db, TECNINHO_PARTNER_TARIFF);
}

async function applyTariff(db: SqlDatabase, rule: { migration: string; name: string; effectiveFrom: string; feeBps: number; fixedFeeCents: number; accountCreatedBefore: string; allSales?: boolean }) {
  if (await db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(rule.migration)) return;
  if (rule.migration.startsWith('named-techninho')) {
    // Diagnóstico temporário (27/11/2026): remover após confirmar o match em produção.
    try {
      const pred = await db.prepare("SELECT typeof(?) AS t1, length(?) AS len1, hex(?) AS hex1, (lower(trim(name)) = 'techninho') AS lit1, (lower(name) = 'techninho') AS lit2, (name = 'TECNINHO') AS lit3, (trim(name) = ?) AS p_upper, (lower(trim(name)) = ?) AS p_lower FROM attendants WHERE id = '35d883b5-1ee8-41e8-8143-83fd72cad9bf'").all('techninho', 'techninho', 'techninho', 'TECNINHO', rule.name);
      console.log('TECHDIAG pred:', JSON.stringify(pred));
    } catch (error) {
      console.log('TECHDIAG err', String(error));
    }
  }
  const matches = await db.prepare("SELECT id, name, partner_fee_rules FROM attendants WHERE account_kind='partner' AND active=1 AND lower(trim(name))=? AND created_at<?").all(rule.name, rule.accountCreatedBefore);
  // Never guess between duplicate names or create an account to match the request.
  if (matches.length !== 1) return;
  const account = matches[0], oldRules = String(account.partner_fee_rules), actor = { id: 'system', name: 'Sistema / alteração solicitada' };
  const rules: PartnerFeeRule[] = rule.allSales ? [] : (JSON.parse(oldRules) as PartnerFeeRule[]).filter(item => item.effectiveFrom !== rule.effectiveFrom);
  rules.push({ effectiveFrom: rule.effectiveFrom, feeBps: rule.feeBps, fixedFeeCents: rule.fixedFeeCents });
  rules.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  await db.prepare('UPDATE attendants SET partner_fee_rules=? WHERE id=?').run(JSON.stringify(rules), String(account.id));
  await appendAudit(db, actor, 'partner.tariff_changed', String(account.id), String(account.name), { rules: oldRules }, { rules: JSON.stringify(rules), effectiveFrom: rule.effectiveFrom, feeBps: rule.feeBps, fixedFeeCents: rule.fixedFeeCents });
  const sales = await db.prepare('SELECT id, date, amount_cents, fee_cents, attendant_fee_cents, commission_bps, commission_mode FROM sales WHERE attendant_id=? AND date>=?').all(String(account.id), rule.effectiveFrom);
  for (const sale of sales) {
    const tariff = partnerTariffAt(rules, String(sale.date));
    const fee = Math.floor((Number(sale.amount_cents) * tariff.feeBps + 5000) / 10000) + tariff.fixedFeeCents;
    if (Number(sale.fee_cents) === fee && Number(sale.attendant_fee_cents) === fee && sale.attendant_fee_cents !== null && Number(sale.commission_bps) === 10000 && sale.commission_mode === 'gross-share-less-fees') continue;
    const before = { date: String(sale.date), feeCents: Number(sale.fee_cents), attendantFeeCents: sale.attendant_fee_cents == null ? null : Number(sale.attendant_fee_cents), commissionBps: Number(sale.commission_bps), commissionMode: String(sale.commission_mode) };
    const after = { date: String(sale.date), feeCents: fee, attendantFeeCents: fee, commissionBps: 10000, commissionMode: 'gross-share-less-fees' };
    await appendAudit(db, actor, 'partner.dated_sale_repriced', String(sale.id), String(account.name), before, after);
    await db.prepare("UPDATE sales SET fee_cents=?, attendant_fee_cents=?, commission_bps=10000, commission_mode='gross-share-less-fees' WHERE id=?").run(fee, fee, String(sale.id));
  }
  await db.prepare('INSERT INTO schema_migrations VALUES (?)').run(rule.migration);
}
