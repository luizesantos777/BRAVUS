import { inPeriod, MAX_SALE_CENTS, money } from './domain.ts';
import type { AdminSale, Period } from './domain.ts';

export const PARTNER_PROVIDER_FEE_BPS = 599;
export const PARTNER_PROVIDER_FIXED_FEE_CENTS = 199;
export interface PartnerBusinessSummary { saleCount: number; partnerFeeCents: number; gatewayCostCents: number; profitCents: number }
type CostedSale = Pick<AdminSale, 'amountCents' | 'feeCents' | 'gatewayCostCents' | 'status' | 'date'>;

/** Merchant expense, separate from the tariff charged to the partner. Round each transaction. */
export function partnerGatewayCost(amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_SALE_CENTS) throw new Error('Valor inválido para calcular o custo do gateway.');
  return Math.floor((amountCents * PARTNER_PROVIDER_FEE_BPS + 5000) / 10000) + PARTNER_PROVIDER_FIXED_FEE_CENTS;
}
export function recordedPartnerGatewayCost(sale: Pick<AdminSale, 'amountCents' | 'gatewayCostCents'>): number {
  if (sale.gatewayCostCents == null) return partnerGatewayCost(sale.amountCents);
  if (!Number.isSafeInteger(sale.gatewayCostCents) || sale.gatewayCostCents < 0) throw new Error('Custo do gateway inválido.');
  return sale.gatewayCostCents;
}
export function partnerGatewayCostLabel() { return '5,99% + ' + money(PARTNER_PROVIDER_FIXED_FEE_CENTS) + ' por transação'; }
export function calculatePartnerBusiness(sales: CostedSale[], period: Period, today: string): PartnerBusinessSummary {
  const result: PartnerBusinessSummary = { saleCount: 0, partnerFeeCents: 0, gatewayCostCents: 0, profitCents: 0 };
  for (const sale of sales) {
    if ((sale.status && sale.status !== 'approved') || !inPeriod(sale.date, period, today)) continue;
    result.saleCount++;
    result.partnerFeeCents += sale.feeCents;
    result.gatewayCostCents += recordedPartnerGatewayCost(sale);
  }
  result.profitCents = result.partnerFeeCents - result.gatewayCostCents;
  return result;
}
