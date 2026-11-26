import type { GatewayCostProfile } from '../src/partner-business.ts';
import type { GatewaySyncView } from '../src/domain.ts';

export interface GatewayAmountLimits {
  pix: { minCents: number | null; maxCents: number | null } | null;
  credit_card: { minCents: number | null; maxCents: number | null } | null;
}

export interface GatewayProviderSnapshot {
  id: string;
  configured: boolean;
  excluded: boolean;
  cost: GatewayCostProfile | null;
  amountLimits: GatewayAmountLimits;
  pausedUntil: number | null;
}

export interface GatewayConfigSnapshot {
  schema: 1;
  generatedAt: number;
  revision: string;
  active: {
    provider: string;
    suspended: boolean;
    configured: boolean;
    excluded: boolean;
    cost: GatewayCostProfile | null;
    amountLimits: GatewayAmountLimits | null;
  };
  providers: GatewayProviderSnapshot[];
  fallback: {
    enabled: boolean;
    autoSwitch: boolean;
    order: string[];
    ticketRouting: { enabled: boolean; rules: { aboveCents: number; gateway: string }[] };
  };
}

export interface GatewaySyncStatus {
  configured: boolean;
  state: 'not_configured' | 'synced' | 'stale' | 'error';
  revision: string | null;
  fetchedAt: string | null;
  error: string | null;
}

export function gatewaySyncView(config: GatewayConfigSnapshot | null, status: GatewaySyncStatus): GatewaySyncView {
  const active = config?.active;
  const pix = active?.amountLimits?.pix ?? null;
  return {
    ...status,
    activeProvider: active?.provider ?? null,
    activeCost: active?.cost ?? null,
    activeMinAmountCents: pix?.minCents ?? null,
    activeMaxAmountCents: pix?.maxCents ?? null,
    fallback: config ? { enabled: config.fallback.enabled, autoSwitch: config.fallback.autoSwitch, order: config.fallback.order } : null,
  };
}

const isIntegerOrNull = (value: unknown) => value === null || Number.isSafeInteger(value);
const MIN_SYNC_TOKEN_LENGTH = 32;

function cost(value: unknown): GatewayCostProfile | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Custo de gateway invalido.');
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.basisPoints) || Number(item.basisPoints) < 0 || Number(item.basisPoints) > 10000 ||
      !Number.isSafeInteger(item.fixedCents) || Number(item.fixedCents) < 0 || Number(item.fixedCents) > 100000000 ||
      (item.rounding !== 'nearest' && item.rounding !== 'up')) throw new Error('Custo de gateway invalido.');
  return { basisPoints: Number(item.basisPoints), fixedCents: Number(item.fixedCents), rounding: item.rounding };
}

function limits(value: unknown): GatewayAmountLimits {
  if (!value || typeof value !== 'object') throw new Error('Limites de gateway invalidos.');
  const source = value as Record<string, unknown>;
  const read = (raw: unknown) => {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') throw new Error('Limites de gateway invalidos.');
    const item = raw as Record<string, unknown>;
    if (!isIntegerOrNull(item.minCents) || !isIntegerOrNull(item.maxCents) ||
        (item.minCents !== null && Number(item.minCents) < 0) || (item.maxCents !== null && Number(item.maxCents) < 0) ||
        (item.minCents !== null && item.maxCents !== null && Number(item.minCents) > Number(item.maxCents))) {
      throw new Error('Limites de gateway invalidos.');
    }
    return { minCents: item.minCents === null ? null : Number(item.minCents), maxCents: item.maxCents === null ? null : Number(item.maxCents) };
  };
  return { pix: read(source.pix), credit_card: read(source.credit_card) };
}

