import { inPeriod, MAX_CONFIRMED_CHECKOUT_CENTS, money } from './domain.ts';
import type { AdminSale, Period } from './domain.ts';

// Internal merchant expense paid to the active gateway. This is deliberately
// separate from the partner tariff and is only exposed to administrator views.
export const PARTNER_PROVIDER_FEE_BPS = 300;
export const PARTNER_PROVIDER_FIXED_FEE_CENTS = 100;
const LEGACY_PARTNER_PROVIDER_FEE_BPS = 599;
const LEGACY_PARTNER_PROVIDER_FIXED_FEE_CENTS = 199;
export type GatewayCostProfile = { basisPoints: number; fixedCents: number; rounding: 'nearest' | 'up' };
export interface PartnerBusinessSummary { saleCount: number; partnerFeeCents: number; gatewayCostCents: number; profitCents: number }
type CostedSale = Pick<AdminSale, 'amountCents' | 'feeCents' | 'gatewayCostCents' | 'status' | 'date'>;

/** Merchant expense, separate from the tariff charged to the partner. Round each transaction. */
export function partnerGatewayCost(amountCents: number, profile?: GatewayCostProfile | null): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CONFIRMED_CHECKOUT_CENTS) throw new Error('Valor inválido para calcular o custo do gateway.');
  // The checkout sync may still return the former default while its gateway
  // settings are being updated. Treat that exact legacy pair as the new
  // internal policy for future sales, without touching saved sale snapshots.
  const current = profile?.basisPoints === LEGACY_PARTNER_PROVIDER_FEE_BPS && profile.fixedCents === LEGACY_PARTNER_PROVIDER_FIXED_FEE_CENTS
    ? { ...profile, basisPoints: PARTNER_PROVIDER_FEE_BPS, fixedCents: PARTNER_PROVIDER_FIXED_FEE_CENTS }
    : profile;
  const basisPoints = current?.basisPoints ?? PARTNER_PROVIDER_FEE_BPS;
  const fixedCents = current?.fixedCents ?? PARTNER_PROVIDER_FIXED_FEE_CENTS;
  const rounding = current?.rounding ?? 'nearest';
  const variable = rounding === 'up'
    ? Math.floor((amountCents * basisPoints + 9999) / 10000)
    : Math.floor((amountCents * basisPoints + 5000) / 10000);
  return variable + fixedCents;
}
export function recordedPartnerGatewayCost(sale: Pick<AdminSale, 'amountCents' | 'gatewayCostCents'>): number {
  if (sale.gatewayCostCents == null) return partnerGatewayCost(sale.amountCents);
  if (!Number.isSafeInteger(sale.gatewayCostCents) || sale.gatewayCostCents < 0) throw new Error('Custo do gateway inválido.');
  return sale.gatewayCostCents;
}
export function partnerGatewayCostLabel() { return '3% + ' + money(PARTNER_PROVIDER_FIXED_FEE_CENTS) + ' por transação'; }
export function calculatePartnerBusiness(sales: CostedSale[], period: Period, today: string, profile?: GatewayCostProfile | null): PartnerBusinessSummary {
  const result: PartnerBusinessSummary = { saleCount: 0, partnerFeeCents: 0, gatewayCostCents: 0, profitCents: 0 };
  for (const sale of sales) {
    if ((sale.status && sale.status !== 'approved') || !inPeriod(sale.date, period, today)) continue;
    result.saleCount++;
    result.partnerFeeCents += sale.feeCents;
    result.gatewayCostCents += sale.gatewayCostCents == null ? partnerGatewayCost(sale.amountCents, profile) : recordedPartnerGatewayCost(sale);
  }
  result.profitCents = result.partnerFeeCents - result.gatewayCostCents;
  return result;
}
