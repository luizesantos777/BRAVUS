import {env} from 'cloudflare:workers';
import {database} from './payments';
import { FUNNEL_COOKIE, SESSION_MS, safeReturn, digest, equal, sign, validSession } from './funnel-session';

export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const logFunnelFailure = () => console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'login_failure', source: 'funnel' }));

function config() {
  const raw = (env as unknown as Record<string, string>).FUNNEL_AUTH;
  if (!raw) throw Error('Access not configured');
  const c = JSON.parse(raw);
  if (!c.hash || !c.salt || !c.sessionKey) throw Error('Access not configured');
  return c;
}

export function loginPage(path = '/', message = '', status = 200) {
  const safeMessage = message ? `<p role="alert" class="error">${message}</p>` : '';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acesso ao funil · Bravus Brasil</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#10150f;color:#f4f5ed;font-family:system-ui,sans-serif;padding:24px}main{width:100%;max-width:420px;border:1px solid #384332;border-radius:24px;padding:32px;background:#192017}img{width:84px;height:84px;border-radius:50%;object-fit:cover}h1{font-size:28px;margin:24px 0 8px}p{color:#c0c9b9;line-height:1.6}label{display:block;margin:24px 0 8px;font-weight:600}input,button{width:100%;min-height:50px;border-radius:10px;padding:12px 16px;font:inherit}input{border:1px solid #718165;background:#10150f;color:white}input:focus-visible,button:focus-visible{outline:3px solid #c8f566;outline-offset:3px}button{margin-top:16px;background:#c8f566;color:#17210b;border:0;font-weight:750;cursor:pointer}.error{color:#ffb8a6}small{display:block;margin-top:24px;color:#a8b39f}</style><main><img src="/assets/bravus-logo.jpg" alt="Bravus Brasil"><h1>Acesso ao funil</h1><p>Digite a senha da equipe para continuar.</p>${safeMessage}<form action="/api/funnel-access" method="post"><input type="hidden" name="returnTo" value="${safeReturn(path)}"><label for="password">Senha de acesso</label><input id="password" name="password" type="password" required maxlength="128" autocomplete="current-password"><button type="submit">Entrar no funil</button></form><small>BRAVUS BRASIL · ÁREA DA EQUIPE</small></main></html>`;
  return new Response(html, { status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'" } });
}

export async function serveFunnel(req: Request, content: string, script = false) {
  try {
    if (await validSession(req.headers.get('cookie') || '', config().sessionKey)) return new Response(content, { headers: { ...privateHeaders, 'Content-Type': script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' } });
    return script ? new Response('Unauthorized', { status: 401, headers: privateHeaders }) : loginPage(new URL(req.url).pathname);
  } catch {
    return script ? new Response('Unavailable', { status: 503, headers: privateHeaders }) : loginPage('/', 'Acesso temporariamente indisponível. Tente novamente em instantes.', 503);
  }
}

async function claimAttempt(req: Request) {
  const db = database(), now = Date.now();
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const key = 'funnel_attempt_' + await sign(config().sessionKey, ip);
  const sql = "INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CASE WHEN json_extract(payment_settings.value,'$.until')<=? THEN excluded.value ELSE json_set(payment_settings.value,'$.count',json_extract(payment_settings.value,'$.count')+1) END WHERE json_extract(payment_settings.value,'$.until')<=? OR json_extract(payment_settings.value,'$.count')<10";
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await db.prepare(sql).bind(key, JSON.stringify({ until: now + 900000, count: 1 }), now, now).run();
      return !!result.meta?.changes;
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      if (attempt >= 2 || !/D1_(?:ERROR|EXEC_ERROR).*?(?:internal error|overloaded|temporar|timeout|timed out|reset)/i.test(detail)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

export async function login(req: Request) {
  let path = '/';
  try {
    const origin = req.headers.get('origin');
    const sameOriginForm = (!origin || origin === 'null') && req.headers.get('sec-fetch-site') === 'same-origin';
    if (!sameOriginForm && (!origin || ![new URL(req.url).origin, 'https://pagamento.bravuspix.shop', 'https://bravus-atendimento-v2.luizlucrocerto.chatgpt.site'].includes(origin))) return new Response('Origem inválida', { status: 403, headers: privateHeaders });
    const raw = await req.text();
    if (raw.length > 4096) return loginPage('/', 'Solicitação inválida.', 400);
    const body = new URLSearchParams(raw);
    path = safeReturn(body.get('returnTo') || '/');
    if (body.get('action') === 'logout') return new Response(null, { status: 303, headers: { ...privateHeaders, Location: path, 'Set-Cookie': FUNNEL_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' } });
    if (!await claimAttempt(req)) return loginPage(path, 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.', 429);
    const password = body.get('password') || '', c = config();
    if (!password || password.length > 128 || !equal(await digest(password, c.salt), c.hash)) return loginPage(path, 'Senha incorreta. Confira e tente novamente.', 401);
    const expires = String(Date.now() + SESSION_MS);
    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: path, 'Set-Cookie': FUNNEL_COOKIE + '=' + expires + '.' + await sign(c.sessionKey, expires) + '; Path=/; HttpOnly; Secure; SameSite=Strict' } });
  } catch {
    logFunnelFailure();
    return loginPage(path, 'Não foi possível entrar. Tente novamente em instantes.', 503);
  }
}
