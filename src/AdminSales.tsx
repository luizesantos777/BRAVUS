import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, FileImage, LoaderCircle, X } from 'lucide-react';
import { attendantSaleFee, dateLabel, money, saleEarnings, saleStatusLabels } from './domain.ts';
import type { AdminAttendant, AdminSale, AdminSalesPage, SaleStatus } from './domain.ts';
import type { AdminClient } from './admin-client.ts';

function ReviewModal({ title, close, busy = false, children }: { title: string; close: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="dialog review-dialog" aria-labelledby="review-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}><header><h2 id="review-dialog-title">{title}</h2><button type="button" disabled={busy} className="icon-button" aria-label="Fechar janela" onClick={close}><X size={18} /></button></header>{children}</dialog>;
}

export default function AdminSales({ client, attendants, refreshKey, resetKey, pendingSalesCount, run, busy, error }: { client: AdminClient; attendants: AdminAttendant[]; refreshKey: unknown; resetKey: number; pendingSalesCount: number; run: (work: () => Promise<unknown>, success: string) => Promise<boolean>; busy: boolean; error: string }) {
  const [status, setStatus] = useState<SaleStatus | 'all'>('pending'), [attendantId, setAttendantId] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminSalesPage | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [decision, setDecision] = useState<{ sale: AdminSale; status: 'approved' | 'rejected' } | null>(null), [note, setNote] = useState(''), [receipt, setReceipt] = useState('');
  const [retry, setRetry] = useState(0), previousQuery = useRef<{ client: AdminClient; status: string; attendantId: string; page: number } | null>(null);
  useEffect(() => { setStatus('pending'); setAttendantId(''); setPage(1); }, [resetKey]);
  useEffect(() => {
    let cancelled = false;
    const previous = previousQuery.current;
    if (!previous || previous.client !== client || previous.status !== status || previous.attendantId !== attendantId || previous.page !== page) setLoading(true);
    previousQuery.current = { client, status, attendantId, page }; setLoadError('');
    client.sales(status, attendantId, page).then(value => { if (!cancelled) { const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize)); if (page > lastPage) setPage(lastPage); else setResult(value); } }).catch(cause => { if (!cancelled) setLoadError((cause as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, status, attendantId, page, refreshKey, resetKey, retry]);
  useEffect(() => () => { if (receipt.startsWith('blob:')) URL.revokeObjectURL(receipt); }, [receipt]);
  async function openReceipt(id: string) { try { setReceipt(await client.receipt(id)); } catch (cause) { setLoadError((cause as Error).message); } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!decision || busy) return;
    if (await run(() => client.reviewSale(decision.sale.id, decision.status, note), decision.status === 'approved' ? 'Venda aprovada. Comissão liberada.' : 'Venda recusada. O motivo aparece para o atendente.')) setDecision(null);
  }
  return <section className="panel admin-sales-panel"><div className="admin-heading"><div><h2>Aprovação de vendas</h2><p>Confira o comprovante antes de liberar a comissão.</p></div><div className="review-tools"><span className="review-count">{result?.total ?? 0} venda(s)</span><button type="button" className="button secondary" onClick={() => { setStatus('all'); setAttendantId(''); setPage(1); setRetry(value => value + 1); }}>Ver todas as vendas recebidas</button></div></div>
    <div className="review-filters"><label>Situação da venda<select value={status} onChange={event => { setStatus(event.target.value as SaleStatus | 'all'); setPage(1); }}><option value="pending">Em análise</option><option value="approved">Aprovadas</option><option value="rejected">Recusadas</option><option value="all">Todas</option></select></label><label>Filtrar por atendente<select value={attendantId} onChange={event => { setAttendantId(event.target.value); setPage(1); }}><option value="">Todos os atendentes</option>{attendants.map(attendant => <option key={attendant.id} value={attendant.id}>{attendant.name}</option>)}</select></label></div>
    {pendingSalesCount > 0 && (status !== 'pending' || attendantId !== '' || page !== 1) && <div className="review-hidden-pending"><p>Há {pendingSalesCount} venda(s) em análise no total. Os filtros atuais podem ocultar novos lançamentos.</p><button className="button secondary" onClick={() => { setStatus('pending'); setAttendantId(''); setPage(1); }}>Ver todas em análise</button></div>}
    {loadError && <div className="form-error" role="alert"><span>{loadError}</span><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Tentar carregar vendas novamente</button></div>}
    {loading ? <div className="loading-state"><LoaderCircle size={20} className="spin" />Carregando vendas...</div> : loadError && !result ? <p className="section-description">A lista não pôde ser consultada. Tente carregar novamente para conferir as vendas recebidas.</p> : result?.sales.length ? <div className="review-list">{result.sales.map(sale => <article className="review-sale" key={sale.id} data-sale-id={sale.id}>
      <div className="review-sale-heading"><div><strong>{sale.attendantName}</strong><small>{dateLabel(sale.date)} às {sale.time} · {sale.checkoutName}</small></div><span className={`sale-status ${sale.status}`}>{saleStatusLabels[sale.status]}</span></div>
      <dl className="review-values"><div><dt>Valor da venda</dt><dd>{money(sale.amountCents)}</dd></div><div><dt>Taxa total do gateway</dt><dd>{money(sale.feeCents)}</dd></div><div><dt>Taxa do atendente</dt><dd>{money(attendantSaleFee(sale))}</dd></div><div><dt>Taxa da BRAVUS</dt><dd>{money(sale.feeCents - attendantSaleFee(sale))}</dd></div><div><dt>BRAVUS após taxas</dt><dd>{money(sale.amountCents - sale.feeCents - saleEarnings(sale))}</dd></div><div><dt>Comissão {sale.status === 'pending' ? 'a liberar' : sale.status === 'rejected' ? 'recusada' : 'liberada'}</dt><dd>{money(saleEarnings(sale))}</dd></div></dl>
      {sale.note && <p className="review-note">{sale.note}</p>}{sale.reviewNote && <p className="review-note"><strong>{sale.status === 'rejected' ? 'Motivo da recusa' : 'Observação da análise'}:</strong> {sale.reviewNote}</p>}
      <div className="review-actions"><button className="button secondary" onClick={() => void openReceipt(sale.receiptId)}><FileImage size={14} />Ver comprovante</button>{sale.status === 'pending' && <><button className="button secondary reject-sale" disabled={busy} onClick={() => { setDecision({ sale, status: 'rejected' }); setNote(''); }}><X size={14} />Recusar venda</button><button className="button primary" disabled={busy} onClick={() => { setDecision({ sale, status: 'approved' }); setNote(''); }}><Check size={14} />Aprovar venda</button></>}</div>
    </article>)}</div> : <div className="empty"><Check size={28} /><h3>Nenhuma venda nesta lista</h3><p>Os lançamentos dos atendentes aparecerão aqui para você analisar.</p></div>}
    {result && result.total > result.pageSize && <div className="review-pagination"><button className="button secondary" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={14} />Anterior</button><span>Página {page} de {Math.ceil(result.total / result.pageSize)}</span><button className="button secondary" disabled={page * result.pageSize >= result.total || loading} onClick={() => setPage(page + 1)}>Próxima<ChevronRight size={14} /></button></div>}
    {decision && <ReviewModal title={decision.status === 'approved' ? 'Aprovar venda' : 'Recusar venda'} busy={busy} close={() => setDecision(null)}><p className="dialog-description">Venda de <strong>{money(decision.sale.amountCents)}</strong> de {decision.sale.attendantName}. {decision.status === 'approved' ? 'A aprovação libera a comissão no saldo do atendente.' : 'A venda não gerará comissão. Informe o motivo para o atendente.'}</p><form className="admin-form" onSubmit={submit}><label>{decision.status === 'rejected' ? 'Motivo da recusa' : 'Observação da aprovação (opcional)'}<textarea required={decision.status === 'rejected'} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setDecision(null)}>Voltar</button><button className="button primary" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{decision.status === 'approved' ? 'Confirmar aprovação' : 'Confirmar recusa'}</button></div></form></ReviewModal>}
    {receipt && <ReviewModal title="Comprovante da venda" close={() => setReceipt('')}><img className="receipt-preview" src={receipt} alt="Comprovante enviado pelo atendente" /></ReviewModal>}
  </section>;
}
