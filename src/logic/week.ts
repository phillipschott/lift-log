// This week's progress and what's "Up next". Weeks run Monday–Sunday (with the 3 a.m. rollover,
// since DayKeys already include it).
//  - A lift day is done (✓) once at least one set was logged for it this week.
//  - Boxing is ✓ when marked done this week, and is never "Up next".
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

export interface WeekStatus {
  done: Set<string>; // routine day ids with ✓ this week
  upNext: string | null; // routine day id, or null when every lift day is done
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
  for (const w of workouts) if (w.boxingDone && inWeek(w.date)) done.add(w.dayId);

  const lifts = routine.days.filter((d) => d.kind === 'lift');
  const upNext =
    lifts.find((d) => startedToday.has(d.id))?.id ?? lifts.find((d) => !done.has(d.id))?.id ?? null;
  return { done, upNext };
}
