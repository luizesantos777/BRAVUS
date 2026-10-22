import { businessToday, payoutNet, saleEarnings, validDate } from './domain.ts';
import type { AdminAttendant, AdminCost, AdminPayout, AdminSale } from './domain.ts';

export const auditActions = {
  'sale.approved': 'Venda aprovada', 'sale.rejected': 'Venda recusada',
  'sales.submitted': 'Vendas lançadas', 'costs.updated': 'Custos alterados',
  'checkout.updated': 'Taxas alteradas', 'payout.paid': 'Repasse confirmado',
  'payout.cancelled': 'Repasse cancelado', 'attendant.created': 'Atendente cadastrado',
  'attendant.access_changed': 'Acesso alterado', 'attendant.token_rotated': 'Token renovado',
} as const;
export type AuditAction = keyof typeof auditActions;
export type AuditValues = Record<string, string | number | boolean | null>;
export interface AuditEntry { id: string; createdAt: string; actorName: string; action: AuditAction; targetId: string; targetName: string; before: AuditValues | null; after: AuditValues | null }
export interface AuditPage { entries: AuditEntry[]; total: number; page: number; pageSize: number }
export interface FinancialTotals {
  count: number; pendingCount: number; rejectedCount: number; grossCents: number;
  gatewayFeeCents: number; commissionCents: number; adsCents: number; adjustmentsCents: number;
  netCommissionCents: number; paidPayoutCents: number; paidPayoutNetCents: number;
  withdrawalGatewayFeeCents: number; attendantWithdrawalFeeCents: number; businessWithdrawalFeeCents: number;
  businessProfitCents: number; cashMovementCents: number;
}
export interface FinancialRow extends FinancialTotals { attendantId: string; attendantName: string }
export interface FinancialReport { start: string; end: string; generatedAt: string; totals: FinancialTotals; attendants: FinancialRow[] }
export interface BackupRecord { id: string; kind: 'daily' | 'manual'; status: 'running' | 'verified' | 'failed'; startedAt: string; verifiedAt: string | null; sizeBytes: number; error: string }
export interface BackupStatus { configured: boolean; destination: 'private-blob' | 'private-folder' | 'unconfigured'; scheduled: boolean; automatic: string; retentionDays: number; records: BackupRecord[] }

export function validateDateRange(start: string, end: string) {
  if (!validDate(start) || !validDate(end) || start > end || end > businessToday()) throw new Error('Informe um período válido, com início até o fim e sem datas futuras.');
}
export function financialReport(input: { attendants: Pick<AdminAttendant, 'id' | 'name'>[]; sales: AdminSale[]; costs: AdminCost[]; payouts: AdminPayout[] }, start: string, end: string, attendantId = ''): FinancialReport {
  validateDateRange(start, end);
  const inside = (date: string) => date >= start && date <= end;
  const empty = (): FinancialTotals => ({ count: 0, pendingCount: 0, rejectedCount: 0, grossCents: 0, gatewayFeeCents: 0, commissionCents: 0, adsCents: 0, adjustmentsCents: 0, netCommissionCents: 0, paidPayoutCents: 0, paidPayoutNetCents: 0, withdrawalGatewayFeeCents: 0, attendantWithdrawalFeeCents: 0, businessWithdrawalFeeCents: 0, businessProfitCents: 0, cashMovementCents: 0 });
  const rows = new Map(input.attendants.filter(a => !attendantId || a.id === attendantId).map(a => [a.id, { ...empty(), attendantId: a.id, attendantName: a.name }]));
  for (const sale of input.sales) {
    const row = rows.get(sale.attendantId); if (!row || !inside(sale.date)) continue;
    if (sale.status === 'pending') { row.pendingCount++; continue; }
    if (sale.status === 'rejected') { row.rejectedCount++; continue; }
    row.count++; row.grossCents += sale.amountCents; row.gatewayFeeCents += sale.feeCents; row.commissionCents += saleEarnings(sale);
  }
  for (const cost of input.costs) {
    const row = rows.get(cost.attendantId); if (!row || !inside(cost.date)) continue;
    row.adsCents += cost.adsCents; row.adjustmentsCents += cost.withdrawalFeeCents;
  }
  for (const payout of input.payouts) {
    const row = rows.get(payout.attendantId);
    if (!row || payout.status !== 'paid' || !inside(businessToday(new Date(payout.paidAt ?? payout.requestedAt)))) continue;
    row.paidPayoutCents += payout.amountCents; row.paidPayoutNetCents += payoutNet(payout);
    row.withdrawalGatewayFeeCents += payout.gatewayFeeCents ?? 0; row.attendantWithdrawalFeeCents += payout.withdrawalFeeCents ?? 0;
  }
  const totals = empty();
  for (const row of rows.values()) {
    row.businessWithdrawalFeeCents = row.withdrawalGatewayFeeCents - row.attendantWithdrawalFeeCents;
    row.netCommissionCents = row.commissionCents - row.adsCents - row.adjustmentsCents - row.attendantWithdrawalFeeCents;
    // ADS and adjustments are expenses fully charged to the attendant. Payouts settle
    // an already accrued commission; subtracting them from profit again would double-count.
    row.businessProfitCents = row.grossCents - row.gatewayFeeCents - row.commissionCents - row.businessWithdrawalFeeCents;
    row.cashMovementCents = row.grossCents - row.gatewayFeeCents - row.adsCents - row.adjustmentsCents - row.paidPayoutNetCents - row.withdrawalGatewayFeeCents;
    for (const key of Object.keys(totals) as (keyof FinancialTotals)[]) totals[key] += row[key];
  }
  return { start, end, generatedAt: new Date().toISOString(), totals, attendants: [...rows.values()].sort((a, b) => a.attendantName.localeCompare(b.attendantName, 'pt-BR')) };
}

export function financialCsv(report: FinancialReport): string {
  const text = (value: string) => '"' + (/^[\s]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  const headings = ['Atendente', 'Início', 'Fim', 'Vendas aprovadas', 'Faturamento', 'Taxas de venda', 'Comissão após taxas de venda', 'ADS', 'Ajustes', 'Parte do atendente no saque', 'Comissão após descontos', 'Repasses brutos pagos', 'PIX líquido pago', 'Taxa total de saque', 'Parte BRAVUS no saque', 'Lucro BRAVUS', 'Movimentação de caixa'];
  const row = (name: string, values: FinancialTotals) => [text(name), report.start, report.end, values.count, ...(['grossCents', 'gatewayFeeCents', 'commissionCents', 'adsCents', 'adjustmentsCents', 'attendantWithdrawalFeeCents', 'netCommissionCents', 'paidPayoutCents', 'paidPayoutNetCents', 'withdrawalGatewayFeeCents', 'businessWithdrawalFeeCents', 'businessProfitCents', 'cashMovementCents'] as const).map(key => (values[key] / 100).toFixed(2).replace('.', ','))].join(';');
  return '\uFEFF' + [headings.map(text).join(';'), ...report.attendants.map(a => row(a.attendantName, a)), row('TOTAL', report.totals)].join('\r\n') + '\r\n';
}
