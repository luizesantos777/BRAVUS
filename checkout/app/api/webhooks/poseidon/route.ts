/* eslint-disable @typescript-eslint/no-explicit-any */
import { credentials, database, json, validId } from '@/lib/payments';
import { syncPoseidon } from '@/lib/poseidon';
import { recordWebhookFailure } from '@/lib/operational-health';

export const dynamic = 'force-dynamic';

const REF_KEYS = ['identifier', 'externalRef', 'external_ref', 'reference', 'requestId', 'request_id'];
const TRANSACTION_KEYS = ['transactionId', 'transaction_id', 'objectId', 'id'];

async function tokenMatches(received: unknown, expected: string) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function findValues(value: unknown, depth = 0, root = true): { refs: string[]; transactions: string[] } {
  if (depth > 5 || value === null || typeof value !== 'object') return { refs: [], transactions: [] };
  if (Array.isArray(value)) return value.reduce((all, item) => {
    const found = findValues(item, depth + 1, false);
    return { refs: [...all.refs, ...found.refs], transactions: [...all.transactions, ...found.transactions] };
  }, { refs: [], transactions: [] });
  const record = value as Record<string, unknown>;
  const refs = REF_KEYS.flatMap(key => typeof record[key] === 'string' ? [record[key] as string] : []);
  const transactions = TRANSACTION_KEYS.flatMap(key => {
    // The root `id` is commonly the webhook event id, not the payment id.
    if (root && key === 'id') return [];
    return typeof record[key] === 'string' ? [record[key] as string] : [];
  });
  for (const key of ['data', 'transaction', 'payment', 'payload', 'event']) {
    const nested = findValues(record[key], depth + 1, false);
    refs.push(...nested.refs);
    transactions.push(...nested.transactions);
  }
  return { refs, transactions };
}

function cleanTransactionId(value: string | undefined) {
  return value && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 262144) return json({ error: 'Payload inválido.' }, 413);
    let event: unknown;
    try { event = JSON.parse(raw); } catch { return json({ error: 'Evento inválido.' }, 400); }
    if (typeof (event as any)?.event === 'string' && (event as any).event !== 'TRANSACTION_PAID') return json({ received: true, ignored: true });
    const found = findValues(event);
    const reference = found.refs.find(validId) ?? null;
    const transaction = found.transactions.map(cleanTransactionId).find(Boolean) ?? null;
    if (!reference && !transaction) return json({ received: true, ignored: true });

    const db = database();
    const row = reference
      ? await db.prepare('SELECT * FROM payment_orders WHERE provider=? AND request_id=?').bind('poseidon', reference).first()
      : await db.prepare('SELECT * FROM payment_orders WHERE provider=? AND transaction_id=?').bind('poseidon', transaction).first();
    if (!row || row.provider !== 'poseidon' || row.state === 'paid') return json({ received: true });
    if (transaction && row.transaction_id && transaction !== row.transaction_id) return json({ received: true, ignored: true });

    const expectedToken = await credentials('poseidon_webhook_' + row.id);
    if (expectedToken && !await tokenMatches((event as any)?.token, expectedToken.token)) return json({ error: 'Token inválido.' }, 401);

    const now = Date.now();
    const claim = await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at<?')
      .bind(now, row.id, now - 30000).run();
    if (!claim.meta?.changes) {
      const current = await db.prepare('SELECT state FROM payment_orders WHERE id=?').bind(row.id).first();
      const statusValue = (event as any)?.status ?? (event as any)?.transaction?.status;
      const status = typeof statusValue === 'string' ? statusValue.toLowerCase() : '';
      if (current?.state !== 'paid' && ['paid', 'completed', 'approved', 'success'].includes(status)) {
        return json({ error: 'Consulta em andamento. Tente novamente.' }, 503);
      }
      return json({ received: true });
    }

    let synced = false;
    try { synced = await syncPoseidon(row); } catch { /* provider will retry the notification */ }
    if (!synced) {
      await recordWebhookFailure('poseidon', 503);
      return json({ error: 'Consulta indisponível.' }, 503);
    }
    return json({ received: true });
  } catch {
    return json({ error: 'Não foi possível confirmar o evento.' }, 503);
  }
}

