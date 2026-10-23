import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PortalStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';
import { BackupService, createArchive, privateBlob, privateFolder, restoreArchive, verifyArchive } from '../server/backups.ts';
import type { BackupStorage } from '../server/backups.ts';
import { readAudit, readFinancialReport } from '../server/admin-controls.ts';
import { financialCsv, financialReport } from '../src/admin-domain.ts';
import type { FinancialReport } from '../src/admin-domain.ts';
import { businessToday } from '../src/domain.ts';
import type { AdminPayout, AdminSale } from '../src/domain.ts';
import { loadDatabasePushKeys } from '../server/push.ts';
import { createClient } from '@libsql/client';
import { libsqlDatabase } from '../server/turso-database.ts';

const adminKey = 'fixture_controls_admin_012345678901234567890123456789';
const token = 'fixture_controls_attendant_012345678901234567890123456789';
const actor = { id: 'fixture-owner-id', name: 'Administrador' };
const receipt = { name: 'print.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-controls-')), store = await PortalStore.open(':memory:');
  const account = await store.createAttendant('Ana', 5000, token), auth = { id: account.id };
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  async function sale(amount = '100', checkoutId = 'main', requestKey = 'fixture_controls_batch_01') {
    await store.recordSales(auth, { date: businessToday(), sales: [{ amount, checkoutId, time: '12:00', note: '', receipt }] }, requestKey);
    return (await store.sales(auth)).find(sale => sale.status === 'pending')!;
  }
  return { store, auth, directory, sale };
}

test('histórico guarda valores anteriores e novos na mesma transação; não duplica ações nem expõe tokens', async t => {
  const { store, auth, sale } = await fixture(t);
  await store.adminSetCosts(auth.id, { date: businessToday(), ads: '10', withdrawalFee: '1' }, actor);
  await store.adminSetCosts(auth.id, { date: businessToday(), ads: '20', withdrawalFee: '2' }, actor);
  await store.adminSetCosts(auth.id, { date: businessToday(), ads: '20', withdrawalFee: '2' }, actor);
  const item = await sale();
  await store.reviewSale(item.id, { status: 'approved', note: 'Conferido' }, actor);
  await assert.rejects(() => store.reviewSale(item.id, { status: 'rejected', note: 'Duplicado' }, actor));
  const invite = await store.rotateToken(auth.id, actor);
  const history = await readAudit(store, new URLSearchParams());
  const costs = history.entries.filter(entry => entry.action === 'costs.updated');
  assert.equal(costs.length, 2);
  const changed = costs.find(entry => entry.before?.adsCents === 1000)!;
  assert.equal(changed.after?.adsCents, 2000); assert.equal(changed.after?.withdrawalFeeCents, 200);
  assert.equal(changed.actorName, 'Administrador');
  assert.equal(history.entries.filter(entry => entry.action.startsWith('sale.')).length, 1);
  for (const secret of [token, invite.token, adminKey, 'token_hash', 'actor_id']) assert.equal(JSON.stringify(history).includes(secret), false);
  await assert.rejects(() => store.sql.prepare('DELETE FROM audit_events').run());
  await assert.rejects(() => store.sql.prepare("UPDATE audit_events SET actor_name = 'Outra pessoa'").run());
  await store.sql.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  await assert.rejects(() => store.adminSetCosts(auth.id, { date: businessToday(), ads: '99', withdrawalFee: '0' }, actor));
  assert.equal((await store.adminCosts(auth.id, businessToday())).adsCents, 2000);
});

