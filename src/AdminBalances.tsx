import { money } from './domain.ts';
import type { AdminAttendant } from './domain.ts';

export default function AdminBalances({ attendants, selected, select }: { attendants: AdminAttendant[]; selected: string; select: (id: string) => void }) {
  const shown = attendants.filter(item => !selected || item.id === selected);
  return <section className="panel admin-balances">
    <div className="admin-heading"><div><h2>Faturamento e saldo por atendente</h2><p>Todo o histórico, incluindo atendentes com acesso revogado.</p></div></div>
    <label className="balance-filter">Atendente dos saldos<select value={selected} onChange={event => select(event.target.value)}><option value="">Todos os atendentes</option>{attendants.map(item => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (acesso revogado)' : ''}</option>)}</select></label>
    <p className="section-description">O faturamento inclui vendas aprovadas. O saldo desconta a parte do atendente nas taxas, ADS, ajustes e repasses já pagos. Os pagamentos são registrados manualmente pela administração.</p>
    <div className="attendant-balances">{shown.map(item => <article className="attendant-balance" key={item.id}>
      <header><h3>{item.name}</h3><span className={`payout-badge ${item.active ? 'paid' : 'cancelled'}`}>{item.active ? 'Ativo' : 'Acesso revogado'}</span></header>
      <dl>
        <div><dt>Faturamento aprovado</dt><dd>{money(item.finance.grossCents)}</dd><small>{item.finance.count} venda(s) aprovada(s)</small></div>
        <div><dt>Comissão após taxas das vendas</dt><dd>{money(item.finance.commissionCents)}</dd></div>
        <div><dt>ADS e ajustes</dt><dd>{money(item.finance.adsCents + item.finance.withdrawalFeeCents - (item.finance.paidPayoutCents - item.finance.paidPayoutNetCents))}</dd></div>
        <div><dt>Taxas de saque já debitadas</dt><dd>{money(item.finance.paidPayoutCents - item.finance.paidPayoutNetCents)}</dd></div>
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
