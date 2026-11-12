import PartnerAdsNotice from './PartnerAdsNotice.tsx';
import { checkoutRateLabel, money } from './domain.ts';
import type { Portal } from './domain.ts';

export default function PartnerFinancialSummary({ portal }: { portal: Portal }) {
  const { finance, marketing, checkouts } = portal;
  const roi = marketing?.roiPercent == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(marketing.roiPercent) + '%';
  return <>
    <PartnerAdsNotice />
    <div className="financial-grid partner-financial-grid">
      <article className="metric" aria-label="Faturamento aprovado do parceiro"><h3>FATURAMENTO APROVADO</h3><strong>{money(finance.grossCents)}</strong><small>{finance.count} {finance.count === 1 ? 'venda aprovada' : 'vendas aprovadas'} no período</small></article>
      <article className="metric" aria-label="Taxas das vendas do parceiro"><h3>TAXAS DAS VENDAS</h3><strong>− {money(finance.transactionFeeCents)}</strong><small>Taxa de 12% nas vendas aprovadas</small></article>
      <article className="metric" aria-label="ADS próprio do parceiro"><h3>ADS PAGOS POR VOCÊ</h3><strong>{marketing ? money(marketing.ownAdsCents) : '—'}</strong><small>Pago por fora · Sem desconto no repasse</small></article>
      <article className="metric" aria-label="ADS registrados pela administração"><h3>ADS DA ADMINISTRAÇÃO</h3><strong>{money(finance.adsCents)}</strong><small>Apenas lucro e ROI · Sem desconto no repasse</small></article>
      <article className={`metric ${(marketing?.profitCents ?? 0) < 0 ? 'negative' : ''}`} aria-label="Lucro do parceiro após ADS"><h3>LUCRO APÓS ADS</h3><strong>{marketing ? money(marketing.profitCents) : '—'}</strong><small>Seu valor após taxas e ADS do período</small></article>
      <article className={`metric ${(marketing?.roiPercent ?? 0) < 0 ? 'negative' : ''}`} aria-label="ROI no extrato do parceiro"><h3>ROI</h3><strong>{roi}</strong><small>{marketing?.roiPercent == null ? 'Informe ADS para calcular o retorno' : 'Retorno sobre o investimento em ADS'}</small></article>
      <article className={`metric balance ${finance.availableCents < 0 ? 'negative' : ''}`} aria-label="Saldo de repasse do parceiro"><h3>SALDO PARA REPASSE</h3><strong>{money(finance.availableCents)}</strong><small>Todo o histórico · Nenhum ADS descontado</small></article>
    </div>
    <dl className="finance-breakdown">
      <div><dt>Seu valor após a taxa da venda</dt><dd>{money(finance.commissionCents)}</dd></div>
      <div><dt>Taxas e ajustes no período</dt><dd>− {money(finance.withdrawalFeeCents)}</dd></div>
      <div><dt>PIX já pagos · Todo o histórico</dt><dd>{money(finance.paidPayoutNetCents)}</dd></div>
    </dl>
    <p className="payout-help">Tarifa atual: <strong>{checkouts[0] ? checkoutRateLabel(checkouts[0]) : 'Consulte o gateway da venda'}</strong>. Todas as suas vendas, inclusive as antigas, usam a taxa padrão de 12%: você recebe 88% do valor bruto. Todos os ADS, inclusive os registrados pela administração, entram somente no lucro e no ROI, sem desconto no repasse.</p>
    <p className="payout-help">Novos repasses são <strong>sem taxa de saque</strong>. O valor registrado é o valor enviado no PIX.</p>
  </>;
}
