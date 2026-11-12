import PartnerAdsNotice from './PartnerAdsNotice.tsx';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, Megaphone, RefreshCw, Save, TrendingUp } from 'lucide-react';
import { businessToday, dateLabel, money, periodLabels } from './domain.ts';
import type { MarketingReport, Period } from './domain.ts';
import type { PortalClient } from './client.ts';
import './partner-ads.css';

export default function PartnerAds({ client, report, period, disabled, refresh, notify }: { client: PortalClient; report?: MarketingReport; period: Period; disabled: boolean; refresh: () => Promise<void>; notify: (notice: { text: string }) => void }) {
  const [date, setDate] = useState(businessToday), [ads, setAds] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [reload, setReload] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setReady(false); setError('');
    if (!date) { setLoading(false); return; }
    client.partnerAds(date).then(cost => { if (!cancelled) { setAds((cost.adsCents / 100).toFixed(2)); setReady(true); } })
      .catch(cause => { if (!cancelled) setError((cause as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, date, reload]);
  const roi = report?.roiPercent == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(report.roiPercent) + '%';
  return <section className="panel partner-ads-panel" aria-labelledby="partner-ads-title">
    <div className="partner-ads-heading"><div className="section-title"><Megaphone size={18} /><h2 id="partner-ads-title">MEUS CUSTOS DE ADS E ROI</h2></div><button className="button secondary" disabled={disabled || saving || loading} onClick={() => { setReload(value => value + 1); void refresh(); }}><RefreshCw size={14} />Atualizar ADS e ROI</button></div>
    <PartnerAdsNotice />
    <p className="section-description">Informe o total que você pagou em anúncios por dia. Esses custos entram somente no seu lucro e ROI, sem desconto no saldo de repasse.</p>
    {report && <><div className="partner-roi-heading"><TrendingUp size={16} /><h3>Resultado · {periodLabels[period]}</h3></div>
      <div className="financial-grid partner-roi-grid">
        <article className="metric" aria-label="Seu valor nas vendas no ROI"><h3>SEU VALOR NAS VENDAS</h3><strong>{money(report.earningsCents)}</strong><small>Somente vendas aprovadas</small></article>
        <article className="metric" aria-label="Investimento em ADS no ROI"><h3>INVESTIMENTO EM ADS</h3><strong>{money(report.totalAdsCents)}</strong><small>Seus anúncios e ADS da administração</small></article>
        <article className={`metric ${report.profitCents < 0 ? 'negative' : ''}`} aria-label="Resultado após ADS"><h3>RESULTADO APÓS ADS</h3><strong>{money(report.profitCents)}</strong><small>Indicador financeiro · Não altera o repasse</small></article>
        <article className={`metric partner-roi ${report.roiPercent != null && report.roiPercent < 0 ? 'negative' : ''}`} aria-label="ROI do parceiro"><h3>ROI</h3><strong>{roi}</strong><small>{report.roiPercent == null ? 'Informe um custo de ADS para calcular' : 'Retorno sobre o investimento em ADS'}</small></article>
      </div>
      <p className="payout-help">ADS pagos por você: <strong>{money(report.ownAdsCents)}</strong> · ADS registrados pela administração (apenas controle): <strong>{money(report.chargedAdsCents)}</strong>.</p>
      <p className="partner-roi-rule">ROI = (seu valor nas vendas aprovadas − ADS do período) ÷ ADS do período × 100. Vendas em análise, vendas canceladas, ajustes e repasses não entram neste cálculo.</p>
    </>}
    <form className="partner-ads-form" onSubmit={async event => {
      event.preventDefault(); if (!ready || submitting.current || disabled) return;
      submitting.current = true; setSaving(true); setError('');
      try { const result = await client.savePartnerAds(date, ads); setAds((result.adsCents / 100).toFixed(2)); notify({ text: 'Custo de ADS salvo. O saldo de repasse foi preservado.' }); await refresh(); }
      catch (cause) { setError((cause as Error).message); }
      finally { submitting.current = false; setSaving(false); }
    }}><h3>Lançar ou editar meu ADS do dia</h3><fieldset disabled={saving || disabled}>
      <div className="partner-ads-fields"><label>Data do ADS<input type="date" required value={date} max={businessToday()} onChange={event => setDate(event.target.value)} /></label>
        <label>Meu custo de ADS (R$)<input required inputMode="decimal" maxLength={16} disabled={!ready || loading} value={ads} onChange={event => setAds(event.target.value)} /></label></div>
      <p className="payout-help">Salvar substitui somente o total que você informou para essa data. Para zerar o seu custo do dia, informe 0. Os custos lançados pela administração são mantidos.</p>
      <button className="button primary" disabled={!ready || loading}>{saving || loading ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saving ? 'Salvando ADS...' : loading ? 'Carregando ADS...' : 'Salvar meu ADS'}</button>
    </fieldset></form>
    {error && <div className="form-error" role="alert"><AlertCircle size={15} />{error}<button type="button" className="button secondary" disabled={loading || saving} onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
    {report && <div className="partner-ads-history"><h3>Meus custos no período</h3>{report.history.length ? <div className="table-scroll"><table><thead><tr><th>Data</th><th>ADS pago por você</th><th>Ação</th></tr></thead><tbody>{report.history.map(cost => <tr key={cost.date}><td>{dateLabel(cost.date)}</td><td>{money(cost.adsCents)}</td><td><button className="button secondary" disabled={saving || disabled} onClick={() => { setDate(cost.date); setReload(value => value + 1); }}>Editar ADS</button></td></tr>)}</tbody></table></div> : <p className="section-description">Nenhum custo próprio de ADS neste período.</p>}<p className="history-caption">Últimos 100 dias com custos próprios no período. Os totais e o ROI consideram todos os registros.</p></div>}
  </section>;
}
