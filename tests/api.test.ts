import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortalStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';
import { businessToday } from '../src/domain.ts';
import { loadAdminKey } from '../server/admin-key.ts';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { PushService, loadPushKeys } from '../server/push.ts';

const tokenA = 'fixture_attendant_a_012345678901234567890';
const tokenB = 'fixture_attendant_b_012345678901234567890';
const adminKey = 'fixture_admin_012345678901234567890123456789';
const image = { name: 'comprovante.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = () => ({ date: businessToday(), sales: [{ amount: '300,00', checkoutId: 'main', time: '12:30', note: 'Venda de teste', receipt: { ...image } }] });
async function fixture(t: TestContext, { defaultCheckoutRates = false, approveSales = true } = {}) {
  const store = new PortalStore(':memory:');
  // General authorization and payout scenarios use an explicit fee-free checkout.
  if (!defaultCheckoutRates) store.adminSetCheckout('main', { name: 'Checkout principal', fee: '0', fixedFee: '0', higherTier: null });
  const a = store.createAttendant('Ana Teste', 1000, tokenA), b = store.createAttendant('Bruno Teste', 1000, tokenB);
  const deliveries: { endpoint: string; payload: string }[] = [];
  const push = new PushService(store, webpush.generateVAPIDKeys(), async (subscription, payload, options) => {
    const request = webpush.generateRequestDetails(subscription, String(payload), options);
    assert.equal(request.method, 'POST'); assert.ok(request.body instanceof Buffer); assert.equal(request.body.includes(Buffer.from(String(payload))), false);
    deliveries.push({ endpoint: subscription.endpoint, payload: String(payload) });
    return { statusCode: 201, body: '', headers: {} };
  });
  const server = createPortalServer(store, { allowedOrigins: ['https://portal.example'], adminKey, push });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close(); resolve(); }); server.closeAllConnections(); }));
  const call = (path: string, token = tokenA, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const submit = async (payload: unknown = batch(), key = 'fixture_request_key_01', token = tokenA) => {
    const response = await call('/api/sales', token, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
    if (response.ok && approveSales) for (const sale of store.sales(store.authenticate(token))) if (sale.status === 'pending') store.reviewSale(sale.id, { status: 'approved', note: 'Aprovação explícita do cenário de teste.' });
    return response;
  };
  return { store, a, b, call, submit, push, deliveries };
}
test('token inválido não abre dados; dados e comprovantes são isolados por atendente', async t => {
  const { call, submit } = await fixture(t);
  assert.equal((await call('/api/portal', 'invalid_token_123456')).status, 401);
  assert.equal((await submit()).status, 200);
  const own = await (await call('/api/portal')).json();
  const other = await (await call('/api/portal', tokenB)).json();
  assert.equal(own.sales.length, 1); assert.equal(other.sales.length, 0);
  assert.equal(own.finance.availableCents, 3000); assert.equal(other.finance.availableCents, 0);
  assert.equal((await call('/api/receipts/' + own.sales[0].receiptId)).status, 200);
  assert.equal((await call('/api/receipts/' + own.sales[0].receiptId, tokenB)).status, 404);
  assert.equal(JSON.stringify(own).includes(tokenA), false);
});
test('envio repetido não duplica vendas e alterações no mesmo envio são rejeitadas', async t => {
  const { call, submit } = await fixture(t);
  assert.equal((await submit()).status, 200);
  const repeated = await (await submit()).json(); assert.equal(repeated.duplicate, true);
  const changed = batch(); changed.sales[0].amount = '400,00'; assert.equal((await submit(changed)).status, 409);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 1);
});
test('venda abaixo de R$ 200 libera comissão e repasse mesmo com meta antiga no banco', async t => {
  const { call, submit, store, a } = await fixture(t);
  store.db.prepare('UPDATE attendants SET daily_goal_cents = 20000 WHERE id = ?').run(a.id);
  const small = batch(); small.sales[0].amount = '197,00';
  assert.equal((await submit(small)).status, 200);
  store.db.prepare('UPDATE sales SET goal_cents = 20000 WHERE attendant_id = ?').run(a.id);
  const portal = await (await call('/api/portal')).json();
  assert.equal(portal.finance.availableCents, 1970); assert.equal(portal.finance.commissionCents, 1970);
  assert.equal(Object.hasOwn(portal.profile, 'dailyGoalCents'), false);
  assert.equal(Object.hasOwn(portal.finance, 'pendingGoalCents'), false);
  await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify({ name: 'Ana', email: '', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana' }) });
  assert.equal((await call('/api/payouts', tokenA, { method: 'POST', body: JSON.stringify({ amount: '19,70' }) })).status, 201);
  assert.equal((await (await call('/api/portal')).json()).finance.availableCents, 0);
});
test('API calcula a tarifa PIX por venda e ignora taxas enviadas pelo navegador', async t => {
  const { call, submit } = await fixture(t);
  const payload = batch();
  payload.sales = [10, 10].map(amount => ({ ...payload.sales[0], amount: String(amount), checkoutId: 'pix', feeCents: 0, feeBps: 0, fixedFeeCents: 0 }));
  assert.equal((await submit(payload)).status, 200);
  const portal = await (await call('/api/portal')).json();
  assert.deepEqual(portal.sales.map((sale: { feeCents: number }) => sale.feeCents), [239, 239]);
  assert.equal(portal.finance.feeCents, 240); assert.equal(portal.finance.availableCents, -40);
  assert.equal((await submit(payload)).status, 200);
  assert.equal((await (await call('/api/portal')).json()).finance.feeCents, 240);
  const invalid = batch(); invalid.sales[0].checkoutId = 'pix'; invalid.sales[0].amount = '4,99';
  assert.equal((await submit(invalid, 'fixture_pix_below_minimum')).status, 400);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 2);
});
test('API limita o checkout a R$ 1.000, recalcula a taxa e rejeita o lote inteiro acima do limite', async t => {
  const { call, submit } = await fixture(t, { defaultCheckoutRates: true });
  const payload = batch(); payload.sales = ['1000', '1000,01'].map(amount => ({ ...payload.sales[0], amount, feeCents: 0, maxAmountCents: null }));
  assert.equal((await submit(payload)).status, 400);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 0);
  payload.sales = [payload.sales[0]];
  assert.equal((await submit(payload)).status, 200);
  const portal = await (await call('/api/portal')).json(), checkout = portal.checkouts.find((item: { id: string }) => item.id === 'main');
  assert.equal(portal.sales[0].feeCents, 15199); assert.equal(portal.finance.availableCents, 2400);
  assert.equal(checkout.feeBps, 1500); assert.equal(checkout.fixedFeeCents, 199); assert.equal(checkout.maxAmountCents, 100000); assert.equal(checkout.higherTier, null);
  const update = (body: unknown) => call('/api/admin/checkouts/main', adminKey, { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await update({ name: 'Principal', fee: '15', higherTier: { aboveAmount: '400', fee: '20', fixedFee: '1.99' } })).status, 200);
  assert.equal((await update({ name: 'Principal', fee: '16' })).status, 200);
  const next = await (await call('/api/portal')).json();
  assert.deepEqual(next.checkouts.find((item: { id: string }) => item.id === 'main').higherTier, { aboveAmountCents: 40000, feeBps: 2000, fixedFeeCents: 199 });
  assert.equal(next.sales[0].feeCents, 15199);
  for (const higherTier of [{ aboveAmount: '350', fee: '101', fixedFee: '1.99' }, { aboveAmount: '0', fee: '25', fixedFee: '1.99' }, { aboveAmount: '350', fee: '25', fixedFee: '-1' }, { aboveAmount: '1000', fee: '25', fixedFee: '1.99' }, []]) assert.equal((await update({ name: 'Principal', fee: '15', higherTier })).status, 400);
});
test('lote inválido é rejeitado inteiro; imagem falsa e data futura não são salvas', async t => {
  const { call, submit } = await fixture(t);
  const invalid = batch(); invalid.sales.push({ ...invalid.sales[0], amount: '-10' });
  assert.equal((await submit(invalid)).status, 400);
  const fake = batch(); fake.sales[0].receipt.base64 = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await submit(fake)).status, 400);
  const future = batch(); future.date = '2999-01-01'; assert.equal((await submit(future)).status, 400);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 0);
});
test('alterar perfil não muda comissão ou token e ranking não expõe PIX ou tokens', async t => {
  const { call, submit } = await fixture(t);
  const fields = { name: 'Ana Atualizada', email: 'ana@example.com', phone: '', pixType: 'email', pixKey: 'pix@example.com', pixOwner: 'Ana', commissionBps: 10000, token: 'fixture_unauthorized_token_01234567890123456789' };
  const result = await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify(fields) });
  assert.equal(result.status, 200); assert.equal((await result.json()).commissionBps, 1000);
  assert.equal((await call('/api/portal', fields.token)).status, 401);
  assert.equal((await call('/api/portal', tokenA)).status, 200);
  await submit();
  const ranking = await (await call('/api/ranking', tokenB)).json();
  assert.equal(ranking[0].name, 'Ana Atualizada');
  assert.equal(JSON.stringify(ranking).includes('pix@example.com'), false);
  assert.deepEqual(Object.keys(ranking[0]).sort(), ['count', 'grossCents', 'id', 'mine', 'name', 'photoUrl']);
});
test('repasse exige PIX e saldo; reserva é mantida quando o repasse é pago', async t => {
  const { call, submit, store } = await fixture(t); await submit();
  const payout = (amount: string) => call('/api/payouts', tokenA, { method: 'POST', body: JSON.stringify({ amount }) });
  assert.equal((await payout('10')).status, 400);
  await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify({ name: 'Ana', email: '', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana' }) });
  assert.equal((await payout('31')).status, 400);
  const response = await payout('20'); assert.equal(response.status, 201);
  const registered = await response.json();
  assert.equal((await (await call('/api/portal')).json()).finance.availableCents, 1000);
  store.markPayout(registered.id, 'paid', 'Pagamento confirmado');
  const summary = await (await call('/api/portal')).json();
  assert.equal(summary.finance.availableCents, 1000); assert.equal(summary.finance.paidPayoutCents, 2000);
  assert.equal((await payout('11')).status, 400);
});
test('origens não autorizadas e requisições sem token são recusadas', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/portal', tokenA, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/api/portal', '')).status, 401);
  const allowed = await call('/api/portal', tokenA, { headers: { Origin: 'https://portal.example' } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://portal.example');
});
test('banco persistente mantém dados no reinício e guarda somente hash do token', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-sqlite-')), file = join(directory, 'portal.sqlite');
  try {
    let store = new PortalStore(file); const account = store.createAttendant('Persistente', 1000, tokenA);
    store.recordSales({ id: account.id }, batch(), 'fixture_persistent_request');
    store.saveProfile({ id: account.id }, { name: 'Persistente', email: '', phone: '', pixType: '', pixKey: '', pixOwner: '', photoUrl: `data:image/png;base64,${image.base64}`, saleAlertTemplate: '{nome}: {valor}' });
    store.close();
    store = new PortalStore(file);
    assert.equal(store.portal(store.authenticate(tokenA)).sales.length, 1);
    assert.equal(store.profile(store.authenticate(tokenA)).saleAlertTemplate, '{nome}: {valor}');
    assert.equal(store.profile(store.authenticate(tokenA)).photoUrl, `data:image/png;base64,${image.base64}`); store.close();
    assert.equal(readFileSync(file).includes(Buffer.from(tokenA)), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('atualização do banco configura PIX uma vez e preserva taxas já registradas nas vendas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-pix-upgrade-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Histórico', 1000, tokenA);
    store.adminSetCheckout('pix', { name: 'PIX manual', fee: '0', fixedFee: '0' });
    const payload = batch(); payload.sales[0].checkoutId = 'pix';
    store.recordSales({ id: account.id }, payload, 'fixture_before_pix_upgrade');
    store.db.exec('ALTER TABLE checkouts DROP COLUMN fixed_fee_cents; ALTER TABLE checkouts DROP COLUMN min_amount_cents; DROP TABLE schema_migrations;');
    store.close(); store = new PortalStore(file);
    assert.equal(store.sales({ id: account.id })[0].feeCents, 0);
    const pix = store.checkouts().find(checkout => checkout.id === 'pix')!;
    assert.equal(pix.feeBps, 699); assert.equal(pix.fixedFeeCents, 169); assert.equal(pix.minAmountCents, 500);
    store.recordSales({ id: account.id }, payload, 'fixture_after_pix_upgrade');
    assert.deepEqual(store.sales({ id: account.id }).map(sale => sale.feeCents).sort((a, b) => a - b), [0, 2266]);
    store.adminSetCheckout('pix', { name: 'PIX manual', fee: '7', fixedFee: '2' });
    store.close(); store = new PortalStore(file);
    assert.equal(store.checkouts().find(checkout => checkout.id === 'pix')!.fixedFeeCents, 200);
    assert.equal(store.checkouts().find(checkout => checkout.id === 'pix')!.feeBps, 700);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('atualização do checkout preserva vendas antigas e mantém faixas ajustadas após reiniciar', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-checkout-upgrade-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Histórico checkout', 1000, tokenA);
    store.adminSetCheckout('main', { name: 'Checkout principal', fee: '0', fixedFee: '0', higherTier: null });
    store.recordSales({ id: account.id }, batch(), 'fixture_before_checkout_upgrade');
    store.db.exec("ALTER TABLE checkouts DROP COLUMN tier_above_cents; ALTER TABLE checkouts DROP COLUMN tier_fee_bps; ALTER TABLE checkouts DROP COLUMN tier_fixed_fee_cents; DELETE FROM schema_migrations WHERE id = 'checkout-pix-tiered-tariff-v1';");
    store.close(); store = new PortalStore(file);
    assert.equal(store.sales({ id: account.id })[0].feeCents, 0);
    const payload = batch(); payload.sales = ['100', '1000'].map(amount => ({ ...payload.sales[0], amount }));
    store.recordSales({ id: account.id }, payload, 'fixture_after_checkout_upgrade');
    assert.deepEqual(store.sales({ id: account.id }).map(sale => sale.feeCents).sort((a, b) => a - b), [0, 1699, 15199]);
    store.adminSetCheckout('main', { name: 'Checkout principal', fee: '16', fixedFee: '2', higherTier: { aboveAmount: '400', fee: '28', fixedFee: '3' } });
    store.close(); store = new PortalStore(file);
    const checkout = store.checkouts().find(item => item.id === 'main')!;
    assert.equal(checkout.feeBps, 1600); assert.equal(checkout.fixedFeeCents, 200);
    assert.deepEqual(checkout.higherTier, { aboveAmountCents: 40000, feeBps: 2800, fixedFeeCents: 300 });
    assert.equal(store.checkouts().find(item => item.id === 'pix')!.feeBps, 699);
    const logs = execFileSync(process.execPath, ['server/manage.ts', 'set-checkout', '--id', 'main', '--name', 'Checkout principal', '--fee', '15', '--fixed-fee', '1.99', '--above', '400', '--above-fee', '25', '--above-fixed-fee', '1.99'], { encoding: 'utf8', env: { ...process.env, BRAVUS_DB_PATH: file } });
    assert.equal(logs.includes(tokenA), false);
    assert.deepEqual(store.checkouts().find(item => item.id === 'main')!.higherTier, { aboveAmountCents: 40000, feeBps: 2500, fixedFeeCents: 199 });
    assert.deepEqual(store.sales({ id: account.id }).map(sale => sale.feeCents).sort((a, b) => a - b), [0, 1699, 15199]);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('operador cria token e convite privados pelo comando de administração', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-invite-')), database = join(directory, 'portal.sqlite'), output = join(directory, 'invite.json');
  try {
    const logs = execFileSync(process.execPath, ['server/manage.ts', 'create-attendant', '--name', 'Atendente de teste', '--commission', '29.99', '--base-url', 'https://portal.example', '--output', output], { encoding: 'utf8', env: { ...process.env, BRAVUS_DB_PATH: database } });
    const invitation = JSON.parse(readFileSync(output, 'utf8'));
    const token = new URL(invitation.url).hash.split('/').at(-1)!;
    assert.ok(token.length >= 43); assert.equal(logs.includes(token), false);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    const store = new PortalStore(database);
    const auth = store.authenticate(token);
    assert.equal(store.profile(auth).commissionBps, 2999);
    assert.equal(auth.id, invitation.attendantId); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('administração exige chave própria; criação, rotação e revogação preservam histórico', async t => {
  const { call, submit, a } = await fixture(t);
  assert.equal((await call('/api/admin/dashboard')).status, 401);
  assert.equal((await call('/api/admin/attendants', tokenB, { method: 'POST', body: JSON.stringify({ name: 'Intruso', commission: '100' }) })).status, 401);
  const created = await call('/api/admin/attendants', adminKey, { method: 'POST', body: JSON.stringify({ name: 'Nova pessoa', commission: '29.99' }) });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  const portal = await (await call('/api/portal', invitation.token)).json();
  assert.equal(portal.profile.commissionBps, 2999);
  await submit();
  const rotated = await (await call(`/api/admin/attendants/${a.id}/token`, adminKey, { method: 'POST' })).json();
  assert.equal((await call('/api/portal', tokenA)).status, 401);
  assert.equal((await (await call('/api/portal', rotated.token)).json()).sales.length, 1);
  assert.equal((await call(`/api/admin/attendants/${a.id}`, adminKey, { method: 'PATCH', body: JSON.stringify({ active: false }) })).status, 200);
  assert.equal((await call('/api/portal', rotated.token)).status, 401);
  assert.equal((await call(`/api/admin/attendants/${a.id}/token`, adminKey, { method: 'POST' })).status, 400);
  await call(`/api/admin/attendants/${a.id}`, adminKey, { method: 'PATCH', body: JSON.stringify({ active: true }) });
  assert.equal((await call('/api/portal', rotated.token)).status, 200);
  const dashboardResponse = await call('/api/admin/dashboard', adminKey);
  assert.equal(dashboardResponse.headers.get('cache-control'), 'no-store');
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.attendants.length, 3);
  assert.equal(JSON.stringify(dashboard).includes(rotated.token), false);
  assert.equal(JSON.stringify(dashboard).includes('token_hash'), false);
});

test('administração valida custos e taxas; alterações não reescrevem vendas anteriores', async t => {
  const { call, submit, a } = await fixture(t); await submit();
  const update = (path: string, body: unknown, method = 'POST') => call(path, adminKey, { method, body: JSON.stringify(body) });
  assert.equal((await update(`/api/admin/attendants/${a.id}/costs`, { date: businessToday(), ads: '5,00', withdrawalFee: '2' })).status, 200);
  assert.deepEqual(await (await call(`/api/admin/attendants/${a.id}/costs?date=${businessToday()}`, adminKey)).json(), { date: businessToday(), adsCents: 500, withdrawalFeeCents: 200 });
  assert.equal((await update(`/api/admin/attendants/${a.id}/costs`, { date: 'bad', ads: '-1', withdrawalFee: '0' })).status, 400);
  assert.equal((await update('/api/admin/attendants', { name: 'Pessoa', commission: '101' })).status, 400);
  assert.equal((await update('/api/admin/checkouts/main', { name: 'Principal', fee: '3.5' }, 'PATCH')).status, 200);
  const data = await (await call('/api/portal')).json();
  assert.equal(data.finance.availableCents, 2300); assert.equal(data.sales[0].feeCents, 0);
  assert.equal(data.checkouts.find((item: { id: string }) => item.id === 'main').feeBps, 350);
  assert.equal((await update('/api/admin/checkouts/main', { name: 'Principal', fee: '-1' }, 'PATCH')).status, 400);
});

test('somente a administração define o token; tokens escolhidos exigem formato válido e são exclusivos', async t => {
  const { call } = await fixture(t);
  const chosen = 'fixture_owner_selected_012345678901234567890';
  const create = (token: string, credential = adminKey) => call('/api/admin/attendants', credential, { method: 'POST', body: JSON.stringify({ name: 'Cadastro pelo responsável', commission: '10', token }) });
  assert.equal((await create(chosen, tokenA)).status, 401);
  assert.equal((await create('short_token')).status, 400);
  const created = await create(chosen); assert.equal(created.status, 201);
  const invitation = await created.json(); assert.equal(invitation.token, chosen);
  assert.equal((await call('/api/portal', chosen)).status, 200);
  assert.equal((await create(chosen)).status, 409);
  const dashboard = await (await call('/api/admin/dashboard', adminKey)).json();
  assert.equal(JSON.stringify(dashboard).includes(chosen), false);
});

test('administração confere destino PIX e confirma ou cancela repasse uma única vez', async t => {
  const { call, submit } = await fixture(t); await submit();
  await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify({ name: 'Ana', email: '', phone: '', pixType: 'email', pixKey: 'pix@example.com', pixOwner: 'Ana' }) });
  const requested = await (await call('/api/payouts', tokenA, { method: 'POST', body: JSON.stringify({ amount: '20' }) })).json();
  const dashboard = await (await call('/api/admin/dashboard', adminKey)).json();
  assert.equal(dashboard.payouts[0].pixKey, 'pix@example.com');
  const finish = (status: string) => call('/api/admin/payouts/' + requested.id, adminKey, { method: 'PATCH', body: JSON.stringify({ status, note: 'Conferido' }) });
  assert.equal((await finish('cancelled')).status, 200);
  assert.equal((await (await call('/api/portal')).json()).finance.availableCents, 3000);
  assert.equal((await finish('paid')).status, 400);
  const next = await (await call('/api/payouts', tokenA, { method: 'POST', body: JSON.stringify({ amount: '20' }) })).json();
  assert.equal((await call('/api/admin/payouts/' + next.id, adminKey, { method: 'PATCH', body: JSON.stringify({ status: 'paid', note: 'Pagamento conferido' }) })).status, 200);
  assert.equal((await (await call('/api/portal')).json()).finance.availableCents, 1000);
});

test('chave administrativa persiste com permissão privada e backup contém vendas e comprovantes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-backup-')), database = join(directory, 'portal.sqlite'), output = join(directory, 'backup.sqlite'), keyPath = join(directory, 'admin.key');
  try {
    const key = loadAdminKey(keyPath);
    assert.equal(loadAdminKey(keyPath), key); assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.throws(() => loadAdminKey(keyPath, 'short'));
    const store = new PortalStore(database); store.createAttendant('Ana', 1000, tokenA);
    store.recordSales(store.authenticate(tokenA), batch(), 'fixture_backup_request_key');
    const logs = execFileSync(process.execPath, ['server/manage.ts', 'backup', '--output', output], { encoding: 'utf8', env: { ...process.env, BRAVUS_DB_PATH: database } });
    assert.equal(logs.includes(tokenA), false); assert.equal(statSync(output).mode & 0o777, 0o600);
    const copy = new PortalStore(output), auth = copy.authenticate(tokenA), sale = copy.sales(auth)[0];
    assert.equal(sale.amountCents, 30000); assert.ok(copy.receipt(auth, sale.receiptId).bytes.length > 0);
    copy.close(); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('foto e alerta são salvos por atendente, persistem e a foto aparece no ranking', async t => {
  const { call, submit, store, a } = await fixture(t);
  const photoUrl = `data:image/png;base64,${image.base64}`;
  const fields = { name: 'Ana Foto', email: '', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana', photoUrl, saleAlertTemplate: '{nome}: {qtd} venda(s) de {valor}' };
  assert.equal((await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify(fields) })).status, 200);
  assert.equal(store.profile({ id: a.id }).photoUrl, photoUrl);
  const other = await (await call('/api/portal', tokenB)).json();
  assert.equal(other.profile.photoUrl, '');
  assert.equal(other.profile.saleAlertTemplate.includes('✅'), true);
  await submit();
  const ranking = await (await call('/api/ranking', tokenB)).json();
  assert.equal(ranking[0].photoUrl, photoUrl); assert.equal(JSON.stringify(ranking).includes('ana@example.com'), false);
  assert.equal((await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify({ ...fields, photoUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }) })).status, 400);
  assert.equal(store.profile({ id: a.id }).photoUrl, photoUrl);
});

