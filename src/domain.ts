export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all';
export type PixType = '' | 'email' | 'cpf' | 'cnpj' | 'phone' | 'random';
export type PayoutStatus = 'pending' | 'paid' | 'cancelled';
export const periodLabels: Record<Period, string> = { today: 'Hoje', yesterday: 'Ontem', week: 'Últimos 7 dias', month: 'Este mês', all: 'Todo o período' };
export const pixLabels: Record<PixType, string> = { '': 'Selecione o tipo', email: 'E-mail', cpf: 'CPF', cnpj: 'CNPJ', phone: 'Telefone', random: 'Chave aleatória' };
export interface Profile { id: string; name: string; email: string; phone: string; pixType: PixType; pixKey: string; pixOwner: string; commissionBps: number; photoUrl: string; saleAlertTemplate: string }
export interface Checkout { id: string; name: string; feeBps: number; fixedFeeCents: number; minAmountCents: number }
export interface Sale { id: string; date: string; time: string; checkoutId: string; checkoutName: string; amountCents: number; feeCents: number; commissionBps: number; note: string; receiptId: string; createdAt: string }
export interface DailyCost { date: string; adsCents: number; withdrawalFeeCents: number }
export interface Payout { id: string; amountCents: number; status: PayoutStatus; requestedAt: string; paidAt: string | null; note: string }
export interface ReceiptInput { name: string; mime: string; base64: string }
export interface SaleInput { amount: string; checkoutId: string; time: string; note: string; receipt: ReceiptInput | null }
export interface SaleBatch { date: string; sales: SaleInput[] }
export interface Finance { grossCents: number; feeCents: number; adsCents: number; commissionCents: number; availableCents: number; pendingPayoutCents: number; paidPayoutCents: number; debtCents: number; count: number }
export interface Portal { profile: Profile; checkouts: Checkout[]; sales: Sale[]; payouts: Payout[]; finance: Finance; today: string }
export interface RankingEntry { id: string; name: string; photoUrl: string; grossCents: number; count: number; mine: boolean }
export interface AdminAttendant { id: string; name: string; active: boolean; commissionBps: number; createdAt: string; salesCount: number; grossCents: number }
export interface AdminPayout extends Payout { attendantId: string; attendantName: string; pixType: PixType; pixKey: string; pixOwner: string }
export interface AdminDashboard { attendants: AdminAttendant[]; payouts: AdminPayout[]; checkouts: Checkout[] }
export interface Invitation { attendantId: string; name: string; token: string }
export interface DemoData { version: 1; profile: Profile; sales: Sale[]; payouts: Payout[]; costs: DailyCost[]; receipts: Record<string, ReceiptInput> }
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
export const MAX_SALE_CENTS = 100_000_000;
export const DEMO_KEY = 'bravus.attendant.demo.v1';
export const DEFAULT_SALE_ALERT = '✅ Venda de {valor} lançada com sucesso!';
export const MAX_AVATAR_BYTES = 256 * 1024;
export function renderSaleAlert(template: string, amountCents: number, count: number, name: string): string {
  const values: Record<string, string> = { valor: money(amountCents), qtd: String(count), nome: name };
  return template.replace(/\{(valor|qtd|nome)\}/g, (_match, key: string) => values[key]);
}
export function detectPixType(value: string): PixType {
  const key = value.trim(), digits = key.replace(/\D/g, '');
  if (!key) return '';
  if (key.includes('@')) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'random';
  if (key.startsWith('+') || /[()]/.test(key)) return 'phone';
  if (digits.length === 14) return 'cnpj';
  if (digits.length === 11 && !/^(\d)\1+$/.test(digits)) {
    const check = (length: number) => { const sum = [...digits.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0); const mod = (sum * 10) % 11; return mod === 10 ? 0 : mod; };
    if (check(9) === Number(digits[9]) && check(10) === Number(digits[10])) return 'cpf';
  }
  return 'phone';
}
export function validateAvatar(value: string): string {
  if (!value) return '';
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || value.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 40) throw new Error('Use uma foto PNG, JPG ou WEBP de até 256 KB após o ajuste.');
  let bytes: string;
  try { bytes = atob(match[2]); } catch { throw new Error('A foto de perfil é inválida.'); }
  const valid = match[1] === 'png' && bytes.startsWith('\x89PNG\r\n\x1a\n') || match[1] === 'jpeg' && bytes.startsWith('\xff\xd8\xff') || match[1] === 'webp' && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid || bytes.length > MAX_AVATAR_BYTES) throw new Error('A foto de perfil é inválida.');
  return value;
}
export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export function checkoutFee(amountCents: number, checkout: Checkout): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_SALE_CENTS) throw new Error('Informe um valor de venda válido.');
  if (amountCents < checkout.minAmountCents) throw new Error(`${checkout.name}: valor mínimo de ${money(checkout.minAmountCents)} por venda.`);
  return Math.floor((amountCents * checkout.feeBps + 5000) / 10000) + checkout.fixedFeeCents;
}
export function checkoutRateLabel(checkout: Checkout): string {
  const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(checkout.feeBps / 100);
  return `${percent}% + ${money(checkout.fixedFeeCents)} por venda`;
}
export const MANUAL_PIX_TARIFF = { feeBps: 699, fixedFeeCents: 169, minAmountCents: 500 };
export function percentageToBps(value: string): number {
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Informe um percentual entre 0 e 100, com até duas casas decimais.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bps > 10000) throw new Error('O percentual não pode ultrapassar 100%.');
  return bps;
}
export function businessToday(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const businessTime = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00Z`));
export function amountToCents(value: string): number {
  let normalized = value.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized)) normalized = normalized.replaceAll('.', '');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor válido, como 197,00.');
  const [whole, fraction = ''] = normalized.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_SALE_CENTS) throw new Error('O valor deve ser maior que zero e de até R$ 1.000.000,00.');
  return cents;
}
export function inPeriod(date: string, period: Period, today: string) {
  if (period === 'all') return true;
  if (period === 'today') return date === today;
  if (period === 'month') return date.slice(0, 7) === today.slice(0, 7) && date <= today;
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (period === 'yesterday' ? 1 : 6));
  const lower = start.toISOString().slice(0, 10);
  return period === 'yesterday' ? date === lower : date >= lower && date <= today;
}
export function calculateFinance(sales: Sale[], costs: DailyCost[], payouts: Payout[], period: Period, today: string): Finance {
  const dates = new Set([...sales.map(sale => sale.date), ...costs.map(cost => cost.date)]);
  let earned = 0, commissionCents = 0, debtCents = 0;
  for (const date of dates) {
    const daily = sales.filter(sale => sale.date === date);
    const commission = daily.reduce((sum, sale) => sum + Math.round((sale.amountCents - sale.feeCents) * sale.commissionBps / 10000), 0);
    const cost = costs.filter(cost => cost.date === date).reduce((sum, cost) => sum + cost.adsCents + cost.withdrawalFeeCents, 0);
    earned += commission - cost;
    if (inPeriod(date, period, today)) {
      commissionCents += commission;
      debtCents += Math.max(0, cost - commission);
    }
  }
  const filtered = sales.filter(sale => inPeriod(sale.date, period, today));
  const filteredCosts = costs.filter(cost => inPeriod(cost.date, period, today));
  const pendingPayoutCents = payouts.filter(payout => payout.status === 'pending').reduce((sum, payout) => sum + payout.amountCents, 0);
  const paidPayoutCents = payouts.filter(payout => payout.status === 'paid').reduce((sum, payout) => sum + payout.amountCents, 0);
  return { grossCents: filtered.reduce((sum, sale) => sum + sale.amountCents, 0), feeCents: filtered.reduce((sum, sale) => sum + sale.feeCents, 0) + filteredCosts.reduce((sum, cost) => sum + cost.withdrawalFeeCents, 0), adsCents: filteredCosts.reduce((sum, cost) => sum + cost.adsCents, 0), commissionCents, availableCents: earned - pendingPayoutCents - paidPayoutCents, pendingPayoutCents, paidPayoutCents, debtCents, count: filtered.length };
}
export function validateProfile(value: unknown): Pick<Profile, 'name' | 'email' | 'phone' | 'pixType' | 'pixKey' | 'pixOwner'> & Partial<Pick<Profile, 'photoUrl' | 'saleAlertTemplate'>> {
  if (!value || typeof value !== 'object') throw new Error('Dados de perfil inválidos.');
  const source = value as Record<string, unknown>;
  function field(name: string, max: number) {
    if (typeof source[name] !== 'string' || source[name].length > max) throw new Error('Confira os dados do perfil.');
    return source[name].trim();
  }
  const name = field('name', 120), email = field('email', 160), phone = field('phone', 40), pixType = field('pixType', 10) as PixType, pixKey = field('pixKey', 180), pixOwner = field('pixOwner', 120);
  if (!name) throw new Error('Informe seu nome.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (!Object.hasOwn(pixLabels, pixType)) throw new Error('Selecione um tipo de chave PIX válido.');
  if (pixType || pixKey || pixOwner) {
    if (!pixType || !pixKey || !pixOwner) throw new Error('Preencha o tipo, a chave PIX e o nome do titular.');
    const digits = pixKey.replace(/\D/g, '');
    if (pixType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey)) throw new Error('A chave PIX deve ser um e-mail válido.');
    if (pixType === 'cpf' && (digits.length !== 11 || /^(\d)\1+$/.test(digits))) throw new Error('Informe um CPF com 11 dígitos.');
    if (pixType === 'cnpj' && (digits.length !== 14 || /^(\d)\1+$/.test(digits))) throw new Error('Informe um CNPJ com 14 dígitos.');
    if (pixType === 'phone' && ![10, 11, 12, 13].includes(digits.length)) throw new Error('Informe um telefone PIX válido, com DDD.');
    if (pixType === 'random' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pixKey)) throw new Error('Informe uma chave aleatória PIX válida.');
  }
  const extra: Partial<Pick<Profile, 'photoUrl' | 'saleAlertTemplate'>> = {};
  if (source.photoUrl !== undefined) {
    if (typeof source.photoUrl !== 'string') throw new Error('A foto de perfil é inválida.');
    extra.photoUrl = validateAvatar(source.photoUrl);
  }
  if (source.saleAlertTemplate !== undefined) {
    if (typeof source.saleAlertTemplate !== 'string' || !source.saleAlertTemplate.trim() || source.saleAlertTemplate.length > 240) throw new Error('O alerta de venda deve ter de 1 a 240 caracteres.');
    if (/\{(?!valor\}|qtd\}|nome\})[^}]*\}/.test(source.saleAlertTemplate)) throw new Error('Use {valor}, {qtd} e {nome} como variáveis do alerta.');
    extra.saleAlertTemplate = source.saleAlertTemplate.trim();
  }
  return { name, email, phone, pixType, pixKey, pixOwner, ...extra };
}
export function demoInitial(): DemoData {
  return { version: 1, profile: { id: 'demo', name: 'Atendente de demonstração', email: '', phone: '', pixType: '', pixKey: '', pixOwner: '', commissionBps: 1000, photoUrl: '', saleAlertTemplate: DEFAULT_SALE_ALERT }, sales: [], payouts: [], costs: [], receipts: {} };
}
export const demoCheckouts: Checkout[] = [{ id: 'main', name: 'Checkout principal', feeBps: 0, fixedFeeCents: 0, minAmountCents: 1 }, { id: 'pix', name: 'PIX manual', ...MANUAL_PIX_TARIFF }];
export function demoPortal(data: DemoData, period: Period): Portal {
  const today = businessToday();
  return { profile: data.profile, checkouts: demoCheckouts, sales: data.sales.filter(sale => inPeriod(sale.date, period, today)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), payouts: data.payouts, finance: calculateFinance(data.sales, data.costs, data.payouts, period, today), today };
}
