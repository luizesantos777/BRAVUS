import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase, SqlStatement } from './database.ts';

export function openSqliteDatabase(filename: string): SqlDatabase {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const native = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  native.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  let pending: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => T | Promise<T>): Promise<T> {
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  }
  const direct: SqlDatabase = {
    native,
    prepare(sql): SqlStatement {
      return {
        async get(...args) { return native.prepare(sql).get(...args); },
        async all(...args) { return native.prepare(sql).all(...args); },
        async run(...args) { return { changes: Number(native.prepare(sql).run(...args).changes) }; },
      };
    },
    async exec(sql) { native.exec(sql); },
    async transaction() { throw new Error('Transações aninhadas não são permitidas.'); },
    close() { native.close(); },
  };
  return {
    native,
    prepare(sql) {
      const statement = direct.prepare(sql);
      return {
        get: (...args) => locked(() => statement.get(...args)),
        all: (...args) => locked(() => statement.all(...args)),
        run: (...args) => locked(() => statement.run(...args)),
      };
    },
    exec: sql => locked(() => direct.exec(sql)),
    transaction: (work, mode = 'write') => locked(async () => {
      native.exec(mode === 'read' ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try { const result = await work(direct); native.exec('COMMIT'); return result; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    }),
    close() { native.close(); },
  };
}
