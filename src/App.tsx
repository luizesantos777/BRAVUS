import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, Copy, DollarSign, ExternalLink, FileImage, History, Info, KeyRound, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck, ShoppingCart, Trash2, Trophy, UserRound, Wallet, X } from 'lucide-react';
import { amountToCents, attendantSaleFee, businessTime, businessToday, checkoutFee, checkoutRateLabel, dateLabel, demoInitial, demoPortal, DEFAULT_SALE_ALERT, ATTENDANT_WITHDRAWAL_FEE_CENTS, GATEWAY_WITHDRAWAL_FEE_CENTS, money, payoutNet, saleEarnings, splitGatewayFee, renderSaleAlert, periodLabels, pixLabels, saleStatusLabels } from './domain.ts';
import type { Checkout, Period, Portal, RankingEntry, SaleInput } from './domain.ts';
import { ApiError, currentToken, PortalClient, readReceipt } from './client.ts';
import { Brand, BrandIntro } from './Brand.tsx';
import ProfileForm, { ProfileAvatar } from './Profile.tsx';
import { notifyDemoSale } from './notifications.ts';

type Tab = 'sales' | 'ranking' | 'payouts' | 'profile';
type Notice = { text: string; error?: boolean };
type SaleRow = SaleInput & { id: string };
const blankRow = (): SaleRow => ({ id: crypto.randomUUID(), amount: '', checkoutId: '', time: businessTime(), note: '', receipt: null });
const tabs = [{ id: 'sales', label: 'Lançar Vendas', icon: Plus }, { id: 'ranking', label: 'Ranking', icon: Trophy }, { id: 'payouts', label: 'Repasses', icon: History }, { id: 'profile', label: 'Meus Dados e PIX', icon: UserRound }] as const;
const MANUAL_PIX_KEY = 'd026e4d9-0a17-4ecf-b2fe-61e0ff386e6f';
const CHECKOUT_URL = 'https://pagamento.bravuspix.shop/checkout';

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><header><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Fechar janela" onClick={close}><X size={19} /></button></header>{children}</dialog>;
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>{children}</p></div>; }
function CheckoutCard({ notify, checkout }: { notify: (notice: Notice) => void; checkout?: Checkout }) {
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(CHECKOUT_URL); notify({ text: 'Link do checkout copiado!' }); }
    catch { input.current?.focus(); input.current?.select(); notify({ text: 'O link foi selecionado. Use a opção Copiar do seu aparelho.' }); }
  }
  return <section className="checkout-card" aria-labelledby="checkout-title"><div className="checkout-heading"><ShoppingCart size={17} /><div><h3 id="checkout-title">Checkout BRAVUS</h3><p>Copie o link para enviar ao cliente ou abra o checkout.</p>{checkout && <small className="checkout-tariff">{checkoutRateLabel(checkout)}</small>}</div></div><div className="checkout-controls"><label className="sr-only" htmlFor="checkout-link">Link do checkout BRAVUS</label><input ref={input} id="checkout-link" readOnly value={CHECKOUT_URL} spellCheck={false} onFocus={event => event.currentTarget.select()} /><a className="button primary" href={CHECKOUT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Abrir checkout</a><button type="button" className="button secondary" onClick={() => void copy()}><Copy size={14} />Copiar link</button></div></section>;
}
function ManualPixCard({ notify, checkout }: { notify: (notice: Notice) => void; checkout?: Checkout }) {
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(MANUAL_PIX_KEY);
      notify({ text: 'Chave PIX manual copiada!' });
    } catch {
      input.current?.focus(); input.current?.select();
      notify({ text: 'A chave PIX foi selecionada. Use a opção Copiar do seu aparelho.' });
    }
  }
  return <section className="manual-pix-card" aria-labelledby="manual-pix-title"><div className="manual-pix-heading"><KeyRound size={17} /><div><h3 id="manual-pix-title">PIX manual · Recebimento de vendas</h3><p>Use esta chave nos pagamentos das vendas por PIX manual.</p>{checkout && <small className="manual-pix-tariff">Taxa: {checkoutRateLabel(checkout)}</small>}</div></div><div className="manual-pix-copy"><label className="sr-only" htmlFor="manual-pix-key">Chave PIX manual para receber vendas</label><input ref={input} id="manual-pix-key" type="text" value={MANUAL_PIX_KEY} readOnly spellCheck={false} onFocus={event => event.currentTarget.select()} /><button type="button" className="button primary" onClick={() => void copy()}><Copy size={14} />Copiar chave PIX</button></div></section>;
}
function SaleFeePreview({ row, checkout, index, commissionBps }: { row: SaleRow; checkout?: Checkout; index: number; commissionBps: number }) {
  if (!checkout) return null;
  let amounts: { fee: number; net: number; gross: number; business: number; ownFee: number } | null = null, error = '';
  if (row.amount.trim()) {
    try { const amount = amountToCents(row.amount), fee = checkoutFee(amount, checkout); const net = saleEarnings({ amountCents: amount, feeCents: fee, attendantFeeCents: splitGatewayFee(fee), commissionBps, commissionMode: 'gross-share-less-fees' }); amounts = { fee, net, gross: amount, business: amount - fee - net, ownFee: splitGatewayFee(fee) }; }
    catch (cause) { error = (cause as Error).message; }
  }
  return <div className="sale-fee-preview" aria-label={`Taxas da venda ${index + 1}`}><span>{checkout.name} · {checkoutRateLabel(checkout, amounts?.gross)}</span>{amounts && <span>BRAVUS após taxas: <strong>{money(amounts.business)}</strong><i />Taxa total do gateway: <strong>{money(amounts.fee)}</strong><i />Sua parte da taxa (50%): <strong>{money(amounts.ownFee)}</strong><i />Seu valor: <strong>{money(amounts.net)}</strong></span>}{error && <span className="fee-validation">{error}</span>}</div>;
}
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
        const checkout = portal.checkouts.find(item => item.id === row.checkoutId);
        if (!checkout) throw new Error('Selecione um checkout válido.');
        checkoutFee(amountToCents(row.amount), checkout);
      }
      const payload = { date, sales: rows.map(({ id: _id, ...row }) => row) };
      const limit = portal.maxRequestBytes ?? 12 * 1024 * 1024;
      if (new Blob([JSON.stringify(payload)]).size > limit) throw new Error(`O envio excede ${Math.floor(limit / 1024 / 1024)} MB. Envie menos vendas ou prints menores por vez.`);
      setBusy(true); await client.saveSales(payload, key.current);
      const count = rows.length; setRows([blankRow()]); key.current = crypto.randomUUID();
      const total = payload.sales.reduce((sum, row) => sum + amountToCents(row.amount), 0);
      const message = renderSaleAlert(portal.profile.saleAlertTemplate ?? DEFAULT_SALE_ALERT, total, count, portal.profile.name);
      notify({ text: message + ' · Aguardando aprovação.' + (client.isDemo ? ' · Demonstração' : '') });
      void notifyDemoSale(client, message);
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel sales-panel"><div className="section-title"><Plus size={17} /><h2>LANÇAMENTO DE VENDAS MANUAIS</h2></div>
    <div className="mandatory"><AlertCircle size={15} /><p><strong>Obrigatório:</strong> Todos os lançamentos de vendas manuais são mandatórios. Suba todas as suas vendas no final do dia ou cadastre cada venda individualmente assim que ocorrer.</p></div>
    <CheckoutCard notify={notify} checkout={portal.checkouts.find(checkout => checkout.id === 'main')} />
    <ManualPixCard notify={notify} checkout={portal.checkouts.find(checkout => checkout.id === 'pix')} />
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
        <SaleFeePreview row={row} checkout={portal.checkouts.find(checkout => checkout.id === row.checkoutId)} index={index} commissionBps={portal.profile.commissionBps} />
        {row.receipt && <div className="attachment-detail"><FileImage size={12} /><button type="button" onClick={() => preview(`data:${row.receipt!.mime};base64,${row.receipt!.base64}`)}>{row.receipt.name}</button><button className="remove-attachment" type="button" aria-label={`Remover print venda ${index + 1}`} onClick={() => update(row.id, { receipt: null })}><X size={12} /></button></div>}
      </div>)}</div>
      {error && <div role="alert" className="form-error"><AlertCircle size={14} />{error}</div>}
      <div className="sales-actions"><button type="button" className="button secondary" disabled={rows.length >= 10} onClick={() => setRows(previous => [...previous, blankRow()])}><Plus size={15} />Adicionar Outra Venda</button><button type="submit" className="button primary">{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{busy ? 'Enviando vendas...' : 'Salvar e Enviar Vendas'}</button></div>
      <p className="form-caption">Até 10 vendas por envio · Prints em PNG, JPG ou WEBP de até 2 MB.</p>
    </fieldset></form>
  </section>;
}
function PayoutDialog({ client, portal, close, refresh, notify }: { client: PortalClient; portal: Portal; close: () => void; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [amount, setAmount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  let requestedCents = 0; try { requestedCents = amountToCents(amount); } catch { /* The API validates the submitted amount. */ }
  const receiveCents = requestedCents - ATTENDANT_WITHDRAWAL_FEE_CENTS;
  return <Dialog title="Solicitar repasse" close={close}><p className="dialog-description">Disponível: <strong>{money(portal.finance.availableCents)}</strong>. A solicitação será enviada para análise e pagamento pela administração.</p><form onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await client.requestPayout(amount); notify({ text: client.isDemo ? 'Solicitação de demonstração registrada. Nenhum PIX foi enviado.' : 'Solicitação de repasse registrada. Aguarde o pagamento da administração.' }); close(); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }}><label className="dialog-label" htmlFor="payout-amount">Valor do repasse (R$)</label><input id="payout-amount" autoFocus inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required placeholder="Ex.: 50,00" /><dl className="payout-calculation" aria-live="polite"><div><dt>Valor reservado para análise</dt><dd>{requestedCents ? money(requestedCents) : '—'}</dd></div><div><dt>Sua metade da taxa no pagamento</dt><dd>− {money(ATTENDANT_WITHDRAWAL_FEE_CENTS)}</dd></div><div><dt>PIX previsto após o repasse</dt><dd>{receiveCents > 0 ? money(receiveCents) : '—'}</dd></div></dl><p className="payout-help">Solicitar apenas reserva o valor para análise: nenhuma taxa de saque é cobrada agora. Da taxa total de {money(GATEWAY_WITHDRAWAL_FEE_CENTS)}, sua metade de {money(ATTENDANT_WITHDRAWAL_FEE_CENTS)} será descontada do valor reservado somente quando a administração confirmar o pagamento. A BRAVUS paga a outra metade. Se cancelar, o valor reservado volta inteiro ao saldo.</p><div className="pix-destination"><ShieldCheck size={16} /><div><strong>{portal.profile.pixOwner}</strong><span>{pixLabels[portal.profile.pixType]}: {portal.profile.pixKey}</span></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancelar</button><button type="submit" className="button primary" disabled={busy || receiveCents <= 0 || requestedCents > portal.finance.availableCents}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}Confirmar solicitação</button></div></form></Dialog>;
}

