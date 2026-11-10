// Starting a workout and the "Just today" / "Permanently" modify flow. Pure functions:
// each returns new objects; the caller saves them.

import type { DayKey, Routine, Slot, Workout } from '../data/types';

export type Scope = 'today' | 'permanent';

export type SlotChange =
  | { kind: 'swap'; exerciseId: string; sets?: number; reps?: number }
  | { kind: 'setsReps'; sets: number; reps: number }
  | { kind: 'remove' };

export function startWorkout(routine: Routine, dayId: string, date: DayKey, id: string, now: number): Workout {
  const day = routine.days.find((d) => d.id === dayId);
  if (!day) throw new Error(`No routine day ${dayId}`);
  return { id, date, dayId, plan: day.slots.map((s) => ({ ...s })), startedAt: now };
}

function applyChange(slots: Slot[], slotId: string, c: SlotChange): Slot[] {
  if (c.kind === 'remove') return slots.filter((s) => s.id !== slotId);
  return slots.map((s) => {
    if (s.id !== slotId) return s;
    if (c.kind === 'setsReps') return { ...s, sets: c.sets, reps: c.reps };
    // A swapped-in exercise has its own history and starting weight, so drop the per-day start.
    return { ...s, exerciseId: c.exerciseId, sets: c.sets ?? s.sets, reps: c.reps ?? s.reps, start: undefined };
  });
}

/**
 * "Just today" changes only this workout's plan; the routine is untouched, so the original
 * is back next session. "Permanently" changes both.
 */
export function modifySlot(
  routine: Routine,
  workout: Workout,
  slotId: string,
  change: SlotChange,
  scope: Scope,
): { routine: Routine; workout: Workout } {
  const w = { ...workout, plan: applyChange(workout.plan, slotId, change) };
  if (scope === 'today') return { routine, workout: w };
  const r: Routine = {
    ...routine,
    days: routine.days.map((d) => (d.id === workout.dayId ? { ...d, slots: applyChange(d.slots, slotId, change) } : d)),
  };
  return { routine: r, workout: w };
}
