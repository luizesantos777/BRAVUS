import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { amountToCents, businessToday, calculateFinance, inPeriod, MAX_RECEIPT_BYTES, percentageToBps, validateProfile, validDate } from '../src/domain.ts';
import type { AdminAttendant, AdminDashboard, AdminPayout, Checkout, DailyCost, Invitation, Period, Portal, Profile, Payout, RankingEntry, ReceiptInput, Sale, SaleBatch } from '../src/domain.ts';

export class PortalError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export interface Authenticated { id: string }
interface AttendantRow { id: string; name: string; email: string; phone: string; pix_type: Profile['pixType']; pix_key: string; pix_owner: string; commission_bps: number; daily_goal_cents: number }
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const invalid = (message: string): never => { throw new PortalError(400, message); };

export class PortalStore {
  db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS attendants (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', pix_type TEXT NOT NULL DEFAULT '', pix_key TEXT NOT NULL DEFAULT '', pix_owner TEXT NOT NULL DEFAULT '', commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000), daily_goal_cents INTEGER NOT NULL CHECK(daily_goal_cents > 0), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkouts (id TEXT PRIMARY KEY, name TEXT NOT NULL, fee_bps INTEGER NOT NULL CHECK(fee_bps BETWEEN 0 AND 10000));
      INSERT OR IGNORE INTO checkouts VALUES ('main', 'Checkout principal', 0), ('pix', 'PIX manual', 0);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, UNIQUE(attendant_id, request_key));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), batch_id TEXT NOT NULL REFERENCES batches(id), date TEXT NOT NULL, time TEXT NOT NULL, checkout_id TEXT NOT NULL REFERENCES checkouts(id), checkout_name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), fee_cents INTEGER NOT NULL, commission_bps INTEGER NOT NULL, goal_cents INTEGER NOT NULL, note TEXT NOT NULL, receipt_id TEXT NOT NULL REFERENCES receipts(id), created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sales_attendant_date ON sales(attendant_id, date);
      CREATE TABLE IF NOT EXISTS costs (attendant_id TEXT NOT NULL REFERENCES attendants(id), date TEXT NOT NULL, ads_cents INTEGER NOT NULL CHECK(ads_cents >= 0), withdrawal_fee_cents INTEGER NOT NULL CHECK(withdrawal_fee_cents >= 0), PRIMARY KEY(attendant_id, date));
      CREATE TABLE IF NOT EXISTS payouts (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled')), requested_at TEXT NOT NULL, paid_at TEXT, note TEXT NOT NULL, pix_type TEXT NOT NULL, pix_key TEXT NOT NULL, pix_owner TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  adminDashboard(): AdminDashboard {
    const rows = this.db.prepare(`SELECT a.id, a.name, a.active, a.commission_bps AS commissionBps, a.daily_goal_cents AS dailyGoalCents, a.created_at AS createdAt, COUNT(s.id) AS salesCount, COALESCE(SUM(s.amount_cents), 0) AS grossCents FROM attendants a LEFT JOIN sales s ON s.attendant_id = a.id GROUP BY a.id ORDER BY a.created_at DESC`).all();
    const attendants = rows.map(row => ({ ...row, active: row.active === 1 })) as unknown as AdminAttendant[];
    const payouts = this.db.prepare(`SELECT p.id, p.attendant_id AS attendantId, a.name AS attendantName, p.amount_cents AS amountCents, p.status, p.requested_at AS requestedAt, p.paid_at AS paidAt, p.note, p.pix_type AS pixType, p.pix_key AS pixKey, p.pix_owner AS pixOwner FROM payouts p JOIN attendants a ON a.id = p.attendant_id ORDER BY p.requested_at DESC`).all() as unknown as AdminPayout[];
    return { attendants, payouts, checkouts: this.checkouts() };
  }
  adminCreateAttendant(input: unknown): Invitation {
    const data = this.adminFields(input);
    if (typeof data.name !== 'string' || typeof data.commission !== 'string' || typeof data.dailyGoal !== 'string') invalid('Informe nome, comissão e meta diária.');
    let commission: number, goal: number;
    try { commission = percentageToBps(data.commission as string); goal = amountToCents(data.dailyGoal as string); }
    catch (error) { return invalid((error as Error).message); }
    const name = (data.name as string).trim();
    const { id, token } = this.createAttendant(name, commission, goal);
    return { attendantId: id, name, token };
  }
  private adminFields(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Dados inválidos.');
    return input as Record<string, unknown>;
  }
  rotateToken(id: string): Invitation {
    const row = this.db.prepare('SELECT name, active FROM attendants WHERE id = ?').get(id);
    if (!row) throw new PortalError(404, 'Atendente não encontrado.');
    if (row.active !== 1) invalid('Reative o atendente antes de gerar um novo token.');
    const token = `atd_${randomBytes(32).toString('base64url')}`;
    this.db.prepare('UPDATE attendants SET token_hash = ? WHERE id = ?').run(tokenHash(token), id);
    return { attendantId: id, name: String(row.name), token };
  }
  setAttendantActive(id: string, input: unknown) {
    const data = this.adminFields(input);
    if (typeof data.active !== 'boolean') invalid('Informe se o acesso deve ficar ativo ou revogado.');
    const result = this.db.prepare('UPDATE attendants SET active = ? WHERE id = ?').run(data.active ? 1 : 0, id);
    if (!result.changes) throw new PortalError(404, 'Atendente não encontrado.');
  }
  adminSetCosts(id: string, input: unknown) {
    const data = this.adminFields(input);
    if (!this.db.prepare('SELECT id FROM attendants WHERE id = ?').get(id)) throw new PortalError(404, 'Atendente não encontrado.');
    if (typeof data.date !== 'string' || typeof data.ads !== 'string' || typeof data.withdrawalFee !== 'string') invalid('Informe data, custo ADS e taxa de saque.');
    const amount = (value: string) => /^0+(?:[.,]0{1,2})?$/.test(value.trim()) ? 0 : amountToCents(value);
    try { this.setCosts(id, data.date as string, amount(data.ads as string), amount(data.withdrawalFee as string)); }
    catch (error) { if (error instanceof PortalError) throw error; invalid((error as Error).message); }
  }
  adminCosts(id: string, date: string): DailyCost {
    if (!validDate(date)) invalid('Informe uma data válida.');
    if (!this.db.prepare('SELECT id FROM attendants WHERE id = ?').get(id)) throw new PortalError(404, 'Atendente não encontrado.');
    return this.costs({ id }).find(cost => cost.date === date) ?? { date, adsCents: 0, withdrawalFeeCents: 0 };
  }
  adminSetCheckout(id: string, input: unknown) {
    const data = this.adminFields(input);
    if (!this.db.prepare('SELECT id FROM checkouts WHERE id = ?').get(id)) throw new PortalError(404, 'Checkout não encontrado.');
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.fee !== 'string') invalid('Informe nome e percentual de taxa.');
    let fee: number;
    try { fee = percentageToBps(data.fee as string); } catch (error) { return invalid((error as Error).message); }
    this.db.prepare('UPDATE checkouts SET name = ?, fee_bps = ? WHERE id = ?').run((data.name as string).trim(), fee, id);
  }
  createAttendant(name: string, commissionBps: number, dailyGoalCents = 20000, providedToken?: string) {
    if (!name.trim() || name.length > 120 || !Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10000 || !Number.isSafeInteger(dailyGoalCents) || dailyGoalCents <= 0) invalid('Nome, comissão e meta são obrigatórios e devem ser válidos.');
    const token = providedToken ?? `atd_${randomBytes(32).toString('base64url')}`;
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) invalid('Token inválido.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO attendants (id, token_hash, name, commission_bps, daily_goal_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, tokenHash(token), name.trim(), commissionBps, dailyGoalCents, new Date().toISOString());
    return { id, token };
  }
  authenticate(token: string): Authenticated {
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    const row = this.db.prepare('SELECT id FROM attendants WHERE token_hash = ? AND active = 1').get(tokenHash(token));
    if (!row) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    return { id: String(row.id) };
  }
  profile(auth: Authenticated): Profile {
    const row = this.db.prepare('SELECT id, name, email, phone, pix_type, pix_key, pix_owner, commission_bps, daily_goal_cents FROM attendants WHERE id = ?').get(auth.id) as unknown as AttendantRow;
    if (!row) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    return { id: row.id, name: row.name, email: row.email, phone: row.phone, pixType: row.pix_type, pixKey: row.pix_key, pixOwner: row.pix_owner, commissionBps: row.commission_bps, dailyGoalCents: row.daily_goal_cents };
  }
  checkouts(): Checkout[] { return this.db.prepare('SELECT id, name, fee_bps AS feeBps FROM checkouts ORDER BY rowid').all() as unknown as Checkout[]; }
  sales(auth: Authenticated): Sale[] { return this.db.prepare('SELECT id, date, time, checkout_id AS checkoutId, checkout_name AS checkoutName, amount_cents AS amountCents, fee_cents AS feeCents, commission_bps AS commissionBps, goal_cents AS goalCents, note, receipt_id AS receiptId, created_at AS createdAt FROM sales WHERE attendant_id = ? ORDER BY date DESC, time DESC, created_at DESC').all(auth.id) as unknown as Sale[]; }
  costs(auth: Authenticated): DailyCost[] { return this.db.prepare('SELECT date, ads_cents AS adsCents, withdrawal_fee_cents AS withdrawalFeeCents FROM costs WHERE attendant_id = ?').all(auth.id) as unknown as DailyCost[]; }
  payouts(auth: Authenticated): Payout[] { return this.db.prepare('SELECT id, amount_cents AS amountCents, status, requested_at AS requestedAt, paid_at AS paidAt, note FROM payouts WHERE attendant_id = ? ORDER BY requested_at DESC').all(auth.id) as unknown as Payout[]; }
  portal(auth: Authenticated, period: Period = 'today'): Portal {
    const profile = this.profile(auth), sales = this.sales(auth), costs = this.costs(auth), payouts = this.payouts(auth), today = businessToday();
    return { profile, checkouts: this.checkouts(), sales: sales.filter(sale => inPeriod(sale.date, period, today)).slice(0, 100), payouts, finance: calculateFinance(sales, costs, payouts, period, today), todayGrossCents: sales.filter(sale => sale.date === today).reduce((sum, sale) => sum + sale.amountCents, 0), today };
  }
  saveProfile(auth: Authenticated, input: unknown): Profile {
    let fields: ReturnType<typeof validateProfile>;
    try { fields = validateProfile(input); } catch (error) { return invalid((error as Error).message); }
    this.db.prepare('UPDATE attendants SET name = ?, email = ?, phone = ?, pix_type = ?, pix_key = ?, pix_owner = ? WHERE id = ?').run(fields.name, fields.email, fields.phone, fields.pixType, fields.pixKey, fields.pixOwner, auth.id);
    return this.profile(auth);
  }
  receiptInput(value: unknown): { name: string; mime: string; bytes: Buffer } {
    if (!value || typeof value !== 'object') return invalid('Anexe o print de cada venda.');
    const receipt = value as ReceiptInput;
    if (typeof receipt.name !== 'string' || !receipt.name || receipt.name.length > 180 || typeof receipt.base64 !== 'string' || receipt.base64.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.base64)) return invalid('O comprovante deve ser uma imagem válida de até 2 MB.');
    const bytes = Buffer.from(receipt.base64, 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES || !(receipt.mime === 'image/png' && png || receipt.mime === 'image/jpeg' && jpeg || receipt.mime === 'image/webp' && webp)) return invalid('Use um print PNG, JPG ou WEBP válido, de até 2 MB.');
    return { name: receipt.name, mime: receipt.mime, bytes };
  }
  recordSales(auth: Authenticated, input: unknown, requestKey: string): { duplicate: boolean; count: number } {
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestKey)) invalid('Identificador de envio inválido. Atualize a página.');
    if (!input || typeof input !== 'object') invalid('Lançamento inválido.');
    const batch = input as SaleBatch;
    if (typeof batch.date !== 'string' || !validDate(batch.date) || batch.date > businessToday()) invalid('Informe uma data válida, até hoje.');
    if (!Array.isArray(batch.sales) || !batch.sales.length || batch.sales.length > 10) invalid('Envie entre 1 e 10 vendas por vez.');
    const profile = this.profile(auth), checkouts = this.checkouts();
    const normalized = batch.sales.map(row => {
      if (!row || typeof row !== 'object' || typeof row.amount !== 'string' || typeof row.note !== 'string' || row.note.length > 500 || typeof row.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) return invalid('Confira o valor, o horário e a observação de cada venda.');
      const checkout = checkouts.find(item => item.id === row.checkoutId);
      if (!checkout) return invalid('Selecione um checkout válido para cada venda.');
      let amountCents: number;
      try { amountCents = amountToCents(row.amount); } catch (error) { return invalid((error as Error).message); }
      return { amountCents, checkout, time: row.time, note: row.note.trim(), receipt: this.receiptInput(row.receipt) };
    });
    const payloadHash = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
    const existing = this.db.prepare('SELECT id, payload_hash FROM batches WHERE attendant_id = ? AND request_key = ?').get(auth.id, requestKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new PortalError(409, 'Este envio já foi registrado com outros dados. Confira o histórico e atualize a página antes de lançar novas vendas.');
      return { duplicate: true, count: normalized.length };
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const batchId = randomUUID(), createdAt = new Date().toISOString();
      this.db.prepare('INSERT INTO batches VALUES (?, ?, ?, ?)').run(batchId, auth.id, requestKey, payloadHash);
      for (const row of normalized) {
        const receiptId = randomUUID();
        this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?)').run(receiptId, auth.id, row.receipt.name, row.receipt.mime, row.receipt.bytes);
        this.db.prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), auth.id, batchId, batch.date, row.time, row.checkout.id, row.checkout.name, row.amountCents, Math.round(row.amountCents * row.checkout.feeBps / 10000), profile.commissionBps, profile.dailyGoalCents, row.note, receiptId, createdAt);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { duplicate: false, count: normalized.length };
  }
  receipt(auth: Authenticated, id: string) {
    const row = this.db.prepare('SELECT mime, bytes FROM receipts WHERE id = ? AND attendant_id = ?').get(id, auth.id);
    if (!row) throw new PortalError(404, 'Comprovante não encontrado.');
    return { mime: String(row.mime), bytes: row.bytes as Uint8Array };
  }
  ranking(auth: Authenticated, period: Period): RankingEntry[] {
    const attendants = this.db.prepare('SELECT id, name FROM attendants WHERE active = 1').all();
    return attendants.map(attendant => {
      const sales = this.sales({ id: String(attendant.id) }).filter(sale => inPeriod(sale.date, period, businessToday()));
      return { id: String(attendant.id), name: String(attendant.name), grossCents: sales.reduce((sum, sale) => sum + sale.amountCents, 0), count: sales.length, mine: attendant.id === auth.id };
    }).filter(item => item.count > 0).sort((a, b) => b.grossCents - a.grossCents || b.count - a.count || a.name.localeCompare(b.name));
  }
  requestPayout(auth: Authenticated, input: unknown): Payout {
    if (!input || typeof input !== 'object' || typeof (input as { amount?: unknown }).amount !== 'string') invalid('Informe o valor do repasse.');
    let amountCents: number;
    try { amountCents = amountToCents((input as { amount: string }).amount); } catch (error) { return invalid((error as Error).message); }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const profile = this.profile(auth), portal = this.portal(auth, 'all');
      if (!profile.pixKey || !profile.pixOwner) invalid('Cadastre sua chave PIX e o titular antes de solicitar um repasse.');
      if (amountCents > portal.finance.availableCents) invalid('O valor ultrapassa seu saldo disponível para repasse.');
      const id = randomUUID(), requestedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO payouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, auth.id, amountCents, 'pending', requestedAt, null, '', profile.pixType, profile.pixKey, profile.pixOwner);
      this.db.exec('COMMIT');
      return { id, amountCents, status: 'pending', requestedAt, paidAt: null, note: '' };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setCosts(attendantId: string, date: string, adsCents: number, withdrawalFeeCents: number) {
    if (!validDate(date) || ![adsCents, withdrawalFeeCents].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000)) invalid('Custos ou data inválidos.');
    this.db.prepare('INSERT INTO costs VALUES (?, ?, ?, ?) ON CONFLICT(attendant_id,date) DO UPDATE SET ads_cents=excluded.ads_cents, withdrawal_fee_cents=excluded.withdrawal_fee_cents').run(attendantId, date, adsCents, withdrawalFeeCents);
  }
  markPayout(id: string, status: 'paid' | 'cancelled', note: string) {
    if (!['paid', 'cancelled'].includes(status) || note.length > 500) invalid('Status ou observação inválidos.');
    const result = this.db.prepare("UPDATE payouts SET status = ?, paid_at = ?, note = ? WHERE id = ? AND status = 'pending'").run(status, status === 'paid' ? new Date().toISOString() : null, note, id);
    if (!result.changes) invalid('Repasse pendente não encontrado.');
  }
}
