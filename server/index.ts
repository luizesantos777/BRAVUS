import { resolve } from 'node:path';
import { PortalStore } from './store.ts';
import { createPortalServer } from './http.ts';

const port = Number(process.env.PORT ?? '3001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
const store = new PortalStore(process.env.BRAVUS_DB_PATH ?? resolve('.bravus/portal.sqlite'));
const allowedOrigins = (process.env.BRAVUS_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
const server = createPortalServer(store, { staticDir: resolve('dist'), allowedOrigins });
server.listen(port, '0.0.0.0', () => console.log(`BRAVUS API e interface iniciadas na porta ${port}.`));
const close = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', close); process.on('SIGINT', close);
