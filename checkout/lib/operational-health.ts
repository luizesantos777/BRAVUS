import { database } from './payments';
import { fallbackPolicy, gatewayHealth, gatewaySelection, isGateway } from './gateways';
import type { Gateway } from './gateways';
import { gatewayEnabled } from './gateway-status';
import { logOperationalEvent } from './operational-log';
import type { AlertReason, OperationalSource } from './operational-log';

const WINDOW_MS = 15 * 60_000;
const REPEATED_FAILURES = 3;
const KEY_PREFIX = 'ops:failure:';
type WebhookSource = 'atlas' | 'beehive' | 'poseidon' | 'legacy_portal';
type CheckoutAlert = { reason: AlertReason; source?: OperationalSource; count?: number };

async function recordFailure(kind: 'gateway' | 'webhook', source: Gateway | WebhookSource, status?: number, now = Date.now()) {
  logOperationalEvent(kind === 'gateway' ? 'gateway_failure' : 'webhook_failure', { source, status });
  try {
    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const row = await database().prepare(`
      INSERT INTO payment_settings (key,value) VALUES (?,json_object('window_start',?,'count',1))
      ON CONFLICT(key) DO UPDATE SET value =
        CASE WHEN json_extract(payment_settings.value,'$.window_start')=?
          THEN json_set(payment_settings.value,'$.count',json_extract(payment_settings.value,'$.count')+1)
          ELSE excluded.value END
      RETURNING json_extract(value,'$.count') AS count
    `).bind(KEY_PREFIX + kind + ':' + source, windowStart, windowStart).first();
    if (row?.count === REPEATED_FAILURES) {
      logOperationalEvent('checkout_alert', {
        reason: kind === 'gateway' ? 'gateway_unavailable' : 'webhook_repeated',
        source, count: row.count,
      });
    }
  } catch {
    // Monitoring must not change the outcome of a checkout or a webhook.
  }
}

export const recordGatewayFailure = (gateway: Gateway, status: number) =>
  recordFailure('gateway', gateway, status);

export const recordWebhookFailure = (source: WebhookSource, status?: number) =>
  recordFailure('webhook', source, status);

export async function checkoutOperationalHealth(now = Date.now()): Promise<{ ok: boolean; alerts: CheckoutAlert[] }> {
  const alerts = new Map<string, CheckoutAlert>();
  const add = (alert: CheckoutAlert) => alerts.set(alert.reason + ':' + (alert.source ?? ''), alert);
  try {
    const db = database();
    const [order, portal, counters, selection, policy] = await Promise.all([
      db.prepare('SELECT 1 AS present FROM payment_orders LIMIT 1').first(),
      db.prepare('SELECT 1 AS present FROM checkout_sale_deliveries WHERE delivered_at IS NULL AND attempts >= ? LIMIT 1').bind(REPEATED_FAILURES).first(),
      db.prepare("SELECT key,value FROM payment_settings WHERE key GLOB 'ops:failure:*'").all(),
      gatewaySelection(),
      fallbackPolicy(),
    ]);
    if (!order) add({ reason: 'database_empty' });
    if (portal) add({ reason: 'webhook_repeated', source: 'portal' });

    const monitored = new Set([
      selection.provider,
      ...(policy.enabled ? policy.order : []),
      ...(policy.ticketRouting.enabled ? policy.ticketRouting.rules.map(rule => rule.gateway) : []),
    ]);
    const status = await Promise.all([...monitored].map(async (source) => {
      const [enabled, health] = await Promise.all([gatewayEnabled(source), gatewayHealth(source)]);
      const unhealthy = health?.epoch === selection.epoch && health.failedUntil > now;
      return { source, unavailable: !enabled || unhealthy || (source === selection.provider && selection.suspended) };
    }));
    for (const { source, unavailable } of status) {
      if (unavailable) add({ reason: 'gateway_unavailable', source });
    }

    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    for (const { key, value } of counters.results as Array<{ key: string; value: string }>) {
      const [, , kind, source] = key.split(':');
      const counter = JSON.parse(value) as { window_start?: number; count?: number };
      if (counter.window_start !== windowStart || typeof counter.count !== 'number' || counter.count < REPEATED_FAILURES) continue;
      if (kind === 'gateway' && isGateway(source) && monitored.has(source)) {
        add({ reason: 'gateway_unavailable', source, count: counter.count });
      } else if (kind === 'webhook' && (source === 'atlas' || source === 'beehive' || source === 'poseidon' || source === 'legacy_portal')) {
        add({ reason: 'webhook_repeated', source, count: counter.count });
      }
    }
  } catch {
    add({ reason: 'database_unavailable' });
  }
  return { ok: alerts.size === 0, alerts: [...alerts.values()] };
}

