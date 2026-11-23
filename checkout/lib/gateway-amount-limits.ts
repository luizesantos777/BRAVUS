import { database, json } from './payments';
import { cardPlans } from './card-pricing';
import { formatCheckoutAmount, isCheckoutAmount, POSEIDON_PIX_MAX_CENTS } from './checkout-amount';
import type { Gateway } from './gateways';

export type PaymentMethod = 'pix' | 'credit_card';
export type AmountLimits = { minCents: number | null; maxCents: number | null };
export type GatewayAmountLimits = Record<PaymentMethod, AmountLimits | null>;
export type AmountCheck = {
  status: 'without_limits' | 'within_limits' | 'outside_limits';
  limits: AmountLimits | null;
  message?: string;
};

const settingsKey = (provider: Gateway) => 'gateway_amount_limits:' + provider;
const noLimits: GatewayAmountLimits = { pix: null, credit_card: null };

function effectiveLimits(provider: Gateway, limits: GatewayAmountLimits): GatewayAmountLimits {
  if (provider !== 'poseidon') return limits;
  const configured = limits.pix;
  // A missing maximum now means R$ 10.000,00 for Poseidon. Keep an operator
  // defined lower ceiling, while upgrading the old R$ 3.000 ceiling.
  const configuredMax = configured?.maxCents;
  const maxCents = configuredMax == null || configuredMax === 300_000
    ? POSEIDON_PIX_MAX_CENTS
    : Math.min(configuredMax, POSEIDON_PIX_MAX_CENTS);
  return {
    pix: { minCents: configured?.minCents ?? null, maxCents },
    credit_card: null,
  };
}

function normalizeLimits(input: unknown): AmountLimits | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new Error('Informe valores válidos para o limite de pagamento.');
  const { minCents, maxCents } = input as Record<string, unknown>;
  if ((minCents !== null && !isCheckoutAmount(minCents)) || (maxCents !== null && !isCheckoutAmount(maxCents))) {
    throw new Error('Informe limites positivos e em valores válidos.');
  }
  if (minCents !== null && maxCents !== null && minCents > maxCents) throw new Error('O mínimo deve ser menor ou igual ao máximo.');
  return minCents === null && maxCents === null ? null : { minCents, maxCents };
}

async function credentialRevision(ciphertext: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ciphertext));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function gatewayAmountLimits(provider: Gateway): Promise<GatewayAmountLimits> {
  const row = await database().prepare(`
    SELECT l.value AS limits, c.value AS credential
    FROM payment_settings l JOIN payment_settings c ON c.key=?
    WHERE l.key=?
  `).bind(provider, settingsKey(provider)).first();
  if (!row) return effectiveLimits(provider, noLimits);
  const entry = JSON.parse(row.limits);
  if (entry.credentialRevision !== await credentialRevision(row.credential)) return effectiveLimits(provider, noLimits);
  return effectiveLimits(provider, { pix: normalizeLimits(entry.pix), credit_card: normalizeLimits(entry.credit_card) });
}

export async function saveGatewayAmountLimits(provider: Gateway, input: unknown): Promise<GatewayAmountLimits> {
  if (!input || typeof input !== 'object') throw new Error('Informe os limites da gateway.');
  const raw = input as Record<string, unknown>;
  const limits = effectiveLimits(provider, { pix: normalizeLimits(raw.pix), credit_card: normalizeLimits(raw.credit_card) });
  if (provider !== 'beehive' && limits.credit_card) throw new Error('Selecione uma gateway com cartão habilitado no checkout.');
  const db = database();
  const credential = await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(provider).first();
  if (!credential) throw new Error('Cadastre a conta da gateway antes de informar seus limites.');
  const value = JSON.stringify({ ...limits, credentialRevision: await credentialRevision(credential.value) });
  const changed = await db.prepare(`
    INSERT INTO payment_settings (key,value)
    SELECT ?,? WHERE EXISTS (SELECT 1 FROM payment_settings WHERE key=? AND value=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).bind(settingsKey(provider), value, provider, credential.value).run();
  if (!changed.meta?.changes) throw new Error('A conta da gateway mudou. Confira os limites e salve novamente.');
  return limits;
}

export function fitsGatewayAmount(amount: number, limits: AmountLimits | null): boolean {
  return isCheckoutAmount(amount) && (limits?.minCents == null || amount >= limits.minCents) &&
    (limits?.maxCents == null || amount <= limits.maxCents);
}

export function gatewayCardPlans(amount: number, limits: AmountLimits | null) {
  return cardPlans(amount).filter(plan => plan.installmentAmount > 0 && fitsGatewayAmount(plan.amount, limits));
}

export function amountLimitMessage(limits: AmountLimits, method: PaymentMethod) {
  const { minCents, maxCents } = limits;
  const label = method === 'pix' ? 'O valor no PIX' : 'O total no cartão, incluindo parcelamento,';
  if (minCents !== null && maxCents !== null) return `${label} deve ficar entre ${formatCheckoutAmount(minCents)} e ${formatCheckoutAmount(maxCents)}.`;
  if (minCents !== null) return `${label} deve ser de pelo menos ${formatCheckoutAmount(minCents)}.`;
  return `${label} deve ser de até ${formatCheckoutAmount(maxCents!)}.`;
}

export async function gatewayAmountCheck(provider: Gateway, method: PaymentMethod, amount: number): Promise<AmountCheck> {
  const limits = (await gatewayAmountLimits(provider))[method];
  if (!limits) return { status: 'without_limits', limits: null };
  const fits = method === 'credit_card' ? gatewayCardPlans(amount, limits).length > 0 : fitsGatewayAmount(amount, limits);
  return fits ? { status: 'within_limits', limits } : { status: 'outside_limits', limits, message: amountLimitMessage(limits, method) };
}

export function amountLimitResponse(check: AmountCheck) {
  return json({ error: check.message, code: 'AMOUNT_LIMIT', amountCheck: check }, 400);
}

