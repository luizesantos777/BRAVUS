import { auditActions, financialReport, validateDateRange } from '../src/admin-domain.ts';
import type { AuditEntry, AuditPage } from '../src/admin-domain.ts';
import type { AdminAttendant, AdminCost, AdminPayout, AdminSale } from '../src/domain.ts';
import { PortalError } from './store.ts';
import type { PortalStore } from './store.ts';

export async function readFinancialReport(store: PortalStore, start: string, end: string, attendantId = '') {
  try { validateDateRange(start, end); } catch (error) { throw new PortalError(400, (error as Error).message); }
  if (attendantId && !/^[a-zA-Z0-9_-]{1,100}$/.test(attendantId)) throw new PortalError(400, 'Atendente inválido.');
  return store.sql.transaction(async db => {
    const attendants = await db.prepare('SELECT id, name FROM attendants WHERE (? = \'\' OR id = ?)').all(attendantId, attendantId) as unknown as AdminAttendant[];
    if (attendantId && !attendants.length) throw new PortalError(404, 'Atendente não encontrado.');
    const sales = await db.prepare('SELECT attendant_id AS attendantId, date, status, amount_cents AS amountCents, fee_cents AS feeCents, attendant_fee_cents AS attendantFeeCents, commission_bps AS commissionBps, commission_mode AS commissionMode FROM sales WHERE date BETWEEN ? AND ? AND (? = \'\' OR attendant_id = ?)').all(start, end, attendantId, attendantId) as unknown as AdminSale[];
    const costs = await db.prepare('SELECT attendant_id AS attendantId, date, ads_cents AS adsCents, withdrawal_fee_cents AS withdrawalFeeCents FROM costs WHERE date BETWEEN ? AND ? AND (? = \'\' OR attendant_id = ?)').all(start, end, attendantId, attendantId) as unknown as AdminCost[];
    const payouts = await db.prepare("SELECT attendant_id AS attendantId, status, amount_cents AS amountCents, withdrawal_fee_cents AS withdrawalFeeCents, gateway_fee_cents AS gatewayFeeCents, paid_at AS paidAt, requested_at AS requestedAt FROM payouts WHERE status = 'paid' AND (? = '' OR attendant_id = ?)").all(attendantId, attendantId) as unknown as AdminPayout[];
    return financialReport({ attendants, sales, costs, payouts }, start, end, attendantId);
  }, 'read');
}

export async function readAudit(store: PortalStore, parameters: URLSearchParams): Promise<AuditPage> {
  const start = parameters.get('start') ?? '', end = parameters.get('end') ?? '', action = parameters.get('action') ?? '', page = Number(parameters.get('page') ?? '1'), pageSize = 50;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || action && !Object.hasOwn(auditActions, action)) throw new PortalError(400, 'Filtro do histórico inválido.');
  if (start || end) { try { validateDateRange(start, end); } catch (error) { throw new PortalError(400, (error as Error).message); } }
  const upper = end ? new Date(new Date(end + 'T03:00:00.000Z').getTime() + 86400000).toISOString() : '';
  const where = "WHERE (? = '' OR created_at >= ?) AND (? = '' OR created_at < ?) AND (? = '' OR action = ?)";
  const args = [start, start ? start + 'T03:00:00.000Z' : '', end, upper, action, action];
  return store.sql.transaction(async db => {
    const total = Number((await db.prepare('SELECT COUNT(*) AS count FROM audit_events ' + where).get(...args))!.count);
    const rows = await db.prepare(`SELECT id, created_at AS createdAt, actor_name AS actorName, action, target_id AS targetId, target_name AS targetName, before_json, after_json FROM audit_events ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    const entries = rows.map(({ before_json, after_json, ...row }) => ({ ...row, before: before_json === null ? null : JSON.parse(String(before_json)), after: after_json === null ? null : JSON.parse(String(after_json)) })) as unknown as AuditEntry[];
    return { entries, total, page, pageSize };
  }, 'read');
}
