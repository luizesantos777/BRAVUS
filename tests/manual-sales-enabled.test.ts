import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PortalStore } from '../server/store.ts';
import { createVercelHandler } from '../server/vercel.ts';
import { businessToday } from '../src/domain.ts';

const token = 'fixture_manual_enabled_012345678901234567890123456789';
const receipt = { name: 'comprovante.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };

async function fixture(t: TestContext, manualSales?: string) {
  const store = await PortalStore.open(':memory:');
  await store.createAttendant('Atendente manual', 5000, token);
  const handler = createVercelHandler({
    environment: () => ({
      TURSO_DATABASE_URL: 'libsql://fixture.invalid',
      TURSO_AUTH_TOKEN: 'fixture_private_database_token',
      BRAVUS_ADMIN_KEY: 'fixture_admin_012345678901234567890123456789',
      ...(manualSales === undefined ? {} : { BRAVUS_MANUAL_SALES: manualSales }),
    }),
    openStore: async () => store,
  });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => {
    server.close(() => { store.close(); resolve(); });
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return { base, headers };
}

test('BRAVUS_MANUAL_SALES=1 reativa o lançamento manual com comprovante', async t => {
  const { base, headers } = await fixture(t, '1');
  const submitted = await fetch(base + '/api/sales', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': 'fixture_manual_enabled_request_001' },
    body: JSON.stringify({ date: businessToday(), sales: [{ amount: '100', checkoutId: 'main', time: '12:00', note: 'Venda manual com comprovante', receipt: { ...receipt } }] }),
  });
  assert.equal(submitted.status, 200, await submitted.clone().text());
  assert.deepEqual(await submitted.json(), { duplicate: false, count: 1 });
  const view = await fetch(base + '/api/portal?period=all', { headers });
  assert.equal(view.status, 200, await view.clone().text());
  const portal = await view.json() as { manualSales?: unknown; sales?: Array<{ status?: string }> };
  assert.equal(portal.manualSales, true);
  assert.ok(Array.isArray(portal.sales) && portal.sales.some(sale => sale.status === 'pending'));
});

test('qualquer valor diferente de 1 mantém o lançamento manual bloqueado', async t => {
  const { base, headers } = await fixture(t, '0');
  const response = await fetch(base + '/api/sales', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': 'fixture_manual_other_value_request' },
    body: JSON.stringify({ date: businessToday(), sales: [] }),
  });
  assert.equal(response.status, 410);
  const view = await fetch(base + '/api/portal?period=all', { headers });
  assert.equal(view.status, 200, await view.clone().text());
  assert.equal((await view.json() as { manualSales?: boolean }).manualSales, false);
});