import { refreshBuckPayment } from './buckpay';
import { readElevaPayment } from './eleva';
import { refreshGestaoPayment } from './gestao';
import { database } from './payments';

const RECENT_PAYMENT_MS = 3 * 24 * 60 * 60 * 1000;
const RECONCILIATION_INTERVAL_MS = 60 * 1000;
const AUTO_STARTED_KEY = 'portal_checkout_auto_started_at';
const NEXT_RECONCILIATION_KEY = 'portal_checkout_next_reconciliation_at';

type PendingPayment = {
  id: string;
  amount: number;
  state: string;
  checked_at: number;
  transaction_id: string | null;
  attendant_id: string;
  provider: 'buckpay' | 'eleva' | 'gestao';
};

const refresh = {
  buckpay: refreshBuckPayment,
  eleva: (row: PendingPayment) => readElevaPayment(row, 10_000),
  gestao: refreshGestaoPayment,
};

export async function reconcileCheckoutPayments(): Promise<void> {
  const now = Date.now();
  const db = database();
  const claim = await db.prepare(`
    INSERT INTO payment_settings (key, value)
    SELECT ?, ? WHERE EXISTS (SELECT 1 FROM payment_settings WHERE key = ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE CAST(payment_settings.value AS INTEGER) <= ?
  `).bind(NEXT_RECONCILIATION_KEY, String(now + RECONCILIATION_INTERVAL_MS), AUTO_STARTED_KEY, now).run();
  if (!claim.meta?.changes) return;

  // Pending orders are confirmed by the provider's authenticated status endpoint.
  const { results } = await db.prepare(`
    SELECT id, amount, state, checked_at, transaction_id, attendant_id, provider
    FROM payment_orders
    WHERE attendant_id IS NOT NULL AND state = 'ready'
      AND provider IN ('buckpay', 'eleva', 'gestao')
      AND (provider = 'buckpay' OR transaction_id IS NOT NULL)
      AND created_at >= (SELECT CAST(value AS INTEGER) FROM payment_settings WHERE key = ?)
      AND created_at >= ? AND checked_at < ?
    ORDER BY checked_at ASC, created_at ASC LIMIT 4
  `).bind(AUTO_STARTED_KEY, now - RECENT_PAYMENT_MS, now - RECONCILIATION_INTERVAL_MS).all();

  await Promise.allSettled((results as PendingPayment[]).map(row => refresh[row.provider](row)));
}
