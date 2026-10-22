import { demoAdminRequest } from './demo-admin.ts';
import { readDemoData } from './demo-store.ts';
import { ApiError } from './client.ts';
import type { AdminDashboard, AdminSalesPage, CheckoutTierInput, DailyCost, Invitation, SaleStatus } from './domain.ts';
import { financialCsv } from './admin-domain.ts';
import type { AuditPage, BackupRecord, BackupStatus, FinancialReport } from './admin-domain.ts';

export const adminUnavailable = !import.meta.env.VITE_API_URL && window.location.hostname.endsWith('.github.io');

/** This key lives only in memory, never in URLs or browser storage. */
export class AdminClient {
  private key: string;
  private base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
  readonly isDemo: boolean;
  constructor(key: string, isDemo = false) { this.key = key; this.isDemo = isDemo; }
  clear() { this.key = ''; }
  private async request<T>(path: string, method = 'GET', payload?: unknown, timeoutMs = 20_000): Promise<T> {
    if (this.isDemo) return await demoAdminRequest(path, method, payload) as T;
    if (adminUnavailable) throw new ApiError('A administração estará disponível no endereço do servidor após a hospedagem da API.', 503);
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.base}/admin${path}`, { method, cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${this.key}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('A API administrativa está indisponível.', 503);
      const body = await response.json();
      if (!response.ok) throw new ApiError(body.error ?? 'Não foi possível concluir a solicitação.', response.status);
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Não foi possível conectar à API. Verifique a conexão e tente novamente.', 503);
    } finally { window.clearTimeout(timer); }
  }
  dashboard(refreshOnly = false) { return this.request<AdminDashboard>('/dashboard' + (refreshOnly ? '?refresh=1' : ''), 'GET', undefined, refreshOnly ? 20_000 : 90_000); }
  financial(start: string, end: string, attendantId = '') { return this.request<FinancialReport>('/reports/financial?' + new URLSearchParams({ start, end, attendantId })); }
  audit(start: string, end: string, action = '', page = 1) { return this.request<AuditPage>('/audit?' + new URLSearchParams({ start, end, action, page: String(page) })); }
  backups() { return this.request<BackupStatus>('/backups'); }
  createBackup() { return this.request<BackupRecord>('/backups', 'POST', undefined, 120_000); }
  async download(path: string, filename: string) {
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${this.base}/admin${path}`, { signal: controller.signal, headers: { Authorization: `Bearer ${this.key}` } });
      if (!response.ok) {
        const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        throw new ApiError(body?.error ?? 'Não foi possível baixar o arquivo.', response.status);
      }
      saveFile(await response.blob(), filename);
    } catch (cause) { if (cause instanceof ApiError) throw cause; throw new ApiError('Não foi possível baixar o arquivo. Confira sua conexão e tente novamente.'); }
    finally { window.clearTimeout(timer); }
  }
  async downloadFinancial(start: string, end: string, attendantId = '') {
    const filename = `bravus-fechamento-${start}-${end}.csv`;
    if (this.isDemo) saveFile(new Blob([financialCsv(await this.financial(start, end, attendantId))], { type: 'text/csv;charset=utf-8' }), filename);
    else await this.download('/reports/financial.csv?' + new URLSearchParams({ start, end, attendantId }), filename);
  }
  pushConfig() { return this.request<{ publicKey: string; subscriptionIds: string[] }>('/push/config'); }
  subscribePush(subscription: PushSubscriptionJSON) { return this.request('/push/subscriptions', 'POST', subscription); }
  unsubscribePush(id: string) { return this.request('/push/subscriptions', 'DELETE', { id }); }
  sales(status: SaleStatus | 'all', attendantId = '', page = 1) { return this.request<AdminSalesPage>(`/sales?${new URLSearchParams({ status, attendantId, page: String(page) })}`); }
  reviewSale(id: string, status: 'approved' | 'rejected', note: string) { return this.request(`/sales/${id}`, 'PATCH', { status, note }); }
  async receipt(id: string): Promise<string> {
    if (this.isDemo) {
      const receipt = readDemoData().receipts[id]; if (!receipt) throw new Error('Comprovante não encontrado.');
      return `data:${receipt.mime};base64,${receipt.base64}`;
    }
    const response = await fetch(`${this.base}/admin/receipts/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!response.ok) throw new ApiError('Não foi possível abrir o comprovante.', response.status);
    return URL.createObjectURL(await response.blob());
  }
  createAttendant(name: string, commission: string, token = '') { return this.request<Invitation>('/attendants', 'POST', { name, commission, ...(token.trim() ? { token: token.trim() } : {}) }); }
  rotateToken(id: string) { return this.request<Invitation>(`/attendants/${id}/token`, 'POST'); }
  setActive(id: string, active: boolean) { return this.request(`/attendants/${id}`, 'PATCH', { active }); }
  costs(id: string, date: string) { return this.request<DailyCost>(`/attendants/${id}/costs?date=${encodeURIComponent(date)}`); }
  setCosts(id: string, date: string, ads: string, withdrawalFee: string) { return this.request(`/attendants/${id}/costs`, 'POST', { date, ads, withdrawalFee }); }
  setCheckout(id: string, name: string, fee: string, fixedFee: string, minimum: string, higherTier: CheckoutTierInput | null) { return this.request(`/checkouts/${id}`, 'PATCH', { name, fee, fixedFee, minimum, higherTier }); }
  markPayout(id: string, status: 'paid' | 'cancelled', note: string) { return this.request(`/payouts/${id}`, 'PATCH', { status, note }); }
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function invitationUrl(token: string) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/admin\/?$/, '/');
  url.search = ''; url.hash = `/atendente/${token}`;
  return url.href;
}
