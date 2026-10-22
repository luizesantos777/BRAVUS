import { DEMO_KEY, demoInitial, saleStatusLabels, validateProfile, validDate } from './domain.ts';
import type { DemoData } from './domain.ts';

export function readDemoData(): DemoData {
  const saved = localStorage.getItem(DEMO_KEY);
  if (!saved) return demoInitial();
  try {
    const data = JSON.parse(saved) as DemoData;
    if (data.version !== 1 || !Array.isArray(data.sales) || !Array.isArray(data.payouts) || !Array.isArray(data.costs) || !data.receipts || typeof data.receipts !== 'object') throw new Error();
    data.profile = { ...demoInitial().profile, ...data.profile }; validateProfile(data.profile);
    data.sales = data.sales.map(sale => ({ ...sale, status: sale.status ?? 'approved', reviewNote: sale.reviewNote ?? '', reviewedAt: sale.reviewedAt ?? null }));
    if (!data.sales.every(sale => typeof sale.id === 'string' && validDate(sale.date) && Number.isSafeInteger(sale.amountCents) && Number.isSafeInteger(sale.feeCents) && Number.isInteger(sale.commissionBps) && sale.commissionBps >= 0 && sale.commissionBps <= 10000 && Object.hasOwn(saleStatusLabels, sale.status) && typeof sale.reviewNote === 'string')) throw new Error();
    return data;
  } catch { throw new Error('Não foi possível ler a demonstração salva. Seus dados foram preservados; use outro navegador para experimentar.'); }
}
export function writeDemoData(data: DemoData) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); }
  catch { throw new Error('Não foi possível salvar a demonstração. Verifique o espaço de armazenamento do navegador.'); }
}
