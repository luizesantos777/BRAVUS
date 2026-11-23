import { syncCard } from '@/lib/beehive-card';
import { database, json, validId } from '@/lib/payments';
import { syncBeehive } from '@/lib/beehive';
import { recordWebhookFailure } from '@/lib/operational-health';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 65536) return json({ error: 'Payload inv\u00e1lido.' }, 413);
    const event = JSON.parse(raw);
    const ref = event?.data?.externalRef;
    if (event.type !== 'transaction' || typeof ref !== 'string' || !validId(ref)) return json({ received: true });
    const db = database();
    const row = await db.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(ref).first();
    if (!row || !['beehive', 'beehive_card'].includes(row.provider) || !row.transaction_id || row.transaction_id.startsWith('link:') || String(event.objectId) !== row.transaction_id || row.state === 'paid') {
      return json({ received: true });
    }
    const now = Date.now();
    const claim = await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at<?').bind(now, row.id, now - 30000).run();
    // A webhook is only a notification: confirm identity, amount and paid status via authenticated GET.
    if (!claim.meta?.changes) {
      const current = await db.prepare('SELECT state FROM payment_orders WHERE id=?').bind(row.id).first();
      if (current?.state !== 'paid' && event.data?.status === 'paid') return json({ error: 'Consulta em andamento. Tente novamente.' }, 503);
      return json({ received: true });
    }
    let synced = false;
    try {
      synced = await (row.provider === 'beehive_card' ? syncCard(row) : syncBeehive(row));
    } catch {
      await recordWebhookFailure('beehive', 503);
      throw Error('WEBHOOK_SYNC_FAILED');
    }
    if (!synced) {
      await recordWebhookFailure('beehive', 503);
      return json({ error: 'Consulta indispon\u00edvel.' }, 503);
    }
    return json({ received: true });
  } catch {
    return json({ error: 'N\u00e3o foi poss\u00edvel confirmar o evento.' }, 503);
  }
}
