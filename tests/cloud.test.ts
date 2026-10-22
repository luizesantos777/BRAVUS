import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import webpush from 'web-push';
import { libsqlDatabase, openTursoDatabase } from '../server/turso-database.ts';
import { PortalStore } from '../server/store.ts';
import { createVercelHandler } from '../server/vercel.ts';
import { loadDatabasePushKeys } from '../server/push.ts';

const adminKey = 'fixture_cloud_admin_012345678901234567890123456789';
const token = 'fixture_cloud_attendant_012345678901234567890123456789';
const env = { TURSO_DATABASE_URL: 'libsql://fixture.invalid', TURSO_AUTH_TOKEN: 'fixture_private_database_token', BRAVUS_ADMIN_KEY: adminKey };
const receipt = { name: 'print.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };

async function serve(t: TestContext, handler: ReturnType<typeof createVercelHandler>) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, key = '', init: RequestInit = {}) => fetch(base + path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...init.headers } });
}
test('Vercel sem configuração responde 503 em JSON e nunca cria um banco temporário', async t => {
  let opened = 0;
  const call = await serve(t, createVercelHandler({ environment: () => ({}), openStore: async () => { opened++; throw new Error(); } }));
  const response = await call('/api/health');
  const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.status, 'configuration_required'); assert.equal(opened, 0);
  assert.deepEqual(body.missingVariables, ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BRAVUS_ADMIN_KEY']);
  assert.equal((await call('/api/admin/dashboard', adminKey)).status, 503);
  const partial = await serve(t, createVercelHandler({ environment: () => ({ ...env, BRAVUS_ADMIN_KEY: '' }), openStore: async () => { opened++; throw new Error(); } }));
  const partialResponse = await partial('/api/health'), partialText = await partialResponse.text();
  assert.deepEqual(JSON.parse(partialText).missingVariables, ['BRAVUS_ADMIN_KEY']);
  assert.equal(partialText.includes(env.TURSO_AUTH_TOKEN), false); assert.equal(partialText.includes(env.TURSO_DATABASE_URL), false); assert.equal(opened, 0);
});
test('Vercel recusa configuração insegura sem revelar credenciais ou cair para SQLite local', async t => {
  const call = await serve(t, createVercelHandler({ environment: () => ({ ...env, TURSO_DATABASE_URL: 'file:/tmp/invalid.sqlite' }) }));
  const response = await call('/api/health'), text = await response.text();
  assert.equal(response.status, 503); assert.equal(text.includes(env.TURSO_AUTH_TOKEN), false); assert.equal(text.includes(adminKey), false); assert.equal(text.includes('/tmp/'), false);
  assert.throws(() => openTursoDatabase({ url: 'http://db.invalid', authToken: 'fixture' }));
});
test('diagnóstico distingue chave inválida e falha no banco sem expor mensagens privadas', async t => {
  let opened = 0;
  const invalidKey = await serve(t, createVercelHandler({ environment: () => ({ ...env, BRAVUS_ADMIN_KEY: 'curta' }), openStore: async () => { opened++; throw new Error(); } }));
  const invalidResponse = await invalidKey('/api/health');
  assert.equal(invalidResponse.status, 503); assert.equal((await invalidResponse.json()).setupIssue, 'admin_key_invalid'); assert.equal(opened, 0);
  const privateError = Object.assign(new Error(env.TURSO_AUTH_TOKEN + env.TURSO_DATABASE_URL + adminKey), { code: 'SERVER_ERROR', cause: { status: 401 } });
  const failedDatabase = await serve(t, createVercelHandler({ environment: () => env, openStore: async () => { throw privateError; } }));
  const response = await failedDatabase('/api/health'), text = await response.text(), body = JSON.parse(text);
  assert.equal(response.status, 503); assert.equal(body.setupIssue, 'database_initialization_failed'); assert.equal(body.databaseCode, 'DATABASE_AUTH_FAILED');
  for (const secret of [env.TURSO_AUTH_TOKEN, env.TURSO_DATABASE_URL, adminKey]) assert.equal(text.includes(secret), false);
});
test('API da Vercel executa vendas, aprovação, ADS e repasse em libSQL persistente entre instâncias', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cloud-')), file = join(directory, 'database.sqlite'), stores: PortalStore[] = [];
  const openStore = async () => {
    const client = createClient({ url: `file:${file}`, intMode: 'number', timeout: 0 });
    await client.execute('PRAGMA journal_mode = WAL');
    const store = await PortalStore.open(libsqlDatabase(client)); stores.push(store); return store;
  };
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = await serve(t, createVercelHandler({ environment: () => env, openStore }));
  assert.equal((await call('/api?__bravus_path=health')).status, 200);
  assert.equal((await call('/api?__bravus_path=admin/dashboard', token)).status, 401);
  const account = await call('/api?__bravus_path=admin/attendants', adminKey, { method: 'POST', body: JSON.stringify({ name: 'Atendente real de teste', token }) });
  assert.equal(account.status, 201); const created = await account.json();
  const initial = await (await call('/api/portal', token)).json(); assert.equal(initial.maxRequestBytes, 4 * 1024 * 1024);
  const batch = { date: initial.today, sales: [{ amount: '100', checkoutId: 'main', time: '12:00', note: '', receipt }] };
  const submit = () => call('/api/sales', token, { method: 'POST', headers: { 'Idempotency-Key': 'fixture_cloud_sale_request' }, body: JSON.stringify(batch) });
  const submitted = await Promise.all([submit(), submit()]);
  assert.deepEqual(submitted.map(response => response.status), [200, 200]);
  const results = await Promise.all(submitted.map(response => response.json()));
  assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]);
  let portal = await (await call('/api/portal', token)).json();
  assert.equal(portal.sales.length, 1); assert.equal(portal.finance.availableCents, 0); const sale = portal.sales[0];
  assert.equal((await call('/api/admin/sales/' + sale.id, adminKey, { method: 'PATCH', body: JSON.stringify({ status: 'approved', note: 'Conferência de teste' }) })).status, 200);
  const image = await call('/api/receipts/' + sale.receiptId, token);
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(receipt.base64, 'base64'));
  await call('/api/admin/attendants/' + created.attendantId + '/costs', adminKey, { method: 'POST', body: JSON.stringify({ date: initial.today, ads: '2', withdrawalFee: '0' }) });
  await call('/api/profile', token, { method: 'PATCH', body: JSON.stringify({ name: 'Atendente de teste', email: '', phone: '', pixType: 'email', pixKey: 'cloud@example.com', pixOwner: 'Teste' }) });
  portal = await (await call('/api/portal', token)).json(); assert.equal(portal.finance.availableCents, 3950);
  // A separate serverless instance opens the same database and reads the persisted account and sale.
  const second = await serve(t, createVercelHandler({ environment: () => env, openStore }));
  assert.equal((await (await second('/api/portal', token)).json()).finance.availableCents, 3950);
  const payout = (api: typeof call) => api('/api/payouts', token, { method: 'POST', body: JSON.stringify({ amount: '39.50' }) });
  const reserved = await Promise.all([payout(call), payout(second)]);
  assert.deepEqual(reserved.map(response => response.status).sort(), [201, 400]);
  const saved = await reserved.find(response => response.status === 201)!.json(); assert.equal(saved.withdrawalFeeCents, 0);
  const finish = (api: typeof call) => api('/api/admin/payouts/' + saved.id, adminKey, { method: 'PATCH', body: JSON.stringify({ status: 'paid', note: 'Pagamento sintético' }) });
  const paid = await Promise.all([finish(call), finish(second)]); assert.deepEqual(paid.map(response => response.status).sort(), [200, 400]);
  portal = await (await second('/api/portal', token)).json();
  assert.equal(portal.finance.availableCents, 0); assert.equal(portal.finance.paidPayoutNetCents, 3700); assert.equal(portal.payouts[0].withdrawalFeeCents, 250);
  assert.equal(portal.payouts[0].gatewayFeeCents, 500); assert.equal(JSON.stringify(portal).includes(env.TURSO_AUTH_TOKEN), false);
});
test('handler aceita corpo já interpretado pela Vercel e aplica o limite de envio', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cloud-body-'));
  const store = await PortalStore.open(join(directory, 'body.sqlite')); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const handler = createVercelHandler({ environment: () => env, openStore: async () => store });
  const call = await serve(t, async (request, response) => {
    (request as typeof request & { body?: unknown }).body = request.headers['x-fixture-large'] ? { name: 'x'.repeat(4 * 1024 * 1024) } : { name: 'Atendente pelo corpo da Vercel', token };
    await handler(request, response);
  });
  assert.equal((await call('/api/admin/attendants', adminKey, { method: 'POST' })).status, 201);
  const oversized = await call('/api/admin/attendants', adminKey, { method: 'POST', headers: { 'x-fixture-large': '1' } });
  assert.equal(oversized.status, 413); assert.equal((await store.adminDashboard()).attendants.length, 1);
});
test('push da Vercel é ativado sem variáveis extras e mantém chave e inscrição entre instâncias concorrentes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cloud-push-')), file = join(directory, 'database.sqlite'), stores: PortalStore[] = [];
  const bootstrap = createClient({ url: `file:${file}` }); await bootstrap.execute('PRAGMA journal_mode = WAL'); bootstrap.close();
  const openStore = async () => {
    const store = await PortalStore.open(libsqlDatabase(createClient({ url: `file:${file}`, intMode: 'number', timeout: 0 })));
    stores.push(store); return store;
  };
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  const first = await serve(t, createVercelHandler({ environment: () => env, openStore }));
  const second = await serve(t, createVercelHandler({ environment: () => env, openStore }));
  for (const response of await Promise.all([first('/api/health'), second('/api/health')])) assert.deepEqual(await response.json(), { status: 'ok', push: 'enabled' });
  assert.equal((await first('/api/admin/attendants', adminKey, { method: 'POST', body: JSON.stringify({ name: 'Conta push de teste', token }) })).status, 201);
  assert.equal((await first('/api/push/config')).status, 401);
  const config = await (await first('/api/push/config', token)).json();
  assert.equal((await (await second('/api/push/config', token)).json()).publicKey, config.publicKey);
  const curve = createECDH('prime256v1'); curve.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-serverless-device', keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const registered = await first('/api/push/subscriptions', token, { method: 'POST', body: JSON.stringify(subscription) });
  assert.equal(registered.status, 201); const { id } = await registered.json();
  const restarted = await serve(t, createVercelHandler({ environment: () => env, openStore }));
  const restored = await (await restarted('/api/push/config', token)).json();
  assert.equal(restored.publicKey, config.publicKey); assert.deepEqual(restored.subscriptionIds, [id]);
  assert.equal((await stores[0].sql.prepare('SELECT COUNT(*) AS count FROM push_server_keys').get())!.count, 1);
  const privateKey = String((await stores[0].sql.prepare('SELECT private_key FROM push_server_keys WHERE id = 1').get())!.private_key);
  for (const response of [restored, await (await restarted('/api/portal', token)).json(), await (await restarted('/api/admin/dashboard', adminKey)).json()]) assert.equal(JSON.stringify(response).includes(privateKey), false);
});
test('push persistente respeita chaves explícitas e não substitui credenciais inválidas silenciosamente', async t => {
  const store = await PortalStore.open(':memory:'); t.after(() => store.close());
  const saved = await loadDatabasePushKeys(store, {}), configured = webpush.generateVAPIDKeys();
  assert.deepEqual(await loadDatabasePushKeys(store, { BRAVUS_PUSH_PUBLIC_KEY: configured.publicKey, BRAVUS_PUSH_PRIVATE_KEY: configured.privateKey }), configured);
  assert.deepEqual(await loadDatabasePushKeys(store, {}), saved);
  await assert.rejects(loadDatabasePushKeys(store, { BRAVUS_PUSH_PUBLIC_KEY: configured.publicKey }));
  await store.sql.prepare('UPDATE push_server_keys SET private_key = ? WHERE id = 1').run(configured.privateKey);
  await assert.rejects(loadDatabasePushKeys(store, {}));
});
test('instâncias libSQL concorrentes inicializam o esquema uma vez sem perder dados', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-cloud-initialize-')), file = join(directory, 'database.sqlite');
  const bootstrap = createClient({ url: `file:${file}` }); await bootstrap.execute('PRAGMA journal_mode = WAL'); bootstrap.close();
  const stores: PortalStore[] = [];
  try {
    const opened = await Promise.all([1, 2].map(async () => PortalStore.open(libsqlDatabase(createClient({ url: `file:${file}`, intMode: 'number', timeout: 0 })))));
    stores.push(...opened);
    const account = await stores[0].adminCreateAttendant({ name: 'Conta persistente', token });
    assert.equal((await stores[1].profile(await stores[1].authenticate(token))).id, account.attendantId);
    assert.equal((await stores[1].checkouts()).length, 2);
  } finally { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('artefato implantado na Vercel carrega sem TypeScript e sem credenciais no build', () => {
  const script = `import handler from './api/index.mjs'; import {createServer} from 'node:http'; const server=createServer(handler); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/health'); const body=await response.json(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); if(response.status!==503||body.status!=='configuration_required') throw new Error('Resposta inesperada'); process.stdout.write('artifact-ok');`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', BRAVUS_ADMIN_KEY: '' } });
  assert.equal(output, 'artifact-ok');
});
