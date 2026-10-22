import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPortalHandler } from './http.ts';
import { PortalStore } from './store.ts';
import { loadAdminKey } from './admin-key.ts';
import { loadDatabasePushKeys, PushService } from './push.ts';
import type { TursoConnection } from './database.ts';
import { BackupService, privateBlob } from './backups.ts';

const BODY_LIMIT = 4 * 1024 * 1024;
type Environment = Record<string, string | undefined>;
type StartupIssue = 'admin_key_invalid' | 'database_initialization_failed' | 'configuration_invalid';
class StartupError extends Error {
  issue: StartupIssue;
  databaseCode?: string;
  constructor(issue: StartupIssue, error?: unknown) {
    super(issue); this.issue = issue;
    if (issue !== 'database_initialization_failed') return;
    const known = new Set(['SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_BUSY_TIMEOUT', 'SQLITE_AUTH', 'SQLITE_READONLY', 'SQLITE_CONSTRAINT', 'SERVER_ERROR', 'HRANA_PROTO_ERROR', 'HRANA_CLOSED_ERROR', 'TRANSACTION_CLOSED', 'PROTOCOL_VERSION_ERROR', 'ERR_INVALID_URL', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT']);
    let current = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
      const detail = current as { code?: unknown; status?: unknown; cause?: unknown };
      if (detail.status === 401 || detail.status === 403) { this.databaseCode = 'DATABASE_AUTH_FAILED'; break; }
      if (typeof detail.code === 'string' && known.has(detail.code)) this.databaseCode = detail.code;
      current = detail.cause;
    }
  }
}
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
    let adminKey: string;
    try { adminKey = loadAdminKey('', key); }
    catch { throw new StartupError('admin_key_invalid'); }
    let store: PortalStore;
    try { store = await openStore({ url, authToken }); }
    catch (error) { throw new StartupError('database_initialization_failed', error); }
    try {
      const push = new PushService(store, await loadDatabasePushKeys(store, env));
      const allowedOrigins = (env.BRAVUS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const backups = new BackupService(store, env.BLOB_READ_WRITE_TOKEN ? privateBlob(env.BLOB_READ_WRITE_TOKEN) : null, (env.CRON_SECRET?.length ?? 0) >= 32);
      return createPortalHandler(store, { adminKey, allowedOrigins, push, backups, cronSecret: env.CRON_SECRET, bodyLimit: BODY_LIMIT });
    } catch { store.close(); throw new StartupError('configuration_invalid'); }
  }

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const routed = url.searchParams.get('__bravus_path');
      if (routed !== null) {
        if (!/^[a-zA-Z0-9_/-]+(?:\.csv)?$/.test(routed)) {
          response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: 'Recurso não encontrado.' })); return;
        }
        url.pathname = '/api/' + routed; url.searchParams.delete('__bravus_path');
        request.url = url.pathname + url.search;
      }
      if (!initialized) initialized = initialize().catch(error => { initialized = undefined; throw error; });
      const handler = await initialized;
      await handler(request, response);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const env = environment();
      const missingVariables = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BRAVUS_ADMIN_KEY'].filter(name => !env[name]);
      const missing = missingVariables.length > 0;
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '30' });
      const diagnostics = error instanceof StartupError ? { setupIssue: error.issue, ...(error.databaseCode ? { databaseCode: error.databaseCode } : {}) } : {};
      response.end(JSON.stringify({ status: missing ? 'configuration_required' : 'unavailable', ...(missing ? { missingVariables } : diagnostics), error: missing ? 'A API precisa da conexão com o banco e da chave administrativa configuradas na hospedagem.' : error instanceof StartupError && error.issue === 'admin_key_invalid' ? 'BRAVUS_ADMIN_KEY deve ter entre 32 e 256 caracteres.' : 'O serviço de atendentes não conseguiu acessar sua configuração ou o banco de dados. Tente novamente em instantes.' }));
    }
  };
}
export default createVercelHandler();
