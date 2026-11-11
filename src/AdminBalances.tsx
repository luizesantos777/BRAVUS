import { money } from './domain.ts';
import type { AdminAttendant } from './domain.ts';

export default function AdminBalances({ attendants, selected, select }: { attendants: AdminAttendant[]; selected: string; select: (id: string) => void }) {
  const shown = attendants.filter(item => !selected || item.id === selected);
  return <section className="panel admin-balances">
    <div className="admin-heading"><div><h2>Faturamento, lucro e saldo por conta</h2><p>Todo o histórico de atendentes e parceiros, incluindo acessos revogados.</p></div></div>
    <label className="balance-filter">Atendente dos saldos<select value={selected} onChange={event => select(event.target.value)}><option value="">Todos os atendentes</option>{attendants.map(item => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (acesso revogado)' : ''}</option>)}</select></label>
    <p className="section-description">O faturamento inclui vendas aprovadas. O lucro dos parceiros considera a taxa única de 12% e os ADS registrados. O saldo para repasse considera também os ajustes e os pagamentos já realizados.</p>
    <div className="attendant-balances">{shown.map(item => <article className="attendant-balance" key={item.id}>
      <header><h3>{item.name}</h3><span className={`payout-badge ${item.active ? 'paid' : 'cancelled'}`}>{item.active ? 'Ativo' : 'Acesso revogado'}</span></header>
      {item.accountKind === 'partner' && <p className="checkout-tariff">Parceiro · Taxa única de 12% por venda · Novos repasses sem taxa de saque.</p>}
      <dl>
        <div><dt>Faturamento aprovado</dt><dd>{money(item.finance.grossCents)}</dd><small>{item.finance.count} venda(s) aprovada(s)</small></div>
        <div><dt>{item.accountKind === 'partner' ? 'Valor após taxa única do gateway' : 'Comissão após taxas das vendas'}</dt><dd>{money(item.finance.commissionCents)}</dd></div>
        {item.accountKind === 'partner' && <>
          <div><dt>Taxa única do gateway</dt><dd>{money(item.finance.transactionFeeCents)}</dd></div>
          <div><dt>ADS próprios do parceiro</dt><dd>{item.marketing ? money(item.marketing.ownAdsCents) : '—'}</dd></div>
          <div className={item.marketing && item.marketing.profitCents < 0 ? 'negative' : 'partner-profit'}><dt>Lucro do parceiro após ADS</dt><dd>{item.marketing ? money(item.marketing.profitCents) : '—'}</dd><small>Vendas aprovadas menos gateway e ADS registrados</small></div>
          <div><dt>ROI do parceiro</dt><dd>{item.marketing?.roiPercent == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(item.marketing.roiPercent) + '%'}</dd></div>
        </>}
        <div><dt>{item.accountKind === 'partner' ? 'ADS cobrados pela administração e ajustes' : 'ADS e ajustes'}</dt><dd>{money(item.finance.adsCents + item.finance.withdrawalFeeCents - (item.finance.paidPayoutCents - item.finance.paidPayoutNetCents))}</dd></div>
        <div><dt>{item.accountKind === 'partner' ? 'Taxas históricas de repasse' : 'Taxas de saque já debitadas'}</dt><dd>{money(item.finance.paidPayoutCents - item.finance.paidPayoutNetCents)}</dd></div>
        <div><dt>PIX já pagos</dt><dd>{money(item.finance.paidPayoutNetCents)}</dd></div>
        <div className={`balance-available ${item.finance.availableCents < 0 ? 'negative' : ''}`}><dt>Saldo disponível para repasse</dt><dd>{money(item.finance.availableCents)}</dd></div>
      </dl>
      {item.finance.pendingSalesCount > 0 && <p>{item.finance.pendingSalesCount} venda(s) em análise: {money(item.finance.pendingSalesCents)}. Esses valores aguardam aprovação.</p>}
      {item.finance.availableCents > 0 && item.finance.pendingPayoutCents === 0 && <p>Há saldo disponível para um repasse manual da administração.</p>}
      {item.finance.availableCents < 0 && <p>O saldo ficou negativo após os custos e pagamentos registrados. Confira as vendas, os custos e os repasses.</p>}
    </article>)}</div>
    {!shown.length && <p className="section-description">Nenhum atendente encontrado.</p>}
  </section>;
}
