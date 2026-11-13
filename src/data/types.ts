// Lift Log data model. Everything here is what gets stored in IndexedDB
// and what Export/Import writes as JSON.

/** Local calendar day, 'YYYY-MM-DD', with the day rolling over at 3 a.m. (see logic/dates.ts). */
export type DayKey = string;

/**
 * 'per-side' → shown as 45/45 (per hand or per side).
 * 'total'    → shown as 105 (machine or stack total).
 * 'bodyweight' → value is added weight; 0 means bodyweight only (shown as BW, or BW+10).
 */
export type LoadMode = 'per-side' | 'total' | 'bodyweight';

export interface Load {
  value: number;
  mode: LoadMode;
}

export interface Exercise {
  id: string;
  name: string;
  /** Default load mode for new sets of this exercise. */
  mode: LoadMode;
  /** Starting weight when it has never been logged. null = "set on first log". */
  start: Load | null;
  /** Default sets × reps when swapped in somewhere (else the slot's are used). */
  defaults?: { sets: number; reps: number };
  /** Ready-made swaps, shown first in the swap picker (e.g. Squat → Leg press). */
  swapIds: string[];
  createdAt: number;
}

/** One exercise line on a routine day. */
export interface Slot {
  id: string;
  exerciseId: string;
  sets: number;
  reps: number;
  /**
   * Per-day starting weight. Lets one exercise appear on two days at different
   * weights with a shared history (Incline press: Day 1 50/50, Day 4 35/35).
   */
  start?: Load | null;
  /** Slots sharing a group id are shown side by side as a superset. */
  supersetGroup?: string;
}

export interface RoutineDay {
  id: string;
  name: string; // "Day 1 — Push"
  kind: 'lift' | 'boxing';
  slots: Slot[];
}

export interface Routine {
  id: 'routine';
  days: RoutineDay[]; // order = display order on Home
}

/**
 * One visit to the gym for one routine day. `plan` is a copy of the day's slots
 * taken when the workout starts; "Just today" edits change only this copy,
 * "Permanently" edits change the routine *and* this copy.
 */
export interface Workout {
  id: string;
  date: DayKey;
  dayId: string;
  plan: Slot[];
  startedAt: number;
  /** Boxing: a single tap marks it done. */
  boxingDone?: boolean;
}

export interface SetLog {
  load: Load;
  reps: number;
  at: number;
}

/** One exercise within one workout: the unit the weight flags are computed from. */
export interface ExerciseLog {
  id: string;
  workoutId: string;
  date: DayKey;
  dayId: string;
  exerciseId: string;
  targetSets: number;
  targetReps: number;
  sets: SetLog[];
  /**
   * Set when you tap Undo on an automatic drop-back: you chose to keep pushing
   * at the heavier weight, so this session counts as a real attempt.
   */
  keepHeavier?: boolean;
  /** Seeded log (e.g. today's shoulder press 10, 10, 7). */
  seeded?: boolean;
}

export interface FoodEntry {
  id: string;
  date: DayKey;
  kcal: number;
  protein: number;
  at: number;
}

/**
 * Per-day food status. Created on the first food add of a day, so it captures
 * the targets in effect that day (editing targets later never rewrites history).
 * Days with no entries have no record and count as ⚪ incomplete.
 */
export interface FoodDay {
  date: DayKey;
  status: 'open' | 'complete' | 'incomplete';
  kcalTarget: number;
  proteinTarget: number;
  /**
   * Reopened from History to fix it. The close-out prompt skips it (you confirm it from the
   * History day sheet instead); cleared when the day is closed again.
   */
  reopened?: boolean;
}

export interface Settings {
  id: 'settings';
  kcalTarget: number;
  proteinTarget: number;
  /** Sedentary-day energy use (TDEE) for the deficit view. Missing in older data → 2,200. */
  maintenanceKcal?: number;
}

/** The whole database, as written by Export and read by Import. */
export interface ExportFile {
  app: 'lift-log';
  version: 1;
  exportedAt: number;
  settings: Settings;
  routine: Routine;
  exercises: Exercise[];
  workouts: Workout[];
  logs: ExerciseLog[];
  food: FoodEntry[];
  foodDays: FoodDay[];
}
