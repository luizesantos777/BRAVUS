import { createHash, randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { get, put, del, issueSignedToken, presignUrl } from '@vercel/blob';
import { businessToday } from '../src/domain.ts';
import type { BackupRecord, BackupStatus } from '../src/admin-domain.ts';
import { PortalError, PortalStore } from './store.ts';
import type { SqlDatabase, SqlValue } from './database.ts';

const compress = promisify(gzip), decompress = promisify(gunzip);
const MAX_BYTES = 128 * 1024 * 1024;
const TABLES = ['attendants', 'checkouts', 'schema_migrations', 'batches', 'receipts', 'sales', 'costs', 'payouts', 'push_subscriptions', 'admin_push_subscriptions', 'push_server_keys', 'backup_runs', 'audit_events'] as const;
type EncodedValue = string | number | null | { binary: string };
interface Archive { format: 'bravus-backup'; version: 1; createdAt: string; backupId?: string; tables: { name: string; columns: string[]; rows: EncodedValue[][] }[] }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const pathFor = (id: string) => {
  if (!/^(daily-\d{4}-\d{2}-\d{2}(?:-[a-f0-9-]{36})?|manual-[a-f0-9-]{36})$/.test(id)) throw new PortalError(400, 'Identificador do backup inválido.');
  return `bravus-backups/${id}.json.gz`;
};

export async function createArchive(store: PortalStore, backupId?: string): Promise<Buffer> {
  const archive = await store.sql.transaction(async db => {
    const tables: Archive['tables'] = [];
    let size = 0;
    for (const name of TABLES) {
      const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).map(column => String(column.name));
      const rows = (await db.prepare(`SELECT * FROM ${name}`).all()).map(row => columns.map(column => {
        const value = row[column];
        if (value instanceof Uint8Array) return { binary: Buffer.from(value).toString('base64') };
        if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)) return value;
        throw new Error('Unsupported backup value');
      }));
      const table = { name, columns, rows }; size += Buffer.byteLength(JSON.stringify(table));
      if (size > MAX_BYTES) throw new PortalError(413, 'A cópia ultrapassou o limite de 128 MB. O armazenamento precisa ser ampliado.');
      tables.push(table);
    }
    return { format: 'bravus-backup', version: 1, createdAt: new Date().toISOString(), ...(backupId ? { backupId } : {}), tables } satisfies Archive;
  }, 'read');
  return compress(Buffer.from(JSON.stringify(archive)));
}

async function decodeArchive(bytes: Buffer): Promise<Archive> {
  if (bytes.length > MAX_BYTES) throw new Error('Invalid backup size');
  const archive = JSON.parse((await decompress(bytes, { maxOutputLength: MAX_BYTES + 1024 * 1024 })).toString('utf8')) as Archive;
  if (archive.format !== 'bravus-backup' || archive.version !== 1 || !Array.isArray(archive.tables) || archive.tables.length !== TABLES.length || new Set(archive.tables.map(table => table.name)).size !== TABLES.length || TABLES.some(name => !archive.tables.some(table => table.name === name))) throw new Error('Invalid backup format');
  return archive;
}
async function importArchive(db: SqlDatabase, archive: Archive) {
  // Recovery always targets an empty, separate database, never the live database.
  if (Number((await db.prepare('SELECT COUNT(*) AS count FROM attendants').get())!.count) || Number((await db.prepare('SELECT COUNT(*) AS count FROM audit_events').get())!.count)) throw new Error('Recovery requires an empty database');
  await db.transaction(async connection => {
    for (const name of [...TABLES].reverse()) if (name !== 'audit_events') await connection.prepare(`DELETE FROM ${name}`).run();
    for (const name of TABLES) {
      const table = archive.tables.find(item => item.name === name)!;
      const expected = (await connection.prepare(`PRAGMA table_info(${name})`).all()).map(column => String(column.name));
      if (!Array.isArray(table.columns) || table.columns.length !== expected.length || new Set(table.columns).size !== expected.length || table.columns.some(column => !expected.includes(column)) || !Array.isArray(table.rows)) throw new Error('Invalid backup columns');
      const statement = connection.prepare(`INSERT INTO ${name} (${table.columns.map(column => '"' + column + '"').join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`);
      for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length) throw new Error('Invalid backup row');
        const values: SqlValue[] = row.map(value => {
          if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)) return value;
          if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.binary === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.binary)) return Buffer.from(value.binary, 'base64');
          throw new Error('Invalid backup value');
        });
        await statement.run(...values);
      }
      if (Number((await connection.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get())!.count) !== table.rows.length) throw new Error('Backup row count mismatch');
    }
    if ((await connection.prepare('PRAGMA foreign_key_check').all()).length || (await connection.prepare('PRAGMA quick_check').all()).some(row => Object.values(row)[0] !== 'ok')) throw new Error('Backup integrity check failed');
  });
}
export async function restoreArchive(bytes: Buffer, destination: PortalStore) {
  const archive = await decodeArchive(bytes);
  if (archive.backupId) pathFor(archive.backupId);
  await importArchive(destination.sql, archive);
  // Preserve the catalog and recognize the recovered copy itself without storing
  // its own checksum recursively inside the archive.
  if (archive.backupId) await destination.sql.prepare("UPDATE backup_runs SET status = 'verified', verified_at = ?, size_bytes = ?, sha256 = ?, error = '' WHERE id = ?").run(new Date().toISOString(), bytes.length, hash(bytes), archive.backupId);
}
export async function verifyArchive(bytes: Buffer) {
  const copy = await PortalStore.open(':memory:');
  try { await restoreArchive(bytes, copy); } finally { copy.close(); }
}

