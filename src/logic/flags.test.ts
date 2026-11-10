import { describe, expect, it } from 'vitest';
import type { ExerciseLog, Load } from '../data/types';
import { buildSeed } from '../data/seed';
import { addDays } from './dates';
import { computeFlagState, contextLogs, dropBackTo, formatLoad, stateForSlot } from './flags';

const ps = (value: number): Load => ({ value, mode: 'per-side' });
const T0 = '2026-11-09';
let n = 0;

/** One session. `loads` defaults to the same weight for every set. */
function log(date: string, load: Load | Load[], reps: number[], o: Partial<ExerciseLog> = {}): ExerciseLog {
  const loads = Array.isArray(load) ? load : reps.map(() => load);
  return {
    id: `l${++n}`,
    workoutId: 'w',
    date,
    dayId: 'day1',
    exerciseId: 'x',
    targetSets: o.targetSets ?? reps.length,
    targetReps: 10,
    sets: reps.map((r, i) => ({ load: loads[i], reps: r, at: n * 100 + i })),
    ...o,
  };
}
const week = (i: number) => addDays(T0, 7 * i);
const base45 = { load: ps(45), date: T0 };
const base50 = { load: ps(50), date: T0 };

describe('acceptance checks', () => {
  it('#2 hit 10,10,10,10 twice in a row at 45/45 → 🟢 Up it', () => {
    const logs = [log(week(0), ps(45), [10, 10, 10, 10]), log(week(1), ps(45), [10, 10, 10, 10])];
    const one = computeFlagState(base45, logs.slice(0, 1), week(0));
    expect(one.flag).toBe(null);
    expect(one.streak).toBe(1);
    expect(computeFlagState(base45, logs, week(1)).flag).toBe('up');
  });

  it('#3 log 50/50 with 10,10,9,8 → 🔵 Attempting', () => {
    const st = computeFlagState(base45, [log(week(0), ps(50), [10, 10, 9, 8])], week(0));
    expect(st.flag).toBe('attempting');
    expect(st.working).toEqual(ps(50));
    expect(st.owned).toEqual(ps(45));
  });

  it('#4 try 55/55 with set 1 at 7 → drops back to 50/50; undo keeps 55/55', () => {
    const st = computeFlagState(base50, [], T0);
    const set1 = [{ load: ps(55), reps: 7, at: 1 }];
    expect(dropBackTo(st, set1, 10)).toEqual(ps(50));
    expect(formatLoad(dropBackTo(st, set1, 10))).toBe('50/50');

    // Finished at 50/50 after the drop-back: nothing changes.
    const dropped = log(T0, [ps(55), ps(50), ps(50), ps(50)], [7, 10, 10, 10]);
    expect(computeFlagState(base50, [dropped], T0).working).toEqual(ps(50));

    // Undo: kept pushing at 55/55 → counts as a real attempt.
    const undone = log(T0, ps(55), [7, 8, 7, 6], { keepHeavier: true });
    const st2 = computeFlagState(base50, [undone], T0);
    expect(st2.working).toEqual(ps(55));
    expect(st2.flag).toBe('attempting');
  });

  it('#5 new weight, set 1 at 10, later sets short → stays at new weight, 🔵 Attempting', () => {
    const st = computeFlagState(base50, [log(T0, ps(55), [10, 10, 7, 6])], T0);
    expect(st.working).toEqual(ps(55));
    expect(st.flag).toBe('attempting');
    expect(dropBackTo(computeFlagState(base50, [], T0), [{ load: ps(55), reps: 10, at: 1 }], 10)).toBe(null);
  });

  it('#6a 4 Attempting sessions with flat reps → 🟠 Stalled', () => {
    const logs = [27, 26, 27, 27].map((_, i) => log(week(i), ps(55), [10, 10, 7]));
    logs[1] = log(week(1), ps(55), [10, 9, 7]);
    logs[3] = log(week(3), ps(55), [10, 9, 8]);
    const three = computeFlagState(base50, logs.slice(0, 3), week(2));
    expect(three.flag).toBe('attempting');
    const st = computeFlagState(base50, logs, week(3));
    expect(st.flag).toBe('stalled');
    expect(st.stalledBy).toBe('reps');
  });

  it('#6a a new rep best clears the stall', () => {
    const logs = [
      log(week(0), ps(55), [10, 10, 7]),
      log(week(1), ps(55), [10, 9, 7]),
      log(week(2), ps(55), [10, 10, 7]),
      log(week(3), ps(55), [10, 10, 8]), // 28 > 27
    ];
    expect(computeFlagState(base50, logs, week(3)).flag).toBe('attempting');
  });

  it('#6b same weight for 28+ days → 🟠 Stalled', () => {
    const logs = [log(T0, ps(55), [10, 10, 7])];
    expect(computeFlagState(base50, logs, addDays(T0, 27)).flag).toBe('attempting');
    const st = computeFlagState(base50, logs, addDays(T0, 28));
    expect(st.flag).toBe('stalled');
    expect(st.stalledBy).toBe('time');
  });
});

