import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PortalError, PortalStore } from './store.ts';
import { periodLabels } from '../src/domain.ts';
import type { Period } from '../src/domain.ts';
import type { SaleBatch } from '../src/domain.ts';
import type { PushService } from './push.ts';

const BODY_LIMIT = 12 * 1024 * 1024;
const json = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((accept, reject) => {
    const parts: Buffer[] = []; let size = 0, rejected = false;
    request.on('data', (part: Buffer) => {
      size += part.length;
      if (size > BODY_LIMIT) { if (!rejected) reject(new PortalError(413, 'O envio excede 12 MB. Envie menos vendas por vez.')); rejected = true; parts.length = 0; return; }
      if (!rejected) parts.push(part);
    });
    request.on('end', () => { if (rejected) return; try { accept(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(new PortalError(400, 'O corpo da solicitação deve ser um JSON válido.')); } });
    request.on('error', () => reject(new PortalError(400, 'Não foi possível receber os dados.')));
  });
}
export function createPortalServer(store: PortalStore, options: { staticDir?: string; allowedOrigins?: string[]; adminKey?: string; push?: PushService } = {}) {
  const failedAuth = new Map<string, { count: number; started: number }>();
  const adminHash = options.adminKey ? createHash('sha256').update(options.adminKey).digest() : null;
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const origin = request.headers.origin;
        const forwardedProtocol = request.headers['x-forwarded-proto'];
        const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
        const sameOrigin = origin === `${protocol}://${request.headers.host}`;
        if (origin && !sameOrigin && !options.allowedOrigins?.includes(origin)) throw new PortalError(403, 'Origem não permitida para este portal.');
        if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
        if (request.method === 'OPTIONS') {
          response.writeHead(204, { 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' }); response.end(); return;
        }
        if (url.pathname === '/api/health' && request.method === 'GET') { store.db.prepare('SELECT 1').get(); json(response, 200, { status: 'ok' }); return; }
        const identity = request.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        for (const [key, value] of failedAuth) if (now - value.started > 60_000) failedAuth.delete(key);
        if ((failedAuth.get(identity)?.count ?? 0) >= 30) throw new PortalError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.');
        const authorization = request.headers.authorization ?? '';
        if (url.pathname.startsWith('/api/admin/')) {
          if (!adminHash) throw new PortalError(503, 'A administração ainda não foi configurada neste servidor.');
          const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
          if (supplied.length < 32 || supplied.length > 256 || !timingSafeEqual(createHash('sha256').update(supplied).digest(), adminHash)) {
            const count = failedAuth.get(identity); failedAuth.set(identity, { count: (count?.count ?? 0) + 1, started: count?.started ?? now });
            throw new PortalError(401, 'Chave administrativa inválida.');
          }
          const route = url.pathname.match(/^\/api\/admin\/(attendants|payouts|checkouts)\/([a-zA-Z0-9_-]+)(?:\/(token|costs))?$/);
          if (url.pathname === '/api/admin/dashboard' && request.method === 'GET') json(response, 200, store.adminDashboard());
          else if (url.pathname === '/api/admin/attendants' && request.method === 'POST') json(response, 201, store.adminCreateAttendant(await readJson(request)));
          else if (route?.[1] === 'attendants' && route[3] === 'token' && request.method === 'POST') json(response, 200, store.rotateToken(route[2]));
          else if (route?.[1] === 'attendants' && route[3] === 'costs' && request.method === 'GET') {
            const date = url.searchParams.get('date') ?? '';
            json(response, 200, store.adminCosts(route[2], date));
          }
          else if (route?.[1] === 'attendants' && route[3] === 'costs' && request.method === 'POST') { store.adminSetCosts(route[2], await readJson(request)); json(response, 200, { saved: true }); }
          else if (route?.[1] === 'attendants' && !route[3] && request.method === 'PATCH') { store.setAttendantActive(route[2], await readJson(request)); json(response, 200, { saved: true }); }
          else if (route?.[1] === 'checkouts' && !route[3] && request.method === 'PATCH') { store.adminSetCheckout(route[2], await readJson(request)); json(response, 200, { saved: true }); }
          else if (route?.[1] === 'payouts' && !route[3] && request.method === 'PATCH') {
            const input = await readJson(request) as { status?: unknown; note?: unknown } | null;
            if (!input || typeof input.status !== 'string' || typeof input.note !== 'string') throw new PortalError(400, 'Informe o status e a observação do pagamento.');
            store.markPayout(route[2], input.status as 'paid' | 'cancelled', input.note); json(response, 200, { saved: true });
          } else throw new PortalError(404, 'Recurso administrativo não encontrado.');
          return;
        }
        let auth;
        try { auth = store.authenticate(authorization.startsWith('Bearer ') ? authorization.slice(7) : ''); }
        catch (error) { const count = failedAuth.get(identity); failedAuth.set(identity, { count: (count?.count ?? 0) + 1, started: count?.started ?? now }); throw error; }
        const requestedPeriod = url.searchParams.get('period') ?? 'today';
        if (!Object.hasOwn(periodLabels, requestedPeriod)) throw new PortalError(400, 'Período inválido.');
        const period = requestedPeriod as Period;
        if (url.pathname.startsWith('/api/push/')) {
          if (!options.push) throw new PortalError(503, 'As notificações push ainda não estão disponíveis neste servidor.');
          if (url.pathname === '/api/push/config' && request.method === 'GET') json(response, 200, options.push.config(auth));
          else if (url.pathname === '/api/push/subscriptions' && request.method === 'POST') json(response, 201, options.push.subscribe(auth, await readJson(request)));
          else if (url.pathname === '/api/push/subscriptions' && request.method === 'DELETE') json(response, 200, options.push.unsubscribe(auth, await readJson(request)));
          else throw new PortalError(404, 'Recurso não encontrado.');
        }
        else if (url.pathname === '/api/portal' && request.method === 'GET') json(response, 200, store.portal(auth, period));
        else if (url.pathname === '/api/profile' && request.method === 'PATCH') json(response, 200, store.saveProfile(auth, await readJson(request)));
        else if (url.pathname === '/api/sales' && request.method === 'POST') {
          const batch = await readJson(request), result = store.recordSales(auth, batch, String(request.headers['idempotency-key'] ?? ''));
          if (!result.duplicate && options.push) await options.push.notifySale(auth, batch as SaleBatch).catch(() => undefined);
          json(response, 200, result);
        }
        else if (url.pathname === '/api/ranking' && request.method === 'GET') json(response, 200, store.ranking(auth, period));
        else if (url.pathname === '/api/payouts' && request.method === 'POST') json(response, 201, store.requestPayout(auth, await readJson(request)));
        else if (/^\/api\/receipts\/[a-zA-Z0-9-]+$/.test(url.pathname) && request.method === 'GET') {
          const receipt = store.receipt(auth, url.pathname.split('/').at(-1)!);
          response.writeHead(200, { 'Content-Type': receipt.mime, 'Content-Length': receipt.bytes.byteLength, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="comprovante.' + (receipt.mime === 'image/jpeg' ? 'jpg' : receipt.mime === 'image/webp' ? 'webp' : 'png') + '"' });
          response.end(receipt.bytes);
        } else throw new PortalError(404, 'Recurso não encontrado.');
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new PortalError(405, 'Método não permitido.');
      if (!options.staticDir) throw new PortalError(404, 'Interface não disponível. Execute npm run build.');
      const root = resolve(options.staticDir);
      const requested = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (requested !== root && !requested.startsWith(root + sep)) throw new PortalError(404, 'Página não encontrada.');
      let filename = requested;
      try { if (!(await stat(filename)).isFile()) filename = resolve(root, 'index.html'); } catch { filename = resolve(root, 'index.html'); }
      const body = await readFile(filename);
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
      response.writeHead(200, { 'Content-Type': types[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': extname(filename) === '.html' ? 'no-store' : 'public, max-age=3600' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const status = error instanceof PortalError ? error.status : 500;
      json(response, status, { error: status === 500 ? 'Não foi possível concluir a solicitação. Tente novamente.' : (error as Error).message });
    }
  });
}
