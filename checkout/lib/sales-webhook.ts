import { credentials, database } from './payments';

export const SALES_WEBHOOK_KEY = 'sales_webhook';

export type PaidSale = {
  id: string; requestId: string; amount: number; state: string; provider: string;
  sellerName: string | null; createdAt: number; origin: string | null;
};

type PortalConfig = { url: string; token: string; checkoutId: string | null };

const dedupeKey = (id: string) => 'sales_webhook_sent:' + id;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Mesma regex usada pelo portal em authenticate(): letras, números, hífen ou sublinhado.
const PORTAL_TOKEN_RE = /^[A-Za-z0-9_-]{12,160}$/;

/**
 * URL de envio + token da conta do portal (ambos criptografados no vault),
 * configurados em /admin/vendas. O token é o mesmo usado pelo app do atendente
 * (Authorization: Bearer). Se a URL terminar com ?checkout=<id>, esse checkout
 * é enviado em cada venda (contas de atendente com mais de um checkout).
 */
export async function salesWebhookConfig(): Promise<PortalConfig | null> {
  try {
    const c = await credentials(SALES_WEBHOOK_KEY);
    const url = typeof c?.token === 'string' ? c.token.trim() : '';
    const token = typeof c?.agent === 'string' ? c.agent.trim() : '';
    if (!/^https:\/\/[^\s/][^\s]*$/.test(url) || !PORTAL_TOKEN_RE.test(token)) return null;
    let checkoutId: string | null = null;
    try {
      const q = new URL(url).searchParams.get('checkout');
      if (q && /^[A-Za-z0-9_-]{3,100}$/.test(q)) checkoutId = q;
    } catch {
      // URL sem consulta parseável: segue sem checkoutId.
    }
    return { url, token, checkoutId };
  } catch {
    return null;
  }
}

async function loadSale(id: string): Promise<PaidSale | null> {
  // This integration posts all sales under a single portal account.
  const row = await database().prepare('SELECT id,request_id,amount,state,provider,seller_name,created_at,origin FROM payment_orders WHERE id=? AND attendant_id IS NULL').bind(id).first();
  if (!row) return null;
  return {
    id: row.id, requestId: row.request_id, amount: Number(row.amount), state: row.state, provider: row.provider,
    sellerName: row.seller_name ?? null, createdAt: Number(row.created_at), origin: row.origin ?? null,
  };
}

/** Data/hora no fuso de Brasília — o portal valida contra businessToday() (America/Sao_Paulo). */
export function saoPauloStamp(ms: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const g = (t: string) => String(parts.find(p => p.type === t)?.value ?? '');
  const date = g('year') + '-' + g('month') + '-' + g('day');
  const time = g('hour') + ':' + g('minute');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Timestamp invalido');
  return { date, time };
}

const ascii = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
const pdfEscape = (s: string) => ascii(s).replace(/([\\()])/g, '\\$1');

/**
 * Comprovante PDF mínimo (A4, Helvetica) gerado na hora do envio.
 * O portal exige um comprovante PNG/JPG/WEBP/PDF por venda e confere os bytes;
 * este arquivo é PDF válido (%PDF- + %%EOF) com os dados do pagamento.
 */
