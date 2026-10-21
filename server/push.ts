import webpush from 'web-push';
import type { PushSubscription, VapidKeys } from 'web-push';
import { createHash, createECDH, ECDH } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { amountToCents, renderSaleAlert } from '../src/domain.ts';
import type { SaleBatch } from '../src/domain.ts';
import { PortalError, PortalStore } from './store.ts';
import type { Authenticated } from './store.ts';

function validatePushKeys(keys: VapidKeys): VapidKeys {
  try {
    if (typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string' || !/^[\w-]{87}$/.test(keys.publicKey) || !/^[\w-]{43}$/.test(keys.privateKey)) throw new Error();
    const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
    if (!ecdh.getPublicKey().equals(Buffer.from(keys.publicKey, 'base64url'))) throw new Error();
    return keys;
  } catch { throw new Error('Chaves de Web Push inválidas. Preserve o arquivo privado e configure um par de chaves válido no servidor.'); }
}

export function loadPushKeys(filename: string, environment: NodeJS.ProcessEnv = process.env): VapidKeys {
  const publicKey = environment.BRAVUS_PUSH_PUBLIC_KEY, privateKey = environment.BRAVUS_PUSH_PRIVATE_KEY;
  if (publicKey || privateKey) {
    if (!publicKey || !privateKey) throw new Error('Configure a chave pública e a chave privada do Web Push.');
    return validatePushKeys({ publicKey, privateKey });
  }
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  try { writeFileSync(filename, JSON.stringify(webpush.generateVAPIDKeys()), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  chmodSync(filename, 0o600);
  return validatePushKeys(JSON.parse(readFileSync(filename, 'utf8')) as VapidKeys);
}

export class PushService {
  store: PortalStore;
  keys: VapidKeys;
  sender: typeof webpush.sendNotification;
  constructor(store: PortalStore, keys: VapidKeys, sender = webpush.sendNotification) { this.store = store; this.keys = keys; this.sender = sender; }
  config(auth: Authenticated) {
    const subscriptionIds = this.store.db.prepare('SELECT endpoint_hash FROM push_subscriptions WHERE attendant_id = ?').all(auth.id).map(row => String(row.endpoint_hash));
    return { publicKey: this.keys.publicKey, subscriptionIds };
  }
  subscribe(auth: Authenticated, input: unknown) {
    if (!input || typeof input !== 'object') throw new PortalError(400, 'Inscrição de notificações inválida.');
    const data = input as PushSubscription;
    try {
      if (typeof data.endpoint !== 'string' || data.endpoint.length > 4096) throw new Error();
      const url = new URL(data.endpoint);
      const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) || url.hostname.endsWith('.notify.windows.com');
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) throw new Error();
      if (!data.keys || typeof data.keys.p256dh !== 'string' || typeof data.keys.auth !== 'string' || !/^[\w-]{87}$/.test(data.keys.p256dh) || !/^[\w-]{22}$/.test(data.keys.auth) || Buffer.from(data.keys.auth, 'base64url').length !== 16 || Buffer.from(data.keys.p256dh, 'base64url').length !== 65) throw new Error();
      ECDH.convertKey(Buffer.from(data.keys.p256dh, 'base64url'), 'prime256v1');
    } catch { throw new PortalError(400, 'Use uma inscrição válida do serviço de notificações do navegador.'); }
    const id = createHash('sha256').update(data.endpoint).digest('hex');
    const exists = this.store.db.prepare('SELECT endpoint_hash FROM push_subscriptions WHERE endpoint_hash = ? AND attendant_id = ?').get(id, auth.id);
    if (!exists && this.config(auth).subscriptionIds.length >= 5) throw new PortalError(400, 'O limite é de cinco aparelhos por atendente.');
    const safe = { endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } };
    this.store.db.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET attendant_id = excluded.attendant_id, subscription = excluded.subscription').run(id, auth.id, JSON.stringify(safe));
    return { id };
  }
  unsubscribe(auth: Authenticated, input: unknown) {
    const id = (input as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new PortalError(400, 'Inscrição inválida.');
    this.store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND attendant_id = ?').run(id, auth.id);
    return { saved: true };
  }
  async notifySale(auth: Authenticated, batch: SaleBatch) {
    const active = this.store.db.prepare('SELECT id FROM attendants WHERE id = ? AND active = 1').get(auth.id);
    if (!active) return;
    const profile = this.store.profile(auth), amount = batch.sales.reduce((sum, sale) => sum + amountToCents(sale.amount), 0);
    const payload = JSON.stringify({ title: 'BRAVUS Brasil · Venda registrada', body: renderSaleAlert(profile.saleAlertTemplate, amount, batch.sales.length, profile.name) });
    const rows = this.store.db.prepare('SELECT endpoint_hash, subscription FROM push_subscriptions WHERE attendant_id = ?').all(auth.id);
    await Promise.allSettled(rows.map(async row => {
      try {
        await this.sender(JSON.parse(String(row.subscription)), payload, { vapidDetails: { ...this.keys, subject: process.env.BRAVUS_PUSH_SUBJECT ?? 'https://github.com/luizesantos777/BRAVUS' }, TTL: 600, timeout: 5000, ...(process.env.HTTPS_PROXY ? { proxy: process.env.HTTPS_PROXY } : {}) });
      } catch (error) {
        if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) this.store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND attendant_id = ?').run(row.endpoint_hash, auth.id);
        // A push delivery failure never changes an already committed sale or exposes subscription credentials.
      }
    }));
  }
}
