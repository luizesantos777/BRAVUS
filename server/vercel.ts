import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPortalHandler } from './http.ts';
import { PortalStore } from './store.ts';
import { loadAdminKey } from './admin-key.ts';
import { loadPushKeys, PushService } from './push.ts';
import type { TursoConnection } from './database.ts';

const BODY_LIMIT = 4 * 1024 * 1024;
type Environment = Record<string, string | undefined>;
interface Options {
  environment?: () => Environment;
  openStore?: (connection: TursoConnection) => Promise<PortalStore>;
}
export function createVercelHandler(options: Options = {}) {
  let initialized: Promise<ReturnType<typeof createPortalHandler>> | undefined;
  const environment = options.environment ?? (() => process.env);
  const openStore = options.openStore ?? (connection => PortalStore.open(connection));

  async function initialize() {
    const env = environment(), url = env.TURSO_DATABASE_URL, authToken = env.TURSO_AUTH_TOKEN, key = env.BRAVUS_ADMIN_KEY;
    if (!url || !authToken || !key) throw new Error('SETUP_REQUIRED');
    // A serverless instance must never create a temporary local database or a new administrative key.
    const adminKey = loadAdminKey('', key);
    const store = await openStore({ url, authToken });
    try {
      const configuredPush = !!(env.BRAVUS_PUSH_PUBLIC_KEY || env.BRAVUS_PUSH_PRIVATE_KEY);
      const push = configuredPush ? new PushService(store, loadPushKeys('', env)) : undefined;
      const allowedOrigins = (env.BRAVUS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      return createPortalHandler(store, { adminKey, allowedOrigins, push, bodyLimit: BODY_LIMIT });
    } catch (error) { store.close(); throw error; }
  }

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const routed = url.searchParams.get('__bravus_path');
      if (routed !== null) {
        if (!/^[a-zA-Z0-9_/-]+$/.test(routed)) {
          response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: 'Recurso não encontrado.' })); return;
        }
        url.pathname = '/api/' + routed; url.searchParams.delete('__bravus_path');
        request.url = url.pathname + url.search;
      }
      if (!initialized) initialized = initialize().catch(error => { initialized = undefined; throw error; });
      const handler = await initialized;
      await handler(request, response);
    } catch {
      if (response.headersSent) { response.end(); return; }
      const env = environment();
      const missingVariables = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BRAVUS_ADMIN_KEY'].filter(name => !env[name]);
      const missing = missingVariables.length > 0;
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '30' });
      response.end(JSON.stringify({ status: missing ? 'configuration_required' : 'unavailable', ...(missing ? { missingVariables } : {}), error: missing ? 'A API precisa da conexão com o banco e da chave administrativa configuradas na hospedagem.' : 'O serviço de atendentes não conseguiu acessar sua configuração ou o banco de dados. Tente novamente em instantes.' }));
    }
  };
}
export default createVercelHandler();
