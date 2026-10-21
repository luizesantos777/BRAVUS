export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  createdAt: string;
}
export interface Task {
  id: string;
  title: string;
  clientId: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  createdAt: string;
}
export interface Transaction {
  id: string;
  description: string;
  clientId: string | null;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  createdAt: string;
}
export interface AppData {
  schemaVersion: 1;
  clients: Client[];
  tasks: Task[];
  transactions: Transaction[];
}
export const STORAGE_KEY = 'bravus.data.v1';
export const MAX_AMOUNT = 999_999_999_999;
export const statusLabels: Record<TaskStatus, string> = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluída' };
export const priorityLabels: Record<Priority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };
export const emptyData = (): AppData => ({ schemaVersion: 1, clients: [], tasks: [], transactions: [] });
export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateLabel(value: string) {
  return value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)) : 'Sem prazo';
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function amountToCents(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor como 1250,50, sem separador de milhares.');
  const [whole, fraction = ''] = normalized.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT) throw new Error('O valor deve ser maior que zero e menor que R$ 10 bilhões.');
  return cents;
}
export function totals(data: AppData, month?: string) {
  const transactions = month ? data.transactions.filter(item => item.date.startsWith(month)) : data.transactions;
  const income = transactions.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, balance: income - expense };
}
export function removeClient(data: AppData, id: string): AppData {
  return {
    ...data,
    clients: data.clients.filter(client => client.id !== id),
    tasks: data.tasks.map(task => task.clientId === id ? { ...task, clientId: null } : task),
    transactions: data.transactions.map(item => item.clientId === id ? { ...item, clientId: null } : item),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}
function created(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function fail(): never { throw new Error('Arquivo inválido. Escolha um backup BRAVUS válido, na versão 1.'); }
/** Validate backups and local storage before use. Rebuild objects to drop unknown fields. */
export function parseData(value: unknown): AppData {
  if (!record(value) || value.schemaVersion !== 1) fail();
  if (!Array.isArray(value.clients) || !Array.isArray(value.tasks) || !Array.isArray(value.transactions)) fail();
  if ([value.clients, value.tasks, value.transactions].some(items => items.length > 10_000)) fail();
  const ids = new Set<string>();
  function identity(item: unknown): asserts item is Record<string, unknown> & { id: string; createdAt: string } {
    if (!record(item) || !text(item.id, 100, true) || !created(item.createdAt) || ids.has(item.id)) fail();
    ids.add(item.id);
  }
  const clients = value.clients.map((item: unknown): Client => {
    identity(item);
    if (!text(item.name, 120, true) || !text(item.company, 120) || !text(item.email, 160) || !text(item.phone, 40)) fail();
    if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) fail();
    return { id: item.id, name: item.name, company: item.company, email: item.email, phone: item.phone, createdAt: item.createdAt };
  });
  const clientIds = new Set(clients.map(item => item.id));
  function clientLink(value: unknown): value is string | null { return value === null || (typeof value === 'string' && clientIds.has(value)); }
  const tasks = value.tasks.map((item: unknown): Task => {
    identity(item);
    if (!text(item.title, 180, true) || !clientLink(item.clientId)) fail();
    if (!['todo', 'doing', 'done'].includes(String(item.status)) || !['low', 'medium', 'high'].includes(String(item.priority))) fail();
    if (item.dueDate !== '' && !validDate(item.dueDate)) fail();
    return { id: item.id, title: item.title, clientId: item.clientId, status: item.status as TaskStatus, priority: item.priority as Priority, dueDate: item.dueDate as string, createdAt: item.createdAt };
  });
  const transactions = value.transactions.map((item: unknown): Transaction => {
    identity(item);
    if (!text(item.description, 180, true) || !clientLink(item.clientId) || !validDate(item.date)) fail();
    if (item.type !== 'income' && item.type !== 'expense') fail();
    if (typeof item.amount !== 'number' || !Number.isSafeInteger(item.amount) || item.amount <= 0 || item.amount > MAX_AMOUNT) fail();
    return { id: item.id, description: item.description, clientId: item.clientId, type: item.type, amount: item.amount, date: item.date, createdAt: item.createdAt };
  });
  return { schemaVersion: 1, clients, tasks, transactions };
}