export default function App() {
  const [client, setClient] = useState(() => new PortalClient(currentToken()));
  const [portal, setPortal] = useState<Portal | null>(null), [period, setPeriod] = useState<Period>('today'), [tab, setTab] = useState<Tab>(() => new URLSearchParams(window.location.search).get('aba') === 'perfil' ? 'profile' : 'sales');
  const [loading, setLoading] = useState(true), [error, setError] = useState<{ text: string; status: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null), [ranking, setRanking] = useState<RankingEntry[]>([]), [rankingLoading, setRankingLoading] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false), [receiptUrl, setReceiptUrl] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { const update = () => { setClient(new PortalClient(currentToken())); setPortal(null); setTab('sales'); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { let cancelled = false; setLoading(true); setError(null); client.portal(period).then(value => { if (!cancelled) setPortal(value); }).catch(cause => { if (!cancelled) setError({ text: (cause as Error).message, status: cause instanceof ApiError ? cause.status : 0 }); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [client, period]);
  useEffect(() => { if (tab !== 'ranking' || error) return; let cancelled = false; setRankingLoading(true); client.ranking(period).then(value => { if (!cancelled) setRanking(value); }).catch(cause => { if (!cancelled) setNotice({ text: (cause as Error).message, error: true }); }).finally(() => { if (!cancelled) setRankingLoading(false); }); return () => { cancelled = true; }; }, [client, period, tab, portal, error]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 8000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => () => { if (receiptUrl.startsWith('blob:')) URL.revokeObjectURL(receiptUrl); }, [receiptUrl]);
  async function refresh() { setLoading(true); try { setPortal(await client.portal(period)); setError(null); } catch (cause) { setError({ text: (cause as Error).message, status: cause instanceof ApiError ? cause.status : 0 }); } finally { setLoading(false); } }
  async function viewReceipt(id: string) { try { setReceiptUrl(await client.receipt(id)); } catch (cause) { setNotice({ text: (cause as Error).message, error: true }); } }
  const display = portal ?? demoPortal(demoInitial(), period), canInteract = !loading && !error && !!portal;
  const profile = display.profile, finance = display.finance;
  return <div className="portal-shell"><a className="skip-link" href="#portal-main" onClick={event => { event.preventDefault(); document.getElementById('portal-main')?.focus(); }}>Pular para o conteúdo</a>
    <header className="portal-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('sales'); }} aria-label="BRAVUS início"><Brand /></a><div className="header-access"><span className={`access-status ${client.isDemo ? 'demo' : ''}`}><ShieldCheck size={12} />{client.isDemo ? 'Demonstração' : 'Acesso individual'}</span><span className="attendant-name">{portal?.profile.name ?? 'Seu portal'}</span><button className="avatar" aria-label="Abrir meus dados" onClick={() => setTab('profile')}><ProfileAvatar photoUrl={profile.photoUrl} name={profile.name} /></button></div></header>
    <main id="portal-main" tabIndex={-1}>
      {tab !== 'profile' && <BrandIntro />}
      {error && <div className="auth-error" role="alert"><AlertCircle size={15} /><span>{error.text}{error.status === 401 && ' Peça um novo link ao responsável pelo BRAVUS.'}</span>{error.status !== 401 && <button onClick={() => void refresh()}>Tentar novamente</button>}</div>}
      {tab !== 'profile' && <section className="panel financial-panel" aria-busy={loading}><div className="financial-heading"><div className="section-title"><DollarSign size={18} /><h2>EXTRATO FINANCEIRO &amp; COMISSÕES</h2></div><div className="period-picker"><CalendarDays size={15} /><select aria-label="Período do extrato" value={period} onChange={event => setPeriod(event.target.value as Period)}>{Object.entries(periodLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><ChevronDown size={13} /></div></div>
        <div className="financial-grid"><article className="metric"><h3>FATURAMENTO<br />CONSOLIDADO</h3><strong>{money(finance.grossCents)}</strong><small>{finance.count} {finance.count === 1 ? 'venda' : 'vendas'}</small></article><article className="metric"><h3>TAXAS + SAQUES</h3><strong>- {money(finance.feeCents)}</strong><small>Sua parte nas taxas + repasses pagos</small></article><article className="metric"><h3>CUSTO ADS ( <span className="status-dot" /> )</h3><strong>- {money(finance.adsCents)}</strong><small>Repasse por gasto</small></article><article className={`metric balance ${finance.availableCents < 0 ? 'negative' : ''}`}><h3>SALDO ACUMULADO ATUAL</h3><strong>{money(finance.availableCents)}</strong><small>Disponível para repasse</small></article></div>
        <dl className="finance-breakdown"><div><dt>BRAVUS após taxas no período</dt><dd>− {money(finance.businessShareCents)}</dd></div><div><dt>Sua parte nas taxas das vendas</dt><dd>− {money(finance.transactionFeeCents)}</dd></div><div><dt>Seu valor após as taxas</dt><dd>{money(finance.commissionCents)}</dd></div><div><dt>Repasses pagos e ajustes</dt><dd>− {money(finance.withdrawalFeeCents)}</dd></div></dl>
        <p className="payout-help">Taxas das vendas no período: gateway {money(finance.gatewayFeeCents)} · BRAVUS {money(finance.businessGatewayFeeCents)} · Sua parte {money(finance.transactionFeeCents)}. O rateio de 50% é feito por venda, com arredondamento em centavos.</p>
        {portal && (finance.pendingPayoutCents > 0 || finance.debtCents > 0) && <div className="finance-details">{finance.pendingPayoutCents > 0 && <span><History size={12} />Repasses em análise: {money(finance.pendingPayoutCents)}</span>}{finance.debtCents > 0 && <span className="debt-text">Custos pendentes no período: {money(finance.debtCents)}</span>}</div>}
      </section>}
      {tab !== 'profile' && finance.pendingSalesCount > 0 && <div className="pending-sales-notice"><History size={15} /><span><strong>{finance.pendingSalesCount} venda(s) em análise · {money(finance.pendingSalesCents)}</strong><br />A comissão será liberada após a aprovação da administração.</span></div>}
      <nav className="portal-tabs" role="tablist" aria-label="Portal do atendente" onKeyDown={event => { const index = tabs.findIndex(item => item.id === tab); const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1; if (next >= 0) { event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus(); } }}>{tabs.map((item, index) => <button ref={element => { tabRefs.current[index] = element; }} key={item.id} type="button" id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={15} /><span>{item.label}{item.id === 'payouts' ? ` (${display.payouts.length})` : ''}</span></button>)}</nav>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'sales' && <><SalesForm key={client.token || 'demo'} client={client} portal={display} disabled={!canInteract} refresh={refresh} notify={setNotice} preview={setReceiptUrl} /><section className="panel history-panel"><div className="section-title"><History size={17} /><h2>VENDAS LANÇADAS</h2><span className="item-count">{display.sales.length}</span><button className="icon-button refresh-button" aria-label="Atualizar vendas" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>{display.sales.length ? <div className="table-scroll"><table><thead><tr><th>Data / Horário</th><th>Checkout</th><th>Valor bruto</th><th>BRAVUS após taxas</th><th>Taxa total gateway</th><th>Sua parte da taxa</th><th>Seu valor</th><th>Situação</th><th>Observação</th><th>Comprovante</th></tr></thead><tbody>{display.sales.map(sale => <tr key={sale.id}><td>{dateLabel(sale.date)}<small>{sale.time}</small></td><td>{sale.checkoutName}</td><td className="money-cell">{money(sale.amountCents)}</td><td className="money-cell">{money(sale.amountCents - sale.feeCents - saleEarnings(sale))}</td><td className="money-cell">{money(sale.feeCents)}</td><td className="money-cell">{money(attendantSaleFee(sale))}</td><td className="money-cell">{money(saleEarnings(sale))}{(sale.commissionMode !== 'gross-share-less-fees' || sale.attendantFeeCents == null) && <small>Regra anterior</small>}</td><td><span className={`sale-status ${sale.status}`}>{saleStatusLabels[sale.status]}</span>{sale.reviewNote && <small className="sale-review-note">{sale.reviewNote}</small>}</td><td className="note-cell">{sale.note || '—'}</td><td><button className="receipt-link" onClick={() => void viewReceipt(sale.receiptId)} aria-label={`Ver print da venda de ${money(sale.amountCents)}`}><FileImage size={14} />Ver print</button></td></tr>)}</tbody></table></div> : <Empty icon={<History size={24} />} title="Nenhuma venda neste período">Seus lançamentos aparecerão aqui depois do envio.</Empty>}<p className="history-caption">Exibindo até 100 vendas do período selecionado.</p></section></>}
        {tab === 'ranking' && <section className="panel ranking-panel"><div className="section-title"><Trophy size={17} /><h2>RANKING DE VENDAS</h2><span className="period-caption">{periodLabels[period]}</span></div><p className="section-description">Acompanhe os resultados e conquiste sua próxima posição.</p>{rankingLoading ? <div className="loading-state"><LoaderCircle size={22} className="spin" />Carregando ranking...</div> : ranking.length ? <div className="ranking-list">{ranking.map((entry, index) => <article className={`ranking-row ${entry.mine ? 'mine' : ''}`} key={entry.id}><span className={`rank-position position-${index + 1}`}>{index < 3 ? <Trophy size={18} /> : index + 1}</span><ProfileAvatar photoUrl={entry.photoUrl} name={entry.name} className="ranking-avatar" /><div><strong>{entry.name}{entry.mine && <span className="you-badge">Você</span>}</strong><small>{entry.count} {entry.count === 1 ? 'venda registrada' : 'vendas registradas'}</small></div><strong>{money(entry.grossCents)}</strong></article>)}</div> : <Empty icon={<Trophy size={26} />} title="A primeira posição espera por você">O ranking aparece quando houver vendas no período selecionado.</Empty>}</section>}
        {tab === 'payouts' && <section className="panel payouts-panel"><div className="section-title"><History size={17} /><h2>MEUS REPASSES</h2></div><div className="payout-summary"><div><span>Saldo disponível</span><strong>{money(finance.availableCents)}</strong></div><div><span>Em análise</span><strong>{money(finance.pendingPayoutCents)}</strong></div><div><span>Total pago</span><strong>{money(finance.paidPayoutNetCents)}</strong></div><button className="button primary" disabled={!canInteract || finance.availableCents <= ATTENDANT_WITHDRAWAL_FEE_CENTS || !profile.pixKey} onClick={() => setPayoutOpen(true)}><ArrowDownToLine size={15} />Solicitar Repasse</button></div><p className="payout-help">A solicitação fica em análise sem taxa de saque. O gateway cobra {money(GATEWAY_WITHDRAWAL_FEE_CENTS)} por pagamento: sua metade é {money(ATTENDANT_WITHDRAWAL_FEE_CENTS)} e a BRAVUS paga a outra metade. A cobrança ocorre somente quando a administração efetua o repasse.</p>{!profile.pixKey && <div className="pix-reminder"><Info size={14} /><span>Cadastre sua chave PIX para solicitar um repasse.</span><button onClick={() => setTab('profile')}>Cadastrar PIX <ArrowRight size={13} /></button></div>}{display.payouts.length ? <div className="table-scroll"><table><thead><tr><th>Solicitado em</th><th>Valor reservado / debitado</th><th>Taxa cobrada</th><th>PIX pago</th><th>Status</th><th>Pagamento</th><th>Observação</th></tr></thead><tbody>{display.payouts.map(payout => <tr key={payout.id}><td>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(payout.requestedAt))}</td><td className="money-cell">{money(payout.amountCents)}</td><td className="money-cell">{money(payout.withdrawalFeeCents ?? 0)}</td><td className="money-cell">{payout.status === 'paid' ? money(payoutNet(payout)) : '—'}</td><td><span className={`payout-badge ${payout.status}`}>{payout.status === 'pending' ? 'Em análise' : payout.status === 'paid' ? 'Pago' : 'Cancelado'}</span></td><td>{payout.paidAt ? new Intl.DateTimeFormat('pt-BR').format(new Date(payout.paidAt)) : '—'}</td><td>{payout.note || '—'}</td></tr>)}</tbody></table></div> : <Empty icon={<Wallet size={26} />} title="Nenhum repasse por enquanto">As solicitações e os pagamentos da administração aparecerão aqui.</Empty>}</section>}
        {tab === 'profile' && (portal ? <ProfileForm key={`${profile.id}-${client.token}`} profile={profile} client={client} disabled={!canInteract} refresh={refresh} notify={setNotice} /> : loading ? <div className="panel loading-state" role="status"><LoaderCircle size={22} className="spin" />Carregando seus dados...</div> : null)}
      </div>
      <footer className="portal-footer"><span><span className="footer-brand">BRAVUS BRASIL</span> Pesca · Agro · Aventura</span>{!client.isDemo && <button onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setNotice({ text: 'Seu link individual foi copiado. Compartilhe apenas com o responsável pelo acesso.' }); } catch { setNotice({ text: 'Não foi possível copiar o link neste navegador.', error: true }); } }}><KeyRound size={12} />Copiar meu link individual<Copy size={11} /></button>}<a href="#/admin">Administração</a></footer>
    </main>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.text}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {payoutOpen && <PayoutDialog client={client} portal={display} close={() => setPayoutOpen(false)} refresh={refresh} notify={setNotice} />}
    {receiptUrl && <Dialog title="Comprovante da venda" close={() => setReceiptUrl('')}><img className="receipt-preview" src={receiptUrl} alt="Print do comprovante da venda" /></Dialog>}
  </div>;
}
