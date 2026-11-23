import { database, validId } from './payments';
import { buildReceiptPdf, saoPauloStamp, toBase64 } from './sales-webhook';
import { isCheckoutAmount } from './checkout-amount';
import { recordWebhookFailure } from './operational-health';

const PORTAL_SALES_URL = 'https://bravus-omega.vercel.app/api/integrations/checkout-sales';
const enabledSince = "(SELECT CAST(value AS INTEGER) FROM payment_settings WHERE key='portal_checkout_auto_started_at')";
const leaseMs = 30_000;
const retryMaxMs = 30 * 60_000;
const allowedProviders = ['atlas', 'beehive', 'beehive_card', 'buckpay', 'eleva', 'gestao', 'poseidon'];
const proofRegex = /^[a-f0-9]{64}$/;

export type CheckoutSaleProof = { orderId: string; proof: string };

export function readCheckoutSaleProof(value: unknown): CheckoutSaleProof | null {
  if (!value || typeof value !== 'object') return null;
  const { orderId, proof } = value as Partial<CheckoutSaleProof>;
  return typeof orderId === 'string' && validId(orderId) && typeof proof === 'string' && proofRegex.test(proof)
    ? { orderId, proof } : null;
}

export async function confirmedCheckoutSale({ orderId, proof }: CheckoutSaleProof) {
  const row = await database().prepare(`
    SELECT p.id,p.request_id,p.attendant_id,p.amount,p.seller_name,p.provider,p.created_at,p.origin
    FROM payment_orders p JOIN checkout_sale_deliveries d ON d.order_id=p.id
    WHERE p.id=? AND d.proof=? AND p.attendant_id IS NOT NULL AND p.state='paid' AND p.created_at>=${enabledSince}
  `).bind(orderId, proof).first();
  if (!row || !allowedProviders.includes(row.provider)) return null;
  const amountCents = Number(row.amount);
  if (!isCheckoutAmount(amountCents)) return null;
  const stamp = saoPauloStamp(Number(row.created_at));
  const amount = Math.floor(amountCents / 100) + ',' + String(amountCents % 100).padStart(2, '0');
  const pdf = buildReceiptPdf({
    id: row.id, requestId: row.request_id, amount: amountCents, state: 'paid',
    provider: row.provider, sellerName: row.seller_name, createdAt: Number(row.created_at), origin: row.origin,
  }, amount, stamp);
  return {
    orderId: row.id, accountId: row.attendant_id, amountCents, provider: row.provider, ...stamp,
    receipt: { name: 'comprovante-checkout-bravus.pdf', mime: 'application/pdf', base64: toBase64(pdf) },
  };
}

function randomProof() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function deliverSale(orderId: string, now: number): Promise<void> {
  const db = database();
  await db.prepare('INSERT INTO checkout_sale_deliveries (order_id,proof) VALUES (?,?) ON CONFLICT(order_id) DO NOTHING')
    .bind(orderId, randomProof()).run();
  const leaseUntil = now + leaseMs;
  const claim = await db.prepare('UPDATE checkout_sale_deliveries SET retry_at=?,attempts=attempts+1 WHERE order_id=? AND delivered_at IS NULL AND retry_at<=?')
    .bind(leaseUntil, orderId, now).run();
  if (!claim.meta?.changes) return;
  const delivery = await db.prepare('SELECT proof,attempts FROM checkout_sale_deliveries WHERE order_id=?').bind(orderId).first();
  let status: number | undefined;
  try {
    const response = await fetch(PORTAL_SALES_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, proof: delivery.proof }),
      signal: AbortSignal.timeout(12_000),
    });
    status = response.status;
    if (!response.ok || (await response.json() as { processed?: boolean } | null)?.processed !== true) {
      throw new Error('Portal did not confirm checkout sale');
    }
    await db.prepare('UPDATE checkout_sale_deliveries SET delivered_at=? WHERE order_id=? AND delivered_at IS NULL')
      .bind(Date.now(), orderId).run();
  } catch {
    void recordWebhookFailure('legacy_portal', status ?? 503).catch(() => {});
    const next = Date.now() + Math.min(retryMaxMs, leaseMs * 2 ** Math.min(Number(delivery.attempts), 8));
    await db.prepare('UPDATE checkout_sale_deliveries SET retry_at=? WHERE order_id=? AND delivered_at IS NULL AND retry_at=?')
      .bind(next, orderId, leaseUntil).run();
  }
}

export async function drainCheckoutSales(): Promise<void> {
  const now = Date.now();
  const { results } = await database().prepare(`
    SELECT p.id FROM payment_orders p LEFT JOIN checkout_sale_deliveries d ON d.order_id=p.id
    WHERE p.state='paid' AND p.attendant_id IS NOT NULL AND p.created_at>=${enabledSince}
      AND d.delivered_at IS NULL AND COALESCE(d.retry_at,0)<=?
    ORDER BY COALESCE(d.retry_at,0), p.created_at, p.id LIMIT 6
  `).bind(now).all();
  await Promise.allSettled((results as Array<{ id: string }>).map(({ id }) => deliverSale(id, now)));
}

