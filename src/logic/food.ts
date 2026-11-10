import type { DayKey, FoodDay, FoodEntry } from '../data/types';
import { addDays } from './dates';

export interface Totals {
  kcal: number;
  protein: number;
}

export function totalsFor(entries: FoodEntry[], date: DayKey): Totals {
  return entries
    .filter((e) => e.date === date)
    .reduce((t, e) => ({ kcal: t.kcal + e.kcal, protein: t.protein + e.protein }), { kcal: 0, protein: 0 });
}

/** Calories at or under target; protein at or over target. Uses the targets stored on that day. */
export function hits(day: FoodDay, t: Totals) {
  return { kcal: t.kcal <= day.kcalTarget, protein: t.protein >= day.proteinTarget };
}

export type DayMark = 'both' | 'one' | 'none' | 'incomplete';
export const MARK_EMOJI: Record<DayMark, string> = { both: '✅', one: '🟡', none: '❌', incomplete: '⚪' };

export function dayMark(day: FoodDay | undefined, t: Totals): DayMark {
  if (!day || day.status !== 'complete') return 'incomplete';
  const h = hits(day, t);
  return h.kcal && h.protein ? 'both' : h.kcal || h.protein ? 'one' : 'none';
}

/**
 * Days before today still 'open'. Those with entries need the close-out prompt (oldest first);
 * those without entries close automatically as incomplete.
 */
export function pendingCloseOuts(days: FoodDay[], entries: FoodEntry[], today: DayKey) {
  const withEntries = new Set(entries.map((e) => e.date));
  const open = days.filter((d) => d.status === 'open' && d.date < today).sort((a, b) => a.date.localeCompare(b.date));
  return {
    prompt: open.filter((d) => withEntries.has(d.date)),
    autoIncomplete: open.filter((d) => !withEntries.has(d.date)),
  };
}

export interface Rate {
  hit: number;
  of: number;
}

/** Hit rate over the last n days ending today, confirmed (complete) days only, kcal and protein separately. */
export function hitRates(days: FoodDay[], entries: FoodEntry[], today: DayKey, n: number) {
  const from = addDays(today, -(n - 1));
  const kcal: Rate = { hit: 0, of: 0 };
  const protein: Rate = { hit: 0, of: 0 };
  for (const d of days) {
    if (d.status !== 'complete' || d.date < from || d.date > today) continue;
    const h = hits(d, totalsFor(entries, d.date));
    kcal.of++;
    protein.of++;
    if (h.kcal) kcal.hit++;
    if (h.protein) protein.hit++;
  }
  return { kcal, protein };
}

export const pct = (r: Rate) => (r.of ? Math.round((100 * r.hit) / r.of) : null);