test('cancelamento mantém a aprovação em falha de auditoria e preserva motivo, saldo e comprovante após restaurar backup', async t => {
  const { store, auth, sale } = await fixture(t), item = await sale();
  await store.reviewSale(item.id, { status: 'approved', note: 'Aprovação original' }, actor);
  await store.sql.exec("CREATE TRIGGER fixture_cancel_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'sale.cancelled' BEGIN SELECT RAISE(ABORT, 'Fixture audit unavailable'); END");
  await assert.rejects(() => store.cancelSale(item.id, { note: 'Erro na aprovação' }, actor));
  assert.equal((await store.sales(auth))[0].status, 'approved'); assert.equal((await store.portal(auth)).finance.availableCents, 4150);
  assert.equal((await readAudit(store, new URLSearchParams('action=sale.cancelled'))).total, 0);
  await store.sql.exec('DROP TRIGGER fixture_cancel_audit');
  await store.cancelSale(item.id, { note: 'Erro na aprovação' }, actor);
  assert.equal((await store.portal(auth)).finance.availableCents, 0);
  assert.equal((await readFinancialReport(store, businessToday(), businessToday())).totals.grossCents, 0);
  const bytes = await createArchive(store), restored = await PortalStore.open(':memory:');
  try {
    await restoreArchive(bytes, restored);
    assert.deepEqual(await restored.sales(auth), await store.sales(auth)); assert.ok((await restored.sales(auth))[0].cancelledAt);
    assert.deepEqual(await restored.receipt(auth, item.receiptId), await store.receipt(auth, item.receiptId));
    assert.equal((await readAudit(restored, new URLSearchParams('action=sale.cancelled'))).entries[0].before!.note, 'Aprovação original');
  } finally { restored.close(); }
});
test('fechamento conta só aprovadas, preserva divisão histórica e separa lucro de repasse e caixa', async t => {
  const { store, auth, sale } = await fixture(t), today = businessToday();
  const checkout = await sale(); await store.reviewSale(checkout.id, { status: 'approved', note: '' }, actor);
  const pix = await sale('100', 'pix', 'fixture_controls_batch_02'); await store.reviewSale(pix.id, { status: 'approved', note: '' }, actor);
  await sale('400', 'main', 'fixture_controls_batch_03');
  await store.setCosts(auth.id, today, 1000, 100, actor);
  await store.saveProfile(auth, { name: 'Ana', email: '', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana' });
  const paid = await store.requestPayout(auth, { amount: '20' }); await store.markPayout(paid.id, 'paid', 'PIX conferido', actor);
  const cancelled = await store.requestPayout(auth, { amount: '10' }); await store.markPayout(cancelled.id, 'cancelled', 'Cancelado', actor);
  const report = await readFinancialReport(store, today, today);
  assert.equal(report.totals.count, 2); assert.equal(report.totals.pendingCount, 1);
  assert.equal(report.totals.grossCents, 20000); assert.equal(report.totals.gatewayFeeCents, 2567);
  assert.equal(report.totals.commissionCents, 8716); assert.equal(report.totals.netCommissionCents, 7366);
  assert.equal(report.totals.paidPayoutCents, 2000); assert.equal(report.totals.paidPayoutNetCents, 1750);
  assert.equal(report.totals.withdrawalGatewayFeeCents, 500); assert.equal(report.totals.businessWithdrawalFeeCents, 250);
  assert.equal(report.totals.businessProfitCents, 8467); assert.equal(report.totals.cashMovementCents, 14083);
  const filtered = await readFinancialReport(store, today, today, auth.id); assert.deepEqual(filtered.totals, report.totals);
  await assert.rejects(() => readFinancialReport(store, today, 'invalid'));
  await assert.rejects(() => readFinancialReport(store, today, today, 'unknown'));
});

test('fechamento usa o dia de Brasília para pagamentos e CSV protege fórmulas em nomes', () => {
  const sale = { attendantId: 'a', date: '2026-01-10', status: 'approved', amountCents: 10000, feeCents: 1000, commissionBps: 2500, commissionMode: 'net-share' } as AdminSale;
  const payout = { attendantId: 'a', status: 'paid', amountCents: 1000, withdrawalFeeCents: 250, gatewayFeeCents: 500, requestedAt: '2026-01-10T12:00:00Z', paidAt: '2026-01-11T01:59:00Z' } as AdminPayout;
  const input = { attendants: [{ id: 'a', name: '=HYPERLINK("bad")' }], sales: [sale], costs: [], payouts: [payout] };
  const report = financialReport(input, '2026-01-10', '2026-01-10');
  assert.equal(report.totals.commissionCents, 2250); assert.equal(report.totals.businessProfitCents, 6500);
  assert.equal(report.totals.paidPayoutNetCents, 750);
  assert.equal(financialReport(input, '2026-01-11', '2026-01-11').totals.paidPayoutCents, 0);
  const csv = financialCsv(report); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('65,00')); assert.equal(csv.includes('ana@example.com'), false);
});

test('backup privado faz recuperação real e preserva vendas, comprovantes, tokens e chaves push', async t => {
  const { store, auth, directory, sale } = await fixture(t);
  const item = await sale(); await store.reviewSale(item.id, { status: 'approved', note: 'Conferido' }, actor);
  await store.setCosts(auth.id, businessToday(), 1000, 0, actor);
  const keys = await loadDatabasePushKeys(store, {}), folder = join(directory, 'backups'), service = new BackupService(store, privateFolder(folder));
  const record = await service.run('daily'); assert.equal(record.status, 'verified'); assert.ok(record.verifiedAt); assert.ok(record.sizeBytes > 0);
  assert.equal(statSync(join(folder, record.id + '.json.gz')).mode & 0o777, 0o600); assert.equal(statSync(folder).mode & 0o777, 0o700);
  assert.deepEqual(await service.run('daily'), record); assert.equal((await service.status()).records.length, 1);
  const bytes = await service.download(record.id), restored = await PortalStore.open(':memory:');
  try {
    await restoreArchive(bytes, restored);
    assert.deepEqual(await restored.authenticate(token), auth);
    assert.deepEqual((await restored.portal(auth, 'all')).finance, (await store.portal(auth, 'all')).finance);
    assert.deepEqual(await restored.receipt(auth, item.receiptId), await store.receipt(auth, item.receiptId));
    assert.deepEqual(await loadDatabasePushKeys(restored, {}), keys);
    assert.deepEqual(await readAudit(restored, new URLSearchParams()), await readAudit(store, new URLSearchParams()));
    assert.equal((await new BackupService(restored, privateFolder(folder)).status()).records.find(copy => copy.id === record.id)?.status, 'verified');
    await assert.rejects(() => restoreArchive(bytes, restored));
  } finally { restored.close(); }
  const input = join(directory, 'download.json.gz'), output = join(directory, 'recovered.sqlite'); writeFileSync(input, bytes, { mode: 0o600 });
  execFileSync(process.execPath, ['server/manage.ts', 'restore-backup', '--input', input, '--output', output]);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const before = readFileSync(output);
  assert.notEqual(spawnSync(process.execPath, ['server/manage.ts', 'restore-backup', '--input', input, '--output', output]).status, 0);
  assert.deepEqual(readFileSync(output), before);
});

test('recuperar um catálogo antigo não sobrescreve cópias mais recentes do mesmo dia', async t => {
  const { store, directory } = await fixture(t), oldArchive = await createArchive(store), storage = privateFolder(join(directory, 'durable'));
  const original = new BackupService(store, storage), first = await original.run('daily'), firstBytes = await original.download(first.id);
  const restored = await PortalStore.open(':memory:');
  try {
    await restoreArchive(oldArchive, restored);
    const second = await new BackupService(restored, storage).run('daily');
    assert.notEqual(second.id, first.id); assert.deepEqual(await storage.read(first.id), firstBytes);
    await assert.rejects(() => storage.write(first.id, Buffer.from('replacement')));
    assert.deepEqual(await storage.read(first.id), firstBytes);
  } finally { restored.close(); }
});

test('cópia corrompida falha sem apagar a última válida; retenção só roda após recuperação verificada', async t => {
  const { store } = await fixture(t), files = new Map<string, Buffer>(); let corrupt = false;
  const storage: BackupStorage = { destination: 'private-blob', async write(id, bytes) { files.set(id, bytes); }, async read(id) { const bytes = files.get(id)!; return corrupt && id.includes('manual') ? Buffer.from('corrupt') : bytes; }, async remove(id) { files.delete(id); } };
  const service = new BackupService(store, storage), old = await service.run('daily', new Date(Date.now() - 35 * 86400000));
  corrupt = true; await assert.rejects(() => service.run('manual'));
  assert.ok(files.has(old.id)); assert.equal((await service.status()).records.find(record => record.id === old.id)?.status, 'verified');
  assert.ok((await service.download(old.id)).length > 0);
  corrupt = false; await service.run('daily'); assert.equal(files.has(old.id), false);
  const current = (await service.status()).records.find(record => record.status === 'verified')!;
  files.set(current.id, Buffer.from('tampered')); await assert.rejects(() => service.download(current.id));
});

test('recuperação recusa SQL injetado, referências quebradas, ZIP inválido e conteúdo alterado', async t => {
  const { store, sale } = await fixture(t); await sale();
  const bytes = await createArchive(store), archive = JSON.parse(gunzipSync(bytes).toString());
  archive.tables[0].columns[0] = 'id); DROP TABLE attendants; --';
  await assert.rejects(() => verifyArchive(gzipSync(JSON.stringify(archive))));
  const broken = JSON.parse(gunzipSync(bytes).toString()), sales = broken.tables.find((table: { name: string }) => table.name === 'sales');
  sales.rows[0][sales.columns.indexOf('attendant_id')] = 'missing';
  await assert.rejects(() => verifyArchive(gzipSync(JSON.stringify(broken))));
  await assert.rejects(() => verifyArchive(Buffer.from('invalid archive')));
  assert.equal((await store.sql.prepare('SELECT COUNT(*) AS count FROM attendants').get())!.count, 1);
});

test('Blob autoriza somente leitura da cópia exata por dois minutos e mantém o token privado no servidor', async () => {
  const token = 'fixture_private_blob_token', id = 'daily-2026-01-10', requested: unknown[] = [], started = Date.now();
  const storage = privateBlob(token, {
    async issue(options) { requested.push(options); return { clientSigningToken: 'fixture-scoped-key', delegationToken: 'fixture-delegation', validUntil: options!.validUntil! }; },
    async url(signed, options) { requested.push(options); assert.equal(signed.clientSigningToken, 'fixture-scoped-key'); return { presignedUrl: 'https://fixture.private.blob.vercel-storage.com/bravus-backups/' + id + '.json.gz?signature=fixture' }; },
  });
  const url = await storage.downloadUrl!(id), [issue, sign] = requested as [{ token: string; pathname: string; operations: string[]; validUntil: number }, { pathname: string; access: string; operation: string; useCache: boolean }];
  assert.equal(issue.token, token); assert.equal(issue.pathname, 'bravus-backups/' + id + '.json.gz'); assert.deepEqual(issue.operations, ['get']);
  assert.ok(issue.validUntil >= started + 119_000 && issue.validUntil <= Date.now() + 120_000);
  assert.equal(sign.access, 'private'); assert.equal(sign.operation, 'get'); assert.equal(sign.useCache, false); assert.equal(sign.pathname, issue.pathname);
  assert.equal(url.includes(token), false); await assert.rejects(() => storage.downloadUrl!('../other'));
});

test('libSQL mantém a visão do backup e os relatórios entre instâncias e impede cópias simultâneas', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bravus-controls-libsql-')), file = join(directory, 'source.sqlite'), stores: PortalStore[] = [];
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  for (let index = 0; index < 2; index++) {
    const client = createClient({ url: 'file:' + file, timeout: 0 }); await client.execute('PRAGMA journal_mode = WAL');
    stores.push(await PortalStore.open(libsqlDatabase(client)));
  }
  const created = await stores[0].createAttendant('LibSQL', 5000, token), today = businessToday();
  await stores[0].adminSetCosts(created.id, { date: today, ads: '10', withdrawalFee: '0' }, actor);
  assert.equal((await readFinancialReport(stores[1], today, today)).totals.adsCents, 1000);
  assert.equal((await readAudit(stores[1], new URLSearchParams({ action: 'costs.updated' }))).total, 1);
  let writes = 0; const folder = privateFolder(join(directory, 'copies')), storage: BackupStorage = { ...folder, async write(id, bytes) { writes++; await folder.write(id, bytes); } };
  const services = stores.map(store => new BackupService(store, storage));
  const results = await Promise.allSettled(services.map(service => service.run('daily')));
  assert.ok(results.some(result => result.status === 'fulfilled')); assert.equal(writes, 1);
  const record = (await services[0].status()).records[0]; assert.equal(record.status, 'verified');
  await verifyArchive(await services[1].download(record.id));
});

