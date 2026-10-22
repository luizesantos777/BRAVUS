import { readDemoData, writeDemoData } from './demo-store.ts';
import { amountToCents, businessToday, checkoutFee, splitGatewayFee, demoInitial, demoPortal, inPeriod, MAX_RECEIPT_BYTES, validateAvatar, validatePayoutAmount, validateProfile, validDate } from './domain.ts';
import type { DemoData, Period, Portal, Profile, RankingEntry, Sale, SaleBatch } from './domain.ts';

export class ApiError extends Error { status: number; constructor(message: string, status = 0) { super(message); this.status = status; } }
export function currentToken() {
  const match = window.location.hash.match(/^#\/atendente\/([A-Za-z0-9_-]{1,160})\/?$/) ?? window.location.pathname.match(/\/atendente\/([A-Za-z0-9_-]{1,160})\/?$/);
  // A malformed individual link must fail authentication, never silently save in the demo.
  if (!match && (window.location.hash.startsWith('#/atendente/') || window.location.pathname.startsWith('/atendente/'))) return 'invalid_attendant_link';
  return match?.[1] ?? new URLSearchParams(window.location.search).get('token') ?? '';
}
export class PortalClient {
  token: string;
  isDemo: boolean;
  private demo: DemoData;
  private storageError = false;
  private base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
  constructor(token: string) {
    this.token = token; this.isDemo = !token; this.demo = demoInitial();
    if (this.isDemo) { try { this.demo = readDemoData(); } catch { this.storageError = true; } }
  }
  private reloadDemo() {
    if (!this.isDemo) return;
    try { this.demo = readDemoData(); this.storageError = false; }
    catch (error) { this.storageError = true; throw new ApiError((error as Error).message); }
  }
  private persist(next: DemoData) {
    if (this.storageError) throw new ApiError('Não foi possível ler a demonstração salva. Seus dados foram preservados.');
    writeDemoData(next); this.demo = next;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!import.meta.env.VITE_API_URL && window.location.hostname.endsWith('.github.io')) throw new ApiError('O acesso por token ainda precisa da API de atendentes hospedada. A demonstração está disponível na página inicial.', 503);
    const abort = new AbortController(), timeout = window.setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch(`${this.base}${path}`, { ...init, signal: abort.signal, headers: { Authorization: `Bearer ${this.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
      if (response.status === 413) throw new ApiError('O envio excede o limite da hospedagem. Envie menos vendas ou prints menores por vez.', 413);
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('O serviço de atendentes está indisponível. Tente novamente em instantes.', 503);
      const body = await response.json();
      if (!response.ok) throw new ApiError(body.error ?? 'Não foi possível concluir a solicitação.', response.status);
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Não foi possível conectar ao serviço de atendentes. Verifique sua conexão e tente novamente.', 503);
    } finally { window.clearTimeout(timeout); }
  }
  async portal(period: Period): Promise<Portal> {
    this.reloadDemo();
    if (this.isDemo) {
      if (this.storageError) throw new ApiError('Os dados desta demonstração não puderam ser lidos e foram preservados. Abra em outro navegador para experimentar.');
      return demoPortal(this.demo, period);
    }
    return this.request(`/portal?period=${period}`);
  }
  async saveSales(batch: SaleBatch, requestKey: string) {
    this.reloadDemo();
    if (!this.isDemo) return this.request('/sales', { method: 'POST', body: JSON.stringify(batch), headers: { 'Idempotency-Key': requestKey } });
    if (!validDate(batch.date) || batch.date > businessToday()) throw new ApiError('Informe uma data válida, até hoje.');
    if (!batch.sales.length || batch.sales.length > 10) throw new ApiError('Envie entre 1 e 10 vendas por vez.');
    const current = demoPortal(this.demo, 'all'), receipts = { ...this.demo.receipts };
    const sales: Sale[] = batch.sales.map(row => {
      const checkout = current.checkouts.find(item => item.id === row.checkoutId);
      if (!checkout) throw new ApiError('Selecione o checkout de cada venda.');
      if (!row.receipt || !['image/png', 'image/jpeg', 'image/webp'].includes(row.receipt.mime) || row.receipt.base64.length * .75 > MAX_RECEIPT_BYTES) throw new ApiError('Anexe um print PNG, JPG ou WEBP de até 2 MB para cada venda.');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) throw new ApiError('Informe o horário de cada venda.');
      const amountCents = amountToCents(row.amount), receiptId = crypto.randomUUID();
      receipts[receiptId] = row.receipt;
      return { id: crypto.randomUUID(), date: batch.date, time: row.time, amountCents, checkoutId: checkout.id, checkoutName: checkout.name, feeCents: checkoutFee(amountCents, checkout), attendantFeeCents: splitGatewayFee(checkoutFee(amountCents, checkout)), commissionBps: current.profile.commissionBps, commissionMode: 'gross-share-less-fees', note: row.note.trim(), receiptId, createdAt: new Date().toISOString(), status: 'pending', reviewNote: '', reviewedAt: null };
    });
    this.persist({ ...this.demo, receipts, sales: [...sales, ...this.demo.sales] });
    return { duplicate: false, count: sales.length };
  }
  async saveProfile(input: unknown): Promise<Profile> {
    this.reloadDemo();
    if (!this.isDemo) return this.request('/profile', { method: 'PATCH', body: JSON.stringify(input) });
    const fields = validateProfile(input), profile = { ...this.demo.profile, ...fields };
    this.persist({ ...this.demo, profile }); return profile;
  }
  async ranking(period: Period): Promise<RankingEntry[]> {
    this.reloadDemo();
    if (!this.isDemo) return this.request(`/ranking?period=${period}`);
    const sales = this.demo.sales.filter(sale => sale.status === 'approved').filter(sale => inPeriod(sale.date, period, businessToday()));
    return sales.length ? [{ id: this.demo.profile.id, name: this.demo.profile.name, photoUrl: this.demo.profile.photoUrl, grossCents: sales.reduce((sum, sale) => sum + sale.amountCents, 0), count: sales.length, mine: true }] : [];
  }
  pushConfig() { return this.request<{ publicKey: string; subscriptionIds: string[] }>('/push/config'); }
  subscribePush(subscription: PushSubscriptionJSON) { return this.request('/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) }); }
  unsubscribePush(id: string) { return this.request('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ id }) }); }
  async requestPayout(amount: string) {
    this.reloadDemo();
    if (!this.isDemo) return this.request('/payouts', { method: 'POST', body: JSON.stringify({ amount }) });
    const current = demoPortal(this.demo, 'all'), amountCents = amountToCents(amount);
    if (!current.profile.pixKey || !current.profile.pixOwner) throw new ApiError('Cadastre sua chave PIX e o titular antes de solicitar um repasse.');
    validatePayoutAmount(amountCents, current.finance.availableCents);
    this.persist({ ...this.demo, payouts: [{ id: crypto.randomUUID(), amountCents, withdrawalFeeCents: 0, gatewayFeeCents: 0, status: 'pending', requestedAt: new Date().toISOString(), paidAt: null, note: '' }, ...this.demo.payouts] });
  }
  async receipt(id: string): Promise<string> {
    this.reloadDemo();
    if (this.isDemo) {
      const receipt = this.demo.receipts[id];
      if (!receipt) throw new ApiError('Comprovante não encontrado.');
      return `data:${receipt.mime};base64,${receipt.base64}`;
    }
    try {
      const response = await fetch(`${this.base}/receipts/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!response.ok) throw new Error();
      return URL.createObjectURL(await response.blob());
    } catch { throw new ApiError('Não foi possível abrir este comprovante.'); }
  }
}
export async function readAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) throw new ApiError('Escolha uma foto PNG, JPG ou WEBP de até 4 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new ApiError('Não foi possível abrir essa foto. Escolha outra imagem.'); }
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new ApiError('Não foi possível preparar a foto neste navegador.');
    const size = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
    return validateAvatar(canvas.toDataURL('image/webp', .85));
  } finally { bitmap.close(); }
}
export { readReceipt } from './receipts.ts';