describe('interview decisions', () => {
  it('Q1: Attempting → hit once → owned (no flag) → hit again → Up it', () => {
    const logs = [log(week(0), ps(55), [10, 10, 8]), log(week(1), ps(55), [10, 10, 10]), log(week(2), ps(55), [10, 10, 10])];
    expect(computeFlagState(base50, logs.slice(0, 1), week(0)).flag).toBe('attempting');
    const owned = computeFlagState(base50, logs.slice(0, 2), week(1));
    expect(owned.flag).toBe(null);
    expect(owned.owned).toEqual(ps(55));
    expect(computeFlagState(base50, logs, week(2)).flag).toBe('up');
  });

  it('Up it stays until a heavier weight is adopted, even after a miss', () => {
    const logs = [log(week(0), ps(45), [10, 10, 10]), log(week(1), ps(45), [10, 10, 10]), log(week(2), ps(45), [10, 9, 8])];
    const st = computeFlagState(base45, logs, week(2));
    expect(st.flag).toBe('up');
    expect(st.streak).toBe(0);
  });

  it('Up it never becomes Stalled, even after 28+ days', () => {
    const logs = [log(week(0), ps(45), [10, 10, 10]), log(week(1), ps(45), [10, 10, 10])];
    expect(computeFlagState(base45, logs, addDays(T0, 60)).flag).toBe('up');
  });

  it('missing after owning resets the streak but you still own the weight', () => {
    const logs = [log(week(0), ps(45), [10, 10, 10]), log(week(1), ps(45), [10, 10, 9])];
    const st = computeFlagState(base45, logs, week(1));
    expect(st.streak).toBe(0);
    expect(st.owned).toEqual(ps(45));
    expect(st.flag).toBe(null);
  });

  it('Q4: set 1 full but set 2 short at a new weight → drop back; Up it stays on', () => {
    const upLogs = [log(week(0), ps(50), [10, 10, 10]), log(week(1), ps(50), [10, 10, 10])];
    const up = computeFlagState(base50, upLogs, week(1));
    expect(up.flag).toBe('up');
    const soFar = [
      { load: ps(55), reps: 10, at: 1 },
      { load: ps(55), reps: 8, at: 2 },
    ];
    expect(dropBackTo(up, soFar, 10)).toEqual(ps(50));
    const bailed = log(week(2), [ps(55), ps(55), ps(50), ps(50)], [10, 8, 10, 10]);
    expect(computeFlagState(base50, [...upLogs, bailed], week(2)).flag).toBe('up');
  });

  it('Q4: no drop-back check after set 2', () => {
    const st = computeFlagState(base50, [], T0);
    const soFar = [10, 10, 6].map((reps, i) => ({ load: ps(55), reps, at: i }));
    expect(dropBackTo(st, soFar, 10)).toBe(null);
  });

  it('Q4: first session at new weight that hits every set → owned at once (streak 1)', () => {
    const st = computeFlagState(base50, [log(T0, ps(55), [10, 10, 10])], T0);
    expect(st.flag).toBe(null);
    expect(st.owned).toEqual(ps(55));
    expect(st.streak).toBe(1);
  });

  it('Q5: bodyweight lifts flag on reps alone', () => {
    const bw: Load = { value: 0, mode: 'bodyweight' };
    const logs = [log(week(0), bw, [10, 10, 10]), log(week(1), bw, [10, 10, 10])];
    expect(computeFlagState({ load: bw, date: T0 }, logs, week(1)).flag).toBe('up');
    expect(formatLoad(bw)).toBe('BW');
  });

  it('Q6b: tired day — short at working weight then lighter → miss, still own it', () => {
    const logs = [log(week(0), ps(50), [10, 10, 10]), log(week(1), [ps(50), ps(50), ps(40), ps(40)], [10, 7, 10, 10], { targetSets: 4 })];
    const st = computeFlagState(base50, logs, week(1));
    expect(st.streak).toBe(0);
    expect(st.working).toEqual(ps(50));
  });

  it('Q6b: whole session lighter → streak untouched', () => {
    const logs = [log(week(0), ps(50), [10, 10, 10]), log(week(1), ps(40), [10, 10, 10])];
    const st = computeFlagState(base50, logs, week(1));
    expect(st.streak).toBe(1);
    expect(st.working).toEqual(ps(50));
  });

  it('Q6: shared lift — each day uses its own sessions for flags and prefill', () => {
    const d1 = [log(week(0), ps(50), [10, 10, 10, 10]), log(week(1), ps(50), [10, 10, 10, 10])];
    const d4 = [log(week(0), ps(35), [10, 10, 10], { dayId: 'day4' })];
    const all = [...d1, ...d4];
    const day4 = computeFlagState({ load: ps(35), date: T0 }, contextLogs(all, 'day4'), week(1));
    expect(day4.working).toEqual(ps(35));
    expect(day4.flag).toBe(null);
    const day1 = computeFlagState(base50, contextLogs(all, 'day1'), week(1));
    expect(day1.flag).toBe('up');
    // A day with no sessions yet falls back to all of the lift's sessions.
    expect(contextLogs(all, 'day3')).toHaveLength(3);
  });

  it('Q6: Day 4 incline press keeps 35/35 even after Day 1 has history (stateForSlot)', () => {
    const seed = buildSeed(T0, 0);
    const ex = seed.exercises.find((e) => e.id === 'incline-press-machine')!;
    const d4slot = seed.routine.days.find((d) => d.id === 'day4')!.slots.find((s) => s.exerciseId === ex.id)!;
    const d1slot = seed.routine.days.find((d) => d.id === 'day1')!.slots.find((s) => s.exerciseId === ex.id)!;
    const d1 = [log(week(0), ps(50), [10, 10, 10, 10], { exerciseId: ex.id }), log(week(1), ps(50), [10, 10, 10, 10], { exerciseId: ex.id })];
    const day4 = stateForSlot(ex, d4slot, 'day4', d1, week(1));
    expect(day4.working).toEqual(ps(35));
    expect(day4.flag).toBe(null);
    expect(stateForSlot(ex, d1slot, 'day1', d1, week(1)).flag).toBe('up');
    // History (no slot/day) follows the heaviest working weight across both days.
    expect(stateForSlot(ex, undefined, undefined, d1, week(1)).working).toEqual(ps(50));
  });

  it('set on first log: first logged weight becomes the starting weight', () => {
    const st = computeFlagState({ load: null, date: T0 }, [], T0);
    expect(st.working).toBe(null);
    const st2 = computeFlagState({ load: null, date: T0 }, [log(T0, { value: 30, mode: 'total' }, [12, 12, 10])], T0);
    expect(st2.working).toEqual({ value: 30, mode: 'total' });
    expect(st2.flag).toBe(null);
  });
});

