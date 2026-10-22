import { createClient } from '@libsql/client/http';
import type { Client, InValue, ResultSet, Transaction } from '@libsql/client';
import type { SqlDatabase, SqlRow, SqlValue, TursoConnection } from './database.ts';

function rows(result: ResultSet): SqlRow[] {
  return result.rows.map(row => Object.fromEntries(result.columns.map((name, index) => {
    const value = row[index];
    return [name, value instanceof ArrayBuffer ? new Uint8Array(value) : value];
  })));
}
/** Shared by the HTTP client in production and a libSQL file client in integration tests. */
export function libsqlDatabase(client: Client): SqlDatabase {
  let pending: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work); pending = next.catch(() => undefined); return next;
  }
  async function begin(): Promise<Transaction> {
    for (let attempt = 0; ; attempt++) {
      try { return await client.transaction('write'); }
      catch (error) {
        const code = String((error as { code?: unknown }).code ?? '');
        if (!code.startsWith('SQLITE_BUSY') || attempt >= 5) throw error;
        // The local libSQL client may retain a failed BEGIN statement in its pool.
        // Remote HTTP transactions own separate server streams; they need no pool reset.
        if (client.protocol === 'file') await client.reconnect();
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  }
  function connection(session: Client | Transaction): SqlDatabase {
    const execute = (sql: string, args: SqlValue[]) => session.execute({ sql, args: args as InValue[] });
    return {
      prepare(sql) {
        return {
          async get(...args) { return rows(await execute(sql, args))[0]; },
          async all(...args) { return rows(await execute(sql, args)); },
          async run(...args) { return { changes: (await execute(sql, args)).rowsAffected }; },
        };
      },
      exec: sql => session.executeMultiple(sql),
      async transaction(work) {
        if (session !== client) throw new Error('Transações aninhadas não são permitidas.');
        return locked(async () => {
          const transaction = await begin();
          try { const result = await work(connection(transaction)); await transaction.commit(); return result; }
          catch (error) { if (!transaction.closed) await transaction.rollback().catch(() => undefined); throw error; }
          finally { transaction.close(); }
        });
      },
      close() { client.close(); },
    };
  }
  return connection(client);
}
export function openTursoDatabase(config: TursoConnection): SqlDatabase {
  const url = new URL(config.url);
  if (!['https:', 'libsql:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || !config.authToken.trim()) throw new Error('Configure uma conexão Turso segura e seu token privado.');
  return libsqlDatabase(createClient({ url: config.url, authToken: config.authToken, intMode: 'number' }));
}
