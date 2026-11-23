import { inPeriod, MAX_CONFIRMED_CHECKOUT_CENTS, money } from './domain.ts';
import type { AdminSale, Period } from './domain.ts';

export const PARTNER_PROVIDER_FEE_BPS = 599;
export const PARTNER_PROVIDER_FIXED_FEE_CENTS = 199;
export type GatewayCostProfile = { basisPoints: number; fixedCents: number; rounding: 'nearest' | 'up' };
export interface PartnerBusinessSummary { saleCount: number; partnerFeeCents: number; gatewayCostCents: number; profitCents: number }
type CostedSale = Pick<AdminSale, 'amountCents' | 'feeCents' | 'gatewayCostCents' | 'status' | 'date'>;

/** Merchant expense, separate from the tariff charged to the partner. Round each transaction. */
export function partnerGatewayCost(amountCents: number, profile?: GatewayCostProfile | null): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CONFIRMED_CHECKOUT_CENTS) throw new Error('Valor inválido para calcular o custo do gateway.');
  const basisPoints = profile?.basisPoints ?? PARTNER_PROVIDER_FEE_BPS;
  const fixedCents = profile?.fixedCents ?? PARTNER_PROVIDER_FIXED_FEE_CENTS;
  const rounding = profile?.rounding ?? 'nearest';
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
export function partnerGatewayCostLabel() { return '5,99% + ' + money(PARTNER_PROVIDER_FIXED_FEE_CENTS) + ' por transação'; }
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
