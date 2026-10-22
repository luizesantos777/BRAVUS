import { randomUUID } from 'node:crypto';
import type { SqlDatabase } from './database.ts';
import type { AuditAction, AuditValues } from '../src/admin-domain.ts';

export async function appendAudit(db: SqlDatabase, actor: { id: string; name: string }, action: AuditAction, targetId: string, targetName: string, before: AuditValues | null, after: AuditValues | null) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await db.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), new Date().toISOString(), actor.id, actor.name, action, targetId, targetName, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after));
}

export const controlsSchema = `
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
    action TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_created ON audit_events(created_at DESC, id);
  CREATE INDEX IF NOT EXISTS audit_action_created ON audit_events(action, created_at DESC);
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit entries are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit entries are immutable'); END;
  CREATE TABLE IF NOT EXISTS backup_runs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('daily','manual')),
    status TEXT NOT NULL CHECK(status IN ('running','verified','failed')), started_at TEXT NOT NULL,
    verified_at TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', day_key TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS backup_daily_active ON backup_runs(day_key) WHERE status IN ('running','verified');
  CREATE TABLE IF NOT EXISTS push_server_keys (id INTEGER PRIMARY KEY CHECK(id=1), public_key TEXT NOT NULL, private_key TEXT NOT NULL);
`;
