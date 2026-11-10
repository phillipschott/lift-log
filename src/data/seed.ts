// Seed routine from the spec + DECISIONS.md. Written to the database on first launch only.

import { addDays } from '../logic/dates';
import type { DayKey, Exercise, ExerciseLog, ExportFile, Load, RoutineDay, Slot, Workout } from './types';

const ps = (value: number): Load => ({ value, mode: 'per-side' });
const tot = (value: number): Load => ({ value, mode: 'total' });
const bw: Load = { value: 0, mode: 'bodyweight' };

interface ExDef {
  id: string;
  name: string;
  start: Load | null;
  mode?: Load['mode'];
  swaps?: string[];
  defaults?: { sets: number; reps: number };
}

const EXERCISES: ExDef[] = [
  // Day 1 — Push
  { id: 'flat-press-db', name: 'Flat press (DB)', start: ps(45), swaps: ['flat-press-machine'] },
  { id: 'flat-press-machine', name: 'Flat press (machine)', start: tot(105) },
  { id: 'incline-cable-fly', name: 'Incline cable fly', start: ps(13) },
  { id: 'cable-rope-vertical-raise', name: 'Cable rope vertical raise', start: tot(40) },
  { id: 'cable-lateral-raise', name: 'Cable lateral raise', start: tot(15) },
  { id: 'seated-shoulder-press', name: 'Seated machine shoulder press', start: ps(50) },
  { id: 'incline-press-machine', name: 'Incline press (machine)', start: ps(50), swaps: ['parallel-bar-dip'] },
  { id: 'parallel-bar-dip', name: 'Parallel bar dip', start: bw },
  { id: 'triceps-pushdown', name: 'Triceps pushdown', start: tot(60), swaps: ['triceps-pushdown-alt'] },
  { id: 'triceps-pushdown-alt', name: 'Triceps pushdown (other machine)', start: tot(100) },
  // Day 2 — Pull
  { id: 'straight-arm-pulldown', name: 'Straight-arm pulldown', start: tot(80) },
  { id: 'wide-pulldown', name: 'Wide pulldown', start: ps(70) },
  { id: 'rear-delt-cable-pull', name: 'Rear delt cable pull', start: tot(15) },
  { id: 'cable-row', name: 'Cable row', start: tot(100) },
  { id: 'face-pulls', name: 'Face pulls', start: tot(70), swaps: ['shoulder-shrugs'] },
  { id: 'shoulder-shrugs', name: 'Shoulder shrugs', start: ps(45), defaults: { sets: 3, reps: 12 } },
  { id: 'incline-db-curl', name: 'Incline DB curl', start: tot(30) },
  { id: 'hammer-curl', name: 'Hammer curl', start: tot(40) },
  // Day 3 — Legs
  { id: 'leg-extension', name: 'Leg extension', start: tot(85) },
  { id: 'hip-thrust', name: 'Hip thrust', start: tot(85) },
  { id: 'romanian-deadlift', name: 'Romanian deadlift', start: ps(45) },
  { id: 'leg-curl', name: 'Leg curl', start: tot(100) },
  { id: 'squat', name: 'Squat', start: ps(35), swaps: ['leg-press'] },
  { id: 'leg-press', name: 'Leg press', start: tot(340) },
  { id: 'standing-calf-raise', name: 'Standing calf raise', start: ps(45), swaps: ['calf-raise-machine'] },
  { id: 'calf-raise-machine', name: 'Calf raise (machine)', start: tot(280) },
  // Day 4 — Shape
  { id: 'rear-delt-machine', name: 'Rear delt machine/fly', start: tot(47.5) },
  { id: 'cable-curl', name: 'Cable curl', start: null, mode: 'total' },
  { id: 'cable-pushdown', name: 'Cable pushdown', start: null, mode: 'total' },
  { id: 'lateral-raise-machine', name: 'Lateral raise (machine)', start: tot(55), swaps: ['db-lateral-raise'] },
  { id: 'db-lateral-raise', name: 'DB lateral raise', start: null, mode: 'per-side' },
  { id: 'hanging-leg-raise', name: 'Hanging leg raises', start: bw },
  { id: 'high-to-low-cable-fly', name: 'High-to-low cable fly', start: ps(20) },
];

