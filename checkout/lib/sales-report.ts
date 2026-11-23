import { database } from './payments';
import { BIOCAMISAS_ORIGINS } from '@/lib/checkout-brand';

export type SaleRow = {
  id: string; requestId: string; amount: number; state: string; provider: string;
  sellerName: string | null; partnerSlug: string | null; createdAt: number; originLabel: string;
};
export type SalesSummary = {
  totalCount: number; paidCount: number; paidAmountCents: number; testCount: number; testAmountCents: number; pendingCount: number;
};
export type PartnerTotal = { partnerSlug: string | null; totalCount: number; paidCount: number; paidAmountCents: number };
export type SalesFilters = { since: number; until: number; partnerName?: string; status?: string };

export const EMPTY_SALES_SUMMARY: SalesSummary = { totalCount: 0, paidCount: 0, paidAmountCents: 0, testCount: 0, testAmountCents: 0, pendingCount: 0 };

const EXACT_STATES = ['paid', 'test_paid', 'rejected', 'unconfirmed', 'failed', 'expired', 'refunded', 'chargeback', 'cancelled'];
const PENDING_CLAUSE = "o.state IN ('creating','ready','unconfirmed','card_draft','rejected')";
// Orders created through a partner link carry the partner name as sellerName.
const JOIN = 'LEFT JOIN partners p ON o.attendant_id IS NULL AND p.active=1 AND p.name=o.seller_name';
const originLabel = (origin: string | null) => ((BIOCAMISAS_ORIGINS as readonly string[]).includes(origin ?? '') ? 'Bio Camisas' : 'Bravus Pix');

function clauses(filters: SalesFilters): [string, unknown[]] {
  let sql = 'WHERE o.created_at>=? AND o.created_at<?';
  const args: unknown[] = [filters.since, filters.until];
  if (filters.partnerName) { sql += ' AND p.name=?'; args.push(filters.partnerName); }
  if (filters.status === 'pendente') sql += ' AND ' + PENDING_CLAUSE;
  else if (EXACT_STATES.includes(filters.status ?? '')) { sql += ' AND o.state=?'; args.push(filters.status); }
  return [sql, args];
}

export async function salesList(filters: SalesFilters): Promise<SaleRow[]> {
  const [where, args] = clauses(filters);
  const rows = (await database().prepare(`SELECT o.id,o.request_id,o.amount,o.state,o.provider,o.seller_name,p.slug AS partner_slug,o.created_at,o.origin FROM payment_orders o ${JOIN} ${where} ORDER BY o.created_at DESC LIMIT 400`).bind(...args).all()).results as any[];
  return rows.map(r => ({
    id: r.id, requestId: r.request_id, amount: Number(r.amount), state: r.state, provider: r.provider,
    sellerName: r.seller_name ?? null, partnerSlug: r.partner_slug ?? null, createdAt: Number(r.created_at), originLabel: originLabel(r.origin ?? null),
  }));
}

export async function salesSummary(filters: SalesFilters): Promise<SalesSummary> {
  const [where, args] = clauses(filters);
  const row = await database().prepare(`SELECT COUNT(*) AS totalCount,
    SUM(CASE WHEN o.state='paid' THEN 1 ELSE 0 END) AS paidCount,
    SUM(CASE WHEN o.state='paid' THEN o.amount ELSE 0 END) AS paidAmount,
    SUM(CASE WHEN o.state='test_paid' THEN 1 ELSE 0 END) AS testCount,
    SUM(CASE WHEN o.state='test_paid' THEN o.amount ELSE 0 END) AS testAmount,
    SUM(CASE WHEN ${PENDING_CLAUSE} THEN 1 ELSE 0 END) AS pendingCount
    FROM payment_orders o ${JOIN} ${where}`).bind(...args).first();
  return {
    totalCount: Number(row?.totalCount ?? 0), paidCount: Number(row?.paidCount ?? 0), paidAmountCents: Number(row?.paidAmount ?? 0),
    testCount: Number(row?.testCount ?? 0), testAmountCents: Number(row?.testAmount ?? 0), pendingCount: Number(row?.pendingCount ?? 0),
  };
}

export async function salesByPartner(filters: SalesFilters): Promise<PartnerTotal[]> {
  const [where, args] = clauses(filters);
  const rows = (await database().prepare(`SELECT p.slug AS partner_slug, COUNT(*) AS totalCount,
    SUM(CASE WHEN o.state='paid' THEN 1 ELSE 0 END) AS paidCount,
    SUM(CASE WHEN o.state='paid' THEN o.amount ELSE 0 END) AS paidAmount
    FROM payment_orders o ${JOIN} ${where} GROUP BY p.slug ORDER BY paidAmount DESC, totalCount DESC LIMIT 50`).bind(...args).all()).results as any[];
  return rows.map(r => ({
    partnerSlug: r.partner_slug ?? null, totalCount: Number(r.totalCount ?? 0),
    paidCount: Number(r.paidCount ?? 0), paidAmountCents: Number(r.paidAmount ?? 0),
  }));
}
