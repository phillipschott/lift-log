// Weight flags. Pure functions: give them a starting point and the logs, get the state.
//
// Rules (DECISIONS.md, revised 2026-11-10 after the skeptic review):
//  1. A session HITS when the first N sets (N = target sets) at the working weight all reach
//     target reps. Extra sets ("+ set") and lighter sets don't count.
//  2. First hit at a weight = you own it (streak 1). Second hit in a row = 🟢 Up it.
//  3. 🟢 Up it stays until you actually move to a heavier weight. It never becomes Stalled.
//  4. Missing after owning resets the streak to 0; you still own the weight.
//  5. Trying heavier: the attempt weight is your first working set of the session (lighter
//     warm-ups before it are ignored). It's a REAL attempt only if the first two sets at that
//     weight both hit target reps (or you tapped Undo on the drop-back). Otherwise the app
//     drops back and the session changes nothing. A heavier set later in a session at your
//     working weight (e.g. a typo on set 3) is ignored, not treated as an attempt.
//  6. 🔵 Attempting = a real attempt at this weight, not hit yet.
//  7. 🟠 Stalled = 3 sessions in a row at the weight with no new best in total reps.
//  8. Per-day flags only for a slot with its own per-day starting weight (Day 4 incline @ 35/35).

import type { DayKey, Exercise, ExerciseLog, Load, SetLog, Slot } from '../data/types';

export type Flag = 'attempting' | 'up' | 'stalled' | null;

/** Stalled after this many sessions in a row without a new best (needs one earlier session to compare). */
export const STALL_RUN = 3;

export interface FlagState {
  /** Current working weight: what the set rows prefill with. null = set on first log. */
  working: Load | null;
  /** Last weight you own. Equals `working` unless you're Attempting a heavier one. */
  owned: Load | null;
  attempting: boolean;
  streak: number;
  upIt: boolean;
  /** Day the working weight was adopted. */
  since: DayKey | null;
  /** Total reps over the judged sets at the working weight, one entry per session since adopted. */
  totals: number[];
  flag: Flag;
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

/**
 * The heavier weight this session is an attempt at, or null. It's the first set that isn't
 * lighter than the working weight (lighter warm-ups are skipped), if that set is heavier.
 */
function attemptLoad(sets: SetLog[], w: Load): Load | null {
  const first = sets.find((s) => !heavier(w, s.load));
  return first && heavier(first.load, w) ? first.load : null;
}

/** The first two sets at the new weight both hit target reps. */
export function isRealAttempt(sets: SetLog[], n: Load, targetReps: number): boolean {
  const firstTwo = sets.filter((s) => same(s.load, n)).slice(0, 2);
  return firstTwo.length > 0 && firstTwo.every((s) => s.reps >= targetReps);
}

function scoreAtWorking(st: FlagState, log: ExerciseLog): void {
  const w = st.working!;
  // Only the first N sets at the working weight are judged; extra sets don't spoil a hit.
  const judged = log.sets.filter((s) => same(s.load, w)).slice(0, log.targetSets);
  if (judged.length === 0) return; // whole session lighter: logged, ignored by flags
  st.totals.push(judged.reduce((t, s) => t + s.reps, 0));
  const hit = judged.length >= log.targetSets && judged.every((s) => s.reps >= log.targetReps);
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

  const n = attemptLoad(log.sets, s.working!);
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

export function withFlag(st: FlagState): FlagState {
  const s = { ...st, flag: null as Flag };
  if (!s.working) return s;
  if (s.upIt) {
    s.flag = 'up';
    return s;
  }
  const t = s.totals;
  if (t.length > STALL_RUN) {
    const bestBefore = Math.max(...t.slice(0, -STALL_RUN));
    const bestRecent = Math.max(...t.slice(-STALL_RUN));
    if (bestRecent <= bestBefore) s.flag = 'stalled';
  }
  if (!s.flag && s.attempting) s.flag = 'attempting';
  return s;
}

/** `today` is kept for callers; flags no longer depend on the calendar (the 28-day rule was cut). */
export function computeFlagState(baseline: Baseline, logs: ExerciseLog[], _today?: DayKey): FlagState {
  return withFlag(sortLogs(logs).reduce(applyLog, initial(baseline)));
}

/**
 * Called after each set during a workout. If this session is an attempt at a heavier weight
 * and one of the first two sets at that weight fell short, returns the weight to drop back to
 * (remaining rows prefill with it; the UI shows "Back to 50/50" + Undo). Otherwise null.
 */
export function dropBackTo(st: FlagState, setsSoFar: SetLog[], targetReps: number): Load | null {
  const w = st.working;
  if (!w) return null;
  const n = attemptLoad(setsSoFar, w);
  if (!n) return null;
  const firstTwo = setsSoFar.filter((s) => same(s.load, n)).slice(0, 2);
  return firstTwo.some((s) => s.reps < targetReps) ? w : null;
}

/**
 * Which logs drive a card's flags, prefill and "Last:": a slot with its own per-day starting
 * weight (Day 4 Incline press @ 35/35) uses only that day's sessions; everything else uses
 * all of the lift's sessions. History (no slot/day) always uses all of them.
 */
export function slotLogs(logsForExercise: ExerciseLog[], slot: Slot | undefined, dayId: string | undefined): ExerciseLog[] {
  return dayId && slot?.start ? logsForExercise.filter((l) => l.dayId === dayId) : logsForExercise;
}

/** Flag state for one card on a workout day (or, with slot/day undefined, for History). */
export function stateForSlot(
  ex: Exercise,
  slot: Slot | undefined,
  dayId: string | undefined,
  logsForExercise: ExerciseLog[],
  today: DayKey,
): FlagState {
  const logs = slotLogs(logsForExercise, slot, dayId);
  const load = dayId && slot?.start ? slot.start : ex.start;
  const firstDate = logs.reduce<DayKey | null>((m, l) => (!m || l.date < m ? l.date : m), null);
  return computeFlagState({ load: load ?? null, date: firstDate ?? today }, logs);
}

/**
 * Short plain-English hint for the open card, so the flag says what it needs:
 *   🔵 "hit 10,10,10 to own it" · owned streak 1 "✓ Own 55/55 · once more → Up it"
 *   🟢 "try heavier today" · 🟠 "3 sessions, no rep gain". Owned with streak 0: none.
 */
export function flagHint(st: FlagState, targetSets: number, targetReps: number): string | null {
  if (!st.working) return null;
  switch (st.flag) {
    case 'up':
      return 'try heavier today';
    case 'stalled':
      return `${STALL_RUN} sessions, no rep gain`;
    case 'attempting':
      return `hit ${Array(targetSets).fill(targetReps).join(',')} to own it`;
  }
  return st.streak >= 1 ? `✓ Own ${formatLoad(st.working)} · once more → Up it` : null;
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
