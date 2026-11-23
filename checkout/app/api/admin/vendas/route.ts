import { database, json, readBody, saveCredentials } from '@/lib/payments';
import { panelGuard } from '@/lib/gateway-access';
import { resolvePartner } from '@/lib/partners';
import { EMPTY_SALES_SUMMARY, salesByPartner, salesList, salesSummary } from '@/lib/sales-report';
import { SALES_WEBHOOK_KEY, salesWebhookConfig, sweepPendingSales } from '@/lib/sales-webhook';

export const dynamic = 'force-dynamic';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const empty = () => ({ rows: [] as unknown[], summary: EMPTY_SALES_SUMMARY, byPartner: [] as unknown[], swept: 0, configured: null as string | null, generatedAt: Date.now() });

export async function GET(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  try {
    const q = new URL(req.url).searchParams;
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const until = end.getTime();
    const from = q.get('from') ?? '';
    let since = until - 29 * 86400000;
    if (from) {
      if (!DAY_RE.test(from)) return json({ error: 'Período inválido. Use AAAA-MM-DD.' }, 400);
      const t = Date.parse(from + 'T00:00:00');
      if (Number.isNaN(t)) return json({ error: 'Período inválido. Use AAAA-MM-DD.' }, 400);
      since = t;
    }
    if (since > until) return json(empty());
    const status = q.get('status') ?? '';
    const partnerSlug = q.get('partner') ?? '';
    let partnerName: string | undefined;
    if (partnerSlug) {
      const p = await resolvePartner(partnerSlug);
      if (!p) return json(empty());
      partnerName = p.name;
    }
    const filters = { since, until, partnerName, status: status || undefined };
    // Retry sweep first: sales confirmed while the portal was down get pushed now.
    const swept = await sweepPendingSales();
    const [rows, summary, byPartner] = await Promise.all([salesList(filters), salesSummary(filters), salesByPartner(filters)]);
    const cfg = await salesWebhookConfig();
    return json({ rows, summary, byPartner, swept, configured: cfg ? cfg.url : null, generatedAt: Date.now() });
  } catch { return json({ error: 'Não foi possível carregar as vendas. Tente novamente.' }, 503); }
}

export async function POST(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  let body: any;
  try { body = await readBody(req); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const secret = typeof body?.secret === 'string' ? body.secret : '';
  if (url && !/^https:\/\/[^\s/][^\s]*$/.test(url)) return json({ error: 'Informe uma URL https válida para o portal.' }, 400);
  if (secret && !/^[A-Za-z0-9_-]{12,160}$/.test(secret)) return json({ error: 'O token do portal deve ter de 12 a 160 letras, números, hífen ou sublinhado.' }, 400);
  if ((url && !secret) || (!url && secret)) return json({ error: 'Preencha os dois campos ou limpe os dois para desativar.' }, 400);
  try {
    if (url) await saveCredentials(url, secret, SALES_WEBHOOK_KEY);
    else await database().prepare('DELETE FROM payment_settings WHERE key=?').bind(SALES_WEBHOOK_KEY).run();
    return json({ ok: true, configured: url || null });
  } catch { return json({ error: 'Não foi possível salvar a configuração do portal.' }, 503); }
}