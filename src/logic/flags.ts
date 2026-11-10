// Weight flags. Pure functions: give them a starting point and the logs, get the state.
//
// Rules (fitness-app-spec.md + DECISIONS.md):
//  - A session HITS target when every target set, at the working weight, reaches target reps.
//  - Hitting once at a weight = you own it (streak 1). Hitting again next session = 🟢 Up it.
//  - 🟢 Up it stays until a heavier weight is actually adopted (never becomes Stalled).
//  - Missing after owning resets the streak to 0; you still own the weight.
//  - Heavier weight, first session: it's a REAL attempt only if sets 1 and 2 both hit target
//    reps (or you tapped Undo on the drop-back). Otherwise the app drops back and nothing changes.
//  - Real attempt → 🔵 Attempting at the new weight (or owned at once if every set hit).
//  - Only sets at the working weight count. Lighter sets are logged but ignored by flags.
//  - 🟠 Stalled: ≥4 sessions at the weight and the last 3 never beat the best before them,
//    or 28+ days on the same weight.

import type { DayKey, Exercise, ExerciseLog, Load, SetLog, Slot } from '../data/types';
import { daysBetween } from './dates';

export type Flag = 'attempting' | 'up' | 'stalled' | null;

export const STALL_SESSIONS = 4;
export const STALL_DAYS = 28;

export interface FlagState {
  /** Current working weight: what the set rows prefill with. null = set on first log. */
  working: Load | null;
  /** Last weight you own. Equals `working` unless you're Attempting a heavier one. */
  owned: Load | null;
  attempting: boolean;
  streak: number;
  upIt: boolean;
  /** Day the working weight was adopted (for the 28-day stall). */
  since: DayKey | null;
  /** Total reps at the working weight, one entry per session since it was adopted. */
  totals: number[];
  flag: Flag;
  stalledBy?: 'reps' | 'time';
}

export interface Baseline {
  load: Load | null;
  date: DayKey;
}

const heavier = (a: Load, b: Load) => a.value > b.value;
const same = (a: Load, b: Load) => a.value === b.value;

function initial(b: Baseline): FlagState {
  return {
    working: b.load,
    owned: b.load,
    attempting: false,
    streak: 0,
    upIt: false,
    since: b.load ? b.date : null,
    totals: [],
    flag: null,
  };
}

/** Heaviest load among sets heavier than the working weight, if any. */
function heavierLoad(sets: SetLog[], w: Load): Load | null {
  let top: Load | null = null;
  for (const s of sets) if (heavier(s.load, w) && (!top || heavier(s.load, top))) top = s.load;
  return top;
}

/** Sets 1 and 2 at the new weight both hit target reps. */
export function isRealAttempt(sets: SetLog[], n: Load, targetReps: number): boolean {
  const firstTwo = sets.slice(0, 2);
  return firstTwo.length > 0 && firstTwo.every((s) => same(s.load, n) && s.reps >= targetReps);
}

function scoreAtWorking(st: FlagState, log: ExerciseLog): void {
  const w = st.working!;
  const atW = log.sets.filter((s) => same(s.load, w));
  if (atW.length === 0) return; // whole session lighter: logged, ignored by flags
  st.totals.push(atW.reduce((t, s) => t + s.reps, 0));
  const hit = atW.length >= log.targetSets && atW.every((s) => s.reps >= log.targetReps);
  if (st.attempting) {
    if (hit) {
      st.attempting = false;
      st.owned = w;
      st.streak = 1;
    }
  } else if (hit) {
    st.streak += 1;
    if (st.streak >= 2) st.upIt = true;
  } else {
    st.streak = 0;
  }
}

export function applyLog(st: FlagState, log: ExerciseLog): FlagState {
  const s: FlagState = { ...st, totals: [...st.totals] };
  if (log.sets.length === 0) return s;

  if (!s.working) {
    // "Set on first log": the first weight you log is your starting (owned) weight.
    s.working = s.owned = log.sets[0].load;
    s.since = log.date;
  }

  const n = heavierLoad(log.sets, s.working!);
  if (n) {
    if (!(log.keepHeavier || isRealAttempt(log.sets, n, log.targetReps))) {
      return s; // dropped back: nothing changes, 🟢 Up it stays on for next time
    }
    s.owned = s.attempting ? s.owned : s.working;
    s.working = n;
    s.attempting = true;
    s.streak = 0;
    s.upIt = false;
    s.since = log.date;
    s.totals = [];
  }

  scoreAtWorking(s, log);
  return s;
}

