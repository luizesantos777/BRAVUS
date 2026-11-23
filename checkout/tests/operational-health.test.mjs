import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const db = new DatabaseSync(':memory:');
for (const migration of ['0000_bitter_king_bedlam', '0001_stale_reaper', '0002_complex_roulette', '0003_hot_wrecker', '0004_attendant-checkout', '0005_checkout-auto-approval']) {
  db.exec(readFileSync(`drizzle/${migration}.sql`, 'utf8'));
}
globalThis.__env = {
  PAYMENT_VAULT_KEY: Buffer.alloc(32, 41).toString('base64'),
  DB: {
    prepare(sql) {
      const execute = (args = []) => ({
        async first() { return db.prepare(sql).get(...args); },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      });
      return {
        ...execute(),
        bind(...args) {
          return execute(args);
        },
      };
    },
  },
};
globalThis.__headers = new Headers();
const temporary = mkdtempSync(join(tmpdir(), 'bravus-operational-health-'));
const plugin = { name: 'runtime', setup(esbuild) {
  esbuild.onResolve({ filter: /^(cloudflare:workers|next\/headers)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  esbuild.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
    contents: args.path === 'cloudflare:workers' ? 'export const env=globalThis.__env' : 'export async function headers(){return globalThis.__headers}',
    loader: 'js',
  }));
} };
async function load(entry, name) {
  const output = join(temporary, `${name}.mjs`);
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', plugins: [plugin] });
  return import(pathToFileURL(output).href);
}

const health = await load('lib/operational-health.ts', 'operational-health');
const gateways = await load('lib/gateways.ts', 'operational-gateways');
const payments = await load('lib/payments.ts', 'operational-payments');
const now = Date.now();

const empty = await health.checkoutOperationalHealth(now);
assert.equal(empty.ok, false);
assert.ok(empty.alerts.some(alert => alert.reason === 'database_empty'));

await payments.saveCredentials('fixture-token', 'fixture-agent', 'buckpay');
assert.equal(await gateways.selectGateway('buckpay'), true);
db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider) VALUES (?,?,?,?,?,?,?)')
  .run(crypto.randomUUID(), crypto.randomUUID(), 9989, 'ready', now, 0, 'buckpay');
for (let i = 0; i < 3; i += 1) await health.recordGatewayFailure('buckpay', 503);
for (let i = 0; i < 3; i += 1) await health.recordWebhookFailure('atlas', 503);
const repeated = await health.checkoutOperationalHealth(now);
assert.equal(repeated.ok, false);
assert.ok(repeated.alerts.some(alert => alert.reason === 'gateway_unavailable' && alert.source === 'buckpay'));
assert.ok(repeated.alerts.some(alert => alert.reason === 'webhook_repeated' && alert.source === 'atlas'));
assert.ok(!JSON.stringify(repeated).match(/fixture-token|fixture-agent|@|\d{11}/));

db.close();
rmSync(temporary, { recursive: true, force: true });
console.log('Operational health checks passed: empty database, repeated gateway/webhook failures and redacted output.');
