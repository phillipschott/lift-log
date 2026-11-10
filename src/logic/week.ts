// This week's progress and what's "Up next". Weeks run Monday–Sunday (with the 3 a.m. rollover,
// since DayKeys already include it).
//  - A lift day is done (✓) once at least one set was logged for it this week.
//  - Boxing counts sessions (one per day) toward 2 a week: 1/2, then ✓. It is never "Up next".
//  - Up next = a lift day you already started today (so you can come back to it), else the first
//    lift day in routine order without ✓, else null (week done).

import type { DayKey, ExerciseLog, Routine, Workout } from '../data/types';
import { addDays } from './dates';

/** Monday of the week containing `k`. */
export function weekStart(k: DayKey): DayKey {
  const [y, m, d] = k.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(k, -((dow + 6) % 7));
}

/** Boxing gets ✓ for the week after this many sessions (on different days). */
export const BOXING_PER_WEEK = 2;

export interface WeekStatus {
  done: Set<string>; // routine day ids with ✓ this week
  upNext: string | null; // routine day id, or null when every lift day is done
  /** Up next is a day you already started today (Home labels it "Today"). */
  upNextStarted: boolean;
  /** Boxing sessions this week, per boxing routine day id. */
  boxing: Map<string, number>;
}

export function weekStatus(routine: Routine, workouts: Workout[], logs: ExerciseLog[], today: DayKey): WeekStatus {
  const from = weekStart(today);
  const inWeek = (date: DayKey) => date >= from && date <= today;
  const done = new Set<string>();
  const startedToday = new Set<string>();
  for (const l of logs) {
    if (!l.sets.length || !inWeek(l.date)) continue;
    done.add(l.dayId);
    if (l.date === today) startedToday.add(l.dayId);
  }
  const boxDates = new Map<string, Set<DayKey>>();
  for (const w of workouts) {
    if (!w.boxingDone || !inWeek(w.date)) continue;
    if (!boxDates.has(w.dayId)) boxDates.set(w.dayId, new Set());
    boxDates.get(w.dayId)!.add(w.date);
  }
  const boxing = new Map([...boxDates].map(([id, dates]) => [id, dates.size]));
  for (const [id, count] of boxing) if (count >= BOXING_PER_WEEK) done.add(id);

  const lifts = routine.days.filter((d) => d.kind === 'lift');
  const started = lifts.find((d) => startedToday.has(d.id))?.id;
  const upNext = started ?? lifts.find((d) => !done.has(d.id))?.id ?? null;
  return { done, upNext, upNextStarted: !!started, boxing };
}
