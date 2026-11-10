// Progress tab: pure weekly aggregation (no DB, no UI).
// Weeks are Monday weeks (weekStart), DayKeys already include the 3 a.m. rollover.
//  - Lift days per week: distinct routine days with ≥1 logged set that week (same rule as week.ts).
//  - Boxing per week: distinct dates with boxingDone.
//  - Macros per week: 'complete' FoodDays hitting protein / at-or-under kcal, using that day's targets.
//  - Lifts: per exercise, each session's top weight within the range.

import type { DayKey, ExerciseLog, FoodDay, FoodEntry, Load, Workout } from '../data/types';
import { addDays } from './dates';
import { hits, totalsFor } from './food';
import { weekStart } from './week';

export type Range = '12w' | 'all';
export const RANGE_WEEKS = 12;

/** Earliest date with any record (a logged set, a workout, a food entry or food day), or null. */
export function firstRecordDate(logs: ExerciseLog[], workouts: Workout[], foodDays: FoodDay[], food: FoodEntry[]): DayKey | null {
  let min: DayKey | null = null;
  const see = (d: DayKey) => {
    if (!min || d < min) min = d;
  };
  for (const l of logs) if (l.sets.length) see(l.date);
  for (const w of workouts) see(w.date);
  for (const d of foodDays) see(d.date);
  for (const e of food) see(e.date);
  return min;
}

/**
 * Week starts (Mondays), oldest first, ending with the current week. '12w' = the last 12 weeks,
 * but never before the first record's week (so a new install shows 1 week, not 11 empty ones).
 * 'all' = since the first record's week. No records → just this week.
 */
export function weekBuckets(today: DayKey, range: Range, first: DayKey | null): DayKey[] {
  const now = weekStart(today);
  let from = first && first <= today ? weekStart(first) : now;
  if (range === '12w') {
    const min = addDays(now, -7 * (RANGE_WEEKS - 1));
    if (from < min) from = min;
  }
  const out: DayKey[] = [];
  for (let w = from; w <= now; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Index of the week containing `date` in `weeks` (sorted Mondays), or -1. */
function weekIndex(weeks: DayKey[], date: DayKey, today: DayKey): number {
  if (!weeks.length || date > today) return -1;
  const ws = weekStart(date);
  if (ws < weeks[0]) return -1;
  return weeks.indexOf(ws);
}

/** Distinct routine days with ≥1 logged set, per week. */
export function liftDaysPerWeek(weeks: DayKey[], logs: ExerciseLog[], today: DayKey): number[] {
  const sets = weeks.map(() => new Set<string>());
  for (const l of logs) {
    if (!l.sets.length) continue;
    const i = weekIndex(weeks, l.date, today);
    if (i >= 0) sets[i].add(l.dayId);
  }
  return sets.map((s) => s.size);
}

/** Distinct dates with boxing marked done, per week. */
export function boxingPerWeek(weeks: DayKey[], workouts: Workout[], today: DayKey): number[] {
  const sets = weeks.map(() => new Set<DayKey>());
  for (const w of workouts) {
    if (!w.boxingDone) continue;
    const i = weekIndex(weeks, w.date, today);
    if (i >= 0) sets[i].add(w.date);
  }
  return sets.map((s) => s.size);
}

export interface MacroWeek {
  protein: number; // confirmed days at/over protein target
  kcal: number; // confirmed days at/under calorie target
  confirmed: number; // 'complete' days in the week
}

/** Per week: confirmed ('complete') days hitting protein and kcal. Open/incomplete days never count. */
export function macroHitsPerWeek(weeks: DayKey[], foodDays: FoodDay[], food: FoodEntry[], today: DayKey): MacroWeek[] {
  const out = weeks.map((): MacroWeek => ({ protein: 0, kcal: 0, confirmed: 0 }));
  for (const d of foodDays) {
    if (d.status !== 'complete') continue;
    const i = weekIndex(weeks, d.date, today);
    if (i < 0) continue;
    const h = hits(d, totalsFor(food, d.date));
    out[i].confirmed++;
    if (h.protein) out[i].protein++;
    if (h.kcal) out[i].kcal++;
  }
  return out;
}

export interface SeriesPoint {
  date: DayKey;
  load: Load;
}

export interface ExerciseSeries {
  exerciseId: string;
  /** Each session's top weight from `from` on, oldest first. */
  points: SeriesPoint[];
  /** Most recent session date ever (for sorting), regardless of range. */
  lastDate: DayKey;
}

/**
 * One series per exercise that has logged sets, most recently trained first (ties by id).
 * Points are limited to sessions on/after `from`; lastDate is over all sessions.
 */
export function topWeightSeries(logs: ExerciseLog[], from: DayKey): ExerciseSeries[] {
  const byEx = new Map<string, ExerciseLog[]>();
  for (const l of logs) {
    if (!l.sets.length) continue;
    const a = byEx.get(l.exerciseId);
    if (a) a.push(l);
    else byEx.set(l.exerciseId, [l]);
  }
  const out: ExerciseSeries[] = [];
  for (const [exerciseId, ls] of byEx) {
    const sorted = [...ls].sort((a, b) => a.date.localeCompare(b.date) || (a.sets[0]?.at ?? 0) - (b.sets[0]?.at ?? 0));
    const points: SeriesPoint[] = [];
    for (const l of sorted) {
      if (l.date < from) continue;
      let top = l.sets[0].load;
      for (const s of l.sets) if (s.load.value > top.value) top = s.load;
      points.push({ date: l.date, load: top });
    }
    out.push({ exerciseId, points, lastDate: sorted[sorted.length - 1].date });
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.exerciseId.localeCompare(b.exerciseId));
}