export interface BackupStorage {
  destination: 'private-blob' | 'private-folder';
  write(id: string, bytes: Buffer): Promise<void>;
  read(id: string): Promise<Buffer>;
  remove(id: string): Promise<void>;
  downloadUrl?(id: string): Promise<string>;
}
export function privateFolder(directory: string): BackupStorage {
  const filename = (id: string) => join(directory, pathFor(id).split('/').at(-1)!);
  return {
    destination: 'private-folder',
    async write(id, bytes) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(filename(id), bytes, { mode: 0o600, flag: 'wx', flush: true });
    },
    read: id => readFile(filename(id)),
    remove: id => unlink(filename(id)),
  };
}
export function privateBlob(token: string, signing = { issue: issueSignedToken, url: presignUrl }): BackupStorage {
  return {
    destination: 'private-blob',
    async write(id, bytes) { await put(pathFor(id), bytes, { access: 'private', token, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/gzip', cacheControlMaxAge: 60 }); },
    async read(id) {
      const result = await get(pathFor(id), { access: 'private', token, useCache: false });
      if (!result || result.statusCode !== 200) throw new Error('Backup not found');
      const reader = result.stream.getReader(), parts: Buffer[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_BYTES) throw new Error('Backup exceeds size limit'); parts.push(Buffer.from(next.value)); } }
      finally { await reader.cancel().catch(() => undefined); }
      return Buffer.concat(parts);
    },
    async remove(id) { await del(pathFor(id), { token }); },
    async downloadUrl(id) {
      const pathname = pathFor(id), validUntil = Date.now() + 2 * 60_000;
      const signed = await signing.issue({ token, pathname, operations: ['get'], validUntil });
      return (await signing.url(signed, { operation: 'get', pathname, access: 'private', validUntil, useCache: false })).presignedUrl;
    },
  };
}

export class BackupService {
  private store: PortalStore;
  private storage: BackupStorage | null;
  readonly scheduled: boolean;
  constructor(store: PortalStore, storage: BackupStorage | null, scheduled = false) { this.store = store; this.storage = storage; this.scheduled = scheduled; }
  async status(): Promise<BackupStatus> {
    const records = await this.store.sql.prepare('SELECT id, kind, status, started_at AS startedAt, verified_at AS verifiedAt, size_bytes AS sizeBytes, error FROM backup_runs ORDER BY started_at DESC LIMIT 50').all() as unknown as BackupRecord[];
    return { configured: this.storage !== null, destination: this.storage?.destination ?? 'unconfigured', scheduled: this.scheduled, automatic: !this.storage ? 'Aguardando armazenamento privado' : this.scheduled ? 'Todos os dias, às 03h de Brasília' : 'Uma cópia por dia ao abrir o painel', retentionDays: 30, records };
  }
  async run(kind: 'daily' | 'manual', now = new Date()): Promise<BackupRecord> {
    if (!this.storage) throw new PortalError(503, 'Conecte um armazenamento Blob privado ao projeto na Vercel para ativar os backups.');
    const day = kind === 'daily' ? businessToday(now) : null;
    let id = kind === 'daily' ? 'daily-' + day + '-' + randomUUID() : 'manual-' + randomUUID();
    const startedAt = now.toISOString();
    const existing = await this.store.sql.transaction(async db => {
      const previous = day ? await db.prepare("SELECT id FROM backup_runs WHERE day_key = ? AND status = 'verified'").get(day) : undefined;
      if (previous) { id = String(previous.id); return true; }
      if (await db.prepare("SELECT id FROM backup_runs WHERE status = 'running' AND started_at > ?").get(new Date(now.getTime() - 10 * 60_000).toISOString())) throw new PortalError(409, 'Uma cópia de segurança já está em andamento. Aguarde a conclusão.');
      await db.prepare("UPDATE backup_runs SET status = 'failed', error = 'A cópia foi interrompida. Tente novamente.' WHERE status = 'running'").run();
      await db.prepare("INSERT INTO backup_runs (id, kind, status, started_at, day_key) VALUES (?, ?, 'running', ?, ?)").run(id, kind, startedAt, day);
      return false;
    });
    if (!existing) {
      try {
        const archive = await createArchive(this.store, id), checksum = hash(archive);
        await this.storage.write(id, archive);
        const downloaded = await this.storage.read(id);
        if (hash(downloaded) !== checksum) throw new Error('Backup checksum mismatch');
        await verifyArchive(downloaded);
        await this.store.sql.prepare("UPDATE backup_runs SET status = 'verified', verified_at = ?, size_bytes = ?, sha256 = ? WHERE id = ?").run(new Date().toISOString(), downloaded.length, checksum, id);
      } catch {
        const message = 'Não foi possível criar e verificar esta cópia. O último backup válido foi preservado.';
        await this.store.sql.prepare("UPDATE backup_runs SET status = 'failed', error = ? WHERE id = ?").run(message, id);
        throw new PortalError(503, message);
      }
      // Prune only older copies after the new one has passed an actual recovery test.
      const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
      for (const record of await this.store.sql.prepare('SELECT id FROM backup_runs WHERE started_at < ? AND id <> ?').all(cutoff, id)) {
        try { await this.storage.remove(String(record.id)); await this.store.sql.prepare('DELETE FROM backup_runs WHERE id = ?').run(String(record.id)); } catch { /* Retaining extra copies is preferable to losing a verified backup. */ }
      }
    }
    return await this.store.sql.prepare('SELECT id, kind, status, started_at AS startedAt, verified_at AS verifiedAt, size_bytes AS sizeBytes, error FROM backup_runs WHERE id = ?').get(id) as unknown as BackupRecord;
  }
  async download(id: string): Promise<Buffer> {
    pathFor(id);
    const record = await this.store.sql.prepare("SELECT sha256 FROM backup_runs WHERE id = ? AND status = 'verified'").get(id);
    if (!this.storage || !record) throw new PortalError(404, 'Cópia verificada não encontrada.');
    try {
      const bytes = await this.storage.read(id);
      if (hash(bytes) !== record.sha256) throw new Error('Backup checksum mismatch');
      return bytes;
    } catch { throw new PortalError(503, 'Não foi possível conferir a integridade desta cópia. Tente novamente ou use outra cópia verificada.'); }
  }
  async downloadUrl(id: string): Promise<string | null> {
    pathFor(id);
    if (!this.storage?.downloadUrl) return null;
    if (!await this.store.sql.prepare("SELECT id FROM backup_runs WHERE id = ? AND status = 'verified'").get(id)) throw new PortalError(404, 'Cópia verificada não encontrada.');
    try {
      const url = new URL(await this.storage.downloadUrl(id));
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.vercel-storage.com') || url.username || url.password) throw new Error('Invalid private download');
      return url.href;
    } catch { throw new PortalError(503, 'Não foi possível autorizar o download privado. Tente novamente.'); }
  }
}
