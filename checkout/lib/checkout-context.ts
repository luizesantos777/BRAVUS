import { headers } from 'next/headers';
import { checkoutBrandForHeaders } from './checkout-brand';

export async function currentCheckoutBrand() {
  return checkoutBrandForHeaders(await headers());
}
