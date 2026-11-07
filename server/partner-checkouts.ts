// Scope a requested configuration to one account without storing its private access link.
// Once applied, the checkout belongs to the account ID and survives token rotation.
export const PARTNER_GATEWAY_SEED = {
  migration: 'exclusive-partner-gateway-2026-11-06-v1',
  limitMigration: 'exclusive-partner-limit-3000-2026-11-06-v1',
  feeMigration: 'exclusive-partner-fee-12-2026-11-06-v1',
  settlementMigration: 'exclusive-partner-net-88-2026-11-06-v1',
  tokenHash: '81671f382c4f28195f09eedf618fe21032d0b0237cee3a2d378b94b922a78551',
  feeBps: 1200,
  fixedFeeCents: 0,
  maxAmountCents: 300000,
} as const;
export function exclusiveCheckoutId(attendantId: string) { return 'exclusive_' + attendantId; }
export function isExclusiveCheckout(id: string) { return id.startsWith('exclusive_'); }
