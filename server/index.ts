import { dirname, resolve } from 'node:path';
import { PortalStore } from './store.ts';
import { createPortalServer } from './http.ts';
import { loadAdminKey } from './admin-key.ts';
import { loadDatabasePushKeys, loadPushKeys, PushService } from './push.ts';

const port = Number(process.env.PORT ?? '3001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
const databasePath = process.env.BRAVUS_DB_PATH ?? resolve('.bravus/portal.sqlite');
const remote = !!(process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN);
if (remote && (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN || !process.env.BRAVUS_ADMIN_KEY)) throw new Error('Configure TURSO_DATABASE_URL, TURSO_AUTH_TOKEN e BRAVUS_ADMIN_KEY para usar o banco remoto.');
const store = await PortalStore.open(remote ? { url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! } : databasePath);
const adminKeyPath = process.env.BRAVUS_ADMIN_KEY_FILE ?? resolve(dirname(databasePath), 'admin.key');
const adminKey = loadAdminKey(adminKeyPath, process.env.BRAVUS_ADMIN_KEY);
const allowedOrigins = (process.env.BRAVUS_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
const push = new PushService(store, remote ? await loadDatabasePushKeys(store) : loadPushKeys(resolve(dirname(databasePath), 'push-keys.json')));
const server = createPortalServer(store, { staticDir: resolve('dist'), allowedOrigins, adminKey, push });
server.listen(port, '0.0.0.0', () => {
  console.log(`BRAVUS API e interface iniciadas na porta ${port}.`);
  console.log(process.env.BRAVUS_ADMIN_KEY ? 'Administração configurada pela variável privada BRAVUS_ADMIN_KEY.' : `Chave administrativa privada disponível em ${adminKeyPath}. Seu valor não é exibido nos logs.`);
});
const close = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', close); process.on('SIGINT', close);
