import { ApiError } from './client.ts';
import type { AdminDashboard, DailyCost, Invitation } from './domain.ts';

export const adminUnavailable = !import.meta.env.VITE_API_URL && window.location.hostname.endsWith('.github.io');

/** This key lives only in memory, never in URLs or browser storage. */
export class AdminClient {
  private key: string;
  private base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
  constructor(key: string) { this.key = key; }
  clear() { this.key = ''; }
  private async request<T>(path: string, method = 'GET', payload?: unknown): Promise<T> {
    if (adminUnavailable) throw new ApiError('A administração estará disponível no endereço do servidor após a hospedagem da API.', 503);
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${this.base}/admin${path}`, { method, signal: controller.signal, headers: { Authorization: `Bearer ${this.key}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('A API administrativa está indisponível.', 503);
      const body = await response.json();
      if (!response.ok) throw new ApiError(body.error ?? 'Não foi possível concluir a solicitação.', response.status);
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Não foi possível conectar à API. Verifique a conexão e tente novamente.', 503);
    } finally { window.clearTimeout(timer); }
  }
  dashboard() { return this.request<AdminDashboard>('/dashboard'); }
  createAttendant(name: string, commission: string, token = '') { return this.request<Invitation>('/attendants', 'POST', { name, commission, ...(token.trim() ? { token: token.trim() } : {}) }); }
  rotateToken(id: string) { return this.request<Invitation>(`/attendants/${id}/token`, 'POST'); }
  setActive(id: string, active: boolean) { return this.request(`/attendants/${id}`, 'PATCH', { active }); }
  costs(id: string, date: string) { return this.request<DailyCost>(`/attendants/${id}/costs?date=${encodeURIComponent(date)}`); }
  setCosts(id: string, date: string, ads: string, withdrawalFee: string) { return this.request(`/attendants/${id}/costs`, 'POST', { date, ads, withdrawalFee }); }
  setCheckout(id: string, name: string, fee: string, fixedFee: string, minimum: string) { return this.request(`/checkouts/${id}`, 'PATCH', { name, fee, fixedFee, minimum }); }
  markPayout(id: string, status: 'paid' | 'cancelled', note: string) { return this.request(`/payouts/${id}`, 'PATCH', { status, note }); }
}

export function invitationUrl(token: string) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/admin\/?$/, '/');
  url.search = ''; url.hash = `/atendente/${token}`;
  return url.href;
}