describe('seed', () => {
  it('seated machine shoulder press starts at 55/55 🔵 Attempting, last owned 50/50', () => {
    const seed = buildSeed(T0, 0);
    const ex = seed.exercises.find((e) => e.id === 'seated-shoulder-press')!;
    const logs = seed.logs.filter((l) => l.exerciseId === ex.id);
    const st = computeFlagState({ load: ex.start, date: T0 }, logs, T0);
    expect(st.flag).toBe('attempting');
    expect(formatLoad(st.working)).toBe('55/55');
    expect(formatLoad(st.owned)).toBe('50/50');
  });

  it('every other seeded lift starts with no flag at its listed weight', () => {
    const seed = buildSeed(T0, 0);
    for (const ex of seed.exercises) {
      if (ex.id === 'seated-shoulder-press') continue;
      const st = computeFlagState({ load: ex.start, date: T0 }, [], T0);
      expect(st.flag, ex.name).toBe(null);
      expect(st.working, ex.name).toEqual(ex.start);
    }
  });

  it('every slot points at a real exercise; Day 4 incline press shares Day 1\'s exercise', () => {
    const seed = buildSeed(T0, 0);
    const ids = new Set(seed.exercises.map((e) => e.id));
    for (const d of seed.routine.days) for (const s of d.slots) expect(ids.has(s.exerciseId), s.exerciseId).toBe(true);
    for (const e of seed.exercises) for (const s of e.swapIds) expect(ids.has(s), s).toBe(true);
    const d4 = seed.routine.days.find((d) => d.id === 'day4')!;
    expect(d4.slots.find((s) => s.exerciseId === 'incline-press-machine')?.start).toEqual(ps(35));
  });
});
