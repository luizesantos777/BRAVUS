import assert from 'node:assert/strict';
import test from 'node:test';
import { amountToCents, businessToday, calculateFinance, inPeriod, percentageToBps, validateProfile, validDate } from '../src/domain.ts';
import type { Sale } from '../src/domain.ts';

const sale = (amountCents: number, date = '2026-10-21', feeCents = 0): Sale => ({ id: 'sale', date, time: '12:00', checkoutId: 'main', checkoutName: 'Principal', amountCents, feeCents, commissionBps: 1000, goalCents: 20000, note: '', receiptId: 'receipt', createdAt: '2026-10-21T12:00:00Z' });
test('valores brasileiros são convertidos em centavos inteiros', () => {
  for (const [value, expected] of [['197,00', 19700], ['1.250,50', 125050], ['0.29', 29], ['1.000', 100000], ['12,3', 1230]] as const) assert.equal(amountToCents(value), expected);
  for (const value of ['0', '-10', '1e3', 'NaN', '1000001', '1,234', '1.25,50']) assert.throws(() => amountToCents(value));
});
test('percentuais mantêm duas casas decimais sem erro de ponto flutuante', () => {
  assert.equal(percentageToBps('29,99'), 2999); assert.equal(percentageToBps('0'), 0); assert.equal(percentageToBps('100'), 10000);
  for (const value of ['100.01', '-1', '', '10.001']) assert.throws(() => percentageToBps(value));
});
test('meta é somada por dia e libera comissão ao atingir o valor mínimo', () => {
  const below = calculateFinance([sale(19700)], [], [], 'today', '2026-10-21');
  assert.equal(below.availableCents, 0); assert.equal(below.pendingGoalCents, 1970);
  const reached = calculateFinance([sale(19700), sale(300)], [], [], 'today', '2026-10-21');
  assert.equal(reached.grossCents, 20000); assert.equal(reached.commissionCents, 2000); assert.equal(reached.availableCents, 2000);
});
test('custos viram dívida quando a meta não é alcançada; dias não se misturam', () => {
  const summary = calculateFinance([sale(10000, '2026-10-20'), sale(10000)], [{ date: '2026-10-20', adsCents: 1500, withdrawalFeeCents: 100 }], [], 'all', '2026-10-21');
  assert.equal(summary.commissionCents, 0); assert.equal(summary.pendingGoalCents, 2000); assert.equal(summary.availableCents, -1600); assert.equal(summary.debtCents, 1600);
});
test('taxas do checkout, comissão e repasses reservados são calculados sem duplicar descontos', () => {
  const summary = calculateFinance([sale(30000, '2026-10-21', 900)], [{ date: '2026-10-21', adsCents: 100, withdrawalFeeCents: 50 }], [{ id: 'payout', amountCents: 1000, status: 'pending', requestedAt: '2026-10-21T12:00:00Z', paidAt: null, note: '' }], 'today', '2026-10-21');
  assert.equal(summary.feeCents, 950); assert.equal(summary.commissionCents, 2910); assert.equal(summary.availableCents, 1760);
});
test('período altera o extrato mas mantém o saldo acumulado', () => {
  const summary = calculateFinance([sale(30000, '2026-09-01'), sale(20000)], [], [], 'today', '2026-10-21');
  assert.equal(summary.grossCents, 20000); assert.equal(summary.availableCents, 5000);
  assert.equal(inPeriod('2026-10-15', 'week', '2026-10-21'), true);
  assert.equal(inPeriod('2026-10-14', 'week', '2026-10-21'), false);
  assert.equal(inPeriod('2026-10-20', 'yesterday', '2026-10-21'), true);
});
test('datas financeiras seguem São Paulo e rejeitam dias inexistentes', () => {
  assert.equal(businessToday(new Date('2026-10-22T01:00:00Z')), '2026-10-21');
  assert.equal(validDate('2024-02-29'), true); assert.equal(validDate('2026-02-30'), false);
});
test('perfil aceita somente os campos pessoais e valida chave e titular PIX', () => {
  const fields = { name: 'Ana', email: 'ana@example.com', phone: '', pixType: 'email', pixKey: 'ana@example.com', pixOwner: 'Ana' };
  assert.deepEqual(validateProfile({ ...fields, commissionBps: 10000, id: 'another' }), fields);
  assert.throws(() => validateProfile({ ...fields, pixOwner: '' }));
  assert.throws(() => validateProfile({ ...fields, pixKey: 'invalid' }));
  assert.throws(() => validateProfile({ ...fields, pixType: '__proto__' }));
});
