import { rmSync } from 'node:fs';

type ClosableStore = {
  sql: { exec(sql: string): Promise<unknown> };
  close(): void;
};

/** Flushes file-backed libSQL before closing it, avoiding Windows EBUSY cleanup races. */
export async function disposeTestStore(store: ClosableStore, directory: string) {
  await disposeTestStores([store], directory);
}

export async function disposeTestStores(stores: ClosableStore[], directory: string) {
  for (const store of stores) {
    try { await store.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  }
  for (const store of stores) store.close();
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

/** Remove um diretório temporário já liberado pelas lojas; tolera travas transitórias do Windows (EBUSY). */
export function removeTempDir(directory: string) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}
