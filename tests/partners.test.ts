import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PortalStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { businessToday } from '../src/domain.ts';
import type { Portal, Sale } from '../src/domain.ts';

const adminKey = 'fixture_partner_admin_012345678901234567890123456789';
const partnerToken = 'fixture_partner_individual_012345678901234567890';
const attendantToken = 'fixture_partner_regular_012345678901234567890';
const receipt = { name: 'comprovante.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };

function batch(amounts = ['100'], checkoutId = 'main') {
  return { date: businessToday(), sales: amounts.map(amount => ({ amount, checkoutId, time: '12:00', note: 'Venda sintética do parceiro', receipt: { ...receipt } })) };
}

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-partners-'));
  const store = await PortalStore.open(join(directory, 'portal.sqlite'));
  const attendant = await store.createAttendant('Atendente comum', 5000, attendantToken);
  const server = createPortalServer(store, { adminKey });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>(resolve => {
    server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); resolve(); });
    server.closeAllConnections();
  }));

  const call = (path: string, credential = partnerToken, init: RequestInit = {}) => fetch(base + path, {
    ...init,
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const created = await call('/api/admin/attendants', adminKey, {
    method: 'POST', body: JSON.stringify({ name: 'Parceiro financeiro', accountKind: 'partner', commission: '1', token: partnerToken }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const invitation = await created.json() as { attendantId: string; name: string; token: string };
  assert.equal(invitation.token, partnerToken);
  const portal = async (credential = partnerToken) => {
    const response = await call('/api/portal?period=all', credential);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as Portal;
  };
  const submit = (payload: unknown = batch(), key = 'fixture_partner_batch_001', credential = partnerToken) => call('/api/sales', credential, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
  });
  const approve = async (sales: Sale[]) => {
    for (const sale of sales) {
      const response = await call(`/api/admin/sales/${sale.id}`, adminKey, {
        method: 'PATCH', body: JSON.stringify({ status: 'approved', note: 'Comprovante sintético conferido' }),
      });
      assert.equal(response.status, 200, await response.clone().text());
    }
  };
  return { store, call, portal, submit, approve, invitation, attendant };
}

test('parceiro recebe R$ 90 por venda de R$ 100; tarifas e divisão dos atendentes continuam separadas', async t => {
  const { store, portal, submit, approve } = await fixture(t);
  await store.adminSetCheckout('main', { name: 'Checkout personalizado', fee: '20', fixedFee: '2', higherTier: { aboveAmount: '50', fee: '30', fixedFee: '3' } });
  const ordinary = await portal(attendantToken), partner = await portal();
  assert.equal(partner.profile.accountKind, 'partner');
  assert.equal(partner.profile.commissionBps, 10000);
  assert.equal(ordinary.profile.accountKind, 'attendant');
  assert.equal(ordinary.profile.commissionBps, 5000);
  assert.equal(partner.checkouts.length, ordinary.checkouts.length);
  for (const checkout of partner.checkouts) {
    const original = ordinary.checkouts.find(item => item.id === checkout.id)!;
    assert.deepEqual(checkout, { ...original, feeBps: 1000, fixedFeeCents: 0, higherTier: null });
  }
  const normalCheckout = ordinary.checkouts.find(item => item.id === 'main')!;
  assert.equal(normalCheckout.feeBps, 2000);
  assert.deepEqual(normalCheckout.higherTier, { aboveAmountCents: 5000, feeBps: 3000, fixedFeeCents: 300 });

  assert.equal((await submit()).status, 200);
  assert.equal((await submit(batch(), 'fixture_regular_batch_001', attendantToken)).status, 200);
  let own = await portal();
  assert.equal(own.finance.availableCents, 0);
  assert.equal(own.finance.pendingSalesCount, 1);
  assert.equal(own.sales[0].feeCents, 1000);
  assert.equal(own.sales[0].attendantFeeCents, 1000);
  assert.equal(own.sales[0].commissionBps, 10000);
  assert.equal(own.sales[0].commissionMode, 'gross-share-less-fees');
  await approve(own.sales);
  await approve((await portal(attendantToken)).sales);
  own = await portal();
  assert.equal(own.finance.availableCents, 9000);
  assert.equal(own.finance.commissionCents, 9000);
  assert.equal(own.finance.transactionFeeCents, 1000);
  assert.equal(own.finance.businessGatewayFeeCents, 0);
  const common = await portal(attendantToken);
  assert.equal(common.sales[0].feeCents, 3300);
  assert.equal(common.sales[0].attendantFeeCents, 1650);
  assert.equal(common.finance.availableCents, 3350);
});

test('API arredonda os 10% por venda, ignora taxas adulteradas e mantém idempotência e limites', async t => {
  const { portal, submit, approve } = await fixture(t);
  const payload = batch(['0.05', '0.15', '100']);
  const tampered = {
    ...payload, accountKind: 'attendant', commissionBps: 0,
    sales: payload.sales.map(sale => ({ ...sale, feeCents: 0, feeBps: 0, fixedFeeCents: 9999, attendantFeeCents: 0, commissionBps: 5000, commissionMode: 'net-share', maxAmountCents: null })),
  };
  assert.equal((await submit(tampered)).status, 200);
  let view = await portal();
  assert.deepEqual(view.sales.map(sale => [sale.amountCents, sale.feeCents, sale.attendantFeeCents]).sort((a, b) => Number(a[0]) - Number(b[0])), [[5, 1, 1], [15, 2, 2], [10000, 1000, 1000]]);
  assert.ok(view.sales.every(sale => sale.commissionBps === 10000 && sale.commissionMode === 'gross-share-less-fees'));
  await approve(view.sales);
  assert.equal((await (await submit(tampered)).json()).duplicate, true);
  const changed = structuredClone(tampered); changed.sales[2].amount = '101';
  assert.equal((await submit(changed)).status, 409);
  view = await portal();
  assert.equal(view.sales.length, 3);
  assert.equal(view.finance.availableCents, 9017);
  assert.equal(view.finance.gatewayFeeCents, 1003);

  assert.equal((await submit(batch(['1000', '1000.01']), 'fixture_partner_over_limit')).status, 400);
  assert.equal((await submit(batch(['4.99'], 'pix'), 'fixture_partner_under_min')).status, 400);
  assert.equal((await portal()).sales.length, 3);
});

test('token do parceiro não administra, não muda o tipo da conta e não lê vendas ou comprovantes de outros usuários', async t => {
  const { call, portal, submit, approve } = await fixture(t);
  for (const path of ['/api/admin/dashboard', '/api/admin/sales', '/api/admin/audit', '/api/admin/backups']) {
    assert.equal((await call(path)).status, 401);
  }
  assert.equal((await call('/api/admin/attendants', partnerToken, { method: 'POST', body: JSON.stringify({ name: 'Escalada', accountKind: 'partner' }) })).status, 401);
  const profile = { name: 'Parceiro atualizado', email: 'partner@example.com', phone: '', pixType: 'email', pixKey: 'partner-pix@example.com', pixOwner: 'Parceiro', accountKind: 'attendant', commissionBps: 0, token: 'fixture_partner_untrusted_token_01234567890123456789' };
  const updated = await call('/api/profile', partnerToken, { method: 'PATCH', body: JSON.stringify(profile) });
  assert.equal(updated.status, 200);
  const ownProfile = await updated.json();
  assert.equal(ownProfile.accountKind, 'partner');
  assert.equal(ownProfile.commissionBps, 10000);
  assert.equal(ownProfile.pixKey, profile.pixKey);
  assert.equal((await call('/api/portal', profile.token)).status, 401);
  const ordinaryUpdate = await call('/api/profile', attendantToken, { method: 'PATCH', body: JSON.stringify({ ...profile, name: 'Atendente atualizado', accountKind: 'partner', commissionBps: 10000 }) });
  assert.equal(ordinaryUpdate.status, 200);
  assert.equal((await ordinaryUpdate.json()).accountKind, 'attendant');
  assert.equal((await portal(attendantToken)).profile.commissionBps, 5000);

  assert.equal((await submit()).status, 200);
  assert.equal((await submit(batch(['50']), 'fixture_partner_other_batch', attendantToken)).status, 200);
  const partnerView = await portal(), ordinaryView = await portal(attendantToken);
  assert.equal(partnerView.sales.length, 1); assert.equal(ordinaryView.sales.length, 1);
  assert.notEqual(partnerView.sales[0].id, ordinaryView.sales[0].id);
  assert.equal((await call(`/api/receipts/${partnerView.sales[0].receiptId}`, attendantToken)).status, 404);
  assert.equal((await call(`/api/receipts/${ordinaryView.sales[0].receiptId}`)).status, 404);
  assert.equal((await call(`/api/receipts/${partnerView.sales[0].receiptId}`)).status, 200);
  await approve(partnerView.sales); await approve(ordinaryView.sales);
  const rankingResponse = await call('/api/ranking?period=all', attendantToken);
  assert.equal(rankingResponse.status, 200);
  const ranking = await rankingResponse.json() as { id: string; name: string }[];
  assert.ok(ranking.some(entry => entry.id === ordinaryView.profile.id));
  assert.equal(ranking.some(entry => entry.id === partnerView.profile.id), false);
  assert.deepEqual(await (await call('/api/ranking?period=all')).json(), []);
  for (const secret of [partnerToken, attendantToken, profile.pixKey]) assert.equal(JSON.stringify(ranking).includes(secret), false);
});

test('rotação e revogação do token individual preservam o parceiro e seu histórico financeiro', async t => {
  const { call, portal, submit, approve, invitation } = await fixture(t);
  assert.equal((await submit()).status, 200);
  await approve((await portal()).sales);
  const before = await portal();
  const response = await call(`/api/admin/attendants/${invitation.attendantId}/token`, adminKey, { method: 'POST' });
  assert.equal(response.status, 200);
  const rotated = await response.json() as { token: string };
  assert.notEqual(rotated.token, partnerToken);
  assert.equal((await call('/api/portal', partnerToken)).status, 401);
  const after = await portal(rotated.token);
  assert.equal(after.profile.accountKind, 'partner');
  assert.deepEqual(after.sales, before.sales);
  assert.deepEqual(after.finance, before.finance);
  const activate = (active: boolean) => call(`/api/admin/attendants/${invitation.attendantId}`, adminKey, { method: 'PATCH', body: JSON.stringify({ active }) });
  assert.equal((await activate(false)).status, 200);
  assert.equal((await call('/api/portal', rotated.token)).status, 401);
  assert.equal((await call(`/api/admin/attendants/${invitation.attendantId}/token`, adminKey, { method: 'POST' })).status, 400);
  assert.equal((await activate(true)).status, 200);
  assert.deepEqual((await portal(rotated.token)).finance, before.finance);
  const dashboard = await (await call('/api/admin/dashboard', adminKey)).json();
  const saved = dashboard.attendants.find((item: { id: string }) => item.id === invitation.attendantId);
  assert.equal(saved.accountKind, 'partner');
  assert.equal(saved.commissionBps, 10000);
  assert.equal(JSON.stringify(dashboard).includes(rotated.token), false);
});

test('backup preserva o parceiro, os comprovantes e snapshots de taxas sem recalcular vendas antigas', async t => {
  const { store, portal, submit, approve, invitation } = await fixture(t);
  assert.equal((await submit()).status, 200);
  await approve((await portal()).sales);
  assert.equal((await submit(batch(['100']), 'fixture_partner_history_normal', attendantToken)).status, 200);
  await approve((await portal(attendantToken)).sales);
  const oldPartner = await portal(), oldNormal = await portal(attendantToken);
  await store.adminSetCheckout('main', { name: 'Tarifa posterior', fee: '40', fixedFee: '9', higherTier: null });
  assert.equal((await submit(batch(['100']), 'fixture_partner_history_next')).status, 200);
  const next = await portal();
  assert.ok(next.sales.every(sale => sale.feeCents === 1000 && sale.attendantFeeCents === 1000));
  assert.deepEqual(next.sales.find(sale => sale.id === oldPartner.sales[0].id), oldPartner.sales[0]);
  assert.deepEqual((await portal(attendantToken)).sales, oldNormal.sales);
  assert.deepEqual((await portal(attendantToken)).finance, oldNormal.finance);
  const bytes = await createArchive(store), restored = await PortalStore.open(':memory:');
  try {
    await restoreArchive(bytes, restored);
    const auth = await restored.authenticate(partnerToken);
    assert.equal(auth.id, invitation.attendantId);
    const recovered = await restored.portal(auth, 'all');
    assert.equal(recovered.profile.accountKind, 'partner');
    assert.equal(recovered.profile.commissionBps, 10000);
    assert.deepEqual(recovered.sales.map(sale => ({ ...sale })), next.sales);
    assert.deepEqual(recovered.finance, next.finance);
    assert.deepEqual(await restored.receipt(auth, next.sales[0].receiptId), await store.receipt(auth, next.sales[0].receiptId));
    assert.deepEqual((await restored.portal(await restored.authenticate(attendantToken), 'all')).sales.map(sale => ({ ...sale })), oldNormal.sales);
    assert.ok(recovered.checkouts.every(checkout => checkout.feeBps === 1000 && checkout.fixedFeeCents === 0 && checkout.higherTier === null));
  } finally { restored.close(); }
});

test('backup anterior sem account_kind restaura contas como atendentes e conserva a contabilidade histórica', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-partners-legacy-'));
  const source = await PortalStore.open(join(directory, 'legacy.sqlite'));
  const restored = await PortalStore.open(':memory:');
  t.after(() => { source.close(); restored.close(); rmSync(directory, { recursive: true, force: true }); });
  const account = await source.createAttendant('Conta anterior aos parceiros', 5000, attendantToken);
  const auth = await source.authenticate(attendantToken);
  await source.recordSales(auth, batch(), 'fixture_partner_legacy_sale');
  const item = (await source.sales(auth))[0];
  await source.reviewSale(item.id, { status: 'approved', note: 'Venda histórica conferida' });
  const before = await source.portal(auth, 'all');
  type Table = { name: string; columns: string[]; rows: unknown[][] };
  const archive = JSON.parse(gunzipSync(await createArchive(source)).toString('utf8')) as { tables: Table[] };
  const attendants = archive.tables.find(table => table.name === 'attendants')!;
  const kindIndex = attendants.columns.indexOf('account_kind');
  assert.notEqual(kindIndex, -1, 'A versão atual precisa persistir account_kind para que o teste represente um backup anterior.');
  attendants.columns.splice(kindIndex, 1);
  for (const row of attendants.rows) row.splice(kindIndex, 1);
  await restoreArchive(gzipSync(Buffer.from(JSON.stringify(archive))), restored);
  const recovered = await restored.portal(await restored.authenticate(attendantToken), 'all');
  assert.equal(recovered.profile.id, account.id);
  assert.equal(recovered.profile.accountKind, 'attendant');
  assert.equal(recovered.profile.commissionBps, before.profile.commissionBps);
  assert.deepEqual(recovered.sales, before.sales);
  assert.deepEqual(recovered.finance, before.finance);
  assert.deepEqual(recovered.checkouts, before.checkouts);
});
