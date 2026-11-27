import { CHECKOUT_ORIGIN } from '../src/checkout-link.ts';
import { businessToday, MAX_CONFIRMED_CHECKOUT_CENTS, validDate } from '../src/domain.ts';
import type { ReceiptInput } from '../src/domain.ts';

const CHECKOUT_VERIFIER = `${CHECKOUT_ORIGIN}/api/integrations/checkout-sales/verify`;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CheckoutSaleProof = { orderId: string; proof: string };
export type VerifiedCheckoutSale = {
  orderId: string;
  accountId?: string;
  amountCents: number;
  provider: string;
  date: string;
  time: string;
  receipt: ReceiptInput;
};
export type CheckoutSaleVerifier = (claim: CheckoutSaleProof) => Promise<unknown>;

export function parseCheckoutSaleProof(value: unknown): CheckoutSaleProof | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return null;
  const { orderId, proof } = value as Record<string, unknown>;
  if (typeof orderId !== 'string' || !uuidV4.test(orderId) || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return null;
  return { orderId, proof };
}

export function parseVerifiedCheckoutSale(value: unknown, expectedOrderId: string): VerifiedCheckoutSale | null {
  if (!value || typeof value !== 'object') return null;
  const { orderId, accountId, amountCents, provider, date, time, receipt } = value as Record<string, unknown>;
  if (orderId !== expectedOrderId || accountId !== undefined && (typeof accountId !== 'string' || !uuidV4.test(accountId))) return null;
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CONFIRMED_CHECKOUT_CENTS) return null;
  if (typeof provider !== 'string' || !/^[a-z0-9_]{1,40}$/.test(provider) || typeof date !== 'string' || !validDate(date) || date > businessToday()) return null;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !receipt || typeof receipt !== 'object') return null;
  const { name, mime, base64 } = receipt as Record<string, unknown>;
  if (typeof name !== 'string' || mime !== 'application/pdf' || typeof base64 !== 'string') return null;
  return { orderId, accountId, amountCents, provider, date, time, receipt: { name, mime, base64 } };
}

export async function verifyCheckoutSale(claim: CheckoutSaleProof): Promise<unknown> {
  const response = await fetch(CHECKOUT_VERIFIER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
    redirect: 'error',
    signal: AbortSignal.timeout(7000),
  });
  if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error('Não foi possível consultar o pagamento no checkout.');
  return response.json();
}

export async function wakeCheckoutSales(): Promise<void> {
  const response = await fetch(`${CHECKOUT_ORIGIN}/checkout`, { redirect: 'error', signal: AbortSignal.timeout(7000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Não foi possível acionar o checkout.');
}
