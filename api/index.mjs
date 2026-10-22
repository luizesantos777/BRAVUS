// Generated from server/vercel.ts by npm run build:api. Do not edit directly.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/sqlite-database.ts
var sqlite_database_exports = {};
__export(sqlite_database_exports, {
  openSqliteDatabase: () => openSqliteDatabase
});
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function openSqliteDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 448 });
  const native = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename, 384);
  native.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  let pending = Promise.resolve();
  function locked(work) {
    const next = pending.then(work);
    pending = next.catch(() => void 0);
    return next;
  }
  const direct = {
    native,
    prepare(sql) {
      return {
        async get(...args) {
          return native.prepare(sql).get(...args);
        },
        async all(...args) {
          return native.prepare(sql).all(...args);
        },
        async run(...args) {
          return { changes: Number(native.prepare(sql).run(...args).changes) };
        }
      };
    },
    async exec(sql) {
      native.exec(sql);
    },
    async transaction() {
      throw new Error("Transa\xE7\xF5es aninhadas n\xE3o s\xE3o permitidas.");
    },
    close() {
      native.close();
    }
  };
  return {
    native,
    prepare(sql) {
      const statement = direct.prepare(sql);
      return {
        get: (...args) => locked(() => statement.get(...args)),
        all: (...args) => locked(() => statement.all(...args)),
        run: (...args) => locked(() => statement.run(...args))
      };
    },
    exec: (sql) => locked(() => direct.exec(sql)),
    transaction: (work, mode = "write") => locked(async () => {
      native.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE");
      try {
        const result = await work(direct);
        native.exec("COMMIT");
        return result;
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    }),
    close() {
      native.close();
    }
  };
}
var init_sqlite_database = __esm({
  "server/sqlite-database.ts"() {
    "use strict";
  }
});

// server/turso-database.ts
var turso_database_exports = {};
__export(turso_database_exports, {
  libsqlDatabase: () => libsqlDatabase,
  openTursoDatabase: () => openTursoDatabase
});
import { createClient } from "@libsql/client/http";
function rows(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((name, index) => {
    const value = row[index];
    return [name, value instanceof ArrayBuffer ? new Uint8Array(value) : value];
  })));
}
function libsqlDatabase(client) {
  let pending = Promise.resolve();
  function locked(work) {
    const next = pending.then(work);
    pending = next.catch(() => void 0);
    return next;
  }
  async function begin(mode) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.transaction(mode);
      } catch (error) {
        const code = String(error.code ?? "");
        if (!code.startsWith("SQLITE_BUSY") || attempt >= 5) throw error;
        if (client.protocol === "file") await client.reconnect();
        await new Promise((resolve2) => setTimeout(resolve2, 20 * 2 ** attempt));
      }
    }
  }
  function connection(session) {
    const execute = (sql, args) => session.execute({ sql, args });
    return {
      prepare(sql) {
        return {
          async get(...args) {
            return rows(await execute(sql, args))[0];
          },
          async all(...args) {
            return rows(await execute(sql, args));
          },
          async run(...args) {
            return { changes: (await execute(sql, args)).rowsAffected };
          }
        };
      },
      exec: (sql) => session.executeMultiple(sql),
      async transaction(work, mode = "write") {
        if (session !== client) throw new Error("Transa\xE7\xF5es aninhadas n\xE3o s\xE3o permitidas.");
        return locked(async () => {
          const transaction = await begin(mode);
          try {
            const result = await work(connection(transaction));
            await transaction.commit();
            return result;
          } catch (error) {
            if (!transaction.closed) await transaction.rollback().catch(() => void 0);
            throw error;
          } finally {
            transaction.close();
          }
        });
      },
      close() {
        client.close();
      }
    };
  }
  return connection(client);
}
function openTursoDatabase(config) {
  const url = new URL(config.url);
  if (!["https:", "libsql:"].includes(url.protocol) || url.username || url.password || url.hash || url.search || !config.authToken.trim()) throw new Error("Configure uma conex\xE3o Turso segura e seu token privado.");
  return libsqlDatabase(createClient({ url: config.url, authToken: config.authToken, intMode: "number" }));
}
var init_turso_database = __esm({
  "server/turso-database.ts"() {
    "use strict";
  }
});

// server/http.ts
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createHash as createHash2, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// server/database.ts
async function openDatabase(source) {
  if (typeof source === "string") {
    const { openSqliteDatabase: openSqliteDatabase2 } = await Promise.resolve().then(() => (init_sqlite_database(), sqlite_database_exports));
    return openSqliteDatabase2(source);
  }
  const { openTursoDatabase: openTursoDatabase2 } = await Promise.resolve().then(() => (init_turso_database(), turso_database_exports));
  return openTursoDatabase2(source);
}

// server/store.ts
import { createHash, randomBytes, randomUUID as randomUUID2 } from "node:crypto";

// src/domain.ts
var periodLabels = { today: "Hoje", yesterday: "Ontem", week: "\xDAltimos 7 dias", month: "Este m\xEAs", all: "Todo o per\xEDodo" };
var pixLabels = { "": "Selecione o tipo", email: "E-mail", cpf: "CPF", cnpj: "CNPJ", phone: "Telefone", random: "Chave aleat\xF3ria" };
var MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
var MAX_SALE_CENTS = 1e8;
var DEFAULT_COMMISSION_BPS = 5e3;
var GATEWAY_WITHDRAWAL_FEE_CENTS = 500;
var ATTENDANT_GATEWAY_FEE_BPS = 5e3;
var ATTENDANT_WITHDRAWAL_FEE_CENTS = 250;
var DEFAULT_SALE_ALERT = "\u2705 Venda de {valor} lan\xE7ada com sucesso!";
var MAX_AVATAR_BYTES = 256 * 1024;
function renderSaleAlert(template, amountCents, count, name) {
  const values = { valor: money(amountCents), qtd: String(count), nome: name };
  return template.replace(/\{(valor|qtd|nome)\}/g, (_match, key) => values[key]);
}
function validateAvatar(value) {
  if (!value) return "";
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || value.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 40) throw new Error("Use uma foto PNG, JPG ou WEBP de at\xE9 256 KB ap\xF3s o ajuste.");
  let bytes;
  try {
    bytes = atob(match[2]);
  } catch {
    throw new Error("A foto de perfil \xE9 inv\xE1lida.");
  }
  const valid = match[1] === "png" && bytes.startsWith("\x89PNG\r\n\n") || match[1] === "jpeg" && bytes.startsWith("\xFF\xD8\xFF") || match[1] === "webp" && bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  if (!valid || bytes.length > MAX_AVATAR_BYTES) throw new Error("A foto de perfil \xE9 inv\xE1lida.");
  return value;
}
var money = (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
function splitGatewayFee(feeCents) {
  return Math.floor((feeCents * ATTENDANT_GATEWAY_FEE_BPS + 5e3) / 1e4);
}
function attendantSaleFee(sale) {
  return sale.attendantFeeCents ?? sale.feeCents;
}
function saleEarnings(sale) {
  if (sale.commissionMode === "gross-share-less-fees") return sale.amountCents - Math.floor((sale.amountCents * (1e4 - sale.commissionBps) + 5e3) / 1e4) - attendantSaleFee(sale);
  return Math.round((sale.amountCents - sale.feeCents) * sale.commissionBps / 1e4);
}
function payoutNet(payout) {
  return payout.amountCents - (payout.withdrawalFeeCents ?? 0);
}
function validatePayoutAmount(amountCents, availableCents) {
  if (amountCents <= ATTENDANT_WITHDRAWAL_FEE_CENTS) throw new Error(`O saque deve ser maior que sua parte da taxa: ${money(ATTENDANT_WITHDRAWAL_FEE_CENTS)}.`);
  if (amountCents > availableCents) throw new Error("O valor ultrapassa seu saldo dispon\xEDvel para repasse.");
}
function checkoutFee(amountCents, checkout) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_SALE_CENTS) throw new Error("Informe um valor de venda v\xE1lido.");
  if (amountCents < checkout.minAmountCents) throw new Error(`${checkout.name}: valor m\xEDnimo de ${money(checkout.minAmountCents)} por venda.`);
  if (checkout.maxAmountCents != null && amountCents > checkout.maxAmountCents) throw new Error(`${checkout.name}: valor m\xE1ximo de ${money(checkout.maxAmountCents)} por venda.`);
  const tariff = checkout.higherTier && amountCents > checkout.higherTier.aboveAmountCents ? checkout.higherTier : checkout;
  return Math.floor((amountCents * tariff.feeBps + 5e3) / 1e4) + tariff.fixedFeeCents;
}
var MANUAL_PIX_TARIFF = { feeBps: 699, fixedFeeCents: 169, minAmountCents: 500, higherTier: null, maxAmountCents: null };
var CHECKOUT_PIX_TARIFF = { feeBps: 1500, fixedFeeCents: 199, minAmountCents: 1, higherTier: null, maxAmountCents: 1e5 };
function percentageToBps(value) {
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("Informe um percentual entre 0 e 100, com at\xE9 duas casas decimais.");
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 1e4) throw new Error("O percentual n\xE3o pode ultrapassar 100%.");
  return bps;
}
function businessToday(date = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function amountToCents(value) {
  let normalized = value.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized)) normalized = normalized.replaceAll(".", "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error("Informe um valor v\xE1lido, como 197,00.");
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_SALE_CENTS) throw new Error("O valor deve ser maior que zero e de at\xE9 R$ 1.000.000,00.");
  return cents;
}
function inPeriod(date, period, today) {
  if (period === "all") return true;
  if (period === "today") return date === today;
  if (period === "month") return date.slice(0, 7) === today.slice(0, 7) && date <= today;
  const start = /* @__PURE__ */ new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (period === "yesterday" ? 1 : 6));
  const lower = start.toISOString().slice(0, 10);
  return period === "yesterday" ? date === lower : date >= lower && date <= today;
}
function calculateFinance(sales, costs, payouts, period, today) {
  const pending = sales.filter((sale) => sale.status === "pending" && inPeriod(sale.date, period, today));
  const rejectedSalesCount = sales.filter((sale) => sale.status === "rejected" && inPeriod(sale.date, period, today)).length;
  sales = sales.filter((sale) => !sale.status || sale.status === "approved");
  const dates = /* @__PURE__ */ new Set([...sales.map((sale) => sale.date), ...costs.map((cost) => cost.date)]);
  let earned = 0, commissionCents = 0, debtCents = 0;
  for (const date of dates) {
    const daily = sales.filter((sale) => sale.date === date);
    const commission = daily.reduce((sum, sale) => sum + saleEarnings(sale), 0);
    const cost = costs.filter((cost2) => cost2.date === date).reduce((sum, cost2) => sum + cost2.adsCents + cost2.withdrawalFeeCents, 0);
    earned += commission - cost;
    if (inPeriod(date, period, today)) {
      commissionCents += commission;
      debtCents += Math.max(0, cost - commission);
    }
  }
  const filtered = sales.filter((sale) => inPeriod(sale.date, period, today));
  const filteredCosts = costs.filter((cost) => inPeriod(cost.date, period, today));
  const pendingPayoutCents = payouts.filter((payout) => payout.status === "pending").reduce((sum, payout) => sum + payout.amountCents, 0);
  const paidPayoutCents = payouts.filter((payout) => payout.status === "paid").reduce((sum, payout) => sum + payout.amountCents, 0);
  const transactionFeeCents = filtered.reduce((sum, sale) => sum + attendantSaleFee(sale), 0);
  const gatewayFeeCents = filtered.reduce((sum, sale) => sum + sale.feeCents, 0), businessGatewayFeeCents = gatewayFeeCents - transactionFeeCents;
  const withdrawalFeeCents = filteredCosts.reduce((sum, cost) => sum + cost.withdrawalFeeCents, 0) + payouts.filter((payout) => payout.status === "paid" && inPeriod(businessToday(new Date(payout.paidAt ?? payout.requestedAt)), period, today)).reduce((sum, payout) => sum + (payout.withdrawalFeeCents ?? 0), 0);
  const businessShareCents = filtered.reduce((sum, sale) => sum + sale.amountCents - sale.feeCents - saleEarnings(sale), 0);
  const paidPayoutNetCents = payouts.filter((payout) => payout.status === "paid").reduce((sum, payout) => sum + payoutNet(payout), 0);
  return { grossCents: filtered.reduce((sum, sale) => sum + sale.amountCents, 0), feeCents: transactionFeeCents + withdrawalFeeCents, transactionFeeCents, gatewayFeeCents, businessGatewayFeeCents, withdrawalFeeCents, businessShareCents, adsCents: filteredCosts.reduce((sum, cost) => sum + cost.adsCents, 0), commissionCents, availableCents: earned - pendingPayoutCents - paidPayoutCents, pendingPayoutCents, paidPayoutCents, paidPayoutNetCents, debtCents, count: filtered.length, pendingSalesCount: pending.length, pendingSalesCents: pending.reduce((sum, sale) => sum + sale.amountCents, 0), rejectedSalesCount };
}
function validateSaleReview(input) {
  if (!input || typeof input !== "object") throw new Error("Informe a decis\xE3o sobre a venda.");
  const data = input;
  if (data.status !== "approved" && data.status !== "rejected" || typeof data.note !== "string" || data.note.length > 500) throw new Error("Informe uma decis\xE3o v\xE1lida e uma observa\xE7\xE3o de at\xE9 500 caracteres.");
  const note = data.note.trim();
  if (data.status === "rejected" && !note) throw new Error("Informe o motivo da recusa.");
  return { status: data.status, note };
}
function validateProfile(value) {
  if (!value || typeof value !== "object") throw new Error("Dados de perfil inv\xE1lidos.");
  const source = value;
  function field(name2, max) {
    if (typeof source[name2] !== "string" || source[name2].length > max) throw new Error("Confira os dados do perfil.");
    return source[name2].trim();
  }
  const name = field("name", 120), email = field("email", 160), phone = field("phone", 40), pixType = field("pixType", 10), pixKey = field("pixKey", 180), pixOwner = field("pixOwner", 120);
  if (!name) throw new Error("Informe seu nome.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail v\xE1lido.");
  if (!Object.hasOwn(pixLabels, pixType)) throw new Error("Selecione um tipo de chave PIX v\xE1lido.");
  if (pixType || pixKey || pixOwner) {
    if (!pixType || !pixKey || !pixOwner) throw new Error("Preencha o tipo, a chave PIX e o nome do titular.");
    const digits = pixKey.replace(/\D/g, "");
    if (pixType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey)) throw new Error("A chave PIX deve ser um e-mail v\xE1lido.");
    if (pixType === "cpf" && (digits.length !== 11 || /^(\d)\1+$/.test(digits))) throw new Error("Informe um CPF com 11 d\xEDgitos.");
    if (pixType === "cnpj" && (digits.length !== 14 || /^(\d)\1+$/.test(digits))) throw new Error("Informe um CNPJ com 14 d\xEDgitos.");
    if (pixType === "phone" && ![10, 11, 12, 13].includes(digits.length)) throw new Error("Informe um telefone PIX v\xE1lido, com DDD.");
    if (pixType === "random" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pixKey)) throw new Error("Informe uma chave aleat\xF3ria PIX v\xE1lida.");
  }
  const extra = {};
  if (source.photoUrl !== void 0) {
    if (typeof source.photoUrl !== "string") throw new Error("A foto de perfil \xE9 inv\xE1lida.");
    extra.photoUrl = validateAvatar(source.photoUrl);
  }
  if (source.saleAlertTemplate !== void 0) {
    if (typeof source.saleAlertTemplate !== "string" || !source.saleAlertTemplate.trim() || source.saleAlertTemplate.length > 240) throw new Error("O alerta de venda deve ter de 1 a 240 caracteres.");
    if (/\{(?!valor\}|qtd\}|nome\})[^}]*\}/.test(source.saleAlertTemplate)) throw new Error("Use {valor}, {qtd} e {nome} como vari\xE1veis do alerta.");
    extra.saleAlertTemplate = source.saleAlertTemplate.trim();
  }
  return { name, email, phone, pixType, pixKey, pixOwner, ...extra };
}
var demoCheckouts = [{ id: "main", name: "Checkout principal", ...CHECKOUT_PIX_TARIFF }, { id: "pix", name: "PIX manual", ...MANUAL_PIX_TARIFF }];

