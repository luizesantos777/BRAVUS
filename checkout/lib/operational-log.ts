const events = ['gateway_failure', 'checkout_alert', 'webhook_failure', 'login_failure'] as const;
const sources = ['atlas', 'beehive', 'buckpay', 'eleva', 'firebot', 'gestao', 'poseidon', 'portal', 'legacy_portal', 'funnel'] as const;
const reasons = ['database_empty', 'database_unavailable', 'gateway_unavailable', 'webhook_repeated'] as const;

export type OperationalSource = typeof sources[number];
export type AlertReason = typeof reasons[number];

export function logOperationalEvent(
  event: typeof events[number],
  context: { source?: OperationalSource; reason?: AlertReason; status?: number; count?: number } = {},
) {
  if (!events.includes(event)) return;
  const entry: Record<string, string | number> = {
    timestamp: new Date().toISOString(),
    level: event === 'checkout_alert' ? 'warn' : 'error',
    event,
  };
  if (context.source && sources.includes(context.source)) entry.source = context.source;
  if (context.reason && reasons.includes(context.reason)) entry.reason = context.reason;
  if (typeof context.status === 'number' && Number.isInteger(context.status) && context.status >= 100 && context.status <= 599) {
    entry.http_status = context.status;
  }
  if (typeof context.count === 'number' && Number.isSafeInteger(context.count) && context.count >= 0) {
    entry.count = context.count;
  }
  const write = event === 'checkout_alert' ? console.warn : console.error;
  write(JSON.stringify(entry));
}
