import assert from 'node:assert/strict';
import test from 'node:test';
import { amountToCents, businessToday, calculateFinance, checkoutFee, demoCheckouts, detectPixType, inPeriod, percentageToBps, renderSaleAlert, validateAvatar, validateProfile, validDate } from '../src/domain.ts';
import type { Sale } from '../src/domain.ts';

const sale = (amountCents: number, date = '2026-10-21', feeCents = 0): Sale => ({ id: 'sale', date, time: '12:00', checkoutId: 'main', checkoutName: 'Principal', amountCents, feeCents, commissionBps: 1000, note: '', receiptId: 'receipt', createdAt: '2026-10-21T12:00:00Z' });
test('valores brasileiros são convertidos em centavos inteiros', () => {
  for (const [value, expected] of [['197,00', 19700], ['1.250,50', 125050], ['0.29', 29], ['1.000', 100000], ['12,3', 1230]] as const) assert.equal(amountToCents(value), expected);
  for (const value of ['0', '-10', '1e3', 'NaN', '1000001', '1,234', '1.25,50']) assert.throws(() => amountToCents(value));
});
test('percentuais mantêm duas casas decimais sem erro de ponto flutuante', () => {
  assert.equal(percentageToBps('29,99'), 2999); assert.equal(percentageToBps('0'), 0); assert.equal(percentageToBps('100'), 10000);
  for (const value of ['100.01', '-1', '', '10.001']) assert.throws(() => percentageToBps(value));
});
test('PIX manual aplica 6,99% mais R$ 1,69 em todas as faixas, arredondando cada venda em centavos', () => {
  const pix = demoCheckouts.find(checkout => checkout.id === 'pix')!;
  for (const [gross, fee] of [[500, 204], [1599, 281], [1600, 281], [1999, 309], [2000, 309], [19999, 1567], [20000, 1567], [29999, 2266], [30000, 2266], [10000, 868], [19700, 1546]]) assert.equal(checkoutFee(gross, pix), fee);
  assert.equal(checkoutFee(1000, pix) + checkoutFee(1000, pix), 478);
  assert.equal(checkoutFee(2000, pix), 309);
  assert.throws(() => checkoutFee(499, pix), /valor mínimo/);
  assert.equal(checkoutFee(10000, demoCheckouts.find(checkout => checkout.id === 'main')!), 0);
});
test('toda venda gera comissão, sem exigir faturamento mínimo ou aplicar metas antigas', () => {
  const legacy = { ...sale(19700), goalCents: 20000 };
  const summary = calculateFinance([legacy], [], [], 'today', '2026-10-21');
  assert.equal(summary.commissionCents, 1970); assert.equal(summary.availableCents, 1970);
  const small = calculateFinance([sale(100)], [], [], 'today', '2026-10-21');
  assert.equal(small.commissionCents, 10); assert.equal(small.availableCents, 10);
});
test('custos descontam a comissão de qualquer venda e podem gerar dívida no dia', () => {
  const summary = calculateFinance([sale(10000, '2026-10-20'), sale(10000)], [{ date: '2026-10-20', adsCents: 1500, withdrawalFeeCents: 100 }], [], 'all', '2026-10-21');
  assert.equal(summary.commissionCents, 2000); assert.equal(summary.availableCents, 400); assert.equal(summary.debtCents, 600);
  const noSales = calculateFinance([], [{ date: '2026-10-21', adsCents: 500, withdrawalFeeCents: 100 }], [], 'today', '2026-10-21');
  assert.equal(noSales.availableCents, -600); assert.equal(noSales.debtCents, 600);
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
test('alerta personalizado substitui valor, quantidade e nome como texto literal', () => {
  assert.match(renderSaleAlert('{nome}: {qtd} vendas, {valor}', 19700, 2, 'Ana $& {valor}'), /^Ana \$& \{valor\}: 2 vendas, R\$/);
  const fields = { name: 'Ana', email: '', phone: '', pixType: '', pixKey: '', pixOwner: '' };
  assert.throws(() => validateProfile({ ...fields, saleAlertTemplate: '' }));
  assert.throws(() => validateProfile({ ...fields, saleAlertTemplate: '{token}' }));
  assert.throws(() => validateProfile({ ...fields, saleAlertTemplate: 'x'.repeat(241) }));
  assert.equal(validateProfile({ ...fields, saleAlertTemplate: '{nome}: {valor}' }).saleAlertTemplate, '{nome}: {valor}');
});
test('fotos rejeitam SVG, URLs externas, conteúdo falso e excesso de tamanho', () => {
  const valid = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=';
  assert.equal(validateAvatar(valid), valid);
  for (const value of ['https://example.com/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHNjcmlwdD4=', valid + 'A'.repeat(400000)]) assert.throws(() => validateAvatar(value));
});
test('campo único de PIX identifica os tipos e mantém disponível a confirmação manual', () => {
  assert.equal(detectPixType('ana@example.com'), 'email');
  assert.equal(detectPixType('529.982.247-25'), 'cpf');
  assert.equal(detectPixType('(11) 98765-4321'), 'phone');
  assert.equal(detectPixType('11987654321'), 'phone');
  assert.equal(detectPixType('12.345.678/0001-90'), 'cnpj');
  assert.equal(detectPixType('c4870728-df71-4ef2-b073-98c118c5a683'), 'random');
});
