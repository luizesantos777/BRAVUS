import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { auditActions } from './admin-domain.ts';
import type { AuditPage } from './admin-domain.ts';
import { businessToday, money } from './domain.ts';
import type { AdminClient } from './admin-client.ts';

const labels: Record<string, string> = { status: 'Situação', note: 'Observação', date: 'Data', commissionCents: 'Comissão', reviewedAt: 'Data da análise anterior', cancelledAt: 'Data do cancelamento', adsCents: 'ADS', withdrawalFeeCents: 'Taxas do atendente', gatewayFeeCents: 'Taxa total do gateway', name: 'Nome', commissionBps: 'Comissão', active: 'Acesso', renewed: 'Token renovado', count: 'Vendas', amountCents: 'Valor', feeBps: 'Taxa variável', fixedFeeCents: 'Taxa fixa', minAmountCents: 'Venda mínima', aboveAmountCents: 'Limite da primeira faixa', aboveFeeBps: 'Taxa da faixa superior', aboveFixedFeeCents: 'Taxa fixa da faixa superior' };
function display(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if ((key === 'reviewedAt' || key === 'cancelledAt') && typeof value === 'string' && Number.isFinite(new Date(value).getTime())) return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
  if (typeof value === 'boolean') return key === 'active' ? value ? 'Ativo' : 'Revogado' : value ? 'Sim' : 'Não';
  if (typeof value === 'number') return key.endsWith('Cents') ? money(value) : key.endsWith('Bps') ? `${value / 100}%` : String(value);
  return ({ approved: 'Aprovada', pending: 'Em análise', rejected: 'Recusada', paid: 'Pago', cancelled: 'Cancelado' } as Record<string, string>)[String(value)] ?? String(value);
}
export default function AdminHistory({ client }: { client: AdminClient }) {
  const today = businessToday(), [start, setStart] = useState(today.slice(0, 8) + '01'), [end, setEnd] = useState(today), [action, setAction] = useState('');
  const [filter, setFilter] = useState({ start, end, action, page: 1, refresh: 0 }), [data, setData] = useState<AuditPage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (client.isDemo) return;
    let cancelled = false; setBusy(true); setError('');
    client.audit(filter.start, filter.end, filter.action, filter.page).then(value => { if (!cancelled) setData(value); }).catch(cause => { if (!cancelled) { setError((cause as Error).message); setData(null); } }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [client, filter]);
  return <section className="panel" aria-busy={busy}><h2>Histórico de alterações</h2><p className="section-description">Confira quem realizou cada ação e os valores antes e depois. O registro começa na ativação deste recurso; ações antigas não são reconstruídas.</p>
    {client.isDemo ? <p className="admin-message">O histórico de alterações fica disponível no painel conectado aos dados reais.</p> : <>
      <form className="admin-form controls-filter" onSubmit={event => { event.preventDefault(); setFilter({ start, end, action, page: 1, refresh: filter.refresh + 1 }); }}><div className="form-grid">
        <label>Início do histórico<input type="date" required value={start} max={end} onChange={event => setStart(event.target.value)} /></label><label>Fim do histórico<input type="date" required value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} /></label>
        <label>Tipo de alteração<select value={action} onChange={event => setAction(event.target.value)}><option value="">Todas as ações</option>{Object.entries(auditActions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div><button className="button secondary" disabled={busy}><RefreshCw size={14} />Consultar histórico</button></form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && <><p className="history-caption">{data.total} registro(s) encontrado(s).</p><div className="audit-list">{data.entries.map(entry => <article key={entry.id} className="audit-entry"><div className="audit-heading"><strong>{auditActions[entry.action]}</strong><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(entry.createdAt))}</time></div><p>{entry.targetName} · Responsável: {entry.actorName}</p><details><summary>Ver alterações</summary><dl>{[...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])].filter(key => entry.before?.[key] !== entry.after?.[key]).map(key => <div key={key}><dt>{labels[key] ?? key}</dt><dd><span>{display(key, entry.before?.[key])}</span><span aria-label="alterado para">→</span><strong>{key === 'status' && entry.action === 'sale.cancelled' ? 'Cancelada' : display(key, entry.after?.[key])}</strong></dd></div>)}</dl></details></article>)}</div>{!data.entries.length && <p className="section-description">Nenhuma alteração neste período.</p>}<div className="controls-pagination"><button className="button secondary" disabled={busy || data.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>Página anterior</button><span>Página {data.page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button className="button secondary" disabled={busy || data.page * data.pageSize >= data.total} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>Próxima página</button></div></>}
    </>}
  </section>;
}