// server/controls-schema.ts
import { randomUUID } from "node:crypto";
async function appendAudit(db, actor, action, targetId, targetName, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), (/* @__PURE__ */ new Date()).toISOString(), actor.id, actor.name, action, targetId, targetName, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after));
}
var controlsSchema = `
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

// server/store.ts
var PortalError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var systemActor = { id: "system", name: "Sistema / terminal" };
var tokenHash = (token) => createHash("sha256").update(token).digest("hex");
var invalid = (message) => {
  throw new PortalError(400, message);
};
var PortalStore = class _PortalStore {
  sql;
  constructor(database) {
    this.sql = database;
  }
  static async open(source) {
    const database = typeof source === "object" && "prepare" in source ? source : await openDatabase(source);
    const store = new _PortalStore(database);
    for (let attempt = 0; ; attempt++) {
      try {
        await store.initialize();
        return store;
      } catch (error) {
        const busy = String(error.code ?? "").startsWith("SQLITE_BUSY");
        if (!busy || attempt >= 3) {
          database.close();
          throw error;
        }
        await new Promise((resolve2) => setTimeout(resolve2, 40 * 2 ** attempt));
      }
    }
  }
  get db() {
    if (!this.sql.native) throw new Error("Esta opera\xE7\xE3o exige um banco SQLite local. Use a administra\xE7\xE3o HTTP para o banco remoto.");
    return this.sql.native;
  }
  withTransaction(work) {
    return this.sql.transaction((connection) => work(new _PortalStore(connection)));
  }
  async health() {
    await this.sql.prepare("SELECT 1").get();
  }
  async audit(actor, action, targetId, targetName, before, after) {
    await appendAudit(this.sql, actor, action, targetId, targetName, before, after);
  }
  async initialize() {
    await this.withTransaction(async (store) => {
      await store.sql.exec(`
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
      await store.sql.exec(controlsSchema);
      const saleColumns = new Set((await store.sql.prepare("PRAGMA table_info(sales)").all()).map((column) => column.name));
      if (!saleColumns.has("status")) await store.sql.exec("ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected'))");
      if (!saleColumns.has("review_note")) await store.sql.exec("ALTER TABLE sales ADD COLUMN review_note TEXT NOT NULL DEFAULT ''");
      if (!saleColumns.has("reviewed_at")) await store.sql.exec("ALTER TABLE sales ADD COLUMN reviewed_at TEXT");
      await store.sql.exec("CREATE INDEX IF NOT EXISTS sales_status_created ON sales(status, created_at)");
      if (!saleColumns.has("commission_mode")) await store.sql.exec("ALTER TABLE sales ADD COLUMN commission_mode TEXT NOT NULL DEFAULT 'net-share' CHECK(commission_mode IN ('net-share','gross-share-less-fees'))");
      if (!saleColumns.has("attendant_fee_cents")) await store.sql.exec("ALTER TABLE sales ADD COLUMN attendant_fee_cents INTEGER CHECK(attendant_fee_cents IS NULL OR attendant_fee_cents >= 0 AND attendant_fee_cents <= fee_cents)");
      const payoutColumns = new Set((await store.sql.prepare("PRAGMA table_info(payouts)").all()).map((column) => column.name));
      if (!payoutColumns.has("withdrawal_fee_cents")) await store.sql.exec("ALTER TABLE payouts ADD COLUMN withdrawal_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(withdrawal_fee_cents >= 0 AND withdrawal_fee_cents < amount_cents)");
      if (!payoutColumns.has("gateway_fee_cents")) {
        await store.sql.exec("ALTER TABLE payouts ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(gateway_fee_cents >= 0)");
        await store.sql.exec("UPDATE payouts SET gateway_fee_cents = withdrawal_fee_cents WHERE status = 'paid'");
      }
      const profileColumns = new Set((await store.sql.prepare("PRAGMA table_info(attendants)").all()).map((column) => column.name));
      if (!profileColumns.has("photo_url")) await store.sql.exec("ALTER TABLE attendants ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''");
      if (!profileColumns.has("sale_alert_template")) await store.sql.exec("ALTER TABLE attendants ADD COLUMN sale_alert_template TEXT NOT NULL DEFAULT '\u2705 Venda de {valor} lan\xE7ada com sucesso!'");
      await store.sql.exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint_hash TEXT PRIMARY KEY, attendant_id TEXT NOT NULL REFERENCES attendants(id), subscription TEXT NOT NULL)");
      await store.sql.exec("CREATE TABLE IF NOT EXISTS admin_push_subscriptions (endpoint_hash TEXT PRIMARY KEY, admin_scope TEXT NOT NULL, subscription TEXT NOT NULL)");
      const columns = new Set((await store.sql.prepare("PRAGMA table_info(checkouts)").all()).map((column) => column.name));
      if (!columns.has("fixed_fee_cents")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN fixed_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fixed_fee_cents >= 0)");
      if (!columns.has("min_amount_cents")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN min_amount_cents INTEGER NOT NULL DEFAULT 1 CHECK(min_amount_cents > 0)");
      if (!columns.has("tier_above_cents")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN tier_above_cents INTEGER CHECK(tier_above_cents IS NULL OR tier_above_cents > 0)");
      if (!columns.has("tier_fee_bps")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN tier_fee_bps INTEGER CHECK(tier_fee_bps IS NULL OR tier_fee_bps BETWEEN 0 AND 10000)");
      if (!columns.has("tier_fixed_fee_cents")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN tier_fixed_fee_cents INTEGER CHECK(tier_fixed_fee_cents IS NULL OR tier_fixed_fee_cents >= 0)");
      if (!columns.has("max_amount_cents")) await store.sql.exec("ALTER TABLE checkouts ADD COLUMN max_amount_cents INTEGER CHECK(max_amount_cents IS NULL OR max_amount_cents > 0)");
      await store.sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY)");
      if (!await store.sql.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("manual-pix-tariff-v1")) {
        await store.sql.prepare("UPDATE checkouts SET fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ? WHERE id = ?").run(MANUAL_PIX_TARIFF.feeBps, MANUAL_PIX_TARIFF.fixedFeeCents, MANUAL_PIX_TARIFF.minAmountCents, "pix");
        await store.sql.prepare("INSERT INTO schema_migrations VALUES (?)").run("manual-pix-tariff-v1");
      }
      if (!await store.sql.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("checkout-pix-tiered-tariff-v1")) {
        const tariff = CHECKOUT_PIX_TARIFF;
        await store.sql.prepare("UPDATE checkouts SET fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ? WHERE id = ?").run(tariff.feeBps, tariff.fixedFeeCents, tariff.minAmountCents, "main");
        await store.sql.prepare("INSERT INTO schema_migrations VALUES (?)").run("checkout-pix-tiered-tariff-v1");
      }
      if (!await store.sql.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("checkout-maximum-1000-v1")) {
        await store.sql.prepare("UPDATE checkouts SET max_amount_cents = ?, tier_above_cents = NULL, tier_fee_bps = NULL, tier_fixed_fee_cents = NULL WHERE id = ?").run(CHECKOUT_PIX_TARIFF.maxAmountCents, "main");
        await store.sql.prepare("INSERT INTO schema_migrations VALUES (?)").run("checkout-maximum-1000-v1");
      }
      if (!await store.sql.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("attendant-gross-share-50-v1")) {
        await store.sql.prepare("UPDATE attendants SET commission_bps = ?").run(DEFAULT_COMMISSION_BPS);
        await store.sql.prepare("INSERT INTO schema_migrations VALUES (?)").run("attendant-gross-share-50-v1");
      }
      if (!await store.sql.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("payout-fee-on-payment-v1")) {
        await store.sql.exec("UPDATE payouts SET withdrawal_fee_cents = 0 WHERE status IN ('pending','cancelled')");
        await store.sql.prepare("INSERT INTO schema_migrations VALUES (?)").run("payout-fee-on-payment-v1");
      }
    });
  }
  close() {
    this.sql.close();
  }
  async adminDashboard() {
    return this.sql.transaction(async (db) => {
      const rows2 = await db.prepare("SELECT id, name, active, commission_bps AS commissionBps, created_at AS createdAt FROM attendants ORDER BY created_at DESC").all();
      const sales = await db.prepare("SELECT attendant_id AS attendantId, date, status, amount_cents AS amountCents, fee_cents AS feeCents, attendant_fee_cents AS attendantFeeCents, commission_bps AS commissionBps, commission_mode AS commissionMode FROM sales").all();
      const payouts = await db.prepare(`SELECT p.id, p.attendant_id AS attendantId, a.name AS attendantName, p.amount_cents AS amountCents, p.withdrawal_fee_cents AS withdrawalFeeCents, p.gateway_fee_cents AS gatewayFeeCents, p.status, p.requested_at AS requestedAt, p.paid_at AS paidAt, p.note, p.pix_type AS pixType, p.pix_key AS pixKey, p.pix_owner AS pixOwner FROM payouts p JOIN attendants a ON a.id = p.attendant_id ORDER BY p.requested_at DESC`).all();
      const costs = await db.prepare("SELECT c.attendant_id AS attendantId, a.name AS attendantName, c.date, c.ads_cents AS adsCents, c.withdrawal_fee_cents AS withdrawalFeeCents FROM costs c JOIN attendants a ON a.id = c.attendant_id ORDER BY c.date DESC, a.name").all();
      function byAttendant(records) {
        const grouped = /* @__PURE__ */ new Map();
        for (const record of records) {
          const group = grouped.get(record.attendantId);
          if (group) group.push(record);
          else grouped.set(record.attendantId, [record]);
        }
        return grouped;
      }
      const ownSales = byAttendant(sales), ownCosts = byAttendant(costs), ownPayouts = byAttendant(payouts), today = businessToday();
      const attendants = rows2.map((row) => {
        const records = ownSales.get(String(row.id)) ?? [];
        return { ...row, active: row.active === 1, salesCount: records.length, grossCents: records.reduce((sum, sale) => sum + sale.amountCents, 0), finance: calculateFinance(records, ownCosts.get(String(row.id)) ?? [], ownPayouts.get(String(row.id)) ?? [], "all", today) };
      });
      return { attendants, payouts, checkouts: await new _PortalStore(db).checkouts(), costs: costs.slice(0, 100), pendingSalesCount: sales.filter((sale) => sale.status === "pending").length, todayAdsCents: costs.filter((cost) => cost.date === today).reduce((sum, cost) => sum + cost.adsCents, 0) };
    }, "read");
  }
  async adminSales(status = "pending", attendantId = "", pageValue = "1") {
    if (!["pending", "approved", "rejected", "all"].includes(status) || !/^\d{1,6}$/.test(pageValue) || Number(pageValue) < 1 || attendantId.length > 100) invalid("Filtro de vendas inv\xE1lido.");
    const page = Number(pageValue), pageSize = 50;
    const where = "WHERE (? = 'all' OR s.status = ?) AND (? = '' OR s.attendant_id = ?)";
    const args = [status, status, attendantId, attendantId];
    const total = Number((await this.sql.prepare("SELECT COUNT(*) AS count FROM sales s " + where).get(...args)).count);
    const sales = await this.sql.prepare(`SELECT s.id, s.attendant_id AS attendantId, a.name AS attendantName, s.date, s.time, s.checkout_id AS checkoutId, s.checkout_name AS checkoutName, s.amount_cents AS amountCents, s.fee_cents AS feeCents, s.attendant_fee_cents AS attendantFeeCents, s.commission_bps AS commissionBps, s.commission_mode AS commissionMode, s.note, s.receipt_id AS receiptId, s.created_at AS createdAt, s.status, s.review_note AS reviewNote, s.reviewed_at AS reviewedAt FROM sales s JOIN attendants a ON a.id = s.attendant_id ${where} ORDER BY s.created_at DESC, s.id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    return { sales, total, page, pageSize };
  }
  async reviewSale(id, input, actor = systemActor) {
    let review;
    try {
      review = validateSaleReview(input);
    } catch (error) {
      return invalid(error.message);
    }
    return this.withTransaction(async (store) => {
      const before = await store.sql.prepare("SELECT s.status, s.review_note, a.name FROM sales s JOIN attendants a ON a.id = s.attendant_id WHERE s.id = ?").get(id);
      const result = await store.sql.prepare("UPDATE sales SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'").run(review.status, review.note, (/* @__PURE__ */ new Date()).toISOString(), id);
      if (!result.changes) {
        if (!before) throw new PortalError(404, "Venda n\xE3o encontrada.");
        throw new PortalError(409, "Esta venda j\xE1 foi analisada. Atualize a lista para conferir a decis\xE3o.");
      }
      await store.audit(actor, review.status === "approved" ? "sale.approved" : "sale.rejected", id, String(before.name), { status: String(before.status), note: String(before.review_note) }, { status: review.status, note: review.note });
      return { saved: true };
    });
  }
  async adminReceipt(id) {
    const row = await this.sql.prepare("SELECT mime, bytes FROM receipts WHERE id = ?").get(id);
    if (!row) throw new PortalError(404, "Comprovante n\xE3o encontrado.");
    return { mime: String(row.mime), bytes: row.bytes };
  }
  async adminCreateAttendant(input, actor = systemActor) {
    const data = { commission: String(DEFAULT_COMMISSION_BPS / 100), ...this.adminFields(input) };
    if (typeof data.name !== "string" || typeof data.commission !== "string") invalid("Informe nome e comiss\xE3o.");
    let commission;
    try {
      commission = percentageToBps(data.commission);
    } catch (error) {
      return invalid(error.message);
    }
    const name = data.name.trim();
    if (data.token !== void 0 && typeof data.token !== "string") invalid("Informe um token v\xE1lido.");
    const chosenToken = typeof data.token === "string" ? data.token.trim() : "";
    if (chosenToken && !/^[A-Za-z0-9_-]{32,160}$/.test(chosenToken)) invalid("O token deve ter de 32 a 160 letras, n\xFAmeros, h\xEDfen ou sublinhado.");
    const { id, token } = await this.createAttendant(name, commission, chosenToken || void 0, actor);
    return { attendantId: id, name, token };
  }
  adminFields(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("Dados inv\xE1lidos.");
    return input;
  }
  async rotateToken(id, actor = systemActor) {
    return this.withTransaction(async (store) => {
      const row = await store.sql.prepare("SELECT name, active FROM attendants WHERE id = ?").get(id);
      if (!row) throw new PortalError(404, "Atendente n\xE3o encontrado.");
      if (row.active !== 1) invalid("Reative o atendente antes de gerar um novo token.");
      const token = `atd_${randomBytes(32).toString("base64url")}`;
      await store.sql.prepare("UPDATE attendants SET token_hash = ? WHERE id = ?").run(tokenHash(token), id);
      await store.sql.prepare("DELETE FROM push_subscriptions WHERE attendant_id = ?").run(id);
      await store.audit(actor, "attendant.token_rotated", id, String(row.name), null, { renewed: true });
      return { attendantId: id, name: String(row.name), token };
    });
  }
  async setAttendantActive(id, input, actor = systemActor) {
    const data = this.adminFields(input);
    if (typeof data.active !== "boolean") invalid("Informe se o acesso deve ficar ativo ou revogado.");
    return this.withTransaction(async (store) => {
      const before = await store.sql.prepare("SELECT name, active FROM attendants WHERE id = ?").get(id);
      const result = await store.sql.prepare("UPDATE attendants SET active = ? WHERE id = ?").run(data.active ? 1 : 0, id);
      if (!result.changes) throw new PortalError(404, "Atendente n\xE3o encontrado.");
      if (!data.active) await store.sql.prepare("DELETE FROM push_subscriptions WHERE attendant_id = ?").run(id);
      await store.audit(actor, "attendant.access_changed", id, String(before.name), { active: before.active === 1 }, { active: data.active });
    });
  }
  async adminSetCosts(id, input, actor = systemActor) {
    const data = this.adminFields(input);
    if (!await this.sql.prepare("SELECT id FROM attendants WHERE id = ?").get(id)) throw new PortalError(404, "Atendente n\xE3o encontrado.");
    if (typeof data.date !== "string" || typeof data.ads !== "string" || typeof data.withdrawalFee !== "string") invalid("Informe data, custo ADS e taxa de saque.");
    const amount = (value) => /^0+(?:[.,]0{1,2})?$/.test(value.trim()) ? 0 : amountToCents(value);
    try {
      await this.setCosts(id, data.date, amount(data.ads), amount(data.withdrawalFee), actor);
    } catch (error) {
      if (error instanceof PortalError) throw error;
      invalid(error.message);
    }
  }
  async adminCosts(id, date) {
    if (!validDate(date)) invalid("Informe uma data v\xE1lida.");
    if (!await this.sql.prepare("SELECT id FROM attendants WHERE id = ?").get(id)) throw new PortalError(404, "Atendente n\xE3o encontrado.");
    return (await this.costs({ id })).find((cost) => cost.date === date) ?? { date, adsCents: 0, withdrawalFeeCents: 0 };
  }
  async adminSetCheckout(id, input, actor = systemActor) {
    const data = this.adminFields(input);
    return this.withTransaction(async (store) => {
      const current = (await store.checkouts()).find((checkout) => checkout.id === id);
      if (!current) throw new PortalError(404, "Checkout n\xE3o encontrado.");
      if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 100 || typeof data.fee !== "string") invalid("Informe nome e percentual de taxa.");
      if (data.fixedFee !== void 0 && typeof data.fixedFee !== "string" || data.minimum !== void 0 && typeof data.minimum !== "string") invalid("Informe valores v\xE1lidos para a taxa fixa e o m\xEDnimo por venda.");
      let fee, fixedFee, minimum, higherTier = current.higherTier;
      try {
        fee = percentageToBps(data.fee);
        fixedFee = data.fixedFee === void 0 ? current.fixedFeeCents : /^0+(?:[.,]0{1,2})?$/.test(data.fixedFee.trim()) ? 0 : amountToCents(data.fixedFee);
        minimum = data.minimum === void 0 ? current.minAmountCents : amountToCents(data.minimum);
        if (data.higherTier !== void 0) {
          if (data.higherTier === null) higherTier = null;
          else {
            const tier = this.adminFields(data.higherTier);
            if (typeof tier.aboveAmount !== "string" || typeof tier.fee !== "string" || typeof tier.fixedFee !== "string") throw new Error("Preencha o limite, o percentual e a taxa fixa da faixa superior.");
            higherTier = { aboveAmountCents: amountToCents(tier.aboveAmount), feeBps: percentageToBps(tier.fee), fixedFeeCents: /^0+(?:[.,]0{1,2})?$/.test(tier.fixedFee.trim()) ? 0 : amountToCents(tier.fixedFee) };
          }
        }
        if (higherTier && higherTier.aboveAmountCents < minimum) throw new Error("O limite da faixa inicial deve ser maior ou igual ao m\xEDnimo por venda.");
        if (current.maxAmountCents !== null && minimum > current.maxAmountCents) throw new Error("O m\xEDnimo n\xE3o pode ultrapassar o limite de recebimento do checkout.");
        if (higherTier && current.maxAmountCents !== null && higherTier.aboveAmountCents >= current.maxAmountCents) throw new Error("A faixa superior deve come\xE7ar abaixo do limite de recebimento do checkout.");
      } catch (error) {
        return invalid(error.message);
      }
      await store.sql.prepare("UPDATE checkouts SET name = ?, fee_bps = ?, fixed_fee_cents = ?, min_amount_cents = ?, tier_above_cents = ?, tier_fee_bps = ?, tier_fixed_fee_cents = ? WHERE id = ?").run(data.name.trim(), fee, fixedFee, minimum, higherTier?.aboveAmountCents ?? null, higherTier?.feeBps ?? null, higherTier?.fixedFeeCents ?? null, id);
      const values = (checkout) => ({ name: checkout.name, feeBps: checkout.feeBps, fixedFeeCents: checkout.fixedFeeCents, minAmountCents: checkout.minAmountCents, aboveAmountCents: checkout.higherTier?.aboveAmountCents ?? null, aboveFeeBps: checkout.higherTier?.feeBps ?? null, aboveFixedFeeCents: checkout.higherTier?.fixedFeeCents ?? null });
      await store.audit(actor, "checkout.updated", id, current.name, values(current), values({ ...current, name: data.name.trim(), feeBps: fee, fixedFeeCents: fixedFee, minAmountCents: minimum, higherTier }));
    });
  }
  async createAttendant(name, commissionBps, providedToken, actor = systemActor) {
    if (!name.trim() || name.length > 120 || !Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 1e4) invalid("Nome e comiss\xE3o s\xE3o obrigat\xF3rios e devem ser v\xE1lidos.");
    const token = providedToken ?? `atd_${randomBytes(32).toString("base64url")}`;
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) invalid("Token inv\xE1lido.");
    return this.withTransaction(async (store) => {
      if (await store.sql.prepare("SELECT id FROM attendants WHERE token_hash = ?").get(tokenHash(token))) throw new PortalError(409, "Esse token j\xE1 est\xE1 em uso. Defina outro token para este atendente.");
      const id = randomUUID2();
      await store.sql.prepare("INSERT INTO attendants (id, token_hash, name, commission_bps, daily_goal_cents, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(id, tokenHash(token), name.trim(), commissionBps, (/* @__PURE__ */ new Date()).toISOString());
      await store.audit(actor, "attendant.created", id, name.trim(), null, { name: name.trim(), commissionBps, active: true });
      return { id, token };
    });
  }
  async authenticate(token) {
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) throw new PortalError(401, "Atendente n\xE3o encontrado pelo token informado.");
    const row = await this.sql.prepare("SELECT id FROM attendants WHERE token_hash = ? AND active = 1").get(tokenHash(token));
    if (!row) throw new PortalError(401, "Atendente n\xE3o encontrado pelo token informado.");
    return { id: String(row.id) };
  }
  async profile(auth) {
    const row = await this.sql.prepare("SELECT id, name, email, phone, pix_type, pix_key, pix_owner, commission_bps, photo_url, sale_alert_template FROM attendants WHERE id = ?").get(auth.id);
    if (!row) throw new PortalError(401, "Atendente n\xE3o encontrado pelo token informado.");
    return { id: row.id, name: row.name, email: row.email, phone: row.phone, pixType: row.pix_type, pixKey: row.pix_key, pixOwner: row.pix_owner, commissionBps: row.commission_bps, photoUrl: row.photo_url, saleAlertTemplate: row.sale_alert_template || DEFAULT_SALE_ALERT };
  }
  async checkouts() {
    return (await this.sql.prepare("SELECT * FROM checkouts ORDER BY rowid").all()).map((row) => ({ id: String(row.id), name: String(row.name), feeBps: Number(row.fee_bps), fixedFeeCents: Number(row.fixed_fee_cents), minAmountCents: Number(row.min_amount_cents), maxAmountCents: row.max_amount_cents == null ? null : Number(row.max_amount_cents), higherTier: row.tier_above_cents == null ? null : { aboveAmountCents: Number(row.tier_above_cents), feeBps: Number(row.tier_fee_bps), fixedFeeCents: Number(row.tier_fixed_fee_cents) } }));
  }
  async sales(auth) {
    return await this.sql.prepare("SELECT id, date, time, checkout_id AS checkoutId, checkout_name AS checkoutName, amount_cents AS amountCents, fee_cents AS feeCents, attendant_fee_cents AS attendantFeeCents, commission_bps AS commissionBps, commission_mode AS commissionMode, note, receipt_id AS receiptId, created_at AS createdAt, status, review_note AS reviewNote, reviewed_at AS reviewedAt FROM sales WHERE attendant_id = ? ORDER BY date DESC, time DESC, created_at DESC").all(auth.id);
  }
  async costs(auth) {
    return await this.sql.prepare("SELECT date, ads_cents AS adsCents, withdrawal_fee_cents AS withdrawalFeeCents FROM costs WHERE attendant_id = ?").all(auth.id);
  }
  async payouts(auth) {
    return await this.sql.prepare("SELECT id, amount_cents AS amountCents, withdrawal_fee_cents AS withdrawalFeeCents, gateway_fee_cents AS gatewayFeeCents, status, requested_at AS requestedAt, paid_at AS paidAt, note FROM payouts WHERE attendant_id = ? ORDER BY requested_at DESC").all(auth.id);
  }
  async portal(auth, period = "today") {
    const profile = await this.profile(auth), sales = await this.sales(auth), costs = await this.costs(auth), payouts = await this.payouts(auth), today = businessToday();
    return { profile, checkouts: await this.checkouts(), sales: sales.filter((sale) => inPeriod(sale.date, period, today)).slice(0, 100), payouts, finance: calculateFinance(sales, costs, payouts, period, today), today };
  }
  async saveProfile(auth, input) {
    let fields;
    try {
      fields = validateProfile(input);
    } catch (error) {
      return invalid(error.message);
    }
    const current = await this.profile(auth);
    await this.sql.prepare("UPDATE attendants SET name = ?, email = ?, phone = ?, pix_type = ?, pix_key = ?, pix_owner = ?, photo_url = ?, sale_alert_template = ? WHERE id = ?").run(fields.name, fields.email, fields.phone, fields.pixType, fields.pixKey, fields.pixOwner, fields.photoUrl ?? current.photoUrl, fields.saleAlertTemplate ?? current.saleAlertTemplate, auth.id);
    return await this.profile(auth);
  }
  receiptInput(value) {
    if (!value || typeof value !== "object") return invalid("Anexe o print de cada venda.");
    const receipt = value;
    if (typeof receipt.name !== "string" || !receipt.name || receipt.name.length > 180 || typeof receipt.base64 !== "string" || receipt.base64.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.base64)) return invalid("O comprovante deve ser uma imagem v\xE1lida de at\xE9 2 MB.");
    const bytes = Buffer.from(receipt.base64, "base64");
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES || !(receipt.mime === "image/png" && png || receipt.mime === "image/jpeg" && jpeg || receipt.mime === "image/webp" && webp)) return invalid("Use um print PNG, JPG ou WEBP v\xE1lido, de at\xE9 2 MB.");
    return { name: receipt.name, mime: receipt.mime, bytes };
  }
  async recordSales(auth, input, requestKey) {
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestKey)) invalid("Identificador de envio inv\xE1lido. Atualize a p\xE1gina.");
    if (!input || typeof input !== "object") invalid("Lan\xE7amento inv\xE1lido.");
    const batch = input;
    if (typeof batch.date !== "string" || !validDate(batch.date) || batch.date > businessToday()) invalid("Informe uma data v\xE1lida, at\xE9 hoje.");
    if (!Array.isArray(batch.sales) || !batch.sales.length || batch.sales.length > 10) invalid("Envie entre 1 e 10 vendas por vez.");
    const profile = await this.profile(auth), checkouts = await this.checkouts();
    const normalized = batch.sales.map((row) => {
      if (!row || typeof row !== "object" || typeof row.amount !== "string" || typeof row.note !== "string" || row.note.length > 500 || typeof row.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) return invalid("Confira o valor, o hor\xE1rio e a observa\xE7\xE3o de cada venda.");
      const checkout = checkouts.find((item) => item.id === row.checkoutId);
      if (!checkout) return invalid("Selecione um checkout v\xE1lido para cada venda.");
      let amountCents;
      try {
        amountCents = amountToCents(row.amount);
      } catch (error) {
        return invalid(error.message);
      }
      let feeCents;
      try {
        feeCents = checkoutFee(amountCents, checkout);
      } catch (error) {
        return invalid(error.message);
      }
      return { amountCents, feeCents, checkout, time: row.time, note: row.note.trim(), receipt: this.receiptInput(row.receipt) };
    });
    const payloadHash = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
    return this.withTransaction(async (store) => {
      const existing = await store.sql.prepare("SELECT id, payload_hash FROM batches WHERE attendant_id = ? AND request_key = ?").get(auth.id, requestKey);
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw new PortalError(409, "Este envio j\xE1 foi registrado com outros dados. Confira o hist\xF3rico e atualize a p\xE1gina antes de lan\xE7ar novas vendas.");
        return { duplicate: true, count: normalized.length };
      }
      const batchId = randomUUID2(), createdAt = (/* @__PURE__ */ new Date()).toISOString();
      await store.sql.prepare("INSERT INTO batches VALUES (?, ?, ?, ?)").run(batchId, auth.id, requestKey, payloadHash);
      for (const row of normalized) {
        const receiptId = randomUUID2();
        await store.sql.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?)").run(receiptId, auth.id, row.receipt.name, row.receipt.mime, row.receipt.bytes);
        await store.sql.prepare("INSERT INTO sales (id, attendant_id, batch_id, date, time, checkout_id, checkout_name, amount_cents, fee_cents, commission_bps, goal_cents, note, receipt_id, created_at, status, commission_mode, attendant_fee_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'gross-share-less-fees', ?)").run(randomUUID2(), auth.id, batchId, batch.date, row.time, row.checkout.id, row.checkout.name, row.amountCents, row.feeCents, profile.commissionBps, 0, row.note, receiptId, createdAt, splitGatewayFee(row.feeCents));
      }
      await store.audit({ id: auth.id, name: profile.name }, "sales.submitted", batchId, profile.name, null, { count: normalized.length, amountCents: normalized.reduce((sum, row) => sum + row.amountCents, 0), date: batch.date });
      return { duplicate: false, count: normalized.length };
    });
  }
  async receipt(auth, id) {
    const row = await this.sql.prepare("SELECT mime, bytes FROM receipts WHERE id = ? AND attendant_id = ?").get(id, auth.id);
    if (!row) throw new PortalError(404, "Comprovante n\xE3o encontrado.");
    return { mime: String(row.mime), bytes: row.bytes };
  }
  async ranking(auth, period) {
    const attendants = await this.sql.prepare("SELECT id, name, photo_url FROM attendants WHERE active = 1").all();
    return (await Promise.all(attendants.map(async (attendant) => {
      const sales = (await this.sales({ id: String(attendant.id) })).filter((sale) => sale.status === "approved").filter((sale) => inPeriod(sale.date, period, businessToday()));
      return { id: String(attendant.id), name: String(attendant.name), photoUrl: String(attendant.photo_url), grossCents: sales.reduce((sum, sale) => sum + sale.amountCents, 0), count: sales.length, mine: attendant.id === auth.id };
    }))).filter((item) => item.count > 0).sort((a, b) => b.grossCents - a.grossCents || b.count - a.count || a.name.localeCompare(b.name));
  }
  async requestPayout(auth, input) {
    if (!input || typeof input !== "object" || typeof input.amount !== "string") invalid("Informe o valor do repasse.");
    let amountCents;
    try {
      amountCents = amountToCents(input.amount);
    } catch (error) {
      return invalid(error.message);
    }
    return this.withTransaction(async (store) => {
      const profile = await store.profile(auth), portal = await store.portal(auth, "all");
      if (!profile.pixKey || !profile.pixOwner) invalid("Cadastre sua chave PIX e o titular antes de solicitar um repasse.");
      try {
        validatePayoutAmount(amountCents, portal.finance.availableCents);
      } catch (error) {
        return invalid(error.message);
      }
      const id = randomUUID2(), requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      await store.sql.prepare("INSERT INTO payouts (id, attendant_id, amount_cents, status, requested_at, paid_at, note, pix_type, pix_key, pix_owner, withdrawal_fee_cents, gateway_fee_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, auth.id, amountCents, "pending", requestedAt, null, "", profile.pixType, profile.pixKey, profile.pixOwner, 0, 0);
      return { id, amountCents, withdrawalFeeCents: 0, gatewayFeeCents: 0, status: "pending", requestedAt, paidAt: null, note: "" };
    });
  }
  async setCosts(attendantId, date, adsCents, withdrawalFeeCents, actor = systemActor) {
    if (!validDate(date) || ![adsCents, withdrawalFeeCents].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1e8)) invalid("Custos ou data inv\xE1lidos.");
    return this.withTransaction(async (store) => {
      const attendant = await store.sql.prepare("SELECT name FROM attendants WHERE id = ?").get(attendantId);
      if (!attendant) throw new PortalError(404, "Atendente n\xE3o encontrado.");
      const before = await store.adminCosts(attendantId, date);
      await store.sql.prepare("INSERT INTO costs VALUES (?, ?, ?, ?) ON CONFLICT(attendant_id,date) DO UPDATE SET ads_cents=excluded.ads_cents, withdrawal_fee_cents=excluded.withdrawal_fee_cents").run(attendantId, date, adsCents, withdrawalFeeCents);
      await store.audit(actor, "costs.updated", attendantId, String(attendant.name), { date, adsCents: before.adsCents, withdrawalFeeCents: before.withdrawalFeeCents }, { date, adsCents, withdrawalFeeCents });
    });
  }
  async markPayout(id, status, note, actor = systemActor) {
    if (!["paid", "cancelled"].includes(status) || note.length > 500) invalid("Status ou observa\xE7\xE3o inv\xE1lidos.");
    return this.withTransaction(async (store) => {
      const before = await store.sql.prepare("SELECT p.status, p.amount_cents, p.withdrawal_fee_cents, p.gateway_fee_cents, p.note, a.name FROM payouts p JOIN attendants a ON a.id = p.attendant_id WHERE p.id = ?").get(id);
      if (status === "paid") {
        const pending = await store.sql.prepare("SELECT amount_cents FROM payouts WHERE id = ? AND status = 'pending'").get(id);
        if (pending && Number(pending.amount_cents) <= ATTENDANT_WITHDRAWAL_FEE_CENTS) invalid(`O repasse precisa ser maior que a sua parte da taxa de ${ATTENDANT_WITHDRAWAL_FEE_CENTS / 100} reais. Cancele o pedido e solicite um valor maior.`);
      }
      const result = await store.sql.prepare("UPDATE payouts SET status = ?, paid_at = ?, note = ?, withdrawal_fee_cents = ?, gateway_fee_cents = ? WHERE id = ? AND status = 'pending'").run(status, status === "paid" ? (/* @__PURE__ */ new Date()).toISOString() : null, note, status === "paid" ? ATTENDANT_WITHDRAWAL_FEE_CENTS : 0, status === "paid" ? GATEWAY_WITHDRAWAL_FEE_CENTS : 0, id);
      if (!result.changes) invalid("Repasse pendente n\xE3o encontrado.");
      await store.audit(actor, status === "paid" ? "payout.paid" : "payout.cancelled", id, String(before.name), { status: String(before.status), amountCents: Number(before.amount_cents), withdrawalFeeCents: Number(before.withdrawal_fee_cents), gatewayFeeCents: Number(before.gateway_fee_cents), note: String(before.note) }, { status, amountCents: Number(before.amount_cents), withdrawalFeeCents: status === "paid" ? ATTENDANT_WITHDRAWAL_FEE_CENTS : 0, gatewayFeeCents: status === "paid" ? GATEWAY_WITHDRAWAL_FEE_CENTS : 0, note });
    });
  }
};

// src/admin-domain.ts
var auditActions = {
  "sale.approved": "Venda aprovada",
  "sale.rejected": "Venda recusada",
  "sales.submitted": "Vendas lan\xE7adas",
  "costs.updated": "Custos alterados",
  "checkout.updated": "Taxas alteradas",
  "payout.paid": "Repasse confirmado",
  "payout.cancelled": "Repasse cancelado",
  "attendant.created": "Atendente cadastrado",
  "attendant.access_changed": "Acesso alterado",
  "attendant.token_rotated": "Token renovado"
};
function validateDateRange(start, end) {
  if (!validDate(start) || !validDate(end) || start > end || end > businessToday()) throw new Error("Informe um per\xEDodo v\xE1lido, com in\xEDcio at\xE9 o fim e sem datas futuras.");
}
function financialReport(input, start, end, attendantId = "") {
  validateDateRange(start, end);
  const inside = (date) => date >= start && date <= end;
  const empty = () => ({ count: 0, pendingCount: 0, rejectedCount: 0, grossCents: 0, gatewayFeeCents: 0, commissionCents: 0, adsCents: 0, adjustmentsCents: 0, netCommissionCents: 0, paidPayoutCents: 0, paidPayoutNetCents: 0, withdrawalGatewayFeeCents: 0, attendantWithdrawalFeeCents: 0, businessWithdrawalFeeCents: 0, businessProfitCents: 0, cashMovementCents: 0 });
  const rows2 = new Map(input.attendants.filter((a) => !attendantId || a.id === attendantId).map((a) => [a.id, { ...empty(), attendantId: a.id, attendantName: a.name }]));
  for (const sale of input.sales) {
    const row = rows2.get(sale.attendantId);
    if (!row || !inside(sale.date)) continue;
    if (sale.status === "pending") {
      row.pendingCount++;
      continue;
    }
    if (sale.status === "rejected") {
      row.rejectedCount++;
      continue;
    }
    row.count++;
    row.grossCents += sale.amountCents;
    row.gatewayFeeCents += sale.feeCents;
    row.commissionCents += saleEarnings(sale);
  }
  for (const cost of input.costs) {
    const row = rows2.get(cost.attendantId);
    if (!row || !inside(cost.date)) continue;
    row.adsCents += cost.adsCents;
    row.adjustmentsCents += cost.withdrawalFeeCents;
  }
  for (const payout of input.payouts) {
    const row = rows2.get(payout.attendantId);
    if (!row || payout.status !== "paid" || !inside(businessToday(new Date(payout.paidAt ?? payout.requestedAt)))) continue;
    row.paidPayoutCents += payout.amountCents;
    row.paidPayoutNetCents += payoutNet(payout);
    row.withdrawalGatewayFeeCents += payout.gatewayFeeCents ?? 0;
    row.attendantWithdrawalFeeCents += payout.withdrawalFeeCents ?? 0;
  }
  const totals = empty();
  for (const row of rows2.values()) {
    row.businessWithdrawalFeeCents = row.withdrawalGatewayFeeCents - row.attendantWithdrawalFeeCents;
    row.netCommissionCents = row.commissionCents - row.adsCents - row.adjustmentsCents - row.attendantWithdrawalFeeCents;
    row.businessProfitCents = row.grossCents - row.gatewayFeeCents - row.commissionCents - row.businessWithdrawalFeeCents;
    row.cashMovementCents = row.grossCents - row.gatewayFeeCents - row.adsCents - row.adjustmentsCents - row.paidPayoutNetCents - row.withdrawalGatewayFeeCents;
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }
  return { start, end, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), totals, attendants: [...rows2.values()].sort((a, b) => a.attendantName.localeCompare(b.attendantName, "pt-BR")) };
}
function financialCsv(report) {
  const text = (value) => '"' + (/^[\s]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  const headings = ["Atendente", "In\xEDcio", "Fim", "Vendas aprovadas", "Faturamento", "Taxas de venda", "Comiss\xE3o ap\xF3s taxas de venda", "ADS", "Ajustes", "Parte do atendente no saque", "Comiss\xE3o ap\xF3s descontos", "Repasses brutos pagos", "PIX l\xEDquido pago", "Taxa total de saque", "Parte BRAVUS no saque", "Lucro BRAVUS", "Movimenta\xE7\xE3o de caixa"];
  const row = (name, values) => [text(name), report.start, report.end, values.count, ...["grossCents", "gatewayFeeCents", "commissionCents", "adsCents", "adjustmentsCents", "attendantWithdrawalFeeCents", "netCommissionCents", "paidPayoutCents", "paidPayoutNetCents", "withdrawalGatewayFeeCents", "businessWithdrawalFeeCents", "businessProfitCents", "cashMovementCents"].map((key) => (values[key] / 100).toFixed(2).replace(".", ","))].join(";");
  return "\uFEFF" + [headings.map(text).join(";"), ...report.attendants.map((a) => row(a.attendantName, a)), row("TOTAL", report.totals)].join("\r\n") + "\r\n";
}

// server/admin-controls.ts
async function readFinancialReport(store, start, end, attendantId = "") {
  try {
    validateDateRange(start, end);
  } catch (error) {
    throw new PortalError(400, error.message);
  }
  if (attendantId && !/^[a-zA-Z0-9_-]{1,100}$/.test(attendantId)) throw new PortalError(400, "Atendente inv\xE1lido.");
  return store.sql.transaction(async (db) => {
    const attendants = await db.prepare("SELECT id, name FROM attendants WHERE (? = '' OR id = ?)").all(attendantId, attendantId);
    if (attendantId && !attendants.length) throw new PortalError(404, "Atendente n\xE3o encontrado.");
    const sales = await db.prepare("SELECT attendant_id AS attendantId, date, status, amount_cents AS amountCents, fee_cents AS feeCents, attendant_fee_cents AS attendantFeeCents, commission_bps AS commissionBps, commission_mode AS commissionMode FROM sales WHERE date BETWEEN ? AND ? AND (? = '' OR attendant_id = ?)").all(start, end, attendantId, attendantId);
    const costs = await db.prepare("SELECT attendant_id AS attendantId, date, ads_cents AS adsCents, withdrawal_fee_cents AS withdrawalFeeCents FROM costs WHERE date BETWEEN ? AND ? AND (? = '' OR attendant_id = ?)").all(start, end, attendantId, attendantId);
    const payouts = await db.prepare("SELECT attendant_id AS attendantId, status, amount_cents AS amountCents, withdrawal_fee_cents AS withdrawalFeeCents, gateway_fee_cents AS gatewayFeeCents, paid_at AS paidAt, requested_at AS requestedAt FROM payouts WHERE status = 'paid' AND (? = '' OR attendant_id = ?)").all(attendantId, attendantId);
    return financialReport({ attendants, sales, costs, payouts }, start, end, attendantId);
  }, "read");
}
async function readAudit(store, parameters) {
  const start = parameters.get("start") ?? "", end = parameters.get("end") ?? "", action = parameters.get("action") ?? "", page = Number(parameters.get("page") ?? "1"), pageSize = 50;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1e6 || action && !Object.hasOwn(auditActions, action)) throw new PortalError(400, "Filtro do hist\xF3rico inv\xE1lido.");
  if (start || end) {
    try {
      validateDateRange(start, end);
    } catch (error) {
      throw new PortalError(400, error.message);
    }
  }
  const upper = end ? new Date((/* @__PURE__ */ new Date(end + "T03:00:00.000Z")).getTime() + 864e5).toISOString() : "";
  const where = "WHERE (? = '' OR created_at >= ?) AND (? = '' OR created_at < ?) AND (? = '' OR action = ?)";
  const args = [start, start ? start + "T03:00:00.000Z" : "", end, upper, action, action];
  return store.sql.transaction(async (db) => {
    const total = Number((await db.prepare("SELECT COUNT(*) AS count FROM audit_events " + where).get(...args)).count);
    const rows2 = await db.prepare(`SELECT id, created_at AS createdAt, actor_name AS actorName, action, target_id AS targetId, target_name AS targetName, before_json, after_json FROM audit_events ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    const entries = rows2.map(({ before_json, after_json, ...row }) => ({ ...row, before: before_json === null ? null : JSON.parse(String(before_json)), after: after_json === null ? null : JSON.parse(String(after_json)) }));
    return { entries, total, page, pageSize };
  }, "read");
}

