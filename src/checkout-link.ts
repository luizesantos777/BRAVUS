import type { AccountKind } from './domain.ts';

export const CHECKOUT_ORIGIN = 'https://pagamento.bravuspix.shop';
const BIOCAMISAS_CHECKOUT_ORIGIN = 'https://biocamisas.shop';

export const GENERAL_CHECKOUT_URL = `${CHECKOUT_ORIGIN}/checkout`;
export const isCheckoutAttendantId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

export function attendantCheckoutUrl(id: string, accountKind: AccountKind = 'attendant'): string | null {
  const origin = accountKind === 'partner' ? BIOCAMISAS_CHECKOUT_ORIGIN : CHECKOUT_ORIGIN;
  return isCheckoutAttendantId(id) ? `${origin}/a/${id}` : null;
}
