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
  // A day you reopened from History is being fixed there — never prompt for it or auto-close it.
  const open = days
    .filter((d) => d.status === 'open' && !d.reopened && d.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
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

// ---------- Deficit view (History → Food) ----------

export const DEFAULT_MAINTENANCE = 2200;
/** Rule of thumb: ~3,500 kcal ≈ 1 lb of body weight. */
export const KCAL_PER_LB = 3500;
/** Protein within this share of target counts as "close" (🟡). */
export const PROTEIN_NEAR = 0.9;

export type ProteinMark = 'hit' | 'near' | 'under';
export const PROTEIN_EMOJI: Record<ProteinMark, string> = { hit: '✅', near: '🟡', under: '❌' };

export function proteinMark(proteinTarget: number, protein: number): ProteinMark {
  if (protein >= proteinTarget) return 'hit';
  return protein >= PROTEIN_NEAR * proteinTarget ? 'near' : 'under';
}

export interface PeriodSummary {
  days: number; // confirmed days counted
  deficit: number; // Σ(maintenance − kcal); positive = deficit, negative = surplus
  lbs: number; // deficit / 3,500
  protein: Record<ProteinMark, number>;
}

/**
 * Confirmed (complete) days in [from, to]: running deficit vs maintenance (before exercise) and
 * protein days hit / within 90% / under. Incomplete and still-open days (incl. today) are left out.
 */
export function periodSummary(days: FoodDay[], entries: FoodEntry[], from: DayKey, to: DayKey, maintenance: number): PeriodSummary {
  const out: PeriodSummary = { days: 0, deficit: 0, lbs: 0, protein: { hit: 0, near: 0, under: 0 } };
  for (const d of days) {
    if (d.status !== 'complete' || d.date < from || d.date > to) continue;
    const t = totalsFor(entries, d.date);
    out.days++;
    out.deficit += maintenance - t.kcal;
    out.protein[proteinMark(d.proteinTarget, t.protein)]++;
  }
  out.lbs = out.deficit / KCAL_PER_LB;
  return out;
}

/** First day of the calendar month containing `k`. */
export const monthStart = (k: DayKey): DayKey => `${k.slice(0, 8)}01`;
