import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, Clock3, Copy, DollarSign, FileImage, History, Info, KeyRound, LoaderCircle, LockKeyhole, Plus, RefreshCw, Save, ShieldCheck, Trash2, Trophy, UserRound, Wallet, X } from 'lucide-react';
import { amountToCents, businessTime, businessToday, dateLabel, demoInitial, demoPortal, money, periodLabels, pixLabels } from './domain.ts';
import type { Period, Portal, Profile, RankingEntry, SaleInput } from './domain.ts';
import { ApiError, currentToken, PortalClient, readReceipt } from './client.ts';
import { Brand, BrandIntro } from './Brand.tsx';

type Tab = 'sales' | 'ranking' | 'payouts' | 'profile';
type Notice = { text: string; error?: boolean };
type SaleRow = SaleInput & { id: string };
const blankRow = (): SaleRow => ({ id: crypto.randomUUID(), amount: '', checkoutId: '', time: businessTime(), note: '', receipt: null });
const tabs = [{ id: 'sales', label: 'Lançar Vendas', icon: Plus }, { id: 'ranking', label: 'Ranking', icon: Trophy }, { id: 'payouts', label: 'Repasses', icon: History }, { id: 'profile', label: 'Meus Dados e PIX', icon: UserRound }] as const;

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><header><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Fechar janela" onClick={close}><X size={19} /></button></header>{children}</dialog>;
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>{children}</p></div>; }
function SalesForm({ client, portal, disabled, refresh, notify, preview }: { client: PortalClient; portal: Portal; disabled: boolean; refresh: () => Promise<void>; notify: (notice: Notice) => void; preview: (url: string) => void }) {
  const [rows, setRows] = useState<SaleRow[]>([blankRow()]);
  const [date, setDate] = useState(businessToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const update = (id: string, patch: Partial<SaleRow>) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row));
  async function attach(id: string, file?: File) {
    if (!file) return;
    try { update(id, { receipt: await readReceipt(file) }); setError(''); }
    catch (cause) { setError((cause as Error).message); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled) return; setError('');
    try {
      for (const [index, row] of rows.entries()) {
        amountToCents(row.amount);
        if (!row.checkoutId || !row.receipt) throw new Error(`Venda ${index + 1}: selecione o checkout e anexe o print obrigatório.`);
      }
      const payload = { date, sales: rows.map(({ id: _id, ...row }) => row) };
      if (new Blob([JSON.stringify(payload)]).size > 12 * 1024 * 1024) throw new Error('O envio excede 12 MB. Envie menos vendas por vez.');
      setBusy(true); await client.saveSales(payload, key.current);
      const count = rows.length; setRows([blankRow()]); key.current = crypto.randomUUID();
      notify({ text: client.isDemo ? `${count} venda(s) salva(s) na demonstração. Nenhum lançamento real foi enviado.` : `${count} venda(s) enviada(s) com sucesso.` });
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel sales-panel"><div className="section-title"><Plus size={17} /><h2>LANÇAMENTO DE VENDAS MANUAIS</h2></div>
    <div className="mandatory"><AlertCircle size={15} /><p><strong>Obrigatório:</strong> Todos os lançamentos de vendas manuais são mandatórios. Suba todas as suas vendas no final do dia ou cadastre cada venda individualmente assim que ocorrer.</p></div>
    <form onSubmit={submit}><fieldset disabled={busy || disabled}>
      <label className="field-label date-label" htmlFor="sale-date">Data da Venda <span aria-hidden="true">*</span></label><input className="date-input" type="date" id="sale-date" value={date} max={businessToday()} required onChange={event => setDate(event.target.value)} />
      <p className="field-label sales-count">Vendas a Lançar ({rows.length})</p>
      <div className="sale-rows">{rows.map((row, index) => <div className="sale-row" key={row.id}>
        <span className="row-number">#{index + 1}</span>
        <div className="amount-input"><span>R$</span><input aria-label={`Valor bruto venda ${index + 1}`} placeholder="Valor Bruto (Ex: 197,00)" inputMode="decimal" required maxLength={16} value={row.amount} onChange={event => update(row.id, { amount: event.target.value })} /></div>
        <div className="select-wrap"><select aria-label={`Checkout venda ${index + 1}`} required value={row.checkoutId} onChange={event => update(row.id, { checkoutId: event.target.value })}><option value="" disabled>Checkout *</option>{portal.checkouts.map(checkout => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}</select><ChevronDown size={13} /></div>
        <input type="time" aria-label={`Horário venda ${index + 1}`} required value={row.time} onChange={event => update(row.id, { time: event.target.value })} />
        <button type="button" className={`attach-button ${row.receipt ? 'attached' : ''}`} aria-label={`Anexar print venda ${index + 1}`} onClick={() => document.getElementById(`receipt-${row.id}`)?.click()}><Camera size={14} />{row.receipt ? 'Print anexado' : 'Anexar Print *'}</button>
        <input className="sr-only" tabIndex={-1} id={`receipt-${row.id}`} type="file" aria-label={`Print da venda ${index + 1}`} accept="image/png,image/jpeg,image/webp" onChange={event => { void attach(row.id, event.target.files?.[0]); event.target.value = ''; }} />
        <button className="icon-button delete-row" type="button" aria-label={`Remover venda ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}><Trash2 size={16} /></button>
        <input className="observation" aria-label={`Observação venda ${index + 1}`} placeholder="Observação (Ex: Cliente pagou via PIX manual após falha no checkout)..." maxLength={500} value={row.note} onChange={event => update(row.id, { note: event.target.value })} />
        {row.receipt && <div className="attachment-detail"><FileImage size={12} /><button type="button" onClick={() => preview(`data:${row.receipt!.mime};base64,${row.receipt!.base64}`)}>{row.receipt.name}</button><button className="remove-attachment" type="button" aria-label={`Remover print venda ${index + 1}`} onClick={() => update(row.id, { receipt: null })}><X size={12} /></button></div>}
      </div>)}</div>
      {error && <div role="alert" className="form-error"><AlertCircle size={14} />{error}</div>}
      <div className="sales-actions"><button type="button" className="button secondary" disabled={rows.length >= 10} onClick={() => setRows(previous => [...previous, blankRow()])}><Plus size={15} />Adicionar Outra Venda</button><button type="submit" className="button primary">{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{busy ? 'Enviando vendas...' : 'Salvar e Enviar Vendas'}</button></div>
      <p className="form-caption">Até 10 vendas por envio · Prints em PNG, JPG ou WEBP de até 2 MB.</p>
    </fieldset></form>
  </section>;
}
function ProfileForm({ profile, client, disabled, refresh, notify }: { profile: Profile; client: PortalClient; disabled: boolean; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [pixType, setPixType] = useState(profile.pixType), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || busy) return; const fields = Object.fromEntries(new FormData(event.currentTarget)); setError(''); setBusy(true);
    try { await client.saveProfile(fields); notify({ text: client.isDemo ? 'Dados salvos na demonstração.' : 'Seus dados e PIX foram atualizados.' }); await refresh(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel profile-panel"><div className="section-title"><UserRound size={17} /><h2>MEUS DADOS E PIX</h2></div><p className="section-description">Mantenha seus dados atualizados para receber seus repasses.</p>
    <form onSubmit={submit}><fieldset disabled={disabled || busy}><div className="form-grid">
      <label>Nome completo <span aria-hidden="true">*</span><input name="name" required maxLength={120} defaultValue={profile.name} autoComplete="name" /></label>
      <label>E-mail<input name="email" type="email" maxLength={160} defaultValue={profile.email} autoComplete="email" placeholder="seu@email.com" /></label>
      <label>Telefone<input name="phone" type="tel" maxLength={40} defaultValue={profile.phone} autoComplete="tel" placeholder="(11) 99999-9999" /></label>
      <label>Tipo de chave PIX<div className="select-wrap"><select name="pixType" value={pixType} onChange={event => setPixType(event.target.value as Profile['pixType'])}>{Object.entries(pixLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><ChevronDown size={14} /></div></label>
      <label>Chave PIX<input name="pixKey" maxLength={180} defaultValue={profile.pixKey} required={!!pixType} placeholder="Informe sua chave PIX" autoComplete="off" /></label>
      <label>Nome do titular da chave<input name="pixOwner" maxLength={120} defaultValue={profile.pixOwner} required={!!pixType} placeholder="Como consta na conta" autoComplete="off" /></label>
    </div><div className="profile-rules"><ShieldCheck size={16} /><span>Comissão configurada: <strong>{profile.commissionBps / 100}%</strong> · Meta diária: <strong>{money(profile.dailyGoalCents)}</strong></span></div>
    {error && <div role="alert" className="form-error"><AlertCircle size={14} />{error}</div>}
    <div className="sales-actions profile-actions"><span><LockKeyhole size={13} />Dados vinculados ao seu acesso individual.</span><button className="button primary" type="submit">{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}Salvar Meus Dados</button></div></fieldset></form>
  </section>;
}
function AccessDialog({ close }: { close: () => void }) {
  const [token, setToken] = useState(''), [error, setError] = useState('');
  return <Dialog title="Acessar meu portal" close={close}><p className="dialog-description">Cole o token individual enviado pela administração. Não compartilhe esse acesso.</p><form onSubmit={event => { event.preventDefault(); if (!/^[A-Za-z0-9_-]{12,160}$/.test(token.trim())) { setError('Confira o token recebido e tente novamente.'); return; } window.location.hash = `/atendente/${token.trim()}`; close(); }}><label className="dialog-label" htmlFor="access-token">Seu token de acesso</label><input id="access-token" autoFocus type="password" autoComplete="off" value={token} maxLength={160} onChange={event => setToken(event.target.value)} required placeholder="Cole seu token individual" />{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button type="submit" className="button primary"><KeyRound size={15} />Acessar portal</button></div></form></Dialog>;
}
function PayoutDialog({ client, portal, close, refresh, notify }: { client: PortalClient; portal: Portal; close: () => void; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [amount, setAmount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog title="Solicitar repasse" close={close}><p className="dialog-description">Disponível: <strong>{money(portal.finance.availableCents)}</strong>. A solicitação será enviada para análise e pagamento pela administração.</p><form onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await client.requestPayout(amount); notify({ text: client.isDemo ? 'Solicitação de demonstração registrada. Nenhum PIX foi enviado.' : 'Solicitação de repasse registrada. Aguarde o pagamento da administração.' }); close(); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }}><label className="dialog-label" htmlFor="payout-amount">Valor do repasse (R$)</label><input id="payout-amount" autoFocus inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required placeholder="Ex.: 50,00" /><div className="pix-destination"><ShieldCheck size={16} /><div><strong>{portal.profile.pixOwner}</strong><span>{pixLabels[portal.profile.pixType]}: {portal.profile.pixKey}</span></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}Confirmar solicitação</button></div></form></Dialog>;
}

export default function App() {
  const [client, setClient] = useState(() => new PortalClient(currentToken()));
  const [portal, setPortal] = useState<Portal | null>(null), [period, setPeriod] = useState<Period>('today'), [tab, setTab] = useState<Tab>('sales');
  const [loading, setLoading] = useState(true), [error, setError] = useState<{ text: string; status: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null), [ranking, setRanking] = useState<RankingEntry[]>([]), [rankingLoading, setRankingLoading] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false), [payoutOpen, setPayoutOpen] = useState(false), [receiptUrl, setReceiptUrl] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { const update = () => { setClient(new PortalClient(currentToken())); setPortal(null); setTab('sales'); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { let cancelled = false; setLoading(true); setError(null); client.portal(period).then(value => { if (!cancelled) setPortal(value); }).catch(cause => { if (!cancelled) setError({ text: (cause as Error).message, status: cause instanceof ApiError ? cause.status : 0 }); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [client, period]);
  useEffect(() => { if (tab !== 'ranking' || error) return; let cancelled = false; setRankingLoading(true); client.ranking(period).then(value => { if (!cancelled) setRanking(value); }).catch(cause => { if (!cancelled) setNotice({ text: (cause as Error).message, error: true }); }).finally(() => { if (!cancelled) setRankingLoading(false); }); return () => { cancelled = true; }; }, [client, period, tab, portal, error]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 8000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => () => { if (receiptUrl.startsWith('blob:')) URL.revokeObjectURL(receiptUrl); }, [receiptUrl]);
  async function refresh() { setLoading(true); try { setPortal(await client.portal(period)); setError(null); } catch (cause) { setError({ text: (cause as Error).message, status: cause instanceof ApiError ? cause.status : 0 }); } finally { setLoading(false); } }
  function openDemo() { const pathname = window.location.pathname.replace(/\/atendente\/[^/]+\/?$/, '/'); window.history.replaceState(null, '', pathname); setClient(new PortalClient('')); setPortal(null); }
  async function viewReceipt(id: string) { try { setReceiptUrl(await client.receipt(id)); } catch (cause) { setNotice({ text: (cause as Error).message, error: true }); } }
  const display = portal ?? demoPortal(demoInitial(), period), canInteract = !loading && !error && !!portal;
  const profile = display.profile, finance = display.finance, goal = profile.dailyGoalCents, progress = Math.min(100, Math.round(display.todayGrossCents / goal * 100)), goalReached = display.todayGrossCents >= goal;
  return <div className="portal-shell"><a className="skip-link" href="#portal-main" onClick={event => { event.preventDefault(); document.getElementById('portal-main')?.focus(); }}>Pular para o conteúdo</a>
    <header className="portal-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('sales'); }} aria-label="BRAVUS início"><Brand /></a><div className="header-access"><span className={`access-status ${client.isDemo ? 'demo' : ''}`}><ShieldCheck size={12} />{client.isDemo ? 'Demonstração' : 'Acesso individual'}</span><span className="attendant-name">{portal?.profile.name ?? 'Seu portal'}</span><button className="avatar" aria-label="Abrir meus dados" onClick={() => setTab('profile')}><UserRound size={17} /></button></div></header>
    <main id="portal-main" tabIndex={-1}>
      <BrandIntro />
      {client.isDemo && <div className="demo-banner"><Info size={15} /><p><strong>Você está na demonstração.</strong> Os dados são de exemplo e nenhum lançamento real será enviado.</p><button onClick={() => setAccessOpen(true)}>Tenho meu token <ArrowRight size={13} /></button></div>}
      <section className={`panel daily-goal ${goalReached ? 'reached' : ''}`} aria-label="Meta diária"><div className="goal-heading"><h2>Meta Diária para salvar vendas</h2><span>{money(display.todayGrossCents)} / {money(goal)}</span></div><div className="goal-track" role="progressbar" aria-label="Progresso da meta diária" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ width: `${progress}%` }} /></div><p>{goalReached ? 'Meta diária atingida! As comissões de hoje já podem entrar no seu saldo.' : `Abaixo de ${money(goal)} as vendas não entram no cofre — mas os custos do dia viram dívida pendente.`}</p></section>
      {error && <div className="auth-error" role="alert"><AlertCircle size={15} /><span>{error.text}</span><button onClick={() => error.status === 401 ? setAccessOpen(true) : void refresh()}>{error.status === 401 ? 'Conferir token' : 'Tentar novamente'}</button>{!client.isDemo && <button className="demo-return" onClick={openDemo}>Ver demonstração</button>}</div>}
      <section className="panel financial-panel" aria-busy={loading}><div className="financial-heading"><div className="section-title"><DollarSign size={18} /><h2>EXTRATO FINANCEIRO &amp; COMISSÕES</h2></div><div className="period-picker"><CalendarDays size={15} /><select aria-label="Período do extrato" value={period} onChange={event => setPeriod(event.target.value as Period)}>{Object.entries(periodLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><ChevronDown size={13} /></div></div>
        <div className="financial-grid"><article className="metric"><h3>FATURAMENTO<br />CONSOLIDADO</h3><strong>{money(finance.grossCents)}</strong><small>{finance.count} {finance.count === 1 ? 'venda' : 'vendas'}</small></article><article className="metric"><h3>TAXAS + SAQUES</h3><strong>- {money(finance.feeCents)}</strong><small>Repasse: gateway + saque diário</small></article><article className="metric"><h3>CUSTO ADS ( <span className="status-dot" /> )</h3><strong>- {money(finance.adsCents)}</strong><small>Repasse por gasto</small></article><article className={`metric balance ${finance.availableCents < 0 ? 'negative' : ''}`}><h3>SALDO ACUMULADO ATUAL</h3><strong>{money(finance.availableCents)}</strong><small>Disponível para repasse</small></article></div>
        {portal && (finance.pendingGoalCents > 0 || finance.pendingPayoutCents > 0 || finance.debtCents > 0) && <div className="finance-details">{finance.pendingGoalCents > 0 && <span><Clock3 size={12} />Comissões aguardando meta: {money(finance.pendingGoalCents)}</span>}{finance.pendingPayoutCents > 0 && <span><History size={12} />Repasses em análise: {money(finance.pendingPayoutCents)}</span>}{finance.debtCents > 0 && <span className="debt-text">Custos pendentes no período: {money(finance.debtCents)}</span>}</div>}
      </section>
      <nav className="portal-tabs" role="tablist" aria-label="Portal do atendente" onKeyDown={event => { const index = tabs.findIndex(item => item.id === tab); const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1; if (next >= 0) { event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus(); } }}>{tabs.map((item, index) => <button ref={element => { tabRefs.current[index] = element; }} key={item.id} type="button" id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={15} /><span>{item.label}{item.id === 'payouts' ? ` (${display.payouts.length})` : ''}</span></button>)}</nav>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'sales' && <><SalesForm key={client.token || 'demo'} client={client} portal={display} disabled={!canInteract} refresh={refresh} notify={setNotice} preview={setReceiptUrl} /><section className="panel history-panel"><div className="section-title"><History size={17} /><h2>VENDAS LANÇADAS</h2><span className="item-count">{display.sales.length}</span><button className="icon-button refresh-button" aria-label="Atualizar vendas" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>{display.sales.length ? <div className="table-scroll"><table><thead><tr><th>Data / Horário</th><th>Checkout</th><th>Valor bruto</th><th>Observação</th><th>Comprovante</th></tr></thead><tbody>{display.sales.map(sale => <tr key={sale.id}><td>{dateLabel(sale.date)}<small>{sale.time}</small></td><td>{sale.checkoutName}</td><td className="money-cell">{money(sale.amountCents)}</td><td className="note-cell">{sale.note || '—'}</td><td><button className="receipt-link" onClick={() => void viewReceipt(sale.receiptId)} aria-label={`Ver print da venda de ${money(sale.amountCents)}`}><FileImage size={14} />Ver print</button></td></tr>)}</tbody></table></div> : <Empty icon={<History size={24} />} title="Nenhuma venda neste período">Seus lançamentos aparecerão aqui depois do envio.</Empty>}<p className="history-caption">Exibindo até 100 vendas do período selecionado.</p></section></>}
        {tab === 'ranking' && <section className="panel ranking-panel"><div className="section-title"><Trophy size={17} /><h2>RANKING DE VENDAS</h2><span className="period-caption">{periodLabels[period]}</span></div><p className="section-description">Acompanhe os resultados e conquiste sua próxima posição.</p>{rankingLoading ? <div className="loading-state"><LoaderCircle size={22} className="spin" />Carregando ranking...</div> : ranking.length ? <div className="ranking-list">{ranking.map((entry, index) => <article className={`ranking-row ${entry.mine ? 'mine' : ''}`} key={entry.id}><span className={`rank-position position-${index + 1}`}>{index < 3 ? <Trophy size={18} /> : index + 1}</span><div><strong>{entry.name}{entry.mine && <span className="you-badge">Você</span>}</strong><small>{entry.count} {entry.count === 1 ? 'venda registrada' : 'vendas registradas'}</small></div><strong>{money(entry.grossCents)}</strong></article>)}</div> : <Empty icon={<Trophy size={26} />} title="A primeira posição espera por você">O ranking aparece quando houver vendas no período selecionado.</Empty>}</section>}
        {tab === 'payouts' && <section className="panel payouts-panel"><div className="section-title"><History size={17} /><h2>MEUS REPASSES</h2></div><div className="payout-summary"><div><span>Saldo disponível</span><strong>{money(finance.availableCents)}</strong></div><div><span>Em análise</span><strong>{money(finance.pendingPayoutCents)}</strong></div><div><span>Total pago</span><strong>{money(finance.paidPayoutCents)}</strong></div><button className="button primary" disabled={!canInteract || finance.availableCents <= 0 || !profile.pixKey} onClick={() => setPayoutOpen(true)}><ArrowDownToLine size={15} />Solicitar Repasse</button></div>{!profile.pixKey && <div className="pix-reminder"><Info size={14} /><span>Cadastre sua chave PIX para solicitar um repasse.</span><button onClick={() => setTab('profile')}>Cadastrar PIX <ArrowRight size={13} /></button></div>}{display.payouts.length ? <div className="table-scroll"><table><thead><tr><th>Solicitado em</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Observação</th></tr></thead><tbody>{display.payouts.map(payout => <tr key={payout.id}><td>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(payout.requestedAt))}</td><td className="money-cell">{money(payout.amountCents)}</td><td><span className={`payout-badge ${payout.status}`}>{payout.status === 'pending' ? 'Em análise' : payout.status === 'paid' ? 'Pago' : 'Cancelado'}</span></td><td>{payout.paidAt ? new Intl.DateTimeFormat('pt-BR').format(new Date(payout.paidAt)) : '—'}</td><td>{payout.note || '—'}</td></tr>)}</tbody></table></div> : <Empty icon={<Wallet size={26} />} title="Nenhum repasse por enquanto">As solicitações e os pagamentos da administração aparecerão aqui.</Empty>}</section>}
        {tab === 'profile' && <ProfileForm key={`${profile.id}-${client.token}`} profile={profile} client={client} disabled={!canInteract} refresh={refresh} notify={setNotice} />}
      </div>
      <footer className="portal-footer"><span><span className="footer-brand">BRAVUS BRASIL</span> Pesca · Agro · Aventura</span><button onClick={async () => { if (client.isDemo) { setAccessOpen(true); return; } try { await navigator.clipboard.writeText(window.location.href); setNotice({ text: 'Seu link individual foi copiado. Compartilhe apenas com o responsável pelo acesso.' }); } catch { setNotice({ text: 'Não foi possível copiar o link neste navegador.', error: true }); } }}><KeyRound size={12} />{client.isDemo ? 'Acessar com meu token' : 'Copiar meu link individual'}{!client.isDemo && <Copy size={11} />}</button><a href="#/admin">Administração</a></footer>
    </main>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.text}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {accessOpen && <AccessDialog close={() => setAccessOpen(false)} />}
    {payoutOpen && <PayoutDialog client={client} portal={display} close={() => setPayoutOpen(false)} refresh={refresh} notify={setNotice} />}
    {receiptUrl && <Dialog title="Comprovante da venda" close={() => setReceiptUrl('')}><img className="receipt-preview" src={receiptUrl} alt="Print do comprovante da venda" /></Dialog>}
  </div>;
}
