import assert from 'node:assert/strict';
import test from 'node:test';
import { amountToCents, emptyData, parseData, removeClient, totals, validDate } from '../src/domain.ts';
import type { AppData } from '../src/domain.ts';

function fixture(): AppData {
  const createdAt = '2026-10-21T12:00:00.000Z';
  return {
    schemaVersion: 1,
    clients: [{ id: 'client-1', name: 'Ana', company: '', email: 'ana@example.com', phone: '', createdAt }],
    tasks: [{ id: 'task-1', title: 'Enviar proposta', clientId: 'client-1', status: 'doing', priority: 'high', dueDate: '2026-10-23', createdAt }],
    transactions: [
      { id: 'income-1', description: 'Projeto', clientId: 'client-1', amount: 125050, type: 'income', date: '2026-10-21', createdAt },
      { id: 'expense-1', description: 'Material', clientId: null, amount: 20025, type: 'expense', date: '2026-10-20', createdAt },
      { id: 'old-1', description: 'Anterior', clientId: null, amount: 10000, type: 'income', date: '2026-09-01', createdAt },
    ],
  };
}
test('converte valores em centavos sem arredondamento de ponto flutuante', () => {
  assert.equal(amountToCents('1250,50'), 125050);
  assert.equal(amountToCents('0.29'), 29);
  assert.equal(amountToCents('12,3'), 1230);
  assert.equal(amountToCents(' 10 '), 1000);
  for (const invalid of ['0', '-10', 'NaN', '1e3', '1.250,50', '1,234', 'Infinity', '10000000000']) assert.throws(() => amountToCents(invalid));
});
test('calcula saldo e filtra por mês, incluindo meses sem registros', () => {
  assert.deepEqual(totals(fixture()), { income: 135050, expense: 20025, balance: 115025 });
  assert.deepEqual(totals(fixture(), '2026-10'), { income: 125050, expense: 20025, balance: 105025 });
  assert.deepEqual(totals(fixture(), '2026-08'), { income: 0, expense: 0, balance: 0 });
  const data = fixture(); data.transactions = data.transactions.filter(item => item.type === 'expense');
  assert.equal(totals(data).balance, -20025);
});
test('excluir cliente mantém histórico financeiro e tarefas sem vínculo, sem mutar original', () => {
  const original = fixture(); const next = removeClient(original, 'client-1');
  assert.equal(next.clients.length, 0);
  assert.equal(next.tasks[0].clientId, null);
  assert.equal(next.transactions[0].clientId, null);
  assert.equal(next.transactions.length, original.transactions.length);
  assert.deepEqual(totals(next), totals(original));
  assert.equal(original.tasks[0].clientId, 'client-1');
});
test('backup válido mantém os registros e elimina campos desconhecidos', () => {
  assert.deepEqual(parseData(JSON.parse(JSON.stringify(fixture()))), fixture());
  assert.deepEqual(parseData({ ...emptyData(), unexpected: true }), emptyData());
});
test('rejeita backups incompatíveis, vínculos inválidos e IDs repetidos', () => {
  assert.throws(() => parseData({ ...fixture(), schemaVersion: 2 }));
  assert.throws(() => parseData({ schemaVersion: 1, clients: [], tasks: null, transactions: [] }));
  const dangling = fixture(); dangling.tasks[0].clientId = 'missing'; assert.throws(() => parseData(dangling));
  const duplicate = fixture(); duplicate.tasks[0].id = duplicate.clients[0].id; assert.throws(() => parseData(duplicate));
  const whitespace = fixture(); whitespace.clients[0].name = '   '; assert.throws(() => parseData(whitespace));
});
test('rejeita dinheiro fracionário, datas inexistentes, prioridades e contatos inválidos', () => {
  for (const amount of [NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER]) {
    const data = fixture(); data.transactions[0].amount = amount; assert.throws(() => parseData(data));
  }
  const date = fixture(); date.transactions[0].date = '2026-02-30'; assert.throws(() => parseData(date));
  const priority = fixture(); (priority.tasks[0] as unknown as { priority: string }).priority = 'urgent'; assert.throws(() => parseData(priority));
  const email = fixture(); email.clients[0].email = 'email-invalido'; assert.throws(() => parseData(email));
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-13-01'), false);
});
