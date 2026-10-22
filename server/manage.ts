import { resolve, dirname } from 'node:path';
import { mkdirSync, openSync, writeFileSync, closeSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { PortalStore } from './store.ts';
import { backup } from 'node:sqlite';
import { amountToCents, DEFAULT_COMMISSION_BPS, percentageToBps } from '../src/domain.ts';
import { restoreArchive, verifyArchive } from './backups.ts';
import { appendAudit } from './controls-schema.ts';

const [command, ...args] = process.argv.slice(2);
const flag = (name: string, fallback = '') => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : (args[index + 1] ?? ''); };
const percent = percentageToBps;
const cost = (input: string) => /^0([.,]0{1,2})?$/.test(input) ? 0 : amountToCents(input);
if (command === 'restore-backup') {
  let restored: PortalStore | undefined, created = false;
  const input = flag('input'), output = flag('output') ? resolve(flag('output')) : '';
  try {
    if (!input || !output.endsWith('.sqlite') || ['dist', 'docs', 'public'].some(folder => output === resolve(folder) || output.startsWith(resolve(folder) + '/'))) throw new Error('Informe --input com a cópia .json.gz e --output com um novo arquivo .sqlite fora das pastas públicas.');
    if (statSync(input).size > 128 * 1024 * 1024) throw new Error('Cópia maior que o limite de recuperação.');
    const bytes = readFileSync(input); await verifyArchive(bytes);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    closeSync(openSync(output, 'wx', 0o600)); created = true;
    restored = await PortalStore.open(output); await restoreArchive(bytes, restored); restored.close(); restored = undefined;
    console.log('Recuperação concluída e integridade conferida em um banco separado. O banco em produção não foi alterado.');
  } catch {
    restored?.close();
    if (created) for (const file of [output, output + '-wal', output + '-shm']) { try { unlinkSync(file); } catch {} }
    console.error('Não foi possível recuperar a cópia. Confira o arquivo e use um destino novo e privado; arquivos existentes não são substituídos.');
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
if (process.env.TURSO_AUTH_TOKEN && !process.env.TURSO_DATABASE_URL) throw new Error('Configure TURSO_DATABASE_URL para usar o token do banco remoto.');
const source = process.env.TURSO_DATABASE_URL ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN ?? '' } : process.env.BRAVUS_DB_PATH ?? resolve('.bravus/portal.sqlite');
const store = await PortalStore.open(source);
try {
  if (command === 'create-attendant') {
    const name = flag('name'), commission = percent(flag('commission', String(DEFAULT_COMMISSION_BPS / 100)));
    const base = flag('base-url', process.env.BRAVUS_PUBLIC_URL ?? '');
    if (!base || !/^https?:\/\//.test(base)) throw new Error('Informe --base-url com o endereço do portal.');
    const output = resolve(flag('output', '.bravus/invites/' + Date.now() + '.json'));
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    const file = openSync(output, 'wx', 0o600);
    try {
      const { id, token } = (await store.createAttendant(name, commission));
      const url = new URL(base); url.hash = `/atendente/${token}`;
      writeFileSync(file, JSON.stringify({ attendantId: id, name, url: url.href }, null, 2));
      console.log(`Atendente criado. Convite privado salvo em ${output}. O token não é exibido nos logs.`);
    } catch (error) { unlinkSync(output); throw error; } finally { closeSync(file); }
  } else if (command === 'backup') {
    const output = resolve(flag('output', '.bravus/backups/' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite'));
    if (!output.endsWith('.sqlite')) throw new Error('O backup deve usar a extensão .sqlite e um destino privado.');
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    const file = openSync(output, 'wx', 0o600); closeSync(file);
    try { await backup(store.db, output); }
    catch (error) { unlinkSync(output); throw error; }
    console.log(`Backup consistente do banco salvo em ${output}. Proteja esse arquivo como os dados originais.`);
  } else if (command === 'list-attendants') {
    console.log(JSON.stringify(await store.sql.prepare('SELECT id, name, commission_bps AS commissionBps, active FROM attendants').all(), null, 2));
  } else if (command === 'set-costs') {
    (await store.setCosts(flag('attendant'), flag('date'), cost(flag('ads', '0')), cost(flag('withdrawal-fee', '0'))));
    console.log('Custos diários atualizados.');
  } else if (command === 'set-checkout') {
    const id = flag('id'), name = flag('name'), fee = percent(flag('fee'));
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || !name.trim() || name.length > 100) throw new Error('Informe ID e nome válidos.');
    const current = (await store.checkouts()).find(checkout => checkout.id === id);
    const fixedFee = cost(flag('fixed-fee', String((current?.fixedFeeCents ?? 0) / 100)));
    const minimum = amountToCents(flag('minimum', String((current?.minAmountCents ?? 1) / 100)));
    const above = flag('above', current?.higherTier ? String(current.higherTier.aboveAmountCents / 100) : '');
    const higherTier = above.trim() === '' ? null : { aboveAmountCents: amountToCents(above), feeBps: percent(flag('above-fee', current?.higherTier ? String(current.higherTier.feeBps / 100) : '')), fixedFeeCents: cost(flag('above-fixed-fee', String((current?.higherTier?.fixedFeeCents ?? 0) / 100))) };
    if (higherTier && higherTier.aboveAmountCents < minimum) throw new Error('O limite da faixa inicial deve ser maior ou igual ao mínimo por venda.');
    if (current?.maxAmountCents != null && (minimum > current.maxAmountCents || higherTier && higherTier.aboveAmountCents >= current.maxAmountCents)) throw new Error('Configuração incompatível com o limite de recebimento do checkout.');
    await store.sql.transaction(async db => {
      await db.prepare('INSERT INTO checkouts (id, name, fee_bps, fixed_fee_cents, min_amount_cents, tier_above_cents, tier_fee_bps, tier_fixed_fee_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, fee_bps=excluded.fee_bps, fixed_fee_cents=excluded.fixed_fee_cents, min_amount_cents=excluded.min_amount_cents, tier_above_cents=excluded.tier_above_cents, tier_fee_bps=excluded.tier_fee_bps, tier_fixed_fee_cents=excluded.tier_fixed_fee_cents').run(id, name.trim(), fee, fixedFee, minimum, higherTier?.aboveAmountCents ?? null, higherTier?.feeBps ?? null, higherTier?.fixedFeeCents ?? null);
      const values = (value: { name: string; feeBps: number; fixedFeeCents: number; minAmountCents: number; higherTier: typeof higherTier }) => ({ name: value.name, feeBps: value.feeBps, fixedFeeCents: value.fixedFeeCents, minAmountCents: value.minAmountCents, aboveAmountCents: value.higherTier?.aboveAmountCents ?? null, aboveFeeBps: value.higherTier?.feeBps ?? null, aboveFixedFeeCents: value.higherTier?.fixedFeeCents ?? null });
      await appendAudit(db, { id: 'cli', name: 'Administração via terminal' }, 'checkout.updated', id, name.trim(), current ? values(current) : null, values({ name: name.trim(), feeBps: fee, fixedFeeCents: fixedFee, minAmountCents: minimum, higherTier }));
    });
    console.log('Checkout atualizado. Novas taxas se aplicam apenas às próximas vendas.');
  } else if (command === 'mark-payout') {
    (await store.markPayout(flag('id'), flag('status') as 'paid' | 'cancelled', flag('note')));
    console.log('Status do repasse atualizado. Nenhuma transferência bancária é executada pelo BRAVUS.');
  } else if (command === 'revoke-attendant') {
    await store.setAttendantActive(flag('id'), { active: false }, { id: 'cli', name: 'Administração via terminal' });
    console.log('Acesso do atendente revogado; histórico preservado.');
  } else throw new Error('Comandos: create-attendant, list-attendants, set-costs, set-checkout, mark-payout, revoke-attendant, backup, restore-backup. Consulte o README.');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
finally { store.close(); }
