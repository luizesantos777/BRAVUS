const CHECKOUT_ORIGIN = 'https://pagamento.bravuspix.shop';

export const GENERAL_CHECKOUT_URL = `${CHECKOUT_ORIGIN}/checkout`;
export const isCheckoutAttendantId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

export function attendantCheckoutUrl(id: string): string | null {
  return isCheckoutAttendantId(id) ? `${CHECKOUT_ORIGIN}/a/${id}` : null;
}
