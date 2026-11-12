import { validDate } from './domain.ts';
import type { Period } from './domain.ts';

export type RankingPeriod = Period | 'last30' | 'custom';
export interface RankingRange { start: string; end: string }
export const rankingPresets = [
  { id: 'today', label: 'Diário', title: 'Diário' },
  { id: 'week', label: '7 dias', title: '7 Dias' },
  { id: 'last30', label: '30 dias', title: '30 Dias' },
] as const;

export function rankingRange(period: RankingPeriod, today: string, start = '', end = ''): RankingRange | null {
  if (period === 'custom') {
    if (!validDate(start) || !validDate(end) || start > end || end > today) throw new Error('Informe datas válidas, com início até o fim e sem datas futuras.');
    return { start, end };
  }
  if (period === 'all') return null;
  if (period === 'today') return { start: today, end: today };
  if (period === 'month') return { start: today.slice(0, 8) + '01', end: today };
  if (!['yesterday', 'week', 'last30'].includes(period)) throw new Error('Período do ranking inválido.');
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (period === 'yesterday' ? 1 : period === 'week' ? 6 : 29));
  const lower = date.toISOString().slice(0, 10);
  return { start: lower, end: period === 'yesterday' ? lower : today };
}
export function inRankingRange(date: string, range: RankingRange | null) { return !range || date >= range.start && date <= range.end; }