export function parseGatewayConfig(value: unknown): GatewayConfigSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Configuracao de gateway invalida.');
  const source = value as Record<string, unknown>;
  const active = source.active;
  const fallback = source.fallback;
  if (source.schema !== 1 || !Number.isSafeInteger(source.generatedAt) || typeof source.revision !== 'string' || !source.revision ||
      !active || typeof active !== 'object' || !fallback || typeof fallback !== 'object' || !Array.isArray(source.providers)) {
    throw new Error('Configuracao de gateway invalida.');
  }
  const activeValue = active as Record<string, unknown>;
  const fallbackValue = fallback as Record<string, unknown>;
  if (typeof activeValue.provider !== 'string' || typeof activeValue.suspended !== 'boolean' ||
      typeof activeValue.configured !== 'boolean' || typeof activeValue.excluded !== 'boolean' ||
      !Array.isArray(fallbackValue.order) || typeof fallbackValue.enabled !== 'boolean' || typeof fallbackValue.autoSwitch !== 'boolean' ||
      !fallbackValue.ticketRouting || typeof fallbackValue.ticketRouting !== 'object') throw new Error('Configuracao de gateway invalida.');
  const providers = source.providers.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Gateway invalida.');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.configured !== 'boolean' || typeof item.excluded !== 'boolean' ||
        (item.pausedUntil !== null && !Number.isSafeInteger(item.pausedUntil))) throw new Error('Gateway invalida.');
    return { id: item.id, configured: item.configured, excluded: item.excluded, cost: cost(item.cost), amountLimits: limits(item.amountLimits), pausedUntil: item.pausedUntil === null ? null : Number(item.pausedUntil) };
  });
  const ticketRouting = fallbackValue.ticketRouting as Record<string, unknown>;
  if (typeof ticketRouting.enabled !== 'boolean' || !Array.isArray(ticketRouting.rules)) throw new Error('Roteamento de gateway invalido.');
  const rules = ticketRouting.rules.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Roteamento de gateway invalido.');
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.aboveCents) || typeof item.gateway !== 'string') throw new Error('Roteamento de gateway invalido.');
    return { aboveCents: Number(item.aboveCents), gateway: item.gateway };
  });
  return { schema: 1, generatedAt: Number(source.generatedAt), revision: source.revision, active: { provider: activeValue.provider, suspended: activeValue.suspended, configured: activeValue.configured, excluded: activeValue.excluded, cost: cost(activeValue.cost), amountLimits: activeValue.amountLimits === null ? null : limits(activeValue.amountLimits) }, providers, fallback: { enabled: fallbackValue.enabled, autoSwitch: fallbackValue.autoSwitch, order: fallbackValue.order.map(String), ticketRouting: { enabled: ticketRouting.enabled, rules } } };
}

export class GatewayConfigSync {
  private readonly url: string;
  private readonly token: string;
  private readonly apply: (config: GatewayConfigSnapshot) => Promise<void> | void;
  private running: Promise<void> | null = null;
  private nextAttempt = 0;
  private snapshot: GatewayConfigSnapshot | null = null;
  private lastError: string | null = null;
  private fetchedAt: string | null = null;
  constructor(url: string, token: string, apply: (config: GatewayConfigSnapshot) => Promise<void> | void) { this.url = url; this.token = token; this.apply = apply; }
  status(): GatewaySyncStatus {
    if (!this.url || this.token.length < MIN_SYNC_TOKEN_LENGTH) return { configured: false, state: 'not_configured', revision: this.snapshot?.revision ?? null, fetchedAt: this.fetchedAt, error: null };
    return { configured: true, state: this.lastError ? (this.snapshot ? 'stale' : 'error') : 'synced', revision: this.snapshot?.revision ?? null, fetchedAt: this.fetchedAt, error: this.lastError };
  }
  view(): GatewaySyncView { return gatewaySyncView(this.snapshot, this.status()); }
  async refresh() {
    if (!this.url || this.token.length < MIN_SYNC_TOKEN_LENGTH) return;
    if (this.running) return this.running;
    if (Date.now() < this.nextAttempt) return;
    this.nextAttempt = Date.now() + 30000;
    this.running = (async () => {
      try {
        const response = await fetch(this.url, { headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json' }, signal: AbortSignal.timeout(5000), cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const config = parseGatewayConfig(await response.json());
        if (this.snapshot?.revision === config.revision) { this.lastError = null; this.fetchedAt = new Date().toISOString(); return; }
        await this.apply(config);
        this.snapshot = config; this.lastError = null; this.fetchedAt = new Date().toISOString();
      } catch (error) { this.lastError = error instanceof Error ? error.message.slice(0, 160) : 'Falha de sincronizacao.'; }
      finally { this.running = null; }
    })();
    return this.running;
  }
}
