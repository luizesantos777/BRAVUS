export function pixBuyerFields(providers: readonly string[]) {
  const phoneRequired = providers.some(provider =>
    provider === 'beehive' || provider === 'gestao' || provider === 'poseidon');
  const buyerDetailsRequired = phoneRequired || providers.some(provider =>
    provider === 'atlas' || provider === 'eleva');
  return { buyerDetailsRequired, phoneRequired };
}

// Checkout buyers can differ from the seller assigned to the order.
export function paymentBuyerName(order: { customerMode?: unknown; customer?: { name?: unknown }; sellerName?: string | null }) {
  if (order.customerMode === 'manual' && typeof order.customer?.name === 'string') {
    const name = order.customer.name.trim().replace(/\s+/g, ' ');
    if (name.length >= 2 && name.length <= 150 && !/[<>\x00-\x1f]/.test(name)) return name;
  }
  return order.sellerName;
}
