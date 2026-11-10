import { describe, expect, it } from 'vitest';
import { buildSeed } from '../data/seed';
import { modifySlot, startWorkout } from './routine';

const T0 = '2026-11-09';

describe('modify just today / permanently', () => {
  it('#7 just today: swap Squat → Leg press; next session the original is back', () => {
    const { routine } = buildSeed(T0, 0);
    const w1 = startWorkout(routine, 'day3', T0, 'w1', 0);
    const squat = w1.plan.find((s) => s.exerciseId === 'squat')!;
    const r = modifySlot(routine, w1, squat.id, { kind: 'swap', exerciseId: 'leg-press' }, 'today');
    expect(r.workout.plan.find((s) => s.id === squat.id)!.exerciseId).toBe('leg-press');
    expect(r.routine).toBe(routine); // untouched
    const w2 = startWorkout(r.routine, 'day3', '2026-11-16', 'w2', 1);
    expect(w2.plan.find((s) => s.id === squat.id)!.exerciseId).toBe('squat');
  });

  it('#8 permanently: change persists in the routine', () => {
    const { routine } = buildSeed(T0, 0);
    const w1 = startWorkout(routine, 'day1', T0, 'w1', 0);
    const fly = w1.plan.find((s) => s.exerciseId === 'incline-cable-fly')!;
    let r = modifySlot(routine, w1, fly.id, { kind: 'setsReps', sets: 4, reps: 15 }, 'permanent');
    const w2 = startWorkout(r.routine, 'day1', '2026-11-16', 'w2', 1);
    expect(w2.plan.find((s) => s.id === fly.id)).toMatchObject({ sets: 4, reps: 15 });

    r = modifySlot(r.routine, w2, fly.id, { kind: 'remove' }, 'permanent');
    expect(startWorkout(r.routine, 'day1', '2026-11-23', 'w3', 2).plan.some((s) => s.id === fly.id)).toBe(false);
  });

  it('just today remove leaves the routine as it was', () => {
    const { routine } = buildSeed(T0, 0);
    const w = startWorkout(routine, 'day2', T0, 'w', 0);
    const r = modifySlot(routine, w, w.plan[0].id, { kind: 'remove' }, 'today');
    expect(r.workout.plan).toHaveLength(6);
    expect(routine.days.find((d) => d.id === 'day2')!.slots).toHaveLength(7);
  });
});
