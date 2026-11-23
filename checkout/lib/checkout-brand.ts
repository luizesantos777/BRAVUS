export const BRAVUS_PAYMENT_ORIGIN = 'https://pagamento.bravuspix.shop';
export const BIOCAMISAS_ORIGIN = 'https://biocamisas.shop';
export const BIOCAMISAS_ORIGINS = [BIOCAMISAS_ORIGIN, 'https://www.biocamisas.shop'] as const;
export const CHECKOUT_ORIGIN_HEADER = 'x-checkout-origin';

export type CheckoutBrand = {
  id: 'bravus' | 'biocamisas';
  name: string;
  wordmark: string;
  tagline: string;
  origin: string;
  home: string;
};

export const BRAVUS_BRAND: CheckoutBrand = {
  id: 'bravus', name: 'Bravus Brasil', wordmark: 'BRAVUS BRASIL',
  tagline: 'PESCA · AGRO · AVENTURA', origin: BRAVUS_PAYMENT_ORIGIN, home: '/loja',
};
export const BIOCAMISAS_BRAND: CheckoutBrand = {
  id: 'biocamisas', name: 'Bio Camisas', wordmark: 'BIO CAMISAS',
  tagline: 'CAMISAS PERSONALIZADAS', origin: BIOCAMISAS_ORIGIN, home: '/checkout',
};

/** Exact trusted origins only: a return URL never comes from arbitrary headers. */
export function checkoutBrandForOrigin(origin: string | null): CheckoutBrand {
  return BIOCAMISAS_ORIGINS.some(value => value === origin) ? BIOCAMISAS_BRAND : BRAVUS_BRAND;
}

export function checkoutBrandForHeaders(h: Pick<Headers, 'get'>): CheckoutBrand {
  // The Worker overwrites this header from the request URL, including behind a proxy.
  const origin = h.get(CHECKOUT_ORIGIN_HEADER);
  if (origin !== null) return checkoutBrandForOrigin(origin);
  // Do not accept X-Forwarded-Host: the incoming Host is set by the domain binding.
  const host = h.get('host')?.toLowerCase();
  return host === 'biocamisas.shop' || host === 'www.biocamisas.shop' ? BIOCAMISAS_BRAND : BRAVUS_BRAND;
}

export function checkoutBrandForRequest(req: Request): CheckoutBrand {
  const hosted = checkoutBrandForOrigin(new URL(req.url).origin);
  // Also support the new frontend using the existing shared API origin.
  return hosted.id === 'biocamisas' ? hosted : checkoutBrandForOrigin(req.headers.get('origin'));
}

/** Change only the public presentation URL, never the transaction or its gateway. */
export async function checkoutResponse(req: Request, response: Response, brand = checkoutBrandForRequest(req)): Promise<Response> {
  if (brand.id !== 'biocamisas' || !response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  let data: unknown;
  try { data = await response.clone().json(); } catch { return response; }
  if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string') return response;
  let url: URL;
  try { url = new URL(data.url); } catch { return response; }
  if (url.origin !== BRAVUS_PAYMENT_ORIGIN || url.username || url.password || url.search || url.hash || !/^\/(pagar|cartao)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(url.pathname)) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(JSON.stringify({ ...data, url: brand.origin + url.pathname }), { status: response.status, headers });
}