const slot = (exerciseId: string, sets: number, reps: number, extra: Partial<Slot> = {}): Slot => ({
  id: `${exerciseId}@${sets}x${reps}${extra.start ? '-' + extra.start.value : ''}`,
  exerciseId,
  sets,
  reps,
  ...extra,
});

const DAYS: RoutineDay[] = [
  {
    id: 'day1',
    name: 'Day 1 — Push',
    kind: 'lift',
    slots: [
      slot('flat-press-db', 4, 10),
      slot('incline-cable-fly', 3, 12),
      slot('cable-rope-vertical-raise', 3, 12),
      slot('cable-lateral-raise', 3, 10),
      slot('seated-shoulder-press', 3, 10),
      slot('incline-press-machine', 4, 10),
      slot('triceps-pushdown', 3, 12),
    ],
  },
  {
    id: 'day2',
    name: 'Day 2 — Pull',
    kind: 'lift',
    slots: [
      slot('straight-arm-pulldown', 3, 12),
      slot('wide-pulldown', 4, 10),
      slot('rear-delt-cable-pull', 4, 12),
      slot('cable-row', 4, 12),
      slot('face-pulls', 3, 15),
      slot('incline-db-curl', 3, 10),
      slot('hammer-curl', 2, 10),
    ],
  },
  {
    id: 'day3',
    name: 'Day 3 — Legs',
    kind: 'lift',
    slots: [
      slot('leg-extension', 2, 12),
      slot('hip-thrust', 3, 12),
      slot('romanian-deadlift', 4, 10),
      slot('leg-curl', 3, 10),
      slot('squat', 4, 12),
      slot('standing-calf-raise', 4, 12),
    ],
  },
  {
    id: 'day4',
    name: 'Day 4 — Shape',
    kind: 'lift',
    slots: [
      slot('rear-delt-machine', 3, 12),
      // Same machine as Day 1, shared history, lighter on this day.
      slot('incline-press-machine', 3, 10, { start: ps(35) }),
      slot('cable-curl', 3, 12, { supersetGroup: 'curl-pushdown' }),
      slot('cable-pushdown', 3, 12, { supersetGroup: 'curl-pushdown' }),
      slot('lateral-raise-machine', 4, 12),
      slot('hanging-leg-raise', 3, 10),
      slot('high-to-low-cable-fly', 4, 10),
    ],
  },
  { id: 'boxing', name: 'Boxing', kind: 'boxing', slots: [] },
];

export function buildSeed(today: DayKey, now: number): ExportFile {
  const exercises: Exercise[] = EXERCISES.map((e) => ({
    id: e.id,
    name: e.name,
    mode: e.mode ?? e.start?.mode ?? 'total',
    start: e.start,
    defaults: e.defaults,
    swapIds: e.swaps ?? [],
    createdAt: now,
  }));

  // Seated machine shoulder press: owned 50/50, attempted 55/55 with 10, 10, 7. Dated a week
  // before install in its own workout, so install day starts with a clean Day 1.
  const seedDate = addDays(today, -7);
  const day1 = DAYS[0];
  const workout: Workout = { id: 'seed-history', date: seedDate, dayId: 'day1', plan: day1.slots.map((s) => ({ ...s })), startedAt: now };
  const log: ExerciseLog = {
    id: 'seed-shoulder-press',
    workoutId: workout.id,
    date: seedDate,
    dayId: 'day1',
    exerciseId: 'seated-shoulder-press',
    targetSets: 3,
    targetReps: 10,
    sets: [10, 10, 7].map((reps, i) => ({ load: ps(55), reps, at: now + i })),
    seeded: true,
  };

  return {
    app: 'lift-log',
    version: 1,
    exportedAt: now,
    settings: { id: 'settings', kcalTarget: 2000, proteinTarget: 180 },
    routine: { id: 'routine', days: structuredClone(DAYS) },
    exercises,
    workouts: [workout],
    logs: [log],
    food: [],
    foodDays: [],
  };
}
