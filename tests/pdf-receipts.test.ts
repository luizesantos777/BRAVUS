import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createClient } from '@libsql/client';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createPortalServer } from '../server/http.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { businessToday, MAX_RECEIPT_BYTES } from '../src/domain.ts';
import { pdfReceiptBytes } from './pdf-fixture.ts';

const bytes = pdfReceiptBytes();
const receipt = { name: 'comprovante.pdf', mime: 'application/pdf', base64: bytes.toString('base64') };

for (const driver of ['sqlite', 'libsql'] as const) test(`${driver}: PDF original chega privado ao admin, preserva idempotência e sobrevive ao backup`, async t => {
  const store = driver === 'sqlite' ? await PortalStore.open(':memory:') : await PortalStore.open(libsqlDatabase(createClient({ url: 'file::memory:', intMode: 'number' })));
  const key = 'fixture_pdf_admin_01234567890123456789', token = 'fixture_pdf_attendant_01234567890123456789', otherToken = 'fixture_pdf_other_01234567890123456789';
  const account = await store.createPartner('Parceiro PDF', token);await store.createAttendant('Outra conta', 5000, otherToken);
  const server = createPortalServer(store, { adminKey: key });server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => { store.close();resolve(); });server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input = { date: businessToday(), sales: [{ amount: '100', time: '12:00', note: 'PDF de teste', receipt }] };
  const send = (payload = input) => fetch(base + '/api/sales', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture_pdf_original_submission' }, body: JSON.stringify(payload) });
  assert.equal((await send()).status, 200);assert.equal((await (await send()).json()).duplicate, true);
  const sales = await store.sales({ id: account.id });assert.equal(sales.length, 1);assert.equal(sales[0].status, 'pending');assert.equal(sales[0].feeCents, 1400);
  assert.equal((await send({ ...input, sales: [{ ...input.sales[0], amount: '101' }] })).status, 409);
  const get = (path: string, credential = '') => fetch(base + path, { headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
  for (const [path, credential] of [[`/api/receipts/${sales[0].receiptId}`, token], [`/api/admin/receipts/${sales[0].receiptId}`, key]]) {
    const response = await get(path, credential);assert.equal(response.status, 200);assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('cache-control')!, /private.*no-store/);assert.match(response.headers.get('content-disposition')!, /comprovante\.pdf/);assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  assert.equal((await get(`/api/receipts/${sales[0].receiptId}`)).status, 401);
  assert.equal((await get(`/api/receipts/${sales[0].receiptId}`, otherToken)).status, 404);
  assert.equal((await get(`/api/admin/receipts/${sales[0].receiptId}`, token)).status, 401);
  await store.reviewSale(sales[0].id, { status: 'approved', note: 'PDF conferido' });
  assert.equal((await store.portal({ id: account.id }, 'all')).finance.availableCents, 8600);
  const restored = await PortalStore.open(':memory:');
  try {
    await restoreArchive(await createArchive(store), restored);
    const recovered = await restored.receipt({ id: account.id }, sales[0].receiptId);assert.equal(recovered.mime, 'application/pdf');assert.equal((await restored.sql.prepare('SELECT name FROM receipts WHERE id=?').get(sales[0].receiptId))!.name, receipt.name);assert.deepEqual(Buffer.from(recovered.bytes), bytes);
  } finally { restored.close(); }
});

test('API rejeita PDF falso, incompleto, MIME incompatível e arquivo acima do limite sem gravar a venda', async () => {
  const store = await PortalStore.open(':memory:');
  try {
    const account = await store.createPartner('Validação PDF');
    const invalid = [
      { ...receipt, base64: Buffer.from('<html>arquivo falso</html>').toString('base64') },
      { ...receipt, base64: Buffer.from('%PDF-1.7\nPDF incompleto').toString('base64') },
      { ...receipt, base64: '' },
      { ...receipt, mime: 'image/png' },
      { ...receipt, base64: Buffer.alloc(MAX_RECEIPT_BYTES + 1, 32).toString('base64') },
    ];
    for (const [index, bad] of invalid.entries()) await assert.rejects(store.recordSales({ id: account.id }, { date: businessToday(), sales: [{ amount: '100', time: '12:00', note: '', receipt }, { amount: '200', time: '12:00', note: '', receipt: bad }] }, `fixture_pdf_invalid_${index}`), /PDF|comprovante/);
    assert.equal((await store.sales({ id: account.id })).length, 0);
    assert.equal((await store.sql.prepare('SELECT COUNT(*) AS n FROM receipts').get())!.n, 0);
    const start = Buffer.from('%PDF-1.7\n'), end = Buffer.from('\n%%EOF');
    const exact = Buffer.concat([start, Buffer.alloc(MAX_RECEIPT_BYTES - start.length - end.length, 32), end]);
    assert.equal(store.receiptInput({ ...receipt, base64: exact.toString('base64') }).bytes.length, MAX_RECEIPT_BYTES);
  } finally { store.close(); }
});
