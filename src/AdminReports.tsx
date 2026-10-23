import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { businessToday, money } from './domain.ts';
import type { AdminAttendant } from './domain.ts';
import type { FinancialReport } from './admin-domain.ts';
import type { AdminClient } from './admin-client.ts';

export default function AdminReports({ client, attendants, refreshKey }: { client: AdminClient; attendants: AdminAttendant[]; refreshKey?: unknown }) {
  const today = businessToday(), [start, setStart] = useState(today.slice(0, 8) + '01'), [end, setEnd] = useState(today), [attendant, setAttendant] = useState('');
  const [filter, setFilter] = useState({ start, end, attendant, refresh: 0 }), [report, setReport] = useState<FinancialReport | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), running = useRef(false);
  const load = useCallback(async () => {
    if (running.current) return;
    const version = generation.current; running.current = true; setBusy(true); setError('');
    try { const value = await client.financial(filter.start, filter.end, filter.attendant); if (version === generation.current) setReport(value); }
    catch (cause) { if (version === generation.current) { setError((cause as Error).message); setReport(null); } }
    finally { if (version === generation.current) { running.current = false; setBusy(false); } }
  }, [client, filter]);
  useEffect(() => { ++generation.current; running.current = false; void load(); return () => { ++generation.current; }; }, [load]);
  // A dashboard refresh updates the applied report without resetting its filters.
  useEffect(() => { if (!busy) void load(); }, [refreshKey, load]);
  async function download() { if (busy || !report) return; setBusy(true); setError(''); try { await client.downloadFinancial(report.start, report.end, filter.attendant); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const metrics = report ? [ ['Faturamento aprovado', report.totals.grossCents], ['Taxas das vendas', report.totals.gatewayFeeCents], ['Custos de ADS', report.totals.adsCents], ['Comissões após descontos', report.totals.netCommissionCents], ['PIX pagos aos atendentes', report.totals.paidPayoutNetCents], ['Lucro BRAVUS', report.totals.businessProfitCents] ] as const : [];
  return <section className="panel admin-report" aria-busy={busy}>
    <div className="admin-heading"><div><h2>Fechamento financeiro</h2><p>Confira o resultado do período e exporte a planilha.</p></div><button className="button secondary" disabled={busy || !report || start !== filter.start || end !== filter.end || attendant !== filter.attendant} onClick={() => void download()}><Download size={14} />Exportar CSV</button></div>
    <form className="admin-form controls-filter" onSubmit={event => { event.preventDefault(); setFilter({ start, end, attendant, refresh: filter.refresh + 1 }); }}><div className="form-grid">
      <label>Início do período<input type="date" required value={start} max={end} onChange={event => setStart(event.target.value)} /></label>
      <label>Fim do período<input type="date" required value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} /></label>
      <label>Atendente do relatório<select value={attendant} onChange={event => setAttendant(event.target.value)}><option value="">Todos os atendentes</option>{attendants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div><button className="button primary" disabled={busy}><RefreshCw size={14} />Consultar fechamento</button></form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {report && <><p className="section-description">Vendas aprovadas pela data da venda, ADS pelo dia lançado e repasses pela data de pagamento em Brasília. {report.totals.pendingCount} venda(s) em análise e {report.totals.rejectedCount} recusada(s) ou cancelada(s) ficam fora dos valores.</p>
      <div className="financial-metrics">{metrics.map(([label, amount]) => <div key={label} className={label === 'Lucro BRAVUS' ? 'profit' : ''}><span>{label}</span><strong>{money(amount)}</strong></div>)}</div>
      <div className="financial-explanation"><p>O lucro considera a comissão uma única vez e desconta a parte da BRAVUS nas taxas de saque. ADS e ajustes são despesas descontadas integralmente do atendente.</p><p><strong>Movimentação de caixa: {money(report.totals.cashMovementCents)}.</strong> Faturamento menos taxas, ADS, ajustes e pagamentos realizados no período. Esse valor pode diferir do lucro porque parte das comissões ainda aguarda repasse. Repasses pagos neste período podem corresponder a vendas de dias anteriores.</p></div>
      <div className="table-scroll"><table className="financial-table"><caption>Resultado por atendente</caption><thead><tr><th>Atendente</th><th>Vendas aprovadas</th><th>Faturamento</th><th>Taxas das vendas</th><th>ADS</th><th>Comissões após descontos</th><th>PIX pagos</th><th>Lucro BRAVUS</th></tr></thead><tbody>{report.attendants.map(row => <tr key={row.attendantId}><td>{row.attendantName}</td><td>{row.count}</td><td>{money(row.grossCents)}</td><td>{money(row.gatewayFeeCents)}</td><td>{money(row.adsCents)}</td><td>{money(row.netCommissionCents)}</td><td>{money(row.paidPayoutNetCents)}</td><td>{money(row.businessProfitCents)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{report.totals.count}</td>{(['grossCents', 'gatewayFeeCents', 'adsCents', 'netCommissionCents', 'paidPayoutNetCents', 'businessProfitCents'] as const).map(key => <td key={key}>{money(report.totals[key])}</td>)}</tr></tfoot></table></div>
      <dl className="financial-breakdown"><div><dt>Ajustes adicionais</dt><dd>{money(report.totals.adjustmentsCents)}</dd></div><div><dt>Comissões antes de ADS, ajustes e saque</dt><dd>{money(report.totals.commissionCents)}</dd></div><div><dt>Taxa total de saques pagos</dt><dd>{money(report.totals.withdrawalGatewayFeeCents)}</dd></div><div><dt>Parte do atendente nos saques</dt><dd>{money(report.totals.attendantWithdrawalFeeCents)}</dd></div><div><dt>Parte da BRAVUS nos saques</dt><dd>{money(report.totals.businessWithdrawalFeeCents)}</dd></div></dl>
    </>}
  </section>;
}
