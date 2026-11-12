import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createPortalServer } from '../server/http.ts';
import { readAudit } from '../server/admin-controls.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { exclusiveCheckoutId } from '../server/partner-checkouts.ts';
import { businessToday } from '../src/domain.ts';

const actor = { id: 'fixture-admin', name: 'Administrador' }, day = businessToday();
const receipt = { name: 'historico.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
const batch = { date: day, sales: [{ amount: '100', time: '12:00', note: '', receipt }] };

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: exclui somente o cadastro revogado vazio por ID, preservando homônimos e auditoria`, async () => {
  const store = await (driver === 'sqlite' ? PortalStore.open(':memory:') : PortalStore.open(libsqlDatabase(createClient({ url: 'file::memory:', intMode: 'number' }))));
  try {
    const target = await store.createAttendant('parceiro', 10000), sameName = await store.createPartner('parceiro');
    assert.equal((await store.adminDashboard()).attendants.find(row => row.id === target.id)!.canDelete, false);
    await assert.rejects(store.deleteRevokedAccount(target.id, actor), /Revogue o acesso/);
    await store.setAttendantActive(target.id, { active: false }, actor);
    assert.equal((await store.adminDashboard()).attendants.find(row => row.id === target.id)!.canDelete, true);
    // Remove a legacy subscription and an unused dedicated gateway with the empty account.
    await store.sql.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?)').run('fixture-endpoint', target.id, '{}');
    await store.sql.prepare('INSERT INTO checkouts (id,name,fee_bps) VALUES (?,?,1200)').run(exclusiveCheckoutId(target.id), 'Gateway vazio');
    const survivor = await store.portal({ id: sameName.id }, 'all');
    assert.deepEqual(await store.deleteRevokedAccount(target.id, actor), { deleted: true });
    assert.equal((await store.adminDashboard()).attendants.some(row => row.id === target.id), false);
    assert.deepEqual(await store.portal({ id: sameName.id }, 'all'), survivor);
    await assert.rejects(store.authenticate(target.token), /não encontrado pelo token/);
    assert.equal(await store.sql.prepare('SELECT attendant_id FROM push_subscriptions WHERE attendant_id=?').get(target.id), undefined);
    assert.equal(await store.sql.prepare('SELECT id FROM checkouts WHERE id=?').get(exclusiveCheckoutId(target.id)), undefined);
    const audit = await readAudit(store, new URLSearchParams('action=attendant.deleted'));
    assert.equal(audit.total, 1);assert.equal(audit.entries[0].targetId, target.id);assert.equal(audit.entries[0].actorName, 'Administrador');
    assert.deepEqual(audit.entries[0].before, { exists: true, active: false, accountKind: 'attendant' });assert.deepEqual(audit.entries[0].after, { exists: false });
    assert.ok(!JSON.stringify(audit).includes(target.token));
    await assert.rejects(store.deleteRevokedAccount(target.id, actor), /Cadastro não encontrado/);
    assert.equal((await readAudit(store, new URLSearchParams('action=attendant.deleted'))).total, 1);
    const restored = await PortalStore.open(':memory:');
    try {
      await restoreArchive(await createArchive(store), restored);
      assert.equal((await restored.adminDashboard()).attendants.some(row => row.id === target.id), false);
      assert.equal((await readAudit(restored, new URLSearchParams('action=attendant.deleted'))).total, 1);
      assert.deepEqual(await restored.sql.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { restored.close(); }
  } finally { store.close(); }
});

test('qualquer histórico impede a exclusão: vendas pendentes, aprovadas ou recusadas, ADS, ajustes, repasses, lotes e comprovantes', async () => {
  const store = await PortalStore.open(':memory:');
  try {
    for (const kind of ['pending', 'approved', 'rejected', 'own-ads', 'admin-ads', 'zero-cost', 'paid', 'cancelled', 'batch', 'receipt']) {
      const account = await store.createPartner(`Histórico ${kind}`), auth = { id: account.id };
      if (['pending', 'approved', 'rejected'].includes(kind)) {
        await store.recordSales(auth, batch, `fixture_delete_history_${kind}`);
        if (kind !== 'pending') await store.reviewSale((await store.sales(auth))[0].id, { status: kind, note: 'Registro original' });
      } else if (kind === 'own-ads') await store.savePartnerAds(auth, { date: day, ads: '1' });
      else if (kind === 'admin-ads' || kind === 'zero-cost') await store.setCosts(account.id, day, kind === 'zero-cost' ? 0 : 100, 0);
      else if (kind === 'paid' || kind === 'cancelled') await store.sql.prepare('INSERT INTO payouts (id,attendant_id,amount_cents,status,requested_at,note,pix_type,pix_key,pix_owner) VALUES (?,?,100,?,?,?, ?,?,?)').run(`fixture-${kind}`, account.id, kind, new Date().toISOString(), '', '', '', '');
      else if (kind === 'batch') await store.sql.prepare('INSERT INTO batches VALUES (?,?,?,?)').run('fixture-batch', account.id, 'fixture-only-batch', 'fixture-hash');
      else await store.sql.prepare('INSERT INTO receipts VALUES (?,?,?,?,?)').run('fixture-receipt', account.id, 'original.png', 'image/png', Buffer.from(receipt.base64, 'base64'));
      await store.setAttendantActive(account.id, { active: false });
      const before = await store.portal(auth, 'all');
      assert.equal((await store.adminDashboard()).attendants.find(row => row.id === account.id)!.canDelete, false, kind);
      await assert.rejects(store.deleteRevokedAccount(account.id, actor), /preservar o histórico/);
      assert.deepEqual(await store.portal(auth, 'all'), before, kind);
    }
    assert.equal((await readAudit(store, new URLSearchParams('action=attendant.deleted'))).total, 0);
  } finally { store.close(); }
});

test('falha na auditoria reverte a exclusão do cadastro, do gateway e da inscrição', async () => {
  const store = await PortalStore.open(':memory:');
  try {
    const account = await store.createPartner('Parceiro rollback');await store.setAttendantActive(account.id, { active: false });
    await store.sql.prepare('INSERT INTO push_subscriptions VALUES (?,?,?)').run('fixture-rollback', account.id, '{}');
    await store.sql.prepare('INSERT INTO checkouts (id,name,fee_bps) VALUES (?,?,1200)').run(exclusiveCheckoutId(account.id), 'Gateway original');
    await store.sql.exec("CREATE TRIGGER fail_delete_audit BEFORE INSERT ON audit_events WHEN NEW.action='attendant.deleted' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
    await assert.rejects(store.deleteRevokedAccount(account.id, actor), /fixture audit failure/);
    assert.equal((await store.adminDashboard()).attendants.find(row => row.id === account.id)!.canDelete, true);
    assert.ok(await store.sql.prepare('SELECT id FROM checkouts WHERE id=?').get(exclusiveCheckoutId(account.id)));
    assert.ok(await store.sql.prepare('SELECT attendant_id FROM push_subscriptions WHERE attendant_id=?').get(account.id));
    assert.equal((await readAudit(store, new URLSearchParams('action=attendant.deleted'))).total, 0);
  } finally { store.close(); }
});

test('API exige a chave administrativa, valida o estado atual e registra uma única exclusão concorrente', async t => {
  const store = await PortalStore.open(':memory:'), key = 'fixture_delete_admin_01234567890123456789';
  const target = await store.createPartner('Parceiro revogado'), caller = await store.createAttendant('Atendente sem poderes', 5000);
  const server = createPortalServer(store, { adminKey: key });server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close();resolve(); });server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, remove = (credential: string) => fetch(`${base}/api/admin/attendants/${target.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${credential}` } });
  for (const credential of ['', caller.token, target.token]) assert.equal((await remove(credential)).status, 401);
  assert.equal((await remove(key)).status, 409);await store.setAttendantActive(target.id, { active: false });
  const staleEligible = (await store.adminDashboard()).attendants.find(row => row.id === target.id)!;assert.equal(staleEligible.canDelete, true);
  await store.setCosts(target.id, day, 0, 0);assert.equal((await remove(key)).status, 409);
  await store.sql.prepare('DELETE FROM costs WHERE attendant_id=?').run(target.id);
  const attempts = await Promise.all([remove(key), remove(key)]);assert.deepEqual(attempts.map(response => response.status).sort(), [200, 404]);
  assert.equal((await readAudit(store, new URLSearchParams('action=attendant.deleted'))).total, 1);
  assert.ok((await store.adminDashboard()).attendants.some(row => row.id === caller.id));
});
