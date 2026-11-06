import { useEffect, useRef, useState } from 'react';
import type { PortalClient } from './client.ts';
import { blankSalesDraft, DraftConflictError, draftStorageError, SalesDraftStore } from './sales-drafts.ts';
import type { DraftRow, SalesDraft } from './sales-drafts.ts';

export function useSalesDraft(client: PortalClient, enabled: boolean) {
  const [draft, setDraft] = useState(blankSalesDraft), current = useRef(draft);
  const [ready, setReady] = useState(false), [dirty, setDirty] = useState(false);
  const [clearing, setClearing] = useState(false), clearingNow = useRef(false);
  const [message, setMessage] = useState('Carregando rascunho...'), [failed, setFailed] = useState(false);
  const repository = useRef<SalesDraftStore | null>(null), generation = useRef(0), operation = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, store: SalesDraftStore | undefined;
    const epoch = ++generation.current;
    client.draftScope().then(async scope => {
      if (cancelled) return;
      store = new SalesDraftStore(scope); repository.current = store;
      const saved = await store.load();
      if (cancelled) return;
      if (saved) { current.current = saved; setDraft(saved); setDirty(true); }
      setMessage(saved ? 'Rascunho recuperado deste aparelho.' : 'Seu preenchimento será salvo automaticamente neste aparelho.');
      setFailed(false);
    }).catch(() => { if (!cancelled) { setMessage(draftStorageError); setFailed(true); } }).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; if (generation.current === epoch) generation.current++; repository.current = null; store?.close(); };
  }, [client, enabled]);
  async function persist(value: SalesDraft) {
    const epoch = generation.current, sequence = ++operation.current;
    setMessage('Salvando rascunho...'); setFailed(false);
    try {
      if (!repository.current) throw new Error(draftStorageError);
      await repository.current.save(value);
      if (generation.current === epoch && operation.current === sequence) setMessage('Rascunho salvo neste aparelho.');
    } catch (error) {
      if (generation.current === epoch && operation.current === sequence) { setMessage(error instanceof DraftConflictError ? error.message : draftStorageError); setFailed(true); }
      throw error;
    }
  }
  function replace(value: SalesDraft, save = true) {
    current.current = value; setDraft(value); setDirty(true);
    if (save) void persist(value).catch(() => undefined);
  }
  function setRows(change: DraftRow[] | ((rows: DraftRow[]) => DraftRow[])) {
    if (!ready || clearingNow.current || current.current.pending) return;
    replace({ ...current.current, rows: typeof change === 'function' ? change(current.current.rows) : change });
  }
  function setDate(date: string) { if (ready && !clearingNow.current && !current.current.pending) replace({ ...current.current, date }); }
  async function beginSubmission() {
    const value = { ...current.current, pending: true };
    replace(value, false);
    try { await persist(value); }
    catch (error) { replace({ ...current.current, pending: false }, false); throw new Error(error instanceof DraftConflictError ? error.message : draftStorageError); }
    return value;
  }
  async function clear(keepDate = false) {
    if (clearingNow.current || !repository.current) return false;
    clearingNow.current = true; setClearing(true);
    setMessage(keepDate ? 'Concluindo envio...' : 'Descartando rascunho...');
    const epoch = generation.current; operation.current++;
    try {
      if (!repository.current) throw new Error(draftStorageError);
      await repository.current.clear();
      if (generation.current !== epoch) return false;
      const value = blankSalesDraft(); if (keepDate) value.date = current.current.date; current.current = value; setDraft(value); setDirty(false); setFailed(false);
      setMessage('Seu preenchimento será salvo automaticamente neste aparelho.');
      return true;
    } catch (error) {
      if (generation.current === epoch) { setMessage(error instanceof DraftConflictError ? error.message : keepDate ? 'Venda recebida. Não foi possível limpar o rascunho deste aparelho; confirme o envio novamente para concluir.' : 'Não foi possível descartar o rascunho. Os dados foram preservados.'); setFailed(true); }
      return false;
    } finally { clearingNow.current = false; if (generation.current === epoch) setClearing(false); }
  }
  function releaseSubmission() { replace({ ...current.current, pending: false }); }
  return { draft, ready, dirty, clearing, message, failed, setRows, setDate, beginSubmission, clear, releaseSubmission };
}
