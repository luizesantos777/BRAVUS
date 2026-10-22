import webpush from 'web-push';
import type { PushSubscription, VapidKeys } from 'web-push';
import { createHash, createECDH, ECDH, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { amountToCents, money, renderSaleAlert } from '../src/domain.ts';
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

/** Serverless instances share one private key pair through the persistent database. */
export async function loadDatabasePushKeys(store: PortalStore, environment: NodeJS.ProcessEnv = process.env): Promise<VapidKeys> {
  if (environment.BRAVUS_PUSH_PUBLIC_KEY || environment.BRAVUS_PUSH_PRIVATE_KEY) return loadPushKeys('', environment);
  return store.sql.transaction(async database => {
    await database.exec('CREATE TABLE IF NOT EXISTS push_server_keys (id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL)');
    const saved = await database.prepare('SELECT public_key, private_key FROM push_server_keys WHERE id = 1').get();
    if (saved) return validatePushKeys({ publicKey: String(saved.public_key), privateKey: String(saved.private_key) });
    const keys = validatePushKeys(webpush.generateVAPIDKeys());
    await database.prepare('INSERT INTO push_server_keys (id, public_key, private_key) VALUES (1, ?, ?)').run(keys.publicKey, keys.privateKey);
    return keys;
  });
}

type PushTarget = { role: 'attendant' | 'admin'; id: string };
function subscriptionTable(target: PushTarget) {
  return target.role === 'admin' ? { table: 'admin_push_subscriptions', column: 'admin_scope' } : { table: 'push_subscriptions', column: 'attendant_id' };
}
function validateSubscription(input: unknown): PushSubscription {
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
  return { endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } };
}

export class PushService {
  store: PortalStore;
  keys: VapidKeys;
  sender: typeof webpush.sendNotification;
  constructor(store: PortalStore, keys: VapidKeys, sender = webpush.sendNotification) { this.store = store; this.keys = keys; this.sender = sender; }
  private async configFor(target: PushTarget) {
    const { table, column } = subscriptionTable(target);
    const subscriptionIds = (await this.store.sql.prepare(`SELECT endpoint_hash FROM ${table} WHERE ${column} = ?`).all(target.id)).map(row => String(row.endpoint_hash));
    return { publicKey: this.keys.publicKey, subscriptionIds };
  }
  private async subscribeFor(target: PushTarget, input: unknown) {
    const data = validateSubscription(input), { table, column } = subscriptionTable(target);
    const id = createHash('sha256').update(data.endpoint).digest('hex');
    return this.store.sql.transaction(async database => {
      const exists = await database.prepare(`SELECT endpoint_hash FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).get(id, target.id);
      const count = Number((await database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(target.id))!.count);
      if (!exists && count >= 5) throw new PortalError(400, 'O limite é de cinco aparelhos por acesso.');
      await database.prepare(`INSERT INTO ${table} (endpoint_hash, ${column}, subscription) VALUES (?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET ${column} = excluded.${column}, subscription = excluded.subscription`).run(id, target.id, JSON.stringify(data));
      return { id };
    });
  }
  private async unsubscribeFor(target: PushTarget, input: unknown) {
    const { table, column } = subscriptionTable(target);
    const id = (input as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new PortalError(400, 'Inscrição inválida.');
    await this.store.sql.prepare(`DELETE FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).run(id, target.id);
    return { saved: true };
  }
  config(auth: Authenticated) { return this.configFor({ role: 'attendant', id: auth.id }); }
  subscribe(auth: Authenticated, input: unknown) { return this.subscribeFor({ role: 'attendant', id: auth.id }, input); }
  unsubscribe(auth: Authenticated, input: unknown) { return this.unsubscribeFor({ role: 'attendant', id: auth.id }, input); }
  adminConfig(scope: string) { return this.configFor({ role: 'admin', id: scope }); }
  adminSubscribe(scope: string, input: unknown) { return this.subscribeFor({ role: 'admin', id: scope }, input); }
  adminUnsubscribe(scope: string, input: unknown) { return this.unsubscribeFor({ role: 'admin', id: scope }, input); }
  async notifySale(auth: Authenticated, batch: SaleBatch) {
    const active = (await this.store.sql.prepare('SELECT id FROM attendants WHERE id = ? AND active = 1').get(auth.id));
    if (!active) return;
    const profile = (await this.store.profile(auth)), amount = batch.sales.reduce((sum, sale) => sum + amountToCents(sale.amount), 0);
    await this.sendTo({ role: 'attendant', id: auth.id }, { title: 'BRAVUS Brasil · Venda registrada', body: renderSaleAlert(profile.saleAlertTemplate, amount, batch.sales.length, profile.name) });
  }
  async notifyAdminSale(scope: string, auth: Authenticated, batch: SaleBatch) {
    const amount = batch.sales.reduce((sum, sale) => sum + amountToCents(sale.amount), 0);
    await this.sendTo({ role: 'admin', id: scope }, { title: 'Nova venda aprovada', body: `Você recebeu ${money(amount)}`, target: 'admin', tag: `bravus-admin-venda-${randomUUID()}` });
  }
  private async sendTo(target: PushTarget, message: { title: string; body: string; target?: 'admin'; tag?: string }) {
    const { table, column } = subscriptionTable(target), payload = JSON.stringify(message);
    const rows = await this.store.sql.prepare(`SELECT endpoint_hash, subscription FROM ${table} WHERE ${column} = ?`).all(target.id);
    await Promise.allSettled(rows.map(async row => {
      try {
        await this.sender(JSON.parse(String(row.subscription)), payload, { vapidDetails: { ...this.keys, subject: process.env.BRAVUS_PUSH_SUBJECT ?? 'https://github.com/luizesantos777/BRAVUS' }, TTL: 600, timeout: 5000, ...(process.env.HTTPS_PROXY ? { proxy: process.env.HTTPS_PROXY } : {}) });
      } catch (error) {
        if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) await this.store.sql.prepare(`DELETE FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).run(String(row.endpoint_hash), target.id);
        // A push delivery failure never changes an already committed sale or exposes subscription credentials.
      }
    }));
  }
}