function pushFixtureSubscription() {
  const curve = createECDH('prime256v1'); curve.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-device', keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
test('push é autenticado e isolado, criptografa o alerta e não repete envio idempotente', async t => {
  const { call, submit, deliveries, store, a, b } = await fixture(t), subscription = pushFixtureSubscription();
  const registered = await call('/api/push/subscriptions', tokenA, { method: 'POST', body: JSON.stringify(subscription) });
  assert.equal(registered.status, 201); const { id } = await registered.json();
  const own = await (await call('/api/push/config')).json(), other = await (await call('/api/push/config', tokenB)).json();
  assert.deepEqual(own.subscriptionIds, [id]); assert.deepEqual(other.subscriptionIds, []);
  assert.equal(Object.hasOwn(own, 'privateKey'), false);
  await call('/api/push/subscriptions', tokenB, { method: 'DELETE', body: JSON.stringify({ id }) });
  assert.equal((await submit()).status, 200); assert.equal(deliveries.length, 1);
  assert.ok(JSON.parse(deliveries[0].payload).body.includes('300,00'));
  await submit(); assert.equal(deliveries.length, 1);
  await call('/api/push/subscriptions', tokenA, { method: 'DELETE', body: JSON.stringify({ id }) });
  assert.deepEqual((await (await call('/api/push/config')).json()).subscriptionIds, []);
  for (const endpoint of ['https://127.0.0.1/private', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', [subscription.endpoint], null]) assert.equal((await call('/api/push/subscriptions', tokenA, { method: 'POST', body: JSON.stringify({ ...subscription, endpoint }) })).status, 400);
  assert.equal((await call('/api/push/subscriptions', tokenA, { method: 'POST', body: JSON.stringify({ ...subscription, keys: { auth: [subscription.keys.auth], p256dh: subscription.keys.p256dh } }) })).status, 400);
  assert.equal((await call('/api/push/subscriptions', tokenA, { method: 'POST', body: JSON.stringify(subscription) })).status, 201);
  store.rotateToken(a.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE attendant_id = ?').get(a.id)?.count, 0);
  assert.equal((await call('/api/push/config', tokenA)).status, 401);
  assert.equal((await call('/api/push/subscriptions', tokenB, { method: 'POST', body: JSON.stringify(subscription) })).status, 201);
  store.setAttendantActive(b.id, { active: false });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE attendant_id = ?').get(b.id)?.count, 0);
});
test('push expirado é removido sem desfazer a venda; credenciais VAPID persistem de forma privada', async t => {
  const { call, submit, push } = await fixture(t);
  await call('/api/push/subscriptions', tokenA, { method: 'POST', body: JSON.stringify(pushFixtureSubscription()) });
  push.sender = async () => { throw Object.assign(new Error('expired fixture'), { statusCode: 410 }); };
  assert.equal((await submit()).status, 200);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 1);
  assert.deepEqual((await (await call('/api/push/config')).json()).subscriptionIds, []);
  const directory = mkdtempSync(join(tmpdir(), 'bravus-push-keys-')), file = join(directory, 'keys.json');
  try {
    const keys = loadPushKeys(file, {});
    assert.deepEqual(loadPushKeys(file, {}), keys); assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(loadPushKeys(file, { BRAVUS_PUSH_PUBLIC_KEY: keys.publicKey, BRAVUS_PUSH_PRIVATE_KEY: keys.privateKey }), keys);
    assert.throws(() => loadPushKeys(file, { BRAVUS_PUSH_PUBLIC_KEY: keys.publicKey }));
    assert.throws(() => loadPushKeys(file, { BRAVUS_PUSH_PUBLIC_KEY: keys.publicKey, BRAVUS_PUSH_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('só o administrador aprova ou recusa vendas; saldo e ranking usam apenas as aprovadas', async t => {
  const { call, submit, a } = await fixture(t, { approveSales: false });
  const forged = batch(); Object.assign(forged.sales[0], { status: 'approved', reviewNote: 'aprovada pelo navegador' });
  assert.equal((await submit(forged)).status, 200);
  let portal = await (await call('/api/portal')).json(); const sale = portal.sales[0];
  assert.equal(sale.status, 'pending'); assert.equal(sale.reviewNote, ''); assert.equal(portal.finance.availableCents, 0);
  assert.equal(portal.finance.pendingSalesCount, 1); assert.equal((await (await call('/api/ranking')).json()).length, 0);
  await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify({ name: 'Ana', email: '', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana' }) });
  assert.equal((await call('/api/payouts', tokenA, { method: 'POST', body: JSON.stringify({ amount: '1' }) })).status, 400);
  const review = (status: string, note = '', credential = adminKey) => call('/api/admin/sales/' + sale.id, credential, { method: 'PATCH', body: JSON.stringify({ status, note }) });
  assert.equal((await review('approved', '', tokenA)).status, 401);
  assert.equal((await call('/api/admin/receipts/' + sale.receiptId, tokenB)).status, 401);
  const receipt = await call('/api/admin/receipts/' + sale.receiptId, adminKey);
  assert.equal(receipt.status, 200); assert.equal(receipt.headers.get('content-type'), 'image/png'); assert.match(receipt.headers.get('cache-control')!, /no-store/);
  assert.equal((await review('rejected', '   ')).status, 400);
  assert.equal((await review('pending')).status, 400);
  const concurrent = await Promise.all([review('approved', 'Print conferido'), review('approved', 'Outra tentativa')]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  portal = await (await call('/api/portal')).json();
  assert.equal(portal.finance.availableCents, 3000); assert.equal(portal.finance.pendingSalesCount, 0); assert.ok(portal.sales[0].reviewedAt);
  assert.equal((await (await call('/api/ranking')).json())[0].grossCents, 30000);
  assert.equal((await review('rejected', 'Não pode desfazer uma aprovação')).status, 409);
  await submit(batch(), 'fixture_rejected_sale_02');
  const pending = await (await call('/api/admin/sales?status=pending', adminKey)).json();
  assert.equal(pending.total, 1); assert.equal(pending.sales[0].attendantId, a.id);
  assert.equal((await call('/api/admin/sales/' + pending.sales[0].id, adminKey, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', note: 'Comprovante não confere' }) })).status, 200);
  await call(`/api/admin/attendants/${a.id}/costs`, adminKey, { method: 'POST', body: JSON.stringify({ date: businessToday(), ads: '5', withdrawalFee: '0' }) });
  portal = await (await call('/api/portal')).json();
  assert.equal(portal.finance.availableCents, 2500); assert.equal(portal.finance.count, 1); assert.equal(portal.finance.rejectedSalesCount, 1);
  assert.ok(portal.sales.some((item: { reviewNote: string }) => item.reviewNote === 'Comprovante não confere'));
  const dashboard = await (await call('/api/admin/dashboard', adminKey)).json();
  assert.equal(dashboard.costs[0].adsCents, 500); assert.equal(dashboard.pendingSalesCount, 0);
});
test('fila administrativa pagina, filtra por atendente e não expõe tokens', async t => {
  const { call, submit, a } = await fixture(t, { approveSales: false });
  const payload = batch(); payload.sales = Array.from({ length: 10 }, () => ({ ...payload.sales[0] }));
  for (let index = 0; index < 6; index++) assert.equal((await submit(payload, `fixture_pagination_${index}`)).status, 200);
  const page = await (await call(`/api/admin/sales?status=pending&attendantId=${a.id}&page=2`, adminKey)).json();
  assert.equal(page.total, 60); assert.equal(page.sales.length, 10); assert.equal(page.page, 2);
  assert.equal(JSON.stringify(page).includes(tokenA), false);
  assert.equal((await call('/api/admin/sales?status=invalid', adminKey)).status, 400);
  assert.equal((await call('/api/admin/sales?page=0', adminKey)).status, 400);
});
test('migração mantém vendas anteriores aprovadas e persiste decisões e novos lançamentos pendentes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-sale-review-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Histórico revisão', 1000, tokenA);
    store.recordSales({ id: account.id }, batch(), 'fixture_legacy_sale_before_review');
    store.db.exec('DROP INDEX sales_status_created; ALTER TABLE sales DROP COLUMN status; ALTER TABLE sales DROP COLUMN review_note; ALTER TABLE sales DROP COLUMN reviewed_at;');
    store.close(); store = new PortalStore(file);
    assert.equal(store.sales({ id: account.id })[0].status, 'approved');
    store.recordSales({ id: account.id }, batch(), 'fixture_sale_after_review_migration');
    const pending = store.sales({ id: account.id }).find(sale => sale.status === 'pending')!;
    store.reviewSale(pending.id, { status: 'rejected', note: 'Print ilegível' });
    store.close(); store = new PortalStore(file);
    const reviewed = store.sales({ id: account.id }).find(sale => sale.id === pending.id)!;
    assert.equal(reviewed.status, 'rejected'); assert.equal(reviewed.reviewNote, 'Print ilegível'); assert.ok(reviewed.reviewedAt);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('limite novo do checkout preserva taxas de vendas antigas acima de R$ 1.000', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-checkout-limit-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Histórico limite', 1000, tokenA);
    store.db.exec("UPDATE checkouts SET max_amount_cents = NULL, tier_above_cents = 100000, tier_fee_bps = 2500, tier_fixed_fee_cents = 199 WHERE id = 'main'; DELETE FROM schema_migrations WHERE id = 'checkout-maximum-1000-v1';");
    const payload = batch(); payload.sales[0].amount = '1000,01';
    store.recordSales({ id: account.id }, payload, 'fixture_sale_before_maximum');
    const sale = store.sales({ id: account.id })[0]; store.reviewSale(sale.id, { status: 'approved', note: 'Histórico' });
    store.close(); store = new PortalStore(file);
    assert.equal(store.sales({ id: account.id })[0].feeCents, 25199);
    assert.equal(store.sales({ id: account.id })[0].status, 'approved');
    assert.equal(store.checkouts().find(item => item.id === 'main')!.higherTier, null);
    assert.throws(() => store!.recordSales({ id: account.id }, payload, 'fixture_sale_after_maximum'), /valor máximo/);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('padrão de 50% divide taxas do gateway e do saque em 50% para cada parte sem aceitar valores manipulados', async t => {
  const { call, submit } = await fixture(t, { defaultCheckoutRates: true });
  const token = 'fixture_fifty_percent_attendant_01234567890123456789';
  const created = await call('/api/admin/attendants', adminKey, { method: 'POST', body: JSON.stringify({ name: 'Regra de 50%', token }) });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.equal((await (await call('/api/portal', token)).json()).profile.commissionBps, 5000);
  const payload = batch(); payload.sales = ['main', 'pix'].map(checkoutId => ({ ...payload.sales[0], amount: '100', checkoutId, commissionBps: 10000, commissionMode: 'net-share', feeCents: 0, attendantFeeCents: 0 }));
  assert.equal((await submit(payload, 'fixture_fifty_percent_sale', token)).status, 200);
  let portal = await (await call('/api/portal', token)).json();
  assert.equal(portal.finance.availableCents, 8716); assert.equal(portal.finance.businessShareCents, 8717); assert.equal(portal.finance.transactionFeeCents, 1284); assert.equal(portal.finance.gatewayFeeCents, 2567); assert.equal(portal.finance.businessGatewayFeeCents, 1283);
  assert.deepEqual(portal.sales.map((sale: { attendantFeeCents: number }) => sale.attendantFeeCents).sort((a: number, b: number) => a - b), [434, 850]);
  assert.ok(portal.sales.every((sale: { commissionBps: number; commissionMode: string }) => sale.commissionBps === 5000 && sale.commissionMode === 'gross-share-less-fees'));
  await call(`/api/admin/attendants/${account.attendantId}/costs`, adminKey, { method: 'POST', body: JSON.stringify({ date: businessToday(), ads: '2', withdrawalFee: '0' }) });
  await call('/api/profile', token, { method: 'PATCH', body: JSON.stringify({ name: 'Regra 50', email: '', phone: '', pixType: 'email', pixKey: 'fifty@example.com', pixOwner: 'Regra 50' }) });
  const request = (amount: string) => call('/api/payouts', token, { method: 'POST', body: JSON.stringify({ amount, withdrawalFeeCents: 0, status: 'paid' }) });
  assert.equal((await request('2,50')).status, 400);
  assert.equal((await request('85,17')).status, 400);
  const concurrent = await Promise.all([request('85,16'), request('85,16')]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 400]);
  const payout = await concurrent.find(response => response.status === 201)!.json();
  assert.equal(payout.withdrawalFeeCents, 0); assert.equal(payout.amountCents, 8516); assert.equal(payout.status, 'pending');
  portal = await (await call('/api/portal', token)).json();
  assert.equal(portal.finance.availableCents, 0); assert.equal(portal.finance.withdrawalFeeCents, 0);
  const finish = (id: string, status: string) => call('/api/admin/payouts/' + id, adminKey, { method: 'PATCH', body: JSON.stringify({ status, note: 'Teste sintético', withdrawalFeeCents: 0 }) });
  assert.equal((await finish(payout.id, 'cancelled')).status, 200);
  portal = await (await call('/api/portal', token)).json();
  assert.equal(portal.finance.availableCents, 8516); assert.equal(portal.finance.withdrawalFeeCents, 0);
  const second = await (await request('85,16')).json();
  const paidTwice = await Promise.all([finish(second.id, 'paid'), finish(second.id, 'paid')]);
  assert.deepEqual(paidTwice.map(response => response.status).sort(), [200, 400]);
  portal = await (await call('/api/portal', token)).json();
  assert.equal(portal.finance.withdrawalFeeCents, 250); assert.equal(portal.payouts.find((item: { id: string }) => item.id === second.id).withdrawalFeeCents, 250);
  assert.equal(portal.finance.availableCents, 0); assert.equal(portal.finance.paidPayoutNetCents, 8266); assert.equal(portal.finance.feeCents, 1534);
  assert.equal(portal.payouts.find((item: { id: string }) => item.id === second.id).gatewayFeeCents, 500);
  assert.equal((await finish(second.id, 'paid')).status, 400);
});

test('migração mantém regras e saques históricos e aplica 50% apenas aos próximos lançamentos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-earnings-upgrade-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Histórico financeiro', 1000, tokenA), auth = { id: account.id };
    const payload = batch(); payload.sales[0].amount = '100';
    store.recordSales(auth, payload, 'fixture_legacy_earnings_sale');
    const sale = store.sales(auth)[0]; store.reviewSale(sale.id, { status: 'approved', note: '' });
    store.saveProfile(auth, { name: 'Histórico', email: '', phone: '', pixType: 'email', pixKey: 'legacy@example.com', pixOwner: 'Histórico' });
    store.db.exec("UPDATE sales SET commission_mode = 'net-share'");
    const historical = store.requestPayout(auth, { amount: '8' });
    store.db.exec('ALTER TABLE sales DROP COLUMN commission_mode; ALTER TABLE sales DROP COLUMN attendant_fee_cents; ALTER TABLE payouts DROP COLUMN withdrawal_fee_cents;');
    store.db.prepare('DELETE FROM schema_migrations WHERE id = ?').run('attendant-gross-share-50-v1');
    store.close(); store = new PortalStore(file);
    assert.equal(store.profile(auth).commissionBps, 5000);
    assert.equal(store.sales(auth)[0].commissionBps, 1000); assert.equal(store.sales(auth)[0].commissionMode, 'net-share');
    assert.equal(store.payouts(auth)[0].id, historical.id); assert.equal(store.payouts(auth)[0].withdrawalFeeCents, 0);
    assert.equal(store.portal(auth).finance.availableCents, 30);
    store.recordSales(auth, payload, 'fixture_new_earnings_sale');
    const next = store.sales(auth).find(item => item.id !== sale.id)!; store.reviewSale(next.id, { status: 'approved', note: '' });
    assert.equal(store.portal(auth).finance.availableCents, 4180);
    // Restarting never resets a later administrative override or changes stored sale snapshots.
    store.db.prepare('UPDATE attendants SET commission_bps = 6000 WHERE id = ?').run(account.id);
    store.close(); store = new PortalStore(file);
    assert.equal(store.profile(auth).commissionBps, 6000); assert.equal(store.portal(auth).finance.availableCents, 4180);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('migração remove tarifas antecipadas de pedidos em análise sem alterar repasses já pagos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-payout-fee-upgrade-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Repasse de teste', 5000, tokenA), auth = { id: account.id };
    store.recordSales(auth, batch(), 'fixture_payout_fee_migration');
    store.reviewSale(store.sales(auth)[0].id, { status: 'approved', note: '' });
    store.saveProfile(auth, { name: 'Repasse de teste', email: '', phone: '', pixType: 'email', pixKey: 'payout@example.com', pixOwner: 'Teste' });
    const paid = store.requestPayout(auth, { amount: '10' }); store.markPayout(paid.id, 'paid', 'Pagamento sintético');
    store.db.prepare('UPDATE payouts SET withdrawal_fee_cents = 500 WHERE id = ?').run(paid.id);
    const pending = store.requestPayout(auth, { amount: '10' });
    const cancelled = store.requestPayout(auth, { amount: '10' }); store.markPayout(cancelled.id, 'cancelled', 'Cancelamento sintético');
    store.db.prepare('UPDATE payouts SET withdrawal_fee_cents = 500 WHERE id IN (?, ?)').run(pending.id, cancelled.id);
    store.db.prepare('DELETE FROM schema_migrations WHERE id = ?').run('payout-fee-on-payment-v1');
    const paidAt = store.payouts(auth).find(item => item.id === paid.id)!.paidAt, balance = store.portal(auth).finance.availableCents;
    store.close(); store = new PortalStore(file);
    const payouts = store.payouts(auth);
    assert.equal(payouts.find(item => item.id === pending.id)!.withdrawalFeeCents, 0);
    assert.equal(payouts.find(item => item.id === cancelled.id)!.withdrawalFeeCents, 0);
    assert.equal(payouts.find(item => item.id === paid.id)!.withdrawalFeeCents, 500);
    assert.equal(payouts.find(item => item.id === paid.id)!.paidAt, paidAt);
    assert.equal(store.portal(auth).finance.availableCents, balance);
    assert.equal(store.portal(auth).finance.withdrawalFeeCents, 500);
    store.markPayout(pending.id, 'paid', 'Pagamento posterior');
    store.close(); store = new PortalStore(file);
    assert.equal(store.portal(auth).finance.withdrawalFeeCents, 750);
    assert.equal(store.portal(auth).finance.availableCents, balance);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('migração mantém taxas inteiras históricas e salva o rateio das próximas vendas e repasses', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-gateway-share-')), file = join(directory, 'portal.sqlite');
  let store: PortalStore | undefined;
  try {
    store = new PortalStore(file); const account = store.createAttendant('Rateio gateway', 5000, tokenA), auth = { id: account.id };
    const payload = batch(); payload.sales[0].amount = '100';
    store.recordSales(auth, payload, 'fixture_gateway_before_share');
    const historical = store.sales(auth)[0]; store.reviewSale(historical.id, { status: 'approved', note: '' });
    store.db.exec('UPDATE sales SET attendant_fee_cents = fee_cents');
    store.saveProfile(auth, { name: 'Rateio gateway', email: '', phone: '', pixType: 'email', pixKey: 'share@example.com', pixOwner: 'Teste' });
    const payout = store.requestPayout(auth, { amount: '30' }); store.markPayout(payout.id, 'paid', 'Repasse histórico sintético');
    store.db.prepare('UPDATE payouts SET withdrawal_fee_cents = 500 WHERE id = ?').run(payout.id);
    store.db.exec('ALTER TABLE sales DROP COLUMN attendant_fee_cents; ALTER TABLE payouts DROP COLUMN gateway_fee_cents;');
    store.close(); store = new PortalStore(file);
    assert.equal(store.sales(auth)[0].attendantFeeCents, null); assert.equal(store.portal(auth).finance.availableCents, 301);
    assert.equal(store.payouts(auth)[0].withdrawalFeeCents, 500); assert.equal(store.payouts(auth)[0].gatewayFeeCents, 500);
    store.recordSales(auth, payload, 'fixture_gateway_after_share');
    const next = store.sales(auth).find(item => item.id !== historical.id)!;
    assert.equal(next.attendantFeeCents, 850); store.reviewSale(next.id, { status: 'approved', note: '' });
    assert.equal(store.portal(auth).finance.availableCents, 4451);
    store.adminSetCheckout('main', { name: 'Nova tarifa', fee: '20' });
    store.close(); store = new PortalStore(file);
    const saved = store.sales(auth).find(item => item.id === next.id)!;
    assert.equal(saved.feeCents, 1699); assert.equal(saved.attendantFeeCents, 850);
    assert.equal(store.portal(auth).finance.availableCents, 4451);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
