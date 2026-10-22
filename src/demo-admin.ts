import { amountToCents, businessToday, calculateFinance, checkoutFee, splitGatewayFee, demoCheckouts, validateSaleReview, validDate } from './domain.ts';
import type { AdminDashboard, AdminSale, AdminSalesPage, Sale } from './domain.ts';
import { readDemoData, writeDemoData } from './demo-store.ts';
import { financialReport } from './admin-domain.ts';

export function prepareAdminDemo() {
  const data = readDemoData();
  if (data.sales.length) return;
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar o exemplo neste navegador.');
  context.fillStyle = '#10180f'; context.fillRect(0, 0, 600, 300);
  context.fillStyle = '#e1b12e'; context.font = 'bold 26px sans-serif'; context.fillText('BRAVUS · EXEMPLO', 30, 65);
  context.fillStyle = '#e5ebdf'; context.font = '20px sans-serif'; context.fillText('Comprovante de demonstração', 30, 130); context.fillText('SEM TRANSAÇÃO REAL', 30, 180);
  const receipt = { name: 'comprovante-demonstracao.png', mime: 'image/png', base64: canvas.toDataURL('image/png').split(',')[1] };
  const now = new Date().toISOString();
  const sales: Sale[] = [19700, 35000, 100000].map((amountCents, index) => {
    const receiptId = crypto.randomUUID(); data.receipts[receiptId] = receipt;
    return { id: crypto.randomUUID(), date: businessToday(), time: '12:00', checkoutId: 'main', checkoutName: 'Checkout principal', amountCents, feeCents: checkoutFee(amountCents, demoCheckouts[0]), attendantFeeCents: splitGatewayFee(checkoutFee(amountCents, demoCheckouts[0])), commissionBps: data.profile.commissionBps, commissionMode: 'gross-share-less-fees', note: 'Venda de exemplo para conhecer o painel.', receiptId, createdAt: now, status: index === 2 ? 'approved' : 'pending', reviewNote: index === 2 ? 'Exemplo aprovado' : '', reviewedAt: index === 2 ? now : null };
  });
  writeDemoData({ ...data, sales });
}

export async function demoAdminRequest(path: string, method: string, payload?: unknown): Promise<unknown> {
  const data = readDemoData(), url = new URL(path, 'https://demo.invalid');
  const profile = data.profile;
  if (url.pathname === '/reports/financial' && method === 'GET') return financialReport({ attendants: [{ id: profile.id, name: profile.name }], sales: data.sales.map(sale => ({ ...sale, attendantId: profile.id, attendantName: profile.name })), costs: data.costs.map(cost => ({ ...cost, attendantId: profile.id, attendantName: profile.name })), payouts: data.payouts.map(payout => ({ ...payout, attendantId: profile.id, attendantName: profile.name, pixType: profile.pixType, pixKey: profile.pixKey, pixOwner: profile.pixOwner })) }, url.searchParams.get('start') ?? '', url.searchParams.get('end') ?? '', url.searchParams.get('attendantId') ?? '');
  if (url.pathname === '/dashboard') {
    const dashboard: AdminDashboard = { attendants: [{ id: profile.id, name: profile.name, active: true, commissionBps: profile.commissionBps, createdAt: new Date().toISOString(), salesCount: data.sales.length, grossCents: data.sales.reduce((sum, sale) => sum + sale.amountCents, 0), finance: calculateFinance(data.sales, data.costs, data.payouts, 'all', businessToday()) }], payouts: data.payouts.map(payout => ({ ...payout, attendantId: profile.id, attendantName: profile.name, pixType: profile.pixType, pixKey: profile.pixKey, pixOwner: profile.pixOwner })), checkouts: demoCheckouts, pendingSalesCount: data.sales.filter(sale => sale.status === 'pending').length, todayAdsCents: data.costs.filter(cost => cost.date === businessToday()).reduce((sum, cost) => sum + cost.adsCents, 0), costs: data.costs.map(cost => ({ ...cost, attendantId: profile.id, attendantName: profile.name })).sort((a, b) => b.date.localeCompare(a.date)) };
    return dashboard;
  }
  if (url.pathname === '/sales' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'pending', attendant = url.searchParams.get('attendantId') ?? '', page = Number(url.searchParams.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1) throw new Error('Página inválida.');
    const sales: AdminSale[] = data.sales.filter(sale => (status === 'all' || sale.status === status) && (!attendant || attendant === profile.id)).map(sale => ({ ...sale, attendantId: profile.id, attendantName: profile.name })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { sales: sales.slice((page - 1) * 50, page * 50), total: sales.length, page, pageSize: 50 } satisfies AdminSalesPage;
  }
  const saleId = url.pathname.match(/^\/sales\/([^/]+)$/)?.[1];
  if (saleId && method === 'PATCH') {
    const review = validateSaleReview(payload), sale = data.sales.find(item => item.id === saleId);
    if (!sale) throw new Error('Venda não encontrada.');
    if (sale.status !== 'pending') throw new Error('Esta venda já foi analisada.');
    sale.status = review.status; sale.reviewNote = review.note; sale.reviewedAt = new Date().toISOString(); writeDemoData(data); return { saved: true };
  }
  const costs = url.pathname.match(/^\/attendants\/([^/]+)\/costs$/);
  if (costs && costs[1] === profile.id) {
    if (method === 'GET') {
      const date = url.searchParams.get('date') ?? ''; if (!validDate(date)) throw new Error('Informe uma data válida.');
      return data.costs.find(cost => cost.date === date) ?? { date, adsCents: 0, withdrawalFeeCents: 0 };
    }
    const fields = payload as { date: string; ads: string; withdrawalFee: string };
    if (!fields || !validDate(fields.date)) throw new Error('Informe uma data válida.');
    const amount = (value: string) => typeof value === 'string' && /^0+(?:[.,]0{1,2})?$/.test(value.trim()) ? 0 : amountToCents(value);
    const cost = { date: fields.date, adsCents: amount(fields.ads), withdrawalFeeCents: amount(fields.withdrawalFee) };
    writeDemoData({ ...data, costs: [cost, ...data.costs.filter(item => item.date !== cost.date)] }); return { saved: true };
  }
  throw new Error('Esta ação usa dados reais e estará disponível no painel conectado à API.');
}
