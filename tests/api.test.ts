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

const tokenA = 'fixture_attendant_a_012345678901234567890';
const tokenB = 'fixture_attendant_b_012345678901234567890';
const adminKey = 'fixture_admin_012345678901234567890123456789';
const image = { name: 'comprovante.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = () => ({ date: businessToday(), sales: [{ amount: '300,00', checkoutId: 'main', time: '12:30', note: 'Venda de teste', receipt: { ...image } }] });
async function fixture(t: TestContext) {
  const store = new PortalStore(':memory:');
  const a = store.createAttendant('Ana Teste', 1000, tokenA), b = store.createAttendant('Bruno Teste', 1000, tokenB);
  const server = createPortalServer(store, { allowedOrigins: ['https://portal.example'], adminKey });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close(); resolve(); }); server.closeAllConnections(); }));
  const call = (path: string, token = tokenA, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const submit = (payload: unknown = batch(), key = 'fixture_request_key_01', token = tokenA) => call('/api/sales', token, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  return { store, a, b, call, submit };
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
test('lote inválido é rejeitado inteiro; imagem falsa e data futura não são salvas', async t => {
  const { call, submit } = await fixture(t);
  const invalid = batch(); invalid.sales.push({ ...invalid.sales[0], amount: '-10' });
  assert.equal((await submit(invalid)).status, 400);
  const fake = batch(); fake.sales[0].receipt.base64 = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await submit(fake)).status, 400);
  const future = batch(); future.date = '2999-01-01'; assert.equal((await submit(future)).status, 400);
  assert.equal((await (await call('/api/portal')).json()).sales.length, 0);
});
test('alterar perfil não altera comissão e ranking não expõe PIX ou tokens', async t => {
  const { call, submit } = await fixture(t);
  const fields = { name: 'Ana Atualizada', email: 'ana@example.com', phone: '', pixType: 'email', pixKey: 'pix@example.com', pixOwner: 'Ana', commissionBps: 10000 };
  const result = await call('/api/profile', tokenA, { method: 'PATCH', body: JSON.stringify(fields) });
  assert.equal(result.status, 200); assert.equal((await result.json()).commissionBps, 1000);
  await submit();
  const ranking = await (await call('/api/ranking', tokenB)).json();
  assert.equal(ranking[0].name, 'Ana Atualizada');
  assert.equal(JSON.stringify(ranking).includes('pix@example.com'), false);
  assert.deepEqual(Object.keys(ranking[0]).sort(), ['count', 'grossCents', 'id', 'mine', 'name']);
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
    store.close();
    store = new PortalStore(file);
    assert.equal(store.portal(store.authenticate(tokenA)).sales.length, 1); store.close();
    assert.equal(readFileSync(file).includes(Buffer.from(tokenA)), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
