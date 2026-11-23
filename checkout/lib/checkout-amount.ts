// The Beehive integration represents a charge as a signed 32-bit count of centavos.
export const MAX_CHECKOUT_CENTS = 2_147_483_647;
// Poseidon accepts PIX physical orders up to R$ 10.000,00.
export const POSEIDON_PIX_MAX_CENTS = 1_000_000;
export const INVALID_CHECKOUT_AMOUNT = 'Informe um valor válido e maior que zero, com até duas casas decimais.';

export function isCheckoutAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_CHECKOUT_CENTS;
}

export function parseCheckoutAmount(value: string): number | null {
  const raw = value.trim();
  if (!raw || raw.length > 24) return null;
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw);
  const normalized = (grouped ? raw.replace(/\./g, '') : raw).replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [integer, fraction = ''] = normalized.split('.');
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
  return isCheckoutAmount(cents) ? cents : null;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatCheckoutAmount = (cents: number) => currency.format(cents / 100);

