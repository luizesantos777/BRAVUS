import type { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, unknown>;
export interface SqlStatement {
  get(...args: SqlValue[]): Promise<SqlRow | undefined>;
  all(...args: SqlValue[]): Promise<SqlRow[]>;
  run(...args: SqlValue[]): Promise<{ changes: number }>;
}
export interface SqlDatabase {
  readonly native?: DatabaseSync;
  prepare(sql: string): SqlStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(work: (connection: SqlDatabase) => Promise<T>, mode?: 'read' | 'write'): Promise<T>;
  close(): void;
}
export interface TursoConnection { url: string; authToken: string }
export async function openDatabase(source: string | TursoConnection): Promise<SqlDatabase> {
  if (typeof source === 'string') {
    const { openSqliteDatabase } = await import('./sqlite-database.ts');
    return openSqliteDatabase(source);
  }
  const { openTursoDatabase } = await import('./turso-database.ts');
  return openTursoDatabase(source);
}