test('link temporário do Blob só é autorizado para administrador e cópia verificada', async t => {
  const { store, directory } = await fixture(t);
  let privateUrl = 'https://fixture.private.blob.vercel-storage.com/copy.json.gz?signature=fixture';
  const service = new BackupService(store, { ...privateFolder(join(directory, 'objects')), async downloadUrl() { return privateUrl; } });
  const record = await service.run('manual'), server = createPortalServer(store, { adminKey, backups: service });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/backups/`;
  for (const key of ['', token]) { const response = await fetch(base + record.id, { redirect: 'manual', headers: { Authorization: 'Bearer ' + key } }); assert.equal(response.status, 401); assert.equal(response.headers.has('location'), false); }
  const response = await fetch(base + record.id, { redirect: 'manual', headers: { Authorization: 'Bearer ' + adminKey } });
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), privateUrl); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(base + 'manual-00000000-0000-0000-0000-000000000000', { redirect: 'manual', headers: { Authorization: 'Bearer ' + adminKey } })).status, 404);
  privateUrl = 'https://untrusted.example/?secret=' + adminKey;
  const rejected = await fetch(base + record.id, { redirect: 'manual', headers: { Authorization: 'Bearer ' + adminKey } });
  assert.equal(rejected.status, 503); assert.equal(rejected.headers.has('location'), false); assert.equal((await rejected.text()).includes(adminKey), false);
});

test('relatórios, histórico e backups exigem administrador; cron exige segredo e cópia diária é idempotente', async t => {
  const { store, directory } = await fixture(t), cronSecret = 'fixture_cron_secret_012345678901234567890123456789';
  const backups = new BackupService(store, privateFolder(join(directory, 'private')), true);
  const server = createPortalServer(store, { adminKey, backups, cronSecret }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, today = businessToday();
  const call = (path: string, key = '', init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Authorization: 'Bearer ' + key, ...init.headers } });
  for (const path of ['/api/admin/audit', `/api/admin/reports/financial?start=${today}&end=${today}`, `/api/admin/reports/financial.csv?start=${today}&end=${today}`, '/api/admin/backups']) for (const key of ['', token]) assert.equal((await call(path, key)).status, 401);
  assert.equal((await call('/api/admin/dashboard?refresh=1', adminKey)).status, 200);
  assert.equal((await backups.status()).records.length, 0);
  assert.equal((await call('/api/cron/backups')).status, 401); assert.equal((await call('/api/cron/backups', adminKey)).status, 401);
  assert.equal((await call('/api/cron/backups', cronSecret)).status, 200); assert.equal((await call('/api/cron/backups', cronSecret)).status, 200);
  const status = await (await call('/api/admin/backups', adminKey)).json(); assert.equal(status.records.length, 1);
  const download = await call('/api/admin/backups/' + status.records[0].id, adminKey); assert.equal(download.status, 200); assert.equal(download.headers.get('cache-control'), 'private, no-store'); await verifyArchive(Buffer.from(await download.arrayBuffer()));
  assert.equal((await call('/api/admin/backups/' + status.records[0].id, token)).status, 401);
  const csv = await call(`/api/admin/reports/financial.csv?start=${today}&end=${today}`, adminKey); assert.equal(csv.status, 200); assert.ok(csv.headers.get('content-type')!.includes('text/csv'));
  assert.equal((await call('/api/admin/audit?action=not-real', adminKey)).status, 400);
  const disabled = new BackupService(store, null); assert.equal((await disabled.status()).configured, false); await assert.rejects(() => disabled.run('daily'));
  assert.equal((await readFinancialReport(store, today, today) satisfies FinancialReport).totals.grossCents, 0);
});
