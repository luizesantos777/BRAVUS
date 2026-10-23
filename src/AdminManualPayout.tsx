import { useEffect, useRef, useState } from 'react';
import { Copy, Wallet, X } from 'lucide-react';
import { amountToCents, ATTENDANT_WITHDRAWAL_FEE_CENTS, GATEWAY_WITHDRAWAL_FEE_CENTS, money } from './domain.ts';
import type { AdminAttendant } from './domain.ts';
import type { AdminClient } from './admin-client.ts';

export default function AdminManualPayout({ client, attendants, selected, run, busy, serverError }: { client: AdminClient; attendants: AdminAttendant[]; selected: string; run: (work: () => Promise<unknown>, success: string) => Promise<boolean>; busy: boolean; serverError: string }) {
  const [attendantId, setAttendantId] = useState(selected), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [open, setOpen] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setAttendantId(selected); setAmount(''); setError(''); }, [selected]);
  useEffect(() => { if (open) dialog.current?.showModal(); return () => dialog.current?.close(); }, [open]);
  const attendant = attendants.find(item => item.id === attendantId);
  let cents = 0; try { cents = amountToCents(amount); } catch { /* Validate before opening confirmation. */ }
  const net = cents - ATTENDANT_WITHDRAWAL_FEE_CENTS;
  return <section className="panel manual-payout-panel"><h2>Registrar repasse manual</h2><p className="section-description">Faça o PIX pelo seu banco e registre o pagamento aqui. O atendente acompanha o saldo e o histórico, sem solicitar repasse.</p>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); setError(''); if (!attendant?.pixKey || !attendant.pixOwner) return setError('O atendente precisa cadastrar sua chave PIX e o titular.'); if (net <= 0 || cents > attendant.finance.availableCents) return setError('Informe um valor acima de R$ 2,50 e dentro do saldo disponível.'); setOpen(true); }}><fieldset disabled={busy || client.isDemo}>
      <div className="form-grid"><label>Atendente do repasse<select required value={attendantId} onChange={event => { setAttendantId(event.target.value); setAmount(''); setError(''); }}><option value="">Selecione um atendente</option>{attendants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Valor total a debitar do saldo (R$)<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Inclui a taxa do atendente" /></label>
      <label>Observação do repasse manual<input required maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: PIX conferido no banco" /></label></div>
      {attendant && <><p className="payout-help">Saldo disponível: <strong>{money(attendant.finance.availableCents)}</strong>. O atendente recebe o valor informado menos {money(ATTENDANT_WITHDRAWAL_FEE_CENTS)}. A BRAVUS assume os outros {money(GATEWAY_WITHDRAWAL_FEE_CENTS - ATTENDANT_WITHDRAWAL_FEE_CENTS)} da taxa do gateway.</p><button type="button" className="button secondary" disabled={attendant.finance.availableCents <= ATTENDANT_WITHDRAWAL_FEE_CENTS} onClick={() => setAmount((attendant.finance.availableCents / 100).toFixed(2))}>Usar saldo total</button>
      {attendant.pixKey ? <div className="pix-destination"><div><strong>{attendant.pixOwner}</strong><span>{attendant.pixKey}</span></div><button className="button secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(attendant.pixKey); } catch { setError('Não foi possível copiar. Selecione a chave PIX exibida e copie manualmente.'); } }}><Copy size={14} />Copiar PIX do atendente</button></div> : <p className="payout-help">Este atendente ainda não cadastrou uma chave PIX.</p>}</>}
      {cents > ATTENDANT_WITHDRAWAL_FEE_CENTS && <dl className="payout-calculation"><div><dt>PIX para o atendente</dt><dd>{money(net)}</dd></div><div><dt>Parte do atendente na taxa</dt><dd>{money(ATTENDANT_WITHDRAWAL_FEE_CENTS)}</dd></div><div><dt>Total debitado do saldo</dt><dd>{money(cents)}</dd></div></dl>}
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button primary"><Wallet size={15} />Registrar pagamento realizado</button>
    </fieldset></form>
    {open && attendant && <dialog ref={dialog} className="dialog" aria-labelledby="manual-payout-title" onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}><header><h2 id="manual-payout-title">Confirmar repasse manual</h2><button className="icon-button" disabled={busy} onClick={() => setOpen(false)} aria-label="Fechar janela"><X size={18} /></button></header><p className="dialog-description">Confirme somente após efetuar e conferir o PIX de <strong>{money(net)}</strong> para <strong>{attendant.name}</strong>. Serão debitados {money(cents)} do saldo: {money(net)} enviados e {money(ATTENDANT_WITHDRAWAL_FEE_CENTS)} de taxa. A BRAVUS paga a outra metade da taxa. Este registro não envia dinheiro pelo banco.</p>
      {serverError && <p className="form-error" role="alert">{serverError}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>Voltar</button><button className="button primary" disabled={busy} onClick={async () => { if (await run(() => client.recordManualPayout(attendant.id, amount, note, key.current), 'Repasse manual registrado. Saldo atualizado.')) { setOpen(false); setAmount(''); setNote(''); key.current = crypto.randomUUID(); } }}>Confirmar PIX já realizado</button></div>
    </dialog>}
  </section>;
}
