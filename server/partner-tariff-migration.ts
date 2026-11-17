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
  migration: 'named-capital-20-percent-from-2026-11-17-v6',
  name: 'capital', effectiveFrom: '2026-11-17', feeBps: 2000, fixedFeeCents: 0,
  accountCreatedBefore: '2026-11-18T03:00:00.000Z',
} as const;

/** Called inside initialize's write transaction, after earlier default migrations. */
export async function applyRequestedPartnerTariff(db: SqlDatabase) {
  await applyTariff(db, REQUESTED_PARTNER_TARIFF);
  await restoreCapitalHistory(db);
  await applyTariff(db, CAPITAL_PARTNER_TARIFF);
}

async function applyTariff(db: SqlDatabase, rule: { migration: string; name: string; effectiveFrom: string; feeBps: number; fixedFeeCents: number; accountCreatedBefore: string; allSales?: boolean }) {
  if (await db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(rule.migration)) return;
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

/** Recover the values recorded before the retroactive Capital tariff migrations. */
async function restoreCapitalHistory(db: SqlDatabase) {
  const rule = CAPITAL_PARTNER_TARIFF;
  if (await db.prepare('SELECT id FROM schema_migrations WHERE id=?').get(rule.migration)) return;
  const accounts = await db.prepare("SELECT id, name FROM attendants WHERE account_kind='partner' AND active=1 AND lower(trim(name))=? AND created_at<?").all(rule.name, rule.accountCreatedBefore);
  if (accounts.length !== 1) return;
  const account = accounts[0], actor = { id: 'system', name: 'Sistema / correção de vigência solicitada' };
  const tariff = await db.prepare("SELECT before_json FROM audit_events WHERE target_id=? AND action='partner.tariff_changed' AND actor_id='system' ORDER BY created_at ASC, rowid ASC LIMIT 1").get(String(account.id));
  if (tariff) {
    const original = JSON.parse(String(tariff.before_json));
    await db.prepare('UPDATE attendants SET partner_fee_rules=? WHERE id=?').run(original.rules, String(account.id));
  }
  const sales = await db.prepare('SELECT id, fee_cents, attendant_fee_cents, commission_bps, commission_mode FROM sales WHERE attendant_id=? AND date<?').all(String(account.id), rule.effectiveFrom);
  for (const sale of sales) {
    const audit = await db.prepare("SELECT before_json FROM audit_events WHERE target_id=? AND action='partner.dated_sale_repriced' AND actor_id='system' ORDER BY created_at ASC, rowid ASC LIMIT 1").get(String(sale.id));
    if (!audit) continue;
    const original = JSON.parse(String(audit.before_json));
    await appendAudit(db, actor, 'partner.dated_sale_repriced', String(sale.id), String(account.name), { feeCents: Number(sale.fee_cents), attendantFeeCents: sale.attendant_fee_cents == null ? null : Number(sale.attendant_fee_cents), commissionBps: Number(sale.commission_bps), commissionMode: String(sale.commission_mode) }, original);
    await db.prepare('UPDATE sales SET fee_cents=?, attendant_fee_cents=?, commission_bps=?, commission_mode=? WHERE id=?').run(original.feeCents, original.attendantFeeCents, original.commissionBps, original.commissionMode, String(sale.id));
  }
}