function sortLogs(logs: ExerciseLog[]): ExerciseLog[] {
  return [...logs].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.sets[0]?.at ?? 0) - (b.sets[0]?.at ?? 0),
  );
}

export function withFlag(st: FlagState, today: DayKey): FlagState {
  const s = { ...st, flag: null as Flag, stalledBy: undefined as FlagState['stalledBy'] };
  if (!s.working) return s;
  if (s.upIt) {
    s.flag = 'up';
    return s;
  }
  const t = s.totals;
  if (t.length >= STALL_SESSIONS) {
    const bestBefore = Math.max(...t.slice(0, -(STALL_SESSIONS - 1)));
    const bestRecent = Math.max(...t.slice(-(STALL_SESSIONS - 1)));
    if (bestRecent <= bestBefore) s.stalledBy = 'reps';
  }
  if (!s.stalledBy && s.since && daysBetween(s.since, today) >= STALL_DAYS) s.stalledBy = 'time';
  if (s.stalledBy) s.flag = 'stalled';
  else if (s.attempting) s.flag = 'attempting';
  return s;
}

export function computeFlagState(baseline: Baseline, logs: ExerciseLog[], today: DayKey): FlagState {
  const st = sortLogs(logs).reduce(applyLog, initial(baseline));
  return withFlag(st, today);
}

/**
 * Called after each set is logged during a workout. If this is the first session at a
 * heavier weight and set 1 or set 2 fell short, returns the weight to drop back to
 * (the remaining sets prefill with it; the UI shows "Back to 50/50" + Undo). Otherwise null.
 */
export function dropBackTo(st: FlagState, setsSoFar: SetLog[], targetReps: number): Load | null {
  const w = st.working;
  if (!w || setsSoFar.length === 0 || setsSoFar.length > 2) return null;
  const n = heavierLoad(setsSoFar, w);
  if (!n) return null;
  const short = setsSoFar.some((s) => same(s.load, n) && s.reps < targetReps);
  return short ? w : null;
}

/**
 * Which logs drive a slot's flags and prefill: this lift's sessions on this routine day if
 * there are any, otherwise all of its sessions. Keeps Incline press Day 1 (50/50) and Day 4
 * (35/35) from fighting, while History still shows one combined history.
 */
export function contextLogs(logsForExercise: ExerciseLog[], dayId: string): ExerciseLog[] {
  const onDay = logsForExercise.filter((l) => l.dayId === dayId);
  return onDay.length ? onDay : logsForExercise;
}

/**
 * Flag state for one card on a workout day: picks the starting weight (the slot's per-day
 * start, else the exercise's) and the right logs (contextLogs). `slot` is undefined for
 * History, which uses the exercise's own start and all of its logs.
 */
export function stateForSlot(
  ex: Exercise,
  slot: Slot | undefined,
  dayId: string | undefined,
  logsForExercise: ExerciseLog[],
  today: DayKey,
): FlagState {
  const onDay = !!dayId && logsForExercise.some((l) => l.dayId === dayId);
  // A slot with its own per-day start (Day 4 Incline press @ 35/35) only ever uses that day's
  // sessions, so Day 1's history never leaks into it. Other slots fall back to all sessions.
  const perDay = !!dayId && !!slot?.start;
  const logs = onDay || perDay ? logsForExercise.filter((l) => l.dayId === dayId) : logsForExercise;
  const load = perDay ? slot!.start! : ex.start;
  // The 28-day clock on the starting weight starts at the first session, not at install.
  const firstDate = logs.reduce<DayKey | null>((m, l) => (!m || l.date < m ? l.date : m), null);
  return computeFlagState({ load: load ?? null, date: firstDate ?? today }, logs, today);
}

/** The most recent log, for the "Last: 50/50 — 10, 10, 7" line. */
export function lastLog(logs: ExerciseLog[]): ExerciseLog | undefined {
  return sortLogs(logs.filter((l) => l.sets.length)).at(-1);
}

export function formatLoad(l: Load | null): string {
  if (!l) return '—';
  if (l.mode === 'bodyweight') return l.value ? `BW+${l.value}` : 'BW';
  return l.mode === 'per-side' ? `${l.value}/${l.value}` : `${l.value}`;
}

export const FLAG_LABEL: Record<Exclude<Flag, null>, string> = {
  attempting: '🔵 Attempting',
  up: '🟢 Up it',
  stalled: '🟠 Stalled',
};
