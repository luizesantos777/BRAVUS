import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { amountToCents, businessToday, calculateFinance, checkoutFee, CHECKOUT_PIX_TARIFF, DEFAULT_SALE_ALERT, DEFAULT_COMMISSION_BPS, GATEWAY_WITHDRAWAL_FEE_CENTS, inPeriod, MANUAL_PIX_TARIFF, MAX_RECEIPT_BYTES, percentageToBps, validateProfile, validateSaleReview, validatePayoutAmount, validDate } from '../src/domain.ts';
import type { AdminAttendant, AdminCost, AdminDashboard, AdminSale, AdminSalesPage, AdminPayout, Checkout, DailyCost, Invitation, Period, Portal, Profile, Payout, RankingEntry, ReceiptInput, Sale, SaleBatch } from '../src/domain.ts';

export class PortalError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export interface Authenticated { id: string }
interface AttendantRow { id: string; name: string; email: string; phone: string; pix_type: Profile['pixType']; pix_key: string; pix_owner: string; commission_bps: number; photo_url: string; sale_alert_template: string }
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
      INSERT OR IGNORE INTO checkouts (id, name, fee_bps) VALUES ('main', 'Checkout principal', 0), ('pix', 'PIX manual', 0);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, UNIQUE(attendant_id, request_key));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), batch_id TEXT NOT NULL REFERENCES batches(id), date TEXT NOT NULL, time TEXT NOT NULL, checkout_id TEXT NOT NULL REFERENCES checkouts(id), checkout_name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), fee_cents INTEGER NOT NULL, commission_bps INTEGER NOT NULL, goal_cents INTEGER NOT NULL, note TEXT NOT NULL, receipt_id TEXT NOT NULL REFERENCES receipts(id), created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sales_attendant_date ON sales(attendant_id, date);
      CREATE TABLE IF NOT EXISTS costs (attendant_id TEXT NOT NULL REFERENCES attendants(id), date TEXT NOT NULL, ads_cents INTEGER NOT NULL CHECK(ads_cents >= 0), withdrawal_fee_cents INTEGER NOT NULL CHECK(withdrawal_fee_cents >= 0), PRIMARY KEY(attendant_id, date));
      CREATE TABLE IF NOT EXISTS payouts (id TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled')), requested_at TEXT NOT NULL, paid_at TEXT, note TEXT NOT NULL, pix_type TEXT NOT NULL, pix_key TEXT NOT NULL, pix_owner TEXT NOT NULL);
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saleColumns = new Set(this.db.prepare('PRAGMA table_info(sales)').all().map(column => column.name));
      if (!saleColumns.has('status')) this.db.exec("ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected'))");
      if (!saleColumns.has('review_note')) this.db.exec("ALTER TABLE sales ADD COLUMN review_note TEXT NOT NULL DEFAULT ''");
      if (!saleColumns.has('reviewed_at')) this.db.exec('ALTER TABLE sales ADD COLUMN reviewed_at TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS sales_status_created ON sales(status, created_at)');
      if (!saleColumns.has('commission_mode')) this.db.exec("ALTER TABLE sales ADD COLUMN commission_mode TEXT NOT NULL DEFAULT 'net-share' CHECK(commission_mode IN ('net-share','gross-share-less-fees'))");
      const payoutColumns = new Set(this.db.prepare('PRAGMA table_info(payouts)').all().map(column => column.name));
      if (!payoutColumns.has('withdrawal_fee_cents')) this.db.exec('ALTER TABLE payouts ADD COLUMN withdrawal_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(withdrawal_fee_cents >= 0 AND withdrawal_fee_cents < amount_cents)');
      const profileColumns = new Set(this.db.prepare('PRAGMA table_info(attendants)').all().map(column => column.name));
      if (!profileColumns.has('photo_url')) this.db.exec("ALTER TABLE attendants ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''");
      if (!profileColumns.has('sale_alert_template')) this.db.exec("ALTER TABLE attendants ADD COLUMN sale_alert_template TEXT NOT NULL DEFAULT '✅ Venda de {valor} lançada com sucesso!'");
      this.db.exec('CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint_hash TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), subscription TEXT NOT NULL)');
      const columns = new Set(this.db.prepare('PRAGMA table_info(checkouts)').all().map(column => column.name));
      if (!columns.has('fixed_fee_cents')) this.db.exec('ALTER TABLE checkouts ADD COLUMN fixed_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fixed_fee_cents >= 0)');
      if (!columns.has('min_amount_cents')) this.db.exec('ALTER TABLE checkouts ADD COLUMN min_amount_cents INTEGER NOT NULL DEFAULT 1 CHECK(min_amount_cents > 0)');
      if (!columns.has('tier_above_cents')) this.db.exec('ALTER TABLE checkouts ADD COLUMN tier_above_cents INTEGER CHECK(tier_above_cents IS NULL OR tier_above_cents > 0)');
      if (!columns.has('tier_fee_bps')) this.db.exec('ALTER TABLE checkouts ADD COLUMN tier_fee_bps INTEGER CHECK(tier_fee_bps IS NULL OR tier_fee_bps BETWEEN 0 AND 10000)');
      if (!columns.has('tier_fixed_fee_cents')) this.db.exec('ALTER TABLE checkouts ADD COLUMN tier_fixed_fee_cents INTEGER CHECK(tier_fixed_fee_cents IS NULL OR tier_fixed_fee_cents >= 0)');
      if (!columns.has('max_amount_cents')) this.db.exec('ALTER TABLE checkouts ADD COLUMN max_amount_cents INTEGER CHECK(max_amount_cents IS NULL OR max_amount_cents > 0)');
      this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY)');
      if (!this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('manual-pix-tariff-v1')) {
        this.db.prepare('UPDATE checkouts SET fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ? WHERE id = ?').run(MANUAL_PIX_TARIFF.feeBps, MANUAL_PIX_TARIFF.fixedFeeCents, MANUAL_PIX_TARIFF.minAmountCents, 'pix');
        this.db.prepare('INSERT INTO schema_migrations VALUES (?)').run('manual-pix-tariff-v1');
      }
      if (!this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('checkout-pix-tiered-tariff-v1')) {
        const tariff = CHECKOUT_PIX_TARIFF;
        this.db.prepare('UPDATE checkouts SET fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ? WHERE id = ?').run(tariff.feeBps, tariff.fixedFeeCents, tariff.minAmountCents, 'main');
        this.db.prepare('INSERT INTO schema_migrations VALUES (?)').run('checkout-pix-tiered-tariff-v1');
      }
      if (!this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('checkout-maximum-1000-v1')) {
        this.db.prepare('UPDATE checkouts SET max_amount_cents = ?, tier_above_cents = NULL, tier_fee_bps = NULL, tier_fixed_fee_cents = NULL WHERE id = ?').run(CHECKOUT_PIX_TARIFF.maxAmountCents, 'main');
        this.db.prepare('INSERT INTO schema_migrations VALUES (?)').run('checkout-maximum-1000-v1');
      }
      if (!this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('attendant-gross-share-50-v1')) {
        this.db.prepare('UPDATE attendants SET commission_bps = ?').run(DEFAULT_COMMISSION_BPS);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?)').run('attendant-gross-share-50-v1');
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  adminDashboard(): AdminDashboard {
    const rows = this.db.prepare(`SELECT a.id, a.name, a.active, a.commission_bps AS commissionBps, a.created_at AS createdAt, COUNT(s.id) AS salesCount, COALESCE(SUM(s.amount_cents), 0) AS grossCents FROM attendants a LEFT JOIN sales s ON s.attendant_id = a.id GROUP BY a.id ORDER BY a.created_at DESC`).all();
    const attendants = rows.map(row => ({ ...row, active: row.active === 1 })) as unknown as AdminAttendant[];
    const payouts = this.db.prepare(`SELECT p.id, p.attendant_id AS attendantId, a.name AS attendantName, p.amount_cents AS amountCents, p.withdrawal_fee_cents AS withdrawalFeeCents, p.status, p.requested_at AS requestedAt, p.paid_at AS paidAt, p.note, p.pix_type AS pixType, p.pix_key AS pixKey, p.pix_owner AS pixOwner FROM payouts p JOIN attendants a ON a.id = p.attendant_id ORDER BY p.requested_at DESC`).all() as unknown as AdminPayout[];
    const costs = this.db.prepare('SELECT c.attendant_id AS attendantId, a.name AS attendantName, c.date, c.ads_cents AS adsCents, c.withdrawal_fee_cents AS withdrawalFeeCents FROM costs c JOIN attendants a ON a.id = c.attendant_id ORDER BY c.date DESC, a.name LIMIT 100').all() as unknown as AdminCost[];
    const pendingSalesCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM sales WHERE status = 'pending'").get()!.count);
    const todayAdsCents = Number(this.db.prepare('SELECT COALESCE(SUM(ads_cents), 0) AS total FROM costs WHERE date = ?').get(businessToday())!.total);
    return { attendants, payouts, checkouts: this.checkouts(), costs, pendingSalesCount, todayAdsCents };
  }
  adminSales(status = 'pending', attendantId = '', pageValue = '1'): AdminSalesPage {
    if (!['pending', 'approved', 'rejected', 'all'].includes(status) || !/^\d{1,6}$/.test(pageValue) || Number(pageValue) < 1 || attendantId.length > 100) invalid('Filtro de vendas inválido.');
    const page = Number(pageValue), pageSize = 50;
    const where = "WHERE (? = 'all' OR s.status = ?) AND (? = '' OR s.attendant_id = ?)";
    const args = [status, status, attendantId, attendantId];
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM sales s ' + where).get(...args)!.count);
    const sales = this.db.prepare(`SELECT s.id, s.attendant_id AS attendantId, a.name AS attendantName, s.date, s.time, s.checkout_id AS checkoutId, s.checkout_name AS checkoutName, s.amount_cents AS amountCents, s.fee_cents AS feeCents, s.commission_bps AS commissionBps, s.commission_mode AS commissionMode, s.note, s.receipt_id AS receiptId, s.created_at AS createdAt, s.status, s.review_note AS reviewNote, s.reviewed_at AS reviewedAt FROM sales s JOIN attendants a ON a.id = s.attendant_id ${where} ORDER BY s.created_at DESC, s.id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as unknown as AdminSale[];
    return { sales, total, page, pageSize };
  }
  reviewSale(id: string, input: unknown) {
    let review: ReturnType<typeof validateSaleReview>;
    try { review = validateSaleReview(input); } catch (error) { return invalid((error as Error).message); }
    const result = this.db.prepare("UPDATE sales SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'").run(review.status, review.note, new Date().toISOString(), id);
    if (!result.changes) {
      if (!this.db.prepare('SELECT id FROM sales WHERE id = ?').get(id)) throw new PortalError(404, 'Venda não encontrada.');
      throw new PortalError(409, 'Esta venda já foi analisada. Atualize a lista para conferir a decisão.');
    }
    return { saved: true };
  }
  adminReceipt(id: string) {
    const row = this.db.prepare('SELECT mime, bytes FROM receipts WHERE id = ?').get(id);
    if (!row) throw new PortalError(404, 'Comprovante não encontrado.');
    return { mime: String(row.mime), bytes: row.bytes as Uint8Array };
  }
  adminCreateAttendant(input: unknown): Invitation {
    const data: Record<string, unknown> = { commission: String(DEFAULT_COMMISSION_BPS / 100), ...this.adminFields(input) };
    if (typeof data.name !== 'string' || typeof data.commission !== 'string') invalid('Informe nome e comissão.');
    let commission: number;
    try { commission = percentageToBps(data.commission as string); }
    catch (error) { return invalid((error as Error).message); }
    const name = (data.name as string).trim();
    if (data.token !== undefined && typeof data.token !== 'string') invalid('Informe um token válido.');
    const chosenToken = typeof data.token === 'string' ? data.token.trim() : '';
    if (chosenToken && !/^[A-Za-z0-9_-]{32,160}$/.test(chosenToken)) invalid('O token deve ter de 32 a 160 letras, números, hífen ou sublinhado.');
    const { id, token } = this.createAttendant(name, commission, chosenToken || undefined);
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
    this.db.prepare('DELETE FROM push_subscriptions WHERE attendant_id = ?').run(id);
    return { attendantId: id, name: String(row.name), token };
  }
  setAttendantActive(id: string, input: unknown) {
    const data = this.adminFields(input);
    if (typeof data.active !== 'boolean') invalid('Informe se o acesso deve ficar ativo ou revogado.');
    const result = this.db.prepare('UPDATE attendants SET active = ? WHERE id = ?').run(data.active ? 1 : 0, id);
    if (!result.changes) throw new PortalError(404, 'Atendente não encontrado.');
    if (!data.active) this.db.prepare('DELETE FROM push_subscriptions WHERE attendant_id = ?').run(id);
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
    const current = this.checkouts().find(checkout => checkout.id === id);
    if (!current) throw new PortalError(404, 'Checkout não encontrado.');
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.fee !== 'string') invalid('Informe nome e percentual de taxa.');
    if (data.fixedFee !== undefined && typeof data.fixedFee !== 'string' || data.minimum !== undefined && typeof data.minimum !== 'string') invalid('Informe valores válidos para a taxa fixa e o mínimo por venda.');
    let fee: number, fixedFee: number, minimum: number, higherTier = current.higherTier;
    try {
      fee = percentageToBps(data.fee as string);
      fixedFee = data.fixedFee === undefined ? current.fixedFeeCents : /^0+(?:[.,]0{1,2})?$/.test((data.fixedFee as string).trim()) ? 0 : amountToCents(data.fixedFee as string);
      minimum = data.minimum === undefined ? current.minAmountCents : amountToCents(data.minimum as string);
      if (data.higherTier !== undefined) {
        if (data.higherTier === null) higherTier = null;
        else {
          const tier = this.adminFields(data.higherTier);
          if (typeof tier.aboveAmount !== 'string' || typeof tier.fee !== 'string' || typeof tier.fixedFee !== 'string') throw new Error('Preencha o limite, o percentual e a taxa fixa da faixa superior.');
          higherTier = { aboveAmountCents: amountToCents(tier.aboveAmount as string), feeBps: percentageToBps(tier.fee as string), fixedFeeCents: /^0+(?:[.,]0{1,2})?$/.test((tier.fixedFee as string).trim()) ? 0 : amountToCents(tier.fixedFee as string) };
        }
      }
      if (higherTier && higherTier.aboveAmountCents < minimum) throw new Error('O limite da faixa inicial deve ser maior ou igual ao mínimo por venda.');
      if (current.maxAmountCents !== null && minimum > current.maxAmountCents) throw new Error('O mínimo não pode ultrapassar o limite de recebimento do checkout.');
      if (higherTier && current.maxAmountCents !== null && higherTier.aboveAmountCents >= current.maxAmountCents) throw new Error('A faixa superior deve começar abaixo do limite de recebimento do checkout.');
    } catch (error) { return invalid((error as Error).message); }
    this.db.prepare('UPDATE checkouts SET name = ?, fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ?, tier_above_cents = ?, tier_fee_bps = ?, tier_fixed_fee_cents = ? WHERE id = ?').run((data.name as string).trim(), fee, fixedFee, minimum, higherTier?.aboveAmountCents ?? null, higherTier?.feeBps ?? null, higherTier?.fixedFeeCents ?? null, id);
  }
  createAttendant(name: string, commissionBps: number, providedToken?: string) {
    if (!name.trim() || name.length > 120 || !Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10000) invalid('Nome e comissão são obrigatórios e devem ser válidos.');
    const token = providedToken ?? `atd_${randomBytes(32).toString('base64url')}`;
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) invalid('Token inválido.');
    if (this.db.prepare('SELECT id FROM attendants WHERE token_hash = ?').get(tokenHash(token))) throw new PortalError(409, 'Esse token já está em uso. Defina outro token para este atendente.');
    const id = randomUUID();
    // Legacy goal columns stay in SQLite to preserve existing databases; they are no longer read or applied.
    this.db.prepare('INSERT INTO attendants (id, token_hash, name, commission_bps, daily_goal_cents, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, tokenHash(token), name.trim(), commissionBps, new Date().toISOString());
    return { id, token };
  }
  authenticate(token: string): Authenticated {
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    const row = this.db.prepare('SELECT id FROM attendants WHERE token_hash = ? AND active = 1').get(tokenHash(token));
    if (!row) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    return { id: String(row.id) };
  }
  profile(auth: Authenticated): Profile {
    const row = this.db.prepare('SELECT id, name, email, phone, pix_type, pix_key, pix_owner, commission_bps, photo_url, sale_alert_template FROM attendants WHERE id = ?').get(auth.id) as unknown as AttendantRow;
    if (!row) throw new PortalError(401, 'Atendente não encontrado pelo token informado.');
    return { id: row.id, name: row.name, email: row.email, phone: row.phone, pixType: row.pix_type, pixKey: row.pix_key, pixOwner: row.pix_owner, commissionBps: row.commission_bps, photoUrl: row.photo_url, saleAlertTemplate: row.sale_alert_template || DEFAULT_SALE_ALERT };
  }
  checkouts(): Checkout[] {
    return this.db.prepare('SELECT * FROM checkouts ORDER BY rowid').all().map(row => ({ id: String(row.id), name: String(row.name), feeBps: Number(row.fee_bps), fixedFeeCents: Number(row.fixed_fee_cents), minAmountCents: Number(row.min_amount_cents), maxAmountCents: row.max_amount_cents == null ? null : Number(row.max_amount_cents), higherTier: row.tier_above_cents == null ? null : { aboveAmountCents: Number(row.tier_above_cents), feeBps: Number(row.tier_fee_bps), fixedFeeCents: Number(row.tier_fixed_fee_cents) } }));
  }
  sales(auth: Authenticated): Sale[] { return this.db.prepare('SELECT id, date, time, checkout_id AS checkoutId, checkout_name AS checkoutName, amount_cents AS amountCents, fee_cents AS feeCents, commission_bps AS commissionBps, commission_mode AS commissionMode, note, receipt_id AS receiptId, created_at AS createdAt, status, review_note AS reviewNote, reviewed_at AS reviewedAt FROM sales WHERE attendant_id = ? ORDER BY date DESC, time DESC, created_at DESC').all(auth.id) as unknown as Sale[]; }
  costs(auth: Authenticated): DailyCost[] { return this.db.prepare('SELECT date, ads_cents AS adsCents, withdrawal_fee_cents AS withdrawalFeeCents FROM costs WHERE attendant_id = ?').all(auth.id) as unknown as DailyCost[]; }
  payouts(auth: Authenticated): Payout[] { return this.db.prepare('SELECT id, amount_cents AS amountCents, withdrawal_fee_cents AS withdrawalFeeCents, status, requested_at AS requestedAt, paid_at AS paidAt, note FROM payouts WHERE attendant_id = ? ORDER BY requested_at DESC').all(auth.id) as unknown as Payout[]; }
  portal(auth: Authenticated, period: Period = 'today'): Portal {
    const profile = this.profile(auth), sales = this.sales(auth), costs = this.costs(auth), payouts = this.payouts(auth), today = businessToday();
    return { profile, checkouts: this.checkouts(), sales: sales.filter(sale => inPeriod(sale.date, period, today)).slice(0, 100), payouts, finance: calculateFinance(sales, costs, payouts, period, today), today };
  }
  saveProfile(auth: Authenticated, input: unknown): Profile {
    let fields: ReturnType<typeof validateProfile>;
    try { fields = validateProfile(input); } catch (error) { return invalid((error as Error).message); }
    const current = this.profile(auth);
    this.db.prepare('UPDATE attendants SET name = ?, email = ?, phone = ?, pix_type = ?, pix_key = ?, pix_owner = ?, photo_url = ?, sale_alert_template = ? WHERE id = ?').run(fields.name, fields.email, fields.phone, fields.pixType, fields.pixKey, fields.pixOwner, fields.photoUrl ?? current.photoUrl, fields.saleAlertTemplate ?? current.saleAlertTemplate, auth.id);
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
      let feeCents: number;
      try { feeCents = checkoutFee(amountCents, checkout); } catch (error) { return invalid((error as Error).message); }
      return { amountCents, feeCents, checkout, time: row.time, note: row.note.trim(), receipt: this.receiptInput(row.receipt) };
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
        this.db.prepare("INSERT INTO sales (id, attendant_id, batch_id, date, time, checkout_id, checkout_name, amount_cents, fee_cents, commission_bps, goal_cents, note, receipt_id, created_at, status, commission_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'gross-share-less-fees')").run(randomUUID(), auth.id, batchId, batch.date, row.time, row.checkout.id, row.checkout.name, row.amountCents, row.feeCents, profile.commissionBps, 0, row.note, receiptId, createdAt);
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
    const attendants = this.db.prepare('SELECT id, name, photo_url FROM attendants WHERE active = 1').all();
    return attendants.map(attendant => {
      const sales = this.sales({ id: String(attendant.id) }).filter(sale => sale.status === 'approved').filter(sale => inPeriod(sale.date, period, businessToday()));
      return { id: String(attendant.id), name: String(attendant.name), photoUrl: String(attendant.photo_url), grossCents: sales.reduce((sum, sale) => sum + sale.amountCents, 0), count: sales.length, mine: attendant.id === auth.id };
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
      try { validatePayoutAmount(amountCents, portal.finance.availableCents); } catch (error) { return invalid((error as Error).message); }
      const id = randomUUID(), requestedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO payouts (id, attendant_id, amount_cents, status, requested_at, paid_at, note, pix_type, pix_key, pix_owner, withdrawal_fee_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, auth.id, amountCents, 'pending', requestedAt, null, '', profile.pixType, profile.pixKey, profile.pixOwner, GATEWAY_WITHDRAWAL_FEE_CENTS);
      this.db.exec('COMMIT');
      return { id, amountCents, withdrawalFeeCents: GATEWAY_WITHDRAWAL_FEE_CENTS, status: 'pending', requestedAt, paidAt: null, note: '' };
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
