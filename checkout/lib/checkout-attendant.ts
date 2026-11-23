const PORTAL_ORIGIN = 'https://bravus-omega.vercel.app';
const ATTENDANT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export type CheckoutAttendant = { id: string; name: string; kind?: 'attendant' | 'partner' };

export function validCheckoutAttendantId(value: unknown): value is string {
  return typeof value === 'string' && ATTENDANT_ID.test(value);
}

export async function lookupCheckoutAttendant(id: string): Promise<CheckoutAttendant | null> {
  if (!validCheckoutAttendantId(id)) return null;
  const response = await fetch(PORTAL_ORIGIN + '/api/public/checkout-attendants/' + id, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    redirect: 'manual',
    signal: AbortSignal.timeout(4000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Checkout attendant lookup failed');
  const data = await response.json() as { name?: unknown; kind?: unknown } | null;
  if (typeof data?.name !== 'string' || !data.name.trim() || data.name.length > 120) {
    throw new Error('Invalid checkout attendant response');
  }
  return data.kind === 'attendant' || data.kind === 'partner'
    ? { id, name: data.name, kind: data.kind }
    : { id, name: data.name };
}

export function checkoutSellerName(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f<>]/g, ' ').trim().slice(0, 100);
  return cleaned.length < 2 ? ('Atendente ' + cleaned).trim() : cleaned;
}
