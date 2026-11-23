import { registeredBeehiveCustomer } from './beehive';
import { BRAVUS_BUYER_NAME } from './checkout-buyer-names';
import { credentials, saveCredentials } from './payments';

export function matchesBravusBuyer(name: string) {
  return name.trim().replace(/\s+/g, ' ').toUpperCase() === BRAVUS_BUYER_NAME;
}

export function registeredBravusBuyer() {
  return registeredBeehiveCustomer(BRAVUS_BUYER_NAME);
}

export async function bravusBuyerForOrder(requestId: string, recovering: boolean) {
  const key = 'checkout_bravus_buyer:' + requestId;
  let snapshot = await credentials(key);
  if (!snapshot && !recovering) {
    const profile = await registeredBravusBuyer();
    if (!profile) return null;
    // The first concurrent request pins the buyer before any gateway is contacted.
    await saveCredentials(JSON.stringify(profile), 'customer', key, false);
    snapshot = await credentials(key);
  }
  return snapshot ? JSON.parse(snapshot.token) : null;
}