export function buildReceiptPdf(sale: PaidSale, amount: string, stamp: { date: string; time: string }): Uint8Array {
  const rows: Array<[number, string]> = [
    [16, 'Comprovante de pagamento'],
    [9, 'Bravus Checkout - venda enviada automaticamente ao portal Lucro Certo'],
    [11, 'Pedido: ' + sale.id],
    [11, 'Valor: R$ ' + amount],
  ];
  if (sale.provider && sale.provider !== 'synthetic') rows.push([11, 'Gateway: ' + sale.provider]);
  if (sale.sellerName) rows.push([11, 'Vendedor: ' + sale.sellerName]);
  rows.push([11, 'Data do pagamento (Brasilia): ' + stamp.date.split('-').reverse().join('/') + ' as ' + stamp.time]);
  rows.push([11, sale.state === 'test_paid' ? 'Status: pago - lancamento em modo TESTE' : 'Status: pago - confirmado pelo processador']);
  rows.push([8, 'Documento gerado automaticamente pela loja como comprovante do lancamento.']);
  let content = 'BT\n';
  let y = 780;
  for (const [size, text] of rows) {
    content += '/F1 ' + size + ' Tf\n1 0 0 1 46 ' + y + ' Tm (' + pdfEscape(text) + ') Tj\n';
    y -= size >= 14 ? 28 : 20;
  }
  content += 'ET';
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n <= 5; n++) {
    offsets[n] = out.length;
    if (n === 1) out += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    else if (n === 2) out += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
    else if (n === 3) out += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n';
    else if (n === 4) out += '4 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n';
    else out += '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n';
  }
  const xrefPos = out.length;
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return new TextEncoder().encode(out);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildNote(sale: PaidSale): string {
  const parts = ['Bravus Checkout', 'Pedido ' + sale.id];
  if (sale.sellerName) parts.push('Vendedor: ' + sale.sellerName);
  if (sale.provider && sale.provider !== 'synthetic') parts.push('Gateway: ' + sale.provider);
  if (sale.state === 'test_paid') parts.push('MODO TESTE');
  return parts.join(' - ').slice(0, 500);
}

/**
 * Envia a venda confirmada (paid/test_paid) para o portal Lucro Certo UMA única vez.
 * Contrato real do portal (POST /api/sales): Authorization Bearer <token> +
 * Idempotency-Key (UUID do pedido, então repetições nunca duplicam) + lote com
 * data/hora de Brasília, valor em reais e comprovante PDF gerado localmente.
 * A venda entra como PENDING no painel do portal, sem alterar o histórico existente.
 * Melhor esforço: qualquer falha deixa a venda para a varredura de /admin/vendas repetir.
 */
export async function notifyPortalSale(orderId: string): Promise<boolean> {
  try {
    if (!ID_RE.test(orderId)) return false;
    const cfg = await salesWebhookConfig();
    if (!cfg) return false;
    const sale = await loadSale(orderId);
    if (!sale || (sale.state !== 'paid' && sale.state !== 'test_paid')) return false;
    const flag = await database().prepare('SELECT key FROM payment_settings WHERE key=?').bind(dedupeKey(sale.id)).first();
    if (flag) return true;
    const cents = Math.round(Number(sale.amount));
    if (!Number.isSafeInteger(cents) || cents <= 0) return false;
    const amount = Math.floor(cents / 100) + ',' + String(cents % 100).padStart(2, '0');
    const stamp = saoPauloStamp(sale.createdAt);
    const batch = {
      date: stamp.date,
      sales: [{
        time: stamp.time,
        amount,
        note: buildNote(sale),
        ...(cfg.checkoutId ? { checkoutId: cfg.checkoutId } : {}),
        receipt: { name: 'comprovante-bravus-checkout.pdf', mime: 'application/pdf', base64: toBase64(buildReceiptPdf(sale, amount, stamp)) },
      }],
    };
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token, 'Idempotency-Key': sale.id },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(dedupeKey(sale.id), '1').run();
    return true;
  } catch {
    return false;
  }
}

/** Repetição: confere as vendas confirmadas recentes e envia as que ainda não saíram. */
export async function sweepPendingSales(limit = 40): Promise<number> {
  try {
    const rows = (await database().prepare("SELECT id FROM payment_orders WHERE attendant_id IS NULL AND state IN ('paid','test_paid') ORDER BY created_at DESC LIMIT ?").bind(limit).all()).results as Array<{ id: string }>;
    let sent = 0;
    for (const r of rows) if (await notifyPortalSale(r.id)) sent++;
    return sent;
  } catch {
    return 0;
  }
}
