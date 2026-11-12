import { useEffect, useState } from 'react';
import { CalendarDays, Crown, LoaderCircle, RefreshCw, Trophy } from 'lucide-react';
import { dateLabel, money } from './domain.ts';
import type { RankingEntry } from './domain.ts';
import type { PortalClient } from './client.ts';
import { ProfileAvatar } from './Profile.tsx';
import { rankingPresets, rankingRange } from './ranking-domain.ts';
import type { RankingPeriod } from './ranking-domain.ts';
import './ranking.css';

type Filter = { period: RankingPeriod; start?: string; end?: string };
const medals = ['🥇', '🥈', '🥉'];
function PodiumPerson({ entry, place }: { entry: RankingEntry; place: number }) {
  return <article className={`ranking-entry podium-entry place-${place}${entry.mine ? ' mine' : ''}`} data-place={place} aria-label={`${place}º lugar: ${entry.name}`}>
    <div className="podium-person">
      <div className="podium-photo"><span className="podium-medal" aria-hidden="true">{medals[place - 1]}</span><ProfileAvatar name={entry.name} photoUrl={entry.photoUrl} className="podium-avatar" /><span className="podium-position">{place === 1 ? <><Crown size={14} aria-hidden="true" />#1 CAMPEÃO</> : `#${place}`}</span></div>
      <h3>{entry.name}<span className="podium-rank-dot" aria-hidden="true" /></h3>
      <div className="podium-you-slot">{entry.mine && <span className="you-badge">Você</span>}</div>
      <strong className="podium-revenue">{money(entry.grossCents)}</strong>
      <p className="podium-sales">{entry.count} {entry.count === 1 ? 'venda' : 'vendas'}</p>
    </div>
    <div className="podium-step" aria-hidden="true"><span>{place}</span></div>
  </article>;
}

export default function Ranking({ client, today, refreshKey }: { client: PortalClient; today: string; refreshKey?: unknown }) {
  const initial = rankingRange('last30', today)!;
  const [filter, setFilter] = useState<Filter>({ period: 'last30' }), [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState(initial.start), [end, setEnd] = useState(today), [formError, setFormError] = useState('');
  const [entries, setEntries] = useState<RankingEntry[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    client.ranking(filter.period, filter.start, filter.end).then(value => { if (!cancelled) setEntries(value); })
      .catch(cause => { if (!cancelled) { setError((cause as Error).message); setEntries([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, filter, retry, refreshKey, today]);
  const title = rankingPresets.find(item => item.id === filter.period)?.title ?? 'Personalizado';
  const range = rankingRange(filter.period, today, filter.start, filter.end);
  return <section className="panel ranking-panel podium-panel" aria-labelledby="ranking-title" aria-busy={loading}>
    <header className="podium-heading"><div><h2 id="ranking-title"><Trophy aria-hidden="true" /><span>Pódio e Ranking de Desempenho ({title})</span></h2><p>Disputa de faturamento consolidado e fechamento de vendas da equipe</p></div><button className="icon-button" type="button" aria-label="Atualizar ranking" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></header>
    <div className="ranking-periods" role="group" aria-label="Período do ranking">{rankingPresets.map(item => <button key={item.id} type="button" aria-pressed={!customOpen && filter.period === item.id} onClick={() => { setFilter({ period: item.id }); setCustomOpen(false); setFormError(''); }}>{item.label}</button>)}<button type="button" aria-pressed={customOpen || filter.period === 'custom'} aria-expanded={customOpen} aria-controls="ranking-calendar" onClick={() => { setCustomOpen(value => !value); setFormError(''); }}><CalendarDays size={14} />Personalizar</button></div>
    {customOpen && <form id="ranking-calendar" className="ranking-calendar" onSubmit={event => {
      event.preventDefault();
      try { rankingRange('custom', today, start, end); setFilter({ period: 'custom', start, end }); setFormError(''); }
      catch (cause) { setFormError((cause as Error).message); }
    }}><label>Data inicial do ranking<input type="date" value={start} max={end || today} required onChange={event => setStart(event.target.value)} /></label><label>Data final do ranking<input type="date" value={end} min={start} max={today} required onChange={event => setEnd(event.target.value)} /></label><button className="button primary" type="submit">Aplicar período</button>{formError && <p className="form-error" role="alert">{formError}</p>}</form>}
    {range && <p className="ranking-date-range">{dateLabel(range.start)} a {dateLabel(range.end)}<span>Somente vendas aprovadas</span></p>}
    {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={22} />Carregando ranking...</div> : error ? <div className="ranking-error" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div> : entries.length ? <>
      <div className="ranking-podium" aria-label="Pódio dos três primeiros colocados">{entries.slice(0, 3).map((entry, index) => <PodiumPerson key={entry.id} entry={entry} place={index + 1} />)}</div>
      {entries.length > 3 && <div className="ranking-rest"><h3>Demais posições</h3><ol className="ranking-list" start={4}>{entries.slice(3).map((entry, index) => <li className={`ranking-entry ranking-row${entry.mine ? ' mine' : ''}`} key={entry.id}><span className="rank-position">{index + 4}</span><ProfileAvatar name={entry.name} photoUrl={entry.photoUrl} className="ranking-avatar" /><div><strong>{entry.name}{entry.mine && <span className="you-badge">Você</span>}</strong><small>{entry.count} {entry.count === 1 ? 'venda' : 'vendas'}</small></div><strong>{money(entry.grossCents)}</strong></li>)}</ol></div>}
    </> : <div className="empty"><Trophy size={30} /><h3>A primeira posição espera por você</h3><p>O pódio aparece quando houver vendas aprovadas neste período.</p></div>}
  </section>;
}
