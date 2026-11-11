import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, FileImage, LoaderCircle, X } from 'lucide-react';
import { attendantSaleFee, dateLabel, money, saleEarnings, saleStatusLabel } from './domain.ts';
import type { AdminAttendant, AdminSale, AdminSalesPage, SaleStatus } from './domain.ts';
import type { AdminClient } from './admin-client.ts';
import ReceiptDuplicateWarning from './ReceiptDuplicateWarning.tsx';

function ReviewModal({ title, close, busy = false, children }: { title: string; close: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="dialog review-dialog" aria-labelledby="review-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}><header><h2 id="review-dialog-title">{title}</h2><button type="button" disabled={busy} className="icon-button" aria-label="Fechar janela" onClick={close}><X size={18} /></button></header>{children}</dialog>;
}

function SaleValues({ sale, partner }: { sale: AdminSale; partner: boolean }) {
  const outcome = sale.cancelledAt ? 'cancelado' : sale.status === 'pending' ? 'a liberar' : sale.status === 'rejected' ? 'recusado' : 'liberado';
  const values: [string, number][] = partner ? [
    ['Valor da venda', sale.amountCents], ['Taxa única do gateway', sale.feeCents], [`Valor do parceiro ${outcome}`, saleEarnings(sale)],
  ] : [
    ['Valor da venda', sale.amountCents], ['Taxa total do gateway', sale.feeCents], ['Taxa do atendente', attendantSaleFee(sale)],
    ['Taxa da BRAVUS', sale.feeCents - attendantSaleFee(sale)], ['BRAVUS após taxas', sale.amountCents - sale.feeCents - saleEarnings(sale)],
    [`Comissão ${sale.cancelledAt ? 'cancelada' : sale.status === 'pending' ? 'a liberar' : sale.status === 'rejected' ? 'recusada' : 'liberada'}`, saleEarnings(sale)],
  ];
  return <dl className={'review-values' + (partner ? ' partner-review-values' : '')}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>;
}

export default function AdminSales({ client, attendants, refreshKey, resetKey, pendingSalesCount, run, busy, error }: { client: AdminClient; attendants: AdminAttendant[]; refreshKey: unknown; resetKey: number; pendingSalesCount: number; run: (work: () => Promise<unknown>, success: string) => Promise<boolean>; busy: boolean; error: string }) {
  const [status, setStatus] = useState<SaleStatus | 'all'>('pending'), [attendantId, setAttendantId] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminSalesPage | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [decision, setDecision] = useState<{ sale: AdminSale; status: 'approved' | 'rejected' | 'cancelled' } | null>(null), [note, setNote] = useState(''), [receipt, setReceipt] = useState('');
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
  const partnerSale = (sale: AdminSale) => sale.accountKind === 'partner' || attendants.some(account => account.id === sale.attendantId && account.accountKind === 'partner');
  async function openReceipt(id: string) { try { setReceipt(await client.receipt(id)); } catch (cause) { setLoadError((cause as Error).message); } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!decision || busy) return;
    if (await run(() => decision.status === 'cancelled' ? client.cancelSale(decision.sale.id, note) : client.reviewSale(decision.sale.id, decision.status, note), decision.status === 'cancelled' ? 'Venda cancelada. Faturamento e saldo atualizados.' : decision.status === 'approved' ? partnerSale(decision.sale) ? 'Venda aprovada. Valor do parceiro liberado.' : 'Venda aprovada. Comissão liberada.' : 'Venda recusada. O motivo aparece no portal da conta.')) setDecision(null);
  }
  return <section className="panel admin-sales-panel"><div className="admin-heading"><div><h2>Aprovação de vendas</h2><p>Confira o comprovante antes de liberar o valor da venda.</p></div><div className="review-tools"><span className="review-count">{result?.total ?? 0} venda(s)</span><button type="button" className="button secondary" onClick={() => { setStatus('all'); setAttendantId(''); setPage(1); setRetry(value => value + 1); }}>Ver todas as vendas recebidas</button></div></div>
    <div className="review-filters"><label>Situação da venda<select value={status} onChange={event => { setStatus(event.target.value as SaleStatus | 'all'); setPage(1); }}><option value="pending">Em análise</option><option value="approved">Aprovadas</option><option value="rejected">Recusadas / canceladas</option><option value="all">Todas</option></select></label><label>Filtrar por atendente<select value={attendantId} onChange={event => { setAttendantId(event.target.value); setPage(1); }}><option value="">Todos os atendentes</option>{attendants.map(attendant => <option key={attendant.id} value={attendant.id}>{attendant.name}</option>)}</select></label></div>
    {pendingSalesCount > 0 && (status !== 'pending' || attendantId !== '' || page !== 1) && <div className="review-hidden-pending"><p>Há {pendingSalesCount} venda(s) em análise no total. Os filtros atuais podem ocultar novos lançamentos.</p><button className="button secondary" onClick={() => { setStatus('pending'); setAttendantId(''); setPage(1); }}>Ver todas em análise</button></div>}
    {loadError && <div className="form-error" role="alert"><span>{loadError}</span><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Tentar carregar vendas novamente</button></div>}
    {loading ? <div className="loading-state"><LoaderCircle size={20} className="spin" />Carregando vendas...</div> : loadError && !result ? <p className="section-description">A lista não pôde ser consultada. Tente carregar novamente para conferir as vendas recebidas.</p> : result?.sales.length ? <div className="review-list">{result.sales.map(sale => <article className="review-sale" key={sale.id} data-sale-id={sale.id}>
      <div className="review-sale-heading"><div><strong>{sale.attendantName}</strong><small>{dateLabel(sale.date)} às {sale.time} · {sale.checkoutName}</small></div><span className={`sale-status ${sale.status}`}>{saleStatusLabel(sale)}</span></div>
      <ReceiptDuplicateWarning sale={sale} />
      <SaleValues sale={sale} partner={partnerSale(sale)} />
      {sale.note && <p className="review-note">{sale.note}</p>}{sale.reviewNote && <p className="review-note"><strong>{sale.cancelledAt ? 'Motivo do cancelamento' : sale.status === 'rejected' ? 'Motivo da recusa' : 'Observação da análise'}:</strong> {sale.reviewNote}</p>}
      <div className="review-actions"><button className="button secondary" onClick={() => void openReceipt(sale.receiptId)}><FileImage size={14} />Ver comprovante</button>{sale.status === 'pending' && <><button className="button secondary reject-sale" disabled={busy} onClick={() => { setDecision({ sale, status: 'rejected' }); setNote(''); }}><X size={14} />Recusar venda</button><button className="button primary" disabled={busy} onClick={() => { setDecision({ sale, status: 'approved' }); setNote(''); }}><Check size={14} />Aprovar venda</button></>}{sale.status === 'approved' && <button className="button secondary reject-sale" disabled={busy} onClick={() => { setDecision({ sale, status: 'cancelled' }); setNote(''); }}><X size={14} />Cancelar venda aprovada</button>}</div>
    </article>)}</div> : <div className="empty"><Check size={28} /><h3>Nenhuma venda nesta lista</h3><p>Os lançamentos de atendentes e parceiros aparecerão aqui para você analisar.</p></div>}
    {result && result.total > result.pageSize && <div className="review-pagination"><button className="button secondary" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={14} />Anterior</button><span>Página {page} de {Math.ceil(result.total / result.pageSize)}</span><button className="button secondary" disabled={page * result.pageSize >= result.total || loading} onClick={() => setPage(page + 1)}>Próxima<ChevronRight size={14} /></button></div>}
    {decision && <ReviewModal title={decision.status === 'cancelled' ? 'Cancelar venda aprovada' : decision.status === 'approved' ? 'Aprovar venda' : 'Recusar venda'} busy={busy} close={() => setDecision(null)}><p className="dialog-description">Venda de <strong>{money(decision.sale.amountCents)}</strong> de {decision.sale.attendantName}. {decision.status === 'cancelled' ? <>{partnerSale(decision.sale) ? 'O valor do parceiro de' : 'A comissão de'} {money(saleEarnings(decision.sale))} será {partnerSale(decision.sale) ? 'retirado' : 'retirada'} do saldo, e a venda sairá do faturamento aprovado e do ranking. Repasses já pagos permanecem no histórico; o saldo pode ficar negativo. Pedidos em análise sem cobertura precisam ser cancelados antes de confirmar pagamentos. O registro e o comprovante da venda serão preservados.</> : decision.status === 'approved' ? partnerSale(decision.sale) ? 'A aprovação libera o valor da venda, já descontada a taxa única de 12%, no saldo do parceiro.' : 'A aprovação libera a comissão no saldo do atendente.' : partnerSale(decision.sale) ? 'A venda não gerará saldo para o parceiro. Informe o motivo da recusa.' : 'A venda não gerará comissão. Informe o motivo para o atendente.'}</p>{decision.status === 'approved' && <ReceiptDuplicateWarning sale={result?.sales.find(sale => sale.id === decision.sale.id) ?? decision.sale} />}<form className="admin-form" onSubmit={submit}><label>{decision.status === 'cancelled' ? 'Motivo do cancelamento' : decision.status === 'rejected' ? 'Motivo da recusa' : 'Observação da aprovação (opcional)'}<textarea required={decision.status !== 'approved'} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setDecision(null)}>Voltar</button><button className="button primary" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{decision.status === 'cancelled' ? 'Confirmar cancelamento da venda' : decision.status === 'approved' ? 'Confirmar aprovação' : 'Confirmar recusa'}</button></div></form></ReviewModal>}
    {receipt && <ReviewModal title="Comprovante da venda" close={() => setReceipt('')}><img className="receipt-preview" src={receipt} alt="Comprovante da venda" /></ReviewModal>}
  </section>;
}
