import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PortalStore } from '../server/store.ts';
import { createVercelHandler } from '../server/vercel.ts';

test('a API implantada na Vercel bloqueia o lançamento manual de vendas', async t => {
  const token = 'fixture_manual_disabled_012345678901234567890123456789';
  const store = await PortalStore.open(':memory:');
  await store.createAttendant('Atendente automático', 1000, token);
  const handler = createVercelHandler({
    environment: () => ({
      TURSO_DATABASE_URL: 'libsql://fixture.invalid',
      TURSO_AUTH_TOKEN: 'fixture_private_database_token',
      BRAVUS_ADMIN_KEY: 'fixture_admin_012345678901234567890123456789',
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
  const response = await fetch(base + '/api/sales', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture_manual_disabled_request' },
    body: JSON.stringify({ date: '2026-11-23', sales: [] }),
  });
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /lançamento manual.*foi desativado/i);
  const view = await fetch(base + '/api/portal?period=all', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(view.status, 200, await view.clone().text());
  assert.equal((await view.json() as { manualSales?: boolean }).manualSales, false);
});

