import assert from 'node:assert/strict';
import test from 'node:test';
import { amountToCents, businessToday, calculateFinance, checkoutFee, checkoutRateLabel, demoCheckouts, detectPixType, inPeriod, percentageToBps, payoutNet, renderSaleAlert, saleEarnings, validateAvatar, validatePayoutAmount, validateProfile, validDate } from '../src/domain.ts';
import type { Sale } from '../src/domain.ts';

const sale = (amountCents: number, date = '2026-10-21', feeCents = 0): Sale => ({ id: 'sale', date, time: '12:00', checkoutId: 'main', checkoutName: 'Principal', amountCents, feeCents, commissionBps: 1000, note: '', receiptId: 'receipt', createdAt: '2026-10-21T12:00:00Z', status: 'approved', reviewNote: '', reviewedAt: null });
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
});
test('checkout aplica 15% + R$ 1,99 até R$ 1.000 e recusa valores acima do limite', () => {
  const checkout = demoCheckouts.find(item => item.id === 'main')!;
  for (const [gross, fee] of [[10000, 1699], [19700, 3154], [35000, 5449], [50000, 7699], [99999, 15199], [100000, 15199]]) assert.equal(checkoutFee(gross, checkout), fee);
  assert.equal(checkoutFee(10000, checkout) * 2, 3398);
  assert.equal(checkoutFee(20000, checkout), 3199);
  assert.throws(() => checkoutFee(100001, checkout), /valor máximo/);
  assert.match(checkoutRateLabel(checkout), /15,00%/);
  assert.doesNotMatch(checkoutRateLabel(checkout), /25,00%/);
  assert.equal(100000 - checkoutFee(100000, checkout), 84801);
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

test('somente vendas aprovadas liberam comissão; pendentes e recusadas não entram no saldo', () => {
  const approved = sale(10000), pending = { ...sale(20000), status: 'pending' as const }, rejected = { ...sale(30000), status: 'rejected' as const };
  const summary = calculateFinance([approved, pending, rejected], [{ date: '2026-10-21', adsCents: 200, withdrawalFeeCents: 0 }], [], 'today', '2026-10-21');
  assert.equal(summary.grossCents, 10000); assert.equal(summary.availableCents, 800); assert.equal(summary.count, 1);
  assert.equal(summary.pendingSalesCount, 1); assert.equal(summary.pendingSalesCents, 20000); assert.equal(summary.rejectedSalesCount, 1);
});

test('novas vendas descontam 50% do bruto e a taxa inteira antes do valor do atendente', () => {
  for (const [checkoutId, amountCents, expected] of [['main', 10000, 3301], ['main', 19700, 6696], ['main', 100000, 34801], ['pix', 10000, 4132], ['main', 10001, 3301]] as const) {
    const feeCents = checkoutFee(amountCents, demoCheckouts.find(checkout => checkout.id === checkoutId)!);
    const item = { ...sale(amountCents, '2026-10-21', feeCents), commissionBps: 5000, commissionMode: 'gross-share-less-fees' as const };
    assert.equal(saleEarnings(item), expected);
    const finance = calculateFinance([item], [], [], 'all', item.date);
    assert.equal(finance.commissionCents, expected); assert.equal(finance.availableCents, expected);
    assert.equal(finance.grossCents, finance.businessShareCents + finance.transactionFeeCents + finance.commissionCents);
  }
  // No checkout fee is shared or silently charged twice. Old snapshots retain their formula.
  assert.equal(saleEarnings(sale(10000, '2026-10-21', 1699)), 830);
  const tiny = { ...sale(1, '2026-10-21', 199), commissionBps: 5000, commissionMode: 'gross-share-less-fees' as const };
  assert.equal(saleEarnings(tiny), -199);
});

test('saque reserva o total uma vez, desconta R$ 5 do PIX e devolve tudo quando cancelado', () => {
  const item = { ...sale(10000, '2026-10-21', 1699), commissionBps: 5000, commissionMode: 'gross-share-less-fees' as const };
  const payout = { id: 'payout', amountCents: 3301, withdrawalFeeCents: 500, status: 'pending' as const, requestedAt: '2026-10-21T12:00:00Z', paidAt: null, note: '' };
  assert.equal(payoutNet(payout), 2801);
  const pending = calculateFinance([item], [], [payout], 'today', item.date);
  assert.equal(pending.availableCents, 0); assert.equal(pending.feeCents, 2199); assert.equal(pending.pendingPayoutCents, 3301);
  const paid = calculateFinance([item], [], [{ ...payout, status: 'paid' }], 'today', item.date);
  assert.equal(paid.availableCents, 0); assert.equal(paid.withdrawalFeeCents, 500); assert.equal(paid.paidPayoutNetCents, 2801);
  const cancelled = calculateFinance([item], [], [{ ...payout, status: 'cancelled' }], 'today', item.date);
  assert.equal(cancelled.availableCents, 3301); assert.equal(cancelled.feeCents, 1699);
  assert.throws(() => validatePayoutAmount(500, 3301), /taxa/);
  assert.throws(() => validatePayoutAmount(3302, 3301), /saldo/);
  assert.doesNotThrow(() => validatePayoutAmount(501, 3301));
  assert.equal(payoutNet({ amountCents: 2000 }), 2000);
});

test('taxa de saque acompanha o período de São Paulo sem alterar o saldo acumulado', () => {
  const payout = { id: 'payout', amountCents: 1000, withdrawalFeeCents: 500, status: 'paid' as const, requestedAt: '2026-10-22T01:00:00Z', paidAt: '2026-10-22T13:00:00Z', note: '' };
  const today = calculateFinance([sale(30000)], [], [payout], 'today', '2026-10-22');
  const yesterday = calculateFinance([sale(30000)], [], [payout], 'yesterday', '2026-10-22');
  assert.equal(today.withdrawalFeeCents, 0); assert.equal(yesterday.withdrawalFeeCents, 500);
  assert.equal(today.availableCents, 2000); assert.equal(yesterday.availableCents, 2000);
});