// server/http.ts
var BODY_LIMIT = 12 * 1024 * 1024;
var json = (response, status, value) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
};
function readJson(request, limit = BODY_LIMIT) {
  const prepared = request.body;
  if (prepared !== void 0) {
    try {
      const text = Buffer.isBuffer(prepared) ? prepared.toString("utf8") : typeof prepared === "string" ? prepared : JSON.stringify(prepared);
      if (Buffer.byteLength(text) > limit) return Promise.reject(new PortalError(413, "O envio excede o limite. Envie menos vendas ou prints menores por vez."));
      return Promise.resolve(JSON.parse(text));
    } catch {
      return Promise.reject(new PortalError(400, "O corpo da solicita\xE7\xE3o deve ser um JSON v\xE1lido."));
    }
  }
  return new Promise((accept, reject) => {
    const parts = [];
    let size = 0, rejected = false;
    request.on("data", (part) => {
      size += part.length;
      if (size > limit) {
        if (!rejected) reject(new PortalError(413, "O envio excede o limite. Envie menos vendas ou prints menores por vez."));
        rejected = true;
        parts.length = 0;
        return;
      }
      if (!rejected) parts.push(part);
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        accept(JSON.parse(Buffer.concat(parts).toString("utf8")));
      } catch {
        reject(new PortalError(400, "O corpo da solicita\xE7\xE3o deve ser um JSON v\xE1lido."));
      }
    });
    request.on("error", () => reject(new PortalError(400, "N\xE3o foi poss\xEDvel receber os dados.")));
  });
}
function createPortalHandler(store, options = {}) {
  const failedAuth = /* @__PURE__ */ new Map();
  const adminHash = options.adminKey ? createHash2("sha256").update(options.adminKey).digest() : null;
  return async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const origin = request.headers.origin;
        const forwardedProtocol = request.headers["x-forwarded-proto"];
        const protocol = forwardedProtocol === "https" ? "https" : "http";
        const sameOrigin = origin === `${protocol}://${request.headers.host}`;
        if (origin && !sameOrigin && !options.allowedOrigins?.includes(origin)) throw new PortalError(403, "Origem n\xE3o permitida para este portal.");
        if (origin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
        }
        if (request.method === "OPTIONS") {
          response.writeHead(204, { "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Max-Age": "600" });
          response.end();
          return;
        }
        if (url.pathname === "/api/health" && request.method === "GET") {
          await store.health();
          json(response, 200, { status: "ok", push: options.push ? "enabled" : "disabled" });
          return;
        }
        const identity = request.socket.remoteAddress ?? "unknown";
        const now = Date.now();
        for (const [key, value] of failedAuth) if (now - value.started > 6e4) failedAuth.delete(key);
        if ((failedAuth.get(identity)?.count ?? 0) >= 30) throw new PortalError(429, "Muitas tentativas. Aguarde um minuto e tente novamente.");
        const authorization = request.headers.authorization ?? "";
        if (url.pathname === "/api/cron/backups") {
          const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!options.cronSecret || options.cronSecret.length < 32 || !timingSafeEqual(createHash2("sha256").update(supplied).digest(), createHash2("sha256").update(options.cronSecret).digest())) throw new PortalError(401, "Acesso n\xE3o autorizado.");
          if (request.method !== "GET") throw new PortalError(405, "M\xE9todo n\xE3o permitido.");
          if (!options.backups) throw new PortalError(503, "Backups ainda n\xE3o configurados.");
          json(response, 200, await options.backups.run("daily"));
          return;
        }
        if (url.pathname.startsWith("/api/admin/")) {
          if (!adminHash) throw new PortalError(503, "A administra\xE7\xE3o ainda n\xE3o foi configurada neste servidor.");
          const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (supplied.length < 32 || supplied.length > 256 || !timingSafeEqual(createHash2("sha256").update(supplied).digest(), adminHash)) {
            const count = failedAuth.get(identity);
            failedAuth.set(identity, { count: (count?.count ?? 0) + 1, started: count?.started ?? now });
            throw new PortalError(401, "Chave administrativa inv\xE1lida.");
          }
          const actor = { id: adminHash.toString("hex"), name: "Administrador" };
          if (url.pathname === "/api/admin/audit" && request.method === "GET") {
            json(response, 200, await readAudit(store, url.searchParams));
            return;
          }
          if (/^\/api\/admin\/reports\/financial(?:\.csv)?$/.test(url.pathname) && request.method === "GET") {
            const report = await readFinancialReport(store, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "", url.searchParams.get("attendantId") ?? "");
            if (url.pathname.endsWith(".csv")) {
              response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bravus-fechamento-${report.start}-${report.end}.csv"`, "Cache-Control": "private, no-store" });
              response.end(financialCsv(report));
            } else json(response, 200, report);
            return;
          }
          if (url.pathname.startsWith("/api/admin/backups")) {
            if (!options.backups) throw new PortalError(503, "Backups ainda n\xE3o configurados.");
            if (url.pathname === "/api/admin/backups" && request.method === "GET") json(response, 200, await options.backups.status());
            else if (url.pathname === "/api/admin/backups" && request.method === "POST") json(response, 201, await options.backups.run("manual"));
            else if (/^\/api\/admin\/backups\/[a-zA-Z0-9-]+$/.test(url.pathname) && request.method === "GET") {
              const id = url.pathname.split("/").at(-1), privateUrl = await options.backups.downloadUrl(id);
              if (privateUrl) {
                response.writeHead(302, { Location: privateUrl, "Cache-Control": "private, no-store" });
                response.end();
                return;
              }
              const bytes = await options.backups.download(id);
              response.writeHead(200, { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="bravus-backup-${id}.json.gz"`, "Cache-Control": "private, no-store" });
              await pipeline(Readable.from([bytes]), response);
            } else throw new PortalError(404, "C\xF3pia n\xE3o encontrada.");
            return;
          }
          if (url.pathname.startsWith("/api/admin/push/")) {
            if (!options.push) throw new PortalError(503, "As notifica\xE7\xF5es push ainda n\xE3o est\xE3o dispon\xEDveis neste servidor.");
            const scope = adminHash.toString("hex");
            if (url.pathname === "/api/admin/push/config" && request.method === "GET") json(response, 200, await options.push.adminConfig(scope));
            else if (url.pathname === "/api/admin/push/subscriptions" && request.method === "POST") json(response, 201, await options.push.adminSubscribe(scope, await readJson(request, options.bodyLimit)));
            else if (url.pathname === "/api/admin/push/subscriptions" && request.method === "DELETE") json(response, 200, await options.push.adminUnsubscribe(scope, await readJson(request, options.bodyLimit)));
            else throw new PortalError(404, "Recurso administrativo n\xE3o encontrado.");
            return;
          }
          const route = url.pathname.match(/^\/api\/admin\/(attendants|payouts|checkouts|sales)\/([a-zA-Z0-9_-]+)(?:\/(token|costs))?$/);
          if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
            if (options.backups && url.searchParams.get("refresh") !== "1") await options.backups.run("daily").catch(() => void 0);
            json(response, 200, await store.adminDashboard());
          } else if (url.pathname === "/api/admin/sales" && request.method === "GET") json(response, 200, await store.adminSales(url.searchParams.get("status") ?? "pending", url.searchParams.get("attendantId") ?? "", url.searchParams.get("page") ?? "1"));
          else if (route?.[1] === "sales" && !route[3] && request.method === "PATCH") json(response, 200, await store.reviewSale(route[2], await readJson(request, options.bodyLimit), actor));
          else if (/^\/api\/admin\/receipts\/[a-zA-Z0-9-]+$/.test(url.pathname) && request.method === "GET") {
            const receipt = await store.adminReceipt(url.pathname.split("/").at(-1));
            response.writeHead(200, { "Content-Type": receipt.mime, "Content-Length": receipt.bytes.byteLength, "Cache-Control": "private, no-store", "Content-Disposition": "inline" });
            response.end(receipt.bytes);
          } else if (url.pathname === "/api/admin/attendants" && request.method === "POST") json(response, 201, await store.adminCreateAttendant(await readJson(request, options.bodyLimit), actor));
          else if (route?.[1] === "attendants" && route[3] === "token" && request.method === "POST") json(response, 200, await store.rotateToken(route[2], actor));
          else if (route?.[1] === "attendants" && route[3] === "costs" && request.method === "GET") {
            const date = url.searchParams.get("date") ?? "";
            json(response, 200, await store.adminCosts(route[2], date));
          } else if (route?.[1] === "attendants" && route[3] === "costs" && request.method === "POST") {
            await store.adminSetCosts(route[2], await readJson(request, options.bodyLimit), actor);
            json(response, 200, { saved: true });
          } else if (route?.[1] === "attendants" && !route[3] && request.method === "PATCH") {
            await store.setAttendantActive(route[2], await readJson(request, options.bodyLimit), actor);
            json(response, 200, { saved: true });
          } else if (route?.[1] === "checkouts" && !route[3] && request.method === "PATCH") {
            await store.adminSetCheckout(route[2], await readJson(request, options.bodyLimit), actor);
            json(response, 200, { saved: true });
          } else if (route?.[1] === "payouts" && !route[3] && request.method === "PATCH") {
            const input = await readJson(request, options.bodyLimit);
            if (!input || typeof input.status !== "string" || typeof input.note !== "string") throw new PortalError(400, "Informe o status e a observa\xE7\xE3o do pagamento.");
            await store.markPayout(route[2], input.status, input.note, actor);
            json(response, 200, { saved: true });
          } else throw new PortalError(404, "Recurso administrativo n\xE3o encontrado.");
          return;
        }
        let auth;
        try {
          auth = await store.authenticate(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
        } catch (error) {
          const count = failedAuth.get(identity);
          failedAuth.set(identity, { count: (count?.count ?? 0) + 1, started: count?.started ?? now });
          throw error;
        }
        const requestedPeriod = url.searchParams.get("period") ?? "today";
        if (!Object.hasOwn(periodLabels, requestedPeriod)) throw new PortalError(400, "Per\xEDodo inv\xE1lido.");
        const period = requestedPeriod;
        if (url.pathname.startsWith("/api/push/")) {
          if (!options.push) throw new PortalError(503, "As notifica\xE7\xF5es push ainda n\xE3o est\xE3o dispon\xEDveis neste servidor.");
          if (url.pathname === "/api/push/config" && request.method === "GET") json(response, 200, await options.push.config(auth));
          else if (url.pathname === "/api/push/subscriptions" && request.method === "POST") json(response, 201, await options.push.subscribe(auth, await readJson(request, options.bodyLimit)));
          else if (url.pathname === "/api/push/subscriptions" && request.method === "DELETE") json(response, 200, await options.push.unsubscribe(auth, await readJson(request, options.bodyLimit)));
          else throw new PortalError(404, "Recurso n\xE3o encontrado.");
        } else if (url.pathname === "/api/portal" && request.method === "GET") json(response, 200, { ...await store.portal(auth, period), maxRequestBytes: options.bodyLimit ?? BODY_LIMIT });
        else if (url.pathname === "/api/profile" && request.method === "PATCH") json(response, 200, await store.saveProfile(auth, await readJson(request, options.bodyLimit)));
        else if (url.pathname === "/api/sales" && request.method === "POST") {
          const batch = await readJson(request, options.bodyLimit), result = await store.recordSales(auth, batch, String(request.headers["idempotency-key"] ?? ""));
          if (!result.duplicate && options.push) await Promise.allSettled([
            options.push.notifySale(auth, batch),
            ...adminHash ? [options.push.notifyAdminSale(adminHash.toString("hex"), auth, batch)] : []
          ]);
          json(response, 200, result);
        } else if (url.pathname === "/api/ranking" && request.method === "GET") json(response, 200, await store.ranking(auth, period));
        else if (url.pathname === "/api/payouts" && request.method === "POST") json(response, 201, await store.requestPayout(auth, await readJson(request, options.bodyLimit)));
        else if (/^\/api\/receipts\/[a-zA-Z0-9-]+$/.test(url.pathname) && request.method === "GET") {
          const receipt = await store.receipt(auth, url.pathname.split("/").at(-1));
          response.writeHead(200, { "Content-Type": receipt.mime, "Content-Length": receipt.bytes.byteLength, "Cache-Control": "private, no-store", "Content-Disposition": 'inline; filename="comprovante.' + (receipt.mime === "image/jpeg" ? "jpg" : receipt.mime === "image/webp" ? "webp" : "png") + '"' });
          response.end(receipt.bytes);
        } else throw new PortalError(404, "Recurso n\xE3o encontrado.");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") throw new PortalError(405, "M\xE9todo n\xE3o permitido.");
      if (!options.staticDir) throw new PortalError(404, "Interface n\xE3o dispon\xEDvel. Execute npm run build.");
      const root = resolve(options.staticDir);
      const requested = resolve(root, "." + decodeURIComponent(url.pathname));
      if (requested !== root && !requested.startsWith(root + sep)) throw new PortalError(404, "P\xE1gina n\xE3o encontrada.");
      let filename = requested;
      try {
        if (!(await stat(filename)).isFile()) filename = resolve(root, "index.html");
      } catch {
        filename = resolve(root, "index.html");
      }
      const body = await readFile(filename);
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
      response.writeHead(200, { "Content-Type": types[extname(filename)] ?? "application/octet-stream", "Cache-Control": extname(filename) === ".html" ? "no-store" : "public, max-age=3600" });
      response.end(request.method === "HEAD" ? void 0 : body);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error instanceof PortalError ? error.status : 500;
      json(response, status, { error: status === 500 ? "N\xE3o foi poss\xEDvel concluir a solicita\xE7\xE3o. Tente novamente." : error.message });
    }
  };
}

// server/admin-key.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { mkdirSync as mkdirSync2, readFileSync, writeFileSync, chmodSync as chmodSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function loadAdminKey(filename, configured) {
  if (configured !== void 0) {
    if (configured.length < 32 || configured.length > 256) throw new Error("BRAVUS_ADMIN_KEY deve ter entre 32 e 256 caracteres.");
    return configured;
  }
  mkdirSync2(dirname2(filename), { recursive: true, mode: 448 });
  try {
    writeFileSync(filename, randomBytes2(32).toString("base64url"), { flag: "wx", mode: 384 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  chmodSync2(filename, 384);
  const key = readFileSync(filename, "utf8").trim();
  if (key.length < 32 || key.length > 256) throw new Error("Arquivo da chave administrativa inv\xE1lido; preserve-o e configure BRAVUS_ADMIN_KEY para recuperar o acesso.");
  return key;
}

// server/push.ts
import webpush from "web-push";
import { createHash as createHash3, createECDH, ECDH, randomUUID as randomUUID3 } from "node:crypto";
import { chmodSync as chmodSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname3 } from "node:path";
function validatePushKeys(keys) {
  try {
    if (typeof keys.publicKey !== "string" || typeof keys.privateKey !== "string" || !/^[\w-]{87}$/.test(keys.publicKey) || !/^[\w-]{43}$/.test(keys.privateKey)) throw new Error();
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(keys.privateKey, "base64url"));
    if (!ecdh.getPublicKey().equals(Buffer.from(keys.publicKey, "base64url"))) throw new Error();
    return keys;
  } catch {
    throw new Error("Chaves de Web Push inv\xE1lidas. Preserve o arquivo privado e configure um par de chaves v\xE1lido no servidor.");
  }
}
function loadPushKeys(filename, environment = process.env) {
  const publicKey = environment.BRAVUS_PUSH_PUBLIC_KEY, privateKey = environment.BRAVUS_PUSH_PRIVATE_KEY;
  if (publicKey || privateKey) {
    if (!publicKey || !privateKey) throw new Error("Configure a chave p\xFAblica e a chave privada do Web Push.");
    return validatePushKeys({ publicKey, privateKey });
  }
  mkdirSync3(dirname3(filename), { recursive: true, mode: 448 });
  try {
    writeFileSync2(filename, JSON.stringify(webpush.generateVAPIDKeys()), { flag: "wx", mode: 384 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  chmodSync3(filename, 384);
  return validatePushKeys(JSON.parse(readFileSync2(filename, "utf8")));
}
async function loadDatabasePushKeys(store, environment = process.env) {
  if (environment.BRAVUS_PUSH_PUBLIC_KEY || environment.BRAVUS_PUSH_PRIVATE_KEY) return loadPushKeys("", environment);
  return store.sql.transaction(async (database) => {
    await database.exec("CREATE TABLE IF NOT EXISTS push_server_keys (id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL)");
    const saved = await database.prepare("SELECT public_key, private_key FROM push_server_keys WHERE id = 1").get();
    if (saved) return validatePushKeys({ publicKey: String(saved.public_key), privateKey: String(saved.private_key) });
    const keys = validatePushKeys(webpush.generateVAPIDKeys());
    await database.prepare("INSERT INTO push_server_keys (id, public_key, private_key) VALUES (1, ?, ?)").run(keys.publicKey, keys.privateKey);
    return keys;
  });
}
function subscriptionTable(target) {
  return target.role === "admin" ? { table: "admin_push_subscriptions", column: "admin_scope" } : { table: "push_subscriptions", column: "attendant_id" };
}
function validateSubscription(input) {
  if (!input || typeof input !== "object") throw new PortalError(400, "Inscri\xE7\xE3o de notifica\xE7\xF5es inv\xE1lida.");
  const data = input;
  try {
    if (typeof data.endpoint !== "string" || data.endpoint.length > 4096) throw new Error();
    const url = new URL(data.endpoint);
    const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname) || url.hostname.endsWith(".notify.windows.com");
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed) throw new Error();
    if (!data.keys || typeof data.keys.p256dh !== "string" || typeof data.keys.auth !== "string" || !/^[\w-]{87}$/.test(data.keys.p256dh) || !/^[\w-]{22}$/.test(data.keys.auth) || Buffer.from(data.keys.auth, "base64url").length !== 16 || Buffer.from(data.keys.p256dh, "base64url").length !== 65) throw new Error();
    ECDH.convertKey(Buffer.from(data.keys.p256dh, "base64url"), "prime256v1");
  } catch {
    throw new PortalError(400, "Use uma inscri\xE7\xE3o v\xE1lida do servi\xE7o de notifica\xE7\xF5es do navegador.");
  }
  return { endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } };
}
var PushService = class {
  store;
  keys;
  sender;
  constructor(store, keys, sender = webpush.sendNotification) {
    this.store = store;
    this.keys = keys;
    this.sender = sender;
  }
  async configFor(target) {
    const { table, column } = subscriptionTable(target);
    const subscriptionIds = (await this.store.sql.prepare(`SELECT endpoint_hash FROM ${table} WHERE ${column} = ?`).all(target.id)).map((row) => String(row.endpoint_hash));
    return { publicKey: this.keys.publicKey, subscriptionIds };
  }
  async subscribeFor(target, input) {
    const data = validateSubscription(input), { table, column } = subscriptionTable(target);
    const id = createHash3("sha256").update(data.endpoint).digest("hex");
    return this.store.sql.transaction(async (database) => {
      const exists = await database.prepare(`SELECT endpoint_hash FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).get(id, target.id);
      const count = Number((await database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(target.id)).count);
      if (!exists && count >= 5) throw new PortalError(400, "O limite \xE9 de cinco aparelhos por acesso.");
      await database.prepare(`INSERT INTO ${table} (endpoint_hash, ${column}, subscription) VALUES (?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET ${column} = excluded.${column}, subscription = excluded.subscription`).run(id, target.id, JSON.stringify(data));
      return { id };
    });
  }
  async unsubscribeFor(target, input) {
    const { table, column } = subscriptionTable(target);
    const id = input?.id;
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new PortalError(400, "Inscri\xE7\xE3o inv\xE1lida.");
    await this.store.sql.prepare(`DELETE FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).run(id, target.id);
    return { saved: true };
  }
  config(auth) {
    return this.configFor({ role: "attendant", id: auth.id });
  }
  subscribe(auth, input) {
    return this.subscribeFor({ role: "attendant", id: auth.id }, input);
  }
  unsubscribe(auth, input) {
    return this.unsubscribeFor({ role: "attendant", id: auth.id }, input);
  }
  adminConfig(scope) {
    return this.configFor({ role: "admin", id: scope });
  }
  adminSubscribe(scope, input) {
    return this.subscribeFor({ role: "admin", id: scope }, input);
  }
  adminUnsubscribe(scope, input) {
    return this.unsubscribeFor({ role: "admin", id: scope }, input);
  }
  async notifySale(auth, batch) {
    const active = await this.store.sql.prepare("SELECT id FROM attendants WHERE id = ? AND active = 1").get(auth.id);
    if (!active) return;
    const profile = await this.store.profile(auth), amount = batch.sales.reduce((sum, sale) => sum + amountToCents(sale.amount), 0);
    await this.sendTo({ role: "attendant", id: auth.id }, { title: "BRAVUS Brasil \xB7 Venda registrada", body: renderSaleAlert(profile.saleAlertTemplate, amount, batch.sales.length, profile.name) });
  }
  async notifyAdminSale(scope, auth, batch) {
    const amount = batch.sales.reduce((sum, sale) => sum + amountToCents(sale.amount), 0);
    await this.sendTo({ role: "admin", id: scope }, { title: "Nova venda aprovada", body: `Voc\xEA recebeu ${money(amount)}`, target: "admin", tag: `bravus-admin-venda-${randomUUID3()}` });
  }
  async sendTo(target, message) {
    const { table, column } = subscriptionTable(target), payload = JSON.stringify(message);
    const rows2 = await this.store.sql.prepare(`SELECT endpoint_hash, subscription FROM ${table} WHERE ${column} = ?`).all(target.id);
    await Promise.allSettled(rows2.map(async (row) => {
      try {
        await this.sender(JSON.parse(String(row.subscription)), payload, { vapidDetails: { ...this.keys, subject: process.env.BRAVUS_PUSH_SUBJECT ?? "https://github.com/luizesantos777/BRAVUS" }, TTL: 600, timeout: 5e3, ...process.env.HTTPS_PROXY ? { proxy: process.env.HTTPS_PROXY } : {} });
      } catch (error) {
        if ([404, 410].includes(error.statusCode ?? 0)) await this.store.sql.prepare(`DELETE FROM ${table} WHERE endpoint_hash = ? AND ${column} = ?`).run(String(row.endpoint_hash), target.id);
      }
    }));
  }
};

// server/backups.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { get, put, del, issueSignedToken, presignUrl } from "@vercel/blob";
var compress = promisify(gzip);
var decompress = promisify(gunzip);
var MAX_BYTES = 128 * 1024 * 1024;
var TABLES = ["attendants", "checkouts", "schema_migrations", "batches", "receipts", "sales", "costs", "payouts", "push_subscriptions", "admin_push_subscriptions", "push_server_keys", "backup_runs", "audit_events"];
var hash = (bytes) => createHash4("sha256").update(bytes).digest("hex");
var pathFor = (id) => {
  if (!/^(daily-\d{4}-\d{2}-\d{2}(?:-[a-f0-9-]{36})?|manual-[a-f0-9-]{36})$/.test(id)) throw new PortalError(400, "Identificador do backup inv\xE1lido.");
  return `bravus-backups/${id}.json.gz`;
};
async function createArchive(store, backupId) {
  const archive = await store.sql.transaction(async (db) => {
    const tables = [];
    let size = 0;
    for (const name of TABLES) {
      const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).map((column) => String(column.name));
      const rows2 = (await db.prepare(`SELECT * FROM ${name}`).all()).map((row) => columns.map((column) => {
        const value = row[column];
        if (value instanceof Uint8Array) return { binary: Buffer.from(value).toString("base64") };
        if (value === null || typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value)) return value;
        throw new Error("Unsupported backup value");
      }));
      const table = { name, columns, rows: rows2 };
      size += Buffer.byteLength(JSON.stringify(table));
      if (size > MAX_BYTES) throw new PortalError(413, "A c\xF3pia ultrapassou o limite de 128 MB. O armazenamento precisa ser ampliado.");
      tables.push(table);
    }
    return { format: "bravus-backup", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), ...backupId ? { backupId } : {}, tables };
  }, "read");
  return compress(Buffer.from(JSON.stringify(archive)));
}
async function decodeArchive(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error("Invalid backup size");
  const archive = JSON.parse((await decompress(bytes, { maxOutputLength: MAX_BYTES + 1024 * 1024 })).toString("utf8"));
  if (archive.format !== "bravus-backup" || archive.version !== 1 || !Array.isArray(archive.tables) || archive.tables.length !== TABLES.length || new Set(archive.tables.map((table) => table.name)).size !== TABLES.length || TABLES.some((name) => !archive.tables.some((table) => table.name === name))) throw new Error("Invalid backup format");
  return archive;
}
async function importArchive(db, archive) {
  if (Number((await db.prepare("SELECT COUNT(*) AS count FROM attendants").get()).count) || Number((await db.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).count)) throw new Error("Recovery requires an empty database");
  await db.transaction(async (connection) => {
    for (const name of [...TABLES].reverse()) if (name !== "audit_events") await connection.prepare(`DELETE FROM ${name}`).run();
    for (const name of TABLES) {
      const table = archive.tables.find((item) => item.name === name);
      const expected = (await connection.prepare(`PRAGMA table_info(${name})`).all()).map((column) => String(column.name));
      if (!Array.isArray(table.columns) || table.columns.length !== expected.length || new Set(table.columns).size !== expected.length || table.columns.some((column) => !expected.includes(column)) || !Array.isArray(table.rows)) throw new Error("Invalid backup columns");
      const statement = connection.prepare(`INSERT INTO ${name} (${table.columns.map((column) => '"' + column + '"').join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`);
      for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length) throw new Error("Invalid backup row");
        const values = row.map((value) => {
          if (value === null || typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value)) return value;
          if (value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.binary === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.binary)) return Buffer.from(value.binary, "base64");
          throw new Error("Invalid backup value");
        });
        await statement.run(...values);
      }
      if (Number((await connection.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()).count) !== table.rows.length) throw new Error("Backup row count mismatch");
    }
    if ((await connection.prepare("PRAGMA foreign_key_check").all()).length || (await connection.prepare("PRAGMA quick_check").all()).some((row) => Object.values(row)[0] !== "ok")) throw new Error("Backup integrity check failed");
  });
}
async function restoreArchive(bytes, destination) {
  const archive = await decodeArchive(bytes);
  if (archive.backupId) pathFor(archive.backupId);
  await importArchive(destination.sql, archive);
  if (archive.backupId) await destination.sql.prepare("UPDATE backup_runs SET status = 'verified', verified_at = ?, size_bytes = ?, sha256 = ?, error = '' WHERE id = ?").run((/* @__PURE__ */ new Date()).toISOString(), bytes.length, hash(bytes), archive.backupId);
}
async function verifyArchive(bytes) {
  const copy = await PortalStore.open(":memory:");
  try {
    await restoreArchive(bytes, copy);
  } finally {
    copy.close();
  }
}
function privateBlob(token, signing = { issue: issueSignedToken, url: presignUrl }) {
  return {
    destination: "private-blob",
    async write(id, bytes) {
      await put(pathFor(id), bytes, { access: "private", token, addRandomSuffix: false, allowOverwrite: false, contentType: "application/gzip", cacheControlMaxAge: 60 });
    },
    async read(id) {
      const result = await get(pathFor(id), { access: "private", token, useCache: false });
      if (!result || result.statusCode !== 200) throw new Error("Backup not found");
      const reader = result.stream.getReader(), parts = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > MAX_BYTES) throw new Error("Backup exceeds size limit");
          parts.push(Buffer.from(next.value));
        }
      } finally {
        await reader.cancel().catch(() => void 0);
      }
      return Buffer.concat(parts);
    },
    async remove(id) {
      await del(pathFor(id), { token });
    },
    async downloadUrl(id) {
      const pathname = pathFor(id), validUntil = Date.now() + 2 * 6e4;
      const signed = await signing.issue({ token, pathname, operations: ["get"], validUntil });
      return (await signing.url(signed, { operation: "get", pathname, access: "private", validUntil, useCache: false })).presignedUrl;
    }
  };
}
var BackupService = class {
  store;
  storage;
  scheduled;
  constructor(store, storage, scheduled = false) {
    this.store = store;
    this.storage = storage;
    this.scheduled = scheduled;
  }
  async status() {
    const records = await this.store.sql.prepare("SELECT id, kind, status, started_at AS startedAt, verified_at AS verifiedAt, size_bytes AS sizeBytes, error FROM backup_runs ORDER BY started_at DESC LIMIT 50").all();
    return { configured: this.storage !== null, destination: this.storage?.destination ?? "unconfigured", scheduled: this.scheduled, automatic: !this.storage ? "Aguardando armazenamento privado" : this.scheduled ? "Todos os dias, \xE0s 03h de Bras\xEDlia" : "Uma c\xF3pia por dia ao abrir o painel", retentionDays: 30, records };
  }
  async run(kind, now = /* @__PURE__ */ new Date()) {
    if (!this.storage) throw new PortalError(503, "Conecte um armazenamento Blob privado ao projeto na Vercel para ativar os backups.");
    const day = kind === "daily" ? businessToday(now) : null;
    let id = kind === "daily" ? "daily-" + day + "-" + randomUUID4() : "manual-" + randomUUID4();
    const startedAt = now.toISOString();
    const existing = await this.store.sql.transaction(async (db) => {
      const previous = day ? await db.prepare("SELECT id FROM backup_runs WHERE day_key = ? AND status = 'verified'").get(day) : void 0;
      if (previous) {
        id = String(previous.id);
        return true;
      }
      if (await db.prepare("SELECT id FROM backup_runs WHERE status = 'running' AND started_at > ?").get(new Date(now.getTime() - 10 * 6e4).toISOString())) throw new PortalError(409, "Uma c\xF3pia de seguran\xE7a j\xE1 est\xE1 em andamento. Aguarde a conclus\xE3o.");
      await db.prepare("UPDATE backup_runs SET status = 'failed', error = 'A c\xF3pia foi interrompida. Tente novamente.' WHERE status = 'running'").run();
      await db.prepare("INSERT INTO backup_runs (id, kind, status, started_at, day_key) VALUES (?, ?, 'running', ?, ?)").run(id, kind, startedAt, day);
      return false;
    });
    if (!existing) {
      try {
        const archive = await createArchive(this.store, id), checksum = hash(archive);
        await this.storage.write(id, archive);
        const downloaded = await this.storage.read(id);
        if (hash(downloaded) !== checksum) throw new Error("Backup checksum mismatch");
        await verifyArchive(downloaded);
        await this.store.sql.prepare("UPDATE backup_runs SET status = 'verified', verified_at = ?, size_bytes = ?, sha256 = ? WHERE id = ?").run((/* @__PURE__ */ new Date()).toISOString(), downloaded.length, checksum, id);
      } catch {
        const message = "N\xE3o foi poss\xEDvel criar e verificar esta c\xF3pia. O \xFAltimo backup v\xE1lido foi preservado.";
        await this.store.sql.prepare("UPDATE backup_runs SET status = 'failed', error = ? WHERE id = ?").run(message, id);
        throw new PortalError(503, message);
      }
      const cutoff = new Date(now.getTime() - 30 * 864e5).toISOString();
      for (const record of await this.store.sql.prepare("SELECT id FROM backup_runs WHERE started_at < ? AND id <> ?").all(cutoff, id)) {
        try {
          await this.storage.remove(String(record.id));
          await this.store.sql.prepare("DELETE FROM backup_runs WHERE id = ?").run(String(record.id));
        } catch {
        }
      }
    }
    return await this.store.sql.prepare("SELECT id, kind, status, started_at AS startedAt, verified_at AS verifiedAt, size_bytes AS sizeBytes, error FROM backup_runs WHERE id = ?").get(id);
  }
  async download(id) {
    pathFor(id);
    const record = await this.store.sql.prepare("SELECT sha256 FROM backup_runs WHERE id = ? AND status = 'verified'").get(id);
    if (!this.storage || !record) throw new PortalError(404, "C\xF3pia verificada n\xE3o encontrada.");
    try {
      const bytes = await this.storage.read(id);
      if (hash(bytes) !== record.sha256) throw new Error("Backup checksum mismatch");
      return bytes;
    } catch {
      throw new PortalError(503, "N\xE3o foi poss\xEDvel conferir a integridade desta c\xF3pia. Tente novamente ou use outra c\xF3pia verificada.");
    }
  }
  async downloadUrl(id) {
    pathFor(id);
    if (!this.storage?.downloadUrl) return null;
    if (!await this.store.sql.prepare("SELECT id FROM backup_runs WHERE id = ? AND status = 'verified'").get(id)) throw new PortalError(404, "C\xF3pia verificada n\xE3o encontrada.");
    try {
      const url = new URL(await this.storage.downloadUrl(id));
      if (url.protocol !== "https:" || !url.hostname.endsWith(".blob.vercel-storage.com") || url.username || url.password) throw new Error("Invalid private download");
      return url.href;
    } catch {
      throw new PortalError(503, "N\xE3o foi poss\xEDvel autorizar o download privado. Tente novamente.");
    }
  }
};

// server/vercel.ts
var BODY_LIMIT2 = 4 * 1024 * 1024;
var StartupError = class extends Error {
  issue;
  databaseCode;
  constructor(issue, error) {
    super(issue);
    this.issue = issue;
    if (issue !== "database_initialization_failed") return;
    const known = /* @__PURE__ */ new Set(["SQLITE_ERROR", "SQLITE_BUSY", "SQLITE_BUSY_TIMEOUT", "SQLITE_AUTH", "SQLITE_READONLY", "SQLITE_CONSTRAINT", "SERVER_ERROR", "HRANA_PROTO_ERROR", "HRANA_CLOSED_ERROR", "TRANSACTION_CLOSED", "PROTOCOL_VERSION_ERROR", "ERR_INVALID_URL", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"]);
    let current = error;
    for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
      const detail = current;
      if (detail.status === 401 || detail.status === 403) {
        this.databaseCode = "DATABASE_AUTH_FAILED";
        break;
      }
      if (typeof detail.code === "string" && known.has(detail.code)) this.databaseCode = detail.code;
      current = detail.cause;
    }
  }
};
function createVercelHandler(options = {}) {
  let initialized;
  const environment = options.environment ?? (() => process.env);
  const openStore = options.openStore ?? ((connection) => PortalStore.open(connection));
  async function initialize() {
    const env = environment(), url = env.TURSO_DATABASE_URL, authToken = env.TURSO_AUTH_TOKEN, key = env.BRAVUS_ADMIN_KEY;
    if (!url || !authToken || !key) throw new Error("SETUP_REQUIRED");
    let adminKey;
    try {
      adminKey = loadAdminKey("", key);
    } catch {
      throw new StartupError("admin_key_invalid");
    }
    let store;
    try {
      store = await openStore({ url, authToken });
    } catch (error) {
      throw new StartupError("database_initialization_failed", error);
    }
    try {
      const push = new PushService(store, await loadDatabasePushKeys(store, env));
      const allowedOrigins = (env.BRAVUS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const backups = new BackupService(store, env.BLOB_READ_WRITE_TOKEN ? privateBlob(env.BLOB_READ_WRITE_TOKEN) : null, (env.CRON_SECRET?.length ?? 0) >= 32);
      return createPortalHandler(store, { adminKey, allowedOrigins, push, backups, cronSecret: env.CRON_SECRET, bodyLimit: BODY_LIMIT2 });
    } catch {
      store.close();
      throw new StartupError("configuration_invalid");
    }
  }
  return async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const routed = url.searchParams.get("__bravus_path");
      if (routed !== null) {
        if (!/^[a-zA-Z0-9_/-]+(?:\.csv)?$/.test(routed)) {
          response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ error: "Recurso n\xE3o encontrado." }));
          return;
        }
        url.pathname = "/api/" + routed;
        url.searchParams.delete("__bravus_path");
        request.url = url.pathname + url.search;
      }
      if (!initialized) initialized = initialize().catch((error) => {
        initialized = void 0;
        throw error;
      });
      const handler = await initialized;
      await handler(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const env = environment();
      const missingVariables = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "BRAVUS_ADMIN_KEY"].filter((name) => !env[name]);
      const missing = missingVariables.length > 0;
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Retry-After": "30" });
      const diagnostics = error instanceof StartupError ? { setupIssue: error.issue, ...error.databaseCode ? { databaseCode: error.databaseCode } : {} } : {};
      response.end(JSON.stringify({ status: missing ? "configuration_required" : "unavailable", ...missing ? { missingVariables } : diagnostics, error: missing ? "A API precisa da conex\xE3o com o banco e da chave administrativa configuradas na hospedagem." : error instanceof StartupError && error.issue === "admin_key_invalid" ? "BRAVUS_ADMIN_KEY deve ter entre 32 e 256 caracteres." : "O servi\xE7o de atendentes n\xE3o conseguiu acessar sua configura\xE7\xE3o ou o banco de dados. Tente novamente em instantes." }));
    }
  };
}
var vercel_default = createVercelHandler();
export {
  createVercelHandler,
  vercel_default as default
};
