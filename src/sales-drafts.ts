import { businessTime, businessToday, MAX_RECEIPT_BYTES, validDate } from './domain.ts';
import type { ReceiptInput, SaleInput } from './domain.ts';
import { RECEIPT_MIMES } from './receipt-types.ts';

export type DraftRow = SaleInput & { id: string };
export interface SalesDraft { version: 1; date: string; rows: DraftRow[]; requestKey: string; pending: boolean }
interface StoredDraft extends Omit<SalesDraft, 'rows'> { revision: string; rows: (Omit<DraftRow, 'receipt'> & { hasReceipt: boolean })[] }
export const blankDraftRow = (): DraftRow => ({ id: crypto.randomUUID(), amount: '', checkoutId: '', time: businessTime(), note: '', receipt: null });
export const blankSalesDraft = (): SalesDraft => ({ version: 1, date: businessToday(), rows: [blankDraftRow()], requestKey: crypto.randomUUID(), pending: false });
export class DraftConflictError extends Error {
  constructor() { super('Este rascunho foi alterado em outra aba. Continue pelo outro acesso ou copie seus dados antes de recarregar.'); }
}
export const draftStorageError = 'Não foi possível guardar o rascunho neste aparelho. Libere espaço ou use outro navegador antes de enviar. Os dados continuam nesta tela.';

function validate(draft: SalesDraft): SalesDraft {
  if (draft?.version !== 1 || typeof draft.date !== 'string' || draft.date !== '' && !validDate(draft.date) || !/^[A-Za-z0-9_-]{12,100}$/.test(draft.requestKey) || typeof draft.pending !== 'boolean' || !Array.isArray(draft.rows) || !draft.rows.length || draft.rows.length > 10) throw new Error('Não foi possível recuperar este rascunho.');
  const ids = new Set<string>();
  for (const row of draft.rows) {
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || ids.has(row.id) || typeof row.amount !== 'string' || row.amount.length > 16 || typeof row.checkoutId !== 'string' || row.checkoutId.length > 100 || typeof row.time !== 'string' || row.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) || typeof row.note !== 'string' || row.note.length > 500) throw new Error('Não foi possível recuperar este rascunho.');
    ids.add(row.id);
    if (row.receipt && (typeof row.receipt.name !== 'string' || row.receipt.name.length > 180 || !(RECEIPT_MIMES as readonly string[]).includes(row.receipt.mime) || typeof row.receipt.base64 !== 'string' || !row.receipt.base64 || row.receipt.base64.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.receipt.base64))) throw new Error('Não foi possível recuperar o comprovante do rascunho.');
  }
  return draft;
}

/** Metadata is small; unchanged prints are never rewritten on each keystroke. */
export class SalesDraftStore {
  private database?: Promise<IDBDatabase>;
  private queue: Promise<unknown> = Promise.resolve();
  private revision: string | null = null;
  private receipts = new Map<string, ReceiptInput | null>();
  constructor(private scope: string) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bravus-sales-drafts-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); request.result.createObjectStore('receipts'); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(draftStorageError));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); this.database = undefined; };
        resolve(database);
      };
    }).catch(error => { this.database = undefined; throw error; });
    return this.database;
  }
  load(): Promise<SalesDraft | null> {
    return this.enqueue(async () => {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(['drafts', 'receipts'], 'readonly');
        let metadata: StoredDraft | undefined, failure: unknown;
        const receipts = new Map<string, ReceiptInput>();
        const request = transaction.objectStore('drafts').get(this.scope);
        request.onsuccess = () => {
          try {
            metadata = request.result;
            this.revision = metadata?.revision ?? null;
            if (!metadata) return;
            if (typeof metadata.revision !== 'string' || !Array.isArray(metadata.rows) || metadata.rows.length > 10) throw new Error('Não foi possível recuperar este rascunho.');
            for (const row of metadata.rows) if (row.hasReceipt) {
              const attachment = transaction.objectStore('receipts').get(this.scope + ':' + row.id);
              attachment.onsuccess = () => receipts.set(row.id, attachment.result);
            }
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error(draftStorageError));
        transaction.oncomplete = () => {
          try {
            if (!metadata) return resolve(null);
            const rows = metadata.rows.map(({ hasReceipt, ...row }) => {
              const receipt = hasReceipt ? receipts.get(row.id) : null;
              if (hasReceipt && !receipt) throw new Error('Não foi possível recuperar o print do rascunho.');
              return { ...row, receipt: receipt ?? null };
            });
            const draft = validate({ version: metadata.version, date: metadata.date, rows, requestKey: metadata.requestKey, pending: metadata.pending });
            this.receipts = new Map(rows.map(row => [row.id, row.receipt]));
            resolve(draft);
          } catch (error) { reject(error); }
        };
      });
    });
  }
  save(draft: SalesDraft): Promise<void> {
    return this.enqueue(async () => {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['drafts', 'receipts'], 'readwrite');
        let failure: unknown;
        const revision = crypto.randomUUID();
        const request = transaction.objectStore('drafts').get(this.scope);
        request.onsuccess = () => {
          try {
            if ((request.result?.revision ?? null) !== this.revision) throw new DraftConflictError();
            const metadata: StoredDraft = { ...draft, revision, rows: draft.rows.map(({ receipt, ...row }) => ({ ...row, hasReceipt: !!receipt })) };
            transaction.objectStore('drafts').put(metadata, this.scope);
            const attachments = transaction.objectStore('receipts');
            for (const row of draft.rows) if (row.receipt !== this.receipts.get(row.id)) {
              if (row.receipt) attachments.put(row.receipt, this.scope + ':' + row.id);
              else attachments.delete(this.scope + ':' + row.id);
            }
            const ids = new Set(draft.rows.map(row => row.id));
            for (const id of this.receipts.keys()) if (!ids.has(id)) attachments.delete(this.scope + ':' + id);
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error(draftStorageError));
        transaction.oncomplete = () => { this.revision = revision; this.receipts = new Map(draft.rows.map(row => [row.id, row.receipt])); resolve(); };
      });
    });
  }
  clear(): Promise<void> {
    return this.enqueue(async () => {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['drafts', 'receipts'], 'readwrite');
        let failure: unknown;
        const request = transaction.objectStore('drafts').get(this.scope);
        request.onsuccess = () => {
          try {
            if ((request.result?.revision ?? null) !== this.revision) throw new DraftConflictError();
            transaction.objectStore('drafts').delete(this.scope);
            transaction.objectStore('receipts').delete(IDBKeyRange.bound(this.scope + ':', this.scope + ':\uffff'));
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error(draftStorageError));
        transaction.oncomplete = () => { this.revision = null; this.receipts.clear(); resolve(); };
      });
    });
  }
  close() { void this.enqueue(async () => { const database = await this.database; database?.close(); this.database = undefined; }).catch(() => undefined); }
}
