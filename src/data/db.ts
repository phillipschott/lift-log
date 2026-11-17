// Storage layer: IndexedDB via `idb`. This file is the CONTRACT the screens code against.
// Signatures and doc comments are fixed; the storage agent implements the bodies.
// Every write must call notify() so subscribed screens re-read.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DayKey, Exercise, ExerciseLog, ExportFile, FoodDay, FoodEntry, LoadMode, Routine, Settings, Workout } from './types';
import { buildSeed } from './seed';
import { dayKey } from '../logic/dates';
import { startWorkout } from '../logic/routine';
import { pendingCloseOuts } from '../logic/food';

interface LiftLogDB extends DBSchema {
  settings: { key: string; value: Settings };
  routine: { key: string; value: Routine };
  exercises: { key: string; value: Exercise };
  workouts: { key: string; value: Workout };
  logs: { key: string; value: ExerciseLog; indexes: { exerciseId: string; workoutId: string } };
  food: { key: string; value: FoodEntry; indexes: { date: string } };
  foodDays: { key: string; value: FoodDay };
}

const STORES = ['settings', 'routine', 'exercises', 'workouts', 'logs', 'food', 'foodDays'] as const;

let dbPromise: Promise<IDBPDatabase<LiftLogDB>> | null = null;

function db(): Promise<IDBPDatabase<LiftLogDB>> {
  dbPromise ??= openDB<LiftLogDB>('lift-log', 1, {
    upgrade(d) {
      d.createObjectStore('settings', { keyPath: 'id' });
      d.createObjectStore('routine', { keyPath: 'id' });
      d.createObjectStore('exercises', { keyPath: 'id' });
      d.createObjectStore('workouts', { keyPath: 'id' });
      const logs = d.createObjectStore('logs', { keyPath: 'id' });
      logs.createIndex('exerciseId', 'exerciseId');
      logs.createIndex('workoutId', 'workoutId');
      const food = d.createObjectStore('food', { keyPath: 'id' });
      food.createIndex('date', 'date');
      d.createObjectStore('foodDays', { keyPath: 'date' });
    },
  });
  return dbPromise;
}

const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}

// ---------- lifecycle & change notification ----------

/**
 * Open the DB. On first launch: write buildSeed(dayKey(), Date.now()) and call
 * navigator.storage.persist(). On every launch: auto-close past 'open' FoodDays that have
 * no entries as 'incomplete' (logic/food.ts pendingCloseOuts().autoIncomplete).
 */
export async function init(): Promise<void> {
  const d = await db();

  // Seed check and seed write happen in one transaction, so two overlapping init() calls can't both seed.
  const tx = allStoresTx(d);
  let seeded = false;
  if (!(await tx.objectStore('settings').get('settings'))) {
    await writeAll(tx, buildSeed(dayKey(), Date.now()));
    seeded = true;
  }
  await tx.done;

  if (seeded) {
    try {
      if (typeof navigator !== 'undefined') await navigator.storage?.persist?.();
    } catch {
      // Not available (tests, older browsers) — data still works, just not guaranteed persistent.
    }
  }

  const { autoIncomplete } = pendingCloseOuts(await d.getAll('foodDays'), await d.getAll('food'), dayKey());
  if (autoIncomplete.length) {
    const t = d.transaction('foodDays', 'readwrite');
    for (const day of autoIncomplete) await t.store.put({ ...day, status: 'incomplete' });
    await t.done;
  }

  await migrateNames2026_11();
  await pruneUnusedExercises(); // notifies
}

// ---------- one-time migration: clearer exercise names (2026-11-17) ----------

/** id → [original seeded name, new name]. Only renamed if the name is still the original. */
export const RENAMES_2026_11: Record<string, [string, string]> = {
  'flat-press-db': ['Flat press (DB)', 'Bench press · dumbbell'],
  'flat-press-machine': ['Flat press (machine)', 'Chest press · plate-loaded'],
  'incline-cable-fly': ['Incline cable fly', 'Incline fly · adjustable pulley'],
  'cable-rope-vertical-raise': ['Cable rope vertical raise', 'Front raise · cable rope'],
  'cable-lateral-raise': ['Cable lateral raise', 'Lateral raise · cable'],
  'seated-shoulder-press': ['Seated machine shoulder press', 'Shoulder press · plate-loaded'],
  'incline-press-machine': ['Incline press (machine)', 'Incline chest press · plate-loaded'],
  'parallel-bar-dip': ['Parallel bar dip', 'Dip · bodyweight'],
  'triceps-pushdown': ['Triceps pushdown', 'Triceps pushdown · high pulley'],
  'triceps-pushdown-alt': ['Triceps pushdown (other machine)', 'Triceps pushdown · other station'],
  'straight-arm-pulldown': ['Straight-arm pulldown', 'Straight-arm pulldown · cable'],
  'wide-pulldown': ['Wide pulldown', 'Lat pulldown · plate-loaded'],
  'rear-delt-cable-pull': ['Rear delt cable pull', 'Rear delt fly · cable'],
  'cable-row': ['Cable row', 'Seated row · cable'],
  'face-pulls': ['Face pulls', 'Face pull · cable rope'],
  'shoulder-shrugs': ['Shoulder shrugs', 'Shrug · dumbbell'],
  'incline-db-curl': ['Incline DB curl', 'Incline curl · dumbbell'],
  'hammer-curl': ['Hammer curl', 'Hammer curl · dumbbell'],
  'leg-extension': ['Leg extension', 'Leg extension · machine'],
  'hip-thrust': ['Hip thrust', 'Hip thrust · machine'],
  'romanian-deadlift': ['Romanian deadlift', 'Romanian deadlift · dumbbell'],
  'leg-curl': ['Leg curl', 'Leg curl · machine'],
  squat: ['Squat', 'Squat · dumbbell'],
  'leg-press': ['Leg press', 'Leg press · machine'],
  'standing-calf-raise': ['Standing calf raise', 'Calf raise · dumbbell'],
  'calf-raise-machine': ['Calf raise (machine)', 'Calf raise · machine'],
  'rear-delt-machine': ['Rear delt machine/fly', 'Reverse fly · machine'],
  'cable-curl': ['Cable curl', 'Curl · adjustable pulley'],
  'cable-pushdown': ['Cable pushdown', 'Triceps pushdown · adjustable pulley'],
  'lateral-raise-machine': ['Lateral raise (machine)', 'Lateral raise · machine'],
  'db-lateral-raise': ['DB lateral raise', 'Lateral raise · dumbbell'],
  'hanging-leg-raise': ['Hanging leg raises', 'Hanging leg raise'],
  'high-to-low-cable-fly': ['High-to-low cable fly', 'High-to-low fly · adjustable pulley'],
};

const MIGRATION_NAMES = 'names-2026-11';
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Clearer names (Movement · equipment). Runs once (recorded in settings.migrations):
 *  1. Merge exercises Riley created on the phone into the seeded one for the same machine:
 *     "Leg Press Machine" → leg-press (pin stack), "Calf Raise Machine" → calf-raise-machine.
 *     Their starting weights become "set on first log" so the logged history decides.
 *  2. Rename "Abduction Machine" → "Hip abduction · machine".
 *  3. Rename seeded exercises whose name is still the original (user renames are kept).
 *  4. Flat press (machine) is plate-loaded, logged per side: mode per-side, start from logs.
 *  5. Add "Leg press · plate-loaded" and "Hack squat · plate-loaded" as swaps for Squat.
 */
async function migrateNames2026_11(): Promise<void> {
  const d = await db();
  const settings = await d.get('settings', 'settings');
  if (!settings || settings.migrations?.includes(MIGRATION_NAMES)) return;

  const byName = async (name: string) => (await d.getAll('exercises')).find((e) => norm(e.name) === norm(name));
  for (const [userName, seededId] of [
    ['Leg Press Machine', 'leg-press'],
    ['Calf Raise Machine', 'calf-raise-machine'],
  ] as const) {
    const mine = await byName(userName);
    const seeded = await d.get('exercises', seededId);
    if (mine && seeded && mine.id !== seededId) {
      await mergeExercise(mine.id, seededId);
      await d.put('exercises', { ...seeded, start: null, mode: mine.mode });
    }
  }
  const abduction = await byName('Abduction Machine');
  if (abduction) await d.put('exercises', { ...abduction, name: 'Hip abduction · machine' });

  const tx = d.transaction(['exercises', 'settings'], 'readwrite');
  const exs = tx.objectStore('exercises');
  for (const [id, [oldName, newName]] of Object.entries(RENAMES_2026_11)) {
    const ex = await exs.get(id);
    if (ex && norm(ex.name) === norm(oldName)) await exs.put({ ...ex, name: newName });
  }
  const chest = await exs.get('flat-press-machine');
  if (chest && chest.mode !== 'per-side') await exs.put({ ...chest, mode: 'per-side', start: null });
  const now = Date.now();
  for (const add of [
    { id: 'leg-press-plate', name: 'Leg press · plate-loaded' },
    { id: 'hack-squat', name: 'Hack squat · plate-loaded' },
  ]) {
    if (!(await exs.get(add.id))) await exs.put({ ...add, mode: 'per-side', start: null, swapIds: [], createdAt: now });
  }
  const squat = await exs.get('squat');
  if (squat) {
    const swapIds = [...new Set([...squat.swapIds, 'leg-press-plate', 'hack-squat'])];
    await exs.put({ ...squat, swapIds });
  }
  const s = await tx.objectStore('settings').get('settings');
  if (s) await tx.objectStore('settings').put({ ...s, migrations: [...(s.migrations ?? []), MIGRATION_NAMES] });
  await tx.done;
  notify();
}

/** Called after every write. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const s = await (await db()).get('settings', 'settings');
  if (!s) throw new Error('Settings missing — call init() first.');
  return s;
}
/** Also updates today's FoodDay targets if today is still 'open' (past days keep theirs). */
export async function setTargets(kcal: number, protein: number): Promise<void> {
  const tx = (await db()).transaction(['settings', 'foodDays'], 'readwrite');
  const prev = await tx.objectStore('settings').get('settings');
  await tx.objectStore('settings').put({ ...prev, id: 'settings', kcalTarget: kcal, proteinTarget: protein });
  const days = tx.objectStore('foodDays');
  const today = await days.get(dayKey());
  if (today && today.status === 'open') await days.put({ ...today, kcalTarget: kcal, proteinTarget: protein });
  await tx.done;
  notify();
}

/** Estimated daily energy use on a sedentary day (TDEE), used for the deficit in History → Food. */
export async function setMaintenance(kcal: number): Promise<void> {
  const tx = (await db()).transaction('settings', 'readwrite');
  const prev = await tx.store.get('settings');
  if (!prev) throw new Error('Settings missing — call init() first.');
  await tx.store.put({ ...prev, maintenanceKcal: kcal });
  await tx.done;
  notify();
}

// ---------- routine & exercises ----------

export async function getRoutine(): Promise<Routine> {
  const r = await (await db()).get('routine', 'routine');
  if (!r) throw new Error('Routine missing — call init() first.');
  return r;
}
export async function saveRoutine(r: Routine): Promise<void> {
  await (await db()).put('routine', r);
  notify();
}
export async function listExercises(): Promise<Exercise[]> {
  return (await db()).getAll('exercises');
}
/** Creates an exercise with start: null ("set on first log"). Names are trimmed; a case-insensitive exact match returns the existing exercise instead. */
export async function createExercise(name: string, mode: LoadMode): Promise<Exercise> {
  const clean = name.trim();
  if (!clean) throw new Error('Exercise name can’t be empty.');
  const tx = (await db()).transaction('exercises', 'readwrite');
  const existing = (await tx.store.getAll()).find((e) => e.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    await tx.done;
    return existing;
  }
  const ex: Exercise = { id: newId(), name: clean, mode, start: null, swapIds: [], createdAt: Date.now() };
  await tx.store.put(ex);
  await tx.done;
  notify();
  return ex;
}
export async function renameExercise(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Exercise name can’t be empty.');
  const tx = (await db()).transaction('exercises', 'readwrite');
  const ex = await tx.store.get(id);
  if (ex) await tx.store.put({ ...ex, name: clean });
  await tx.done;
  notify();
}
/** Moves all logs from `fromId` to `intoId`, repoints routine slots / swapIds / workout plans, deletes `fromId`. */
export async function mergeExercise(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const tx = (await db()).transaction(['exercises', 'logs', 'routine', 'workouts'], 'readwrite');
  const repoint = (id: string) => (id === fromId ? intoId : id);

  const logs = tx.objectStore('logs');
  for (const log of await logs.index('exerciseId').getAll(fromId)) await logs.put({ ...log, exerciseId: intoId });

  const routines = tx.objectStore('routine');
  const routine = await routines.get('routine');
  if (routine) {
    await routines.put({
      ...routine,
      days: routine.days.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s, exerciseId: repoint(s.exerciseId) })) })),
    });
  }

  const workouts = tx.objectStore('workouts');
  for (const w of await workouts.getAll()) {
    if (w.plan.some((s) => s.exerciseId === fromId)) {
      await workouts.put({ ...w, plan: w.plan.map((s) => ({ ...s, exerciseId: repoint(s.exerciseId) })) });
    }
  }

  const exercises = tx.objectStore('exercises');
  for (const ex of await exercises.getAll()) {
    if (ex.id === fromId || !ex.swapIds.includes(fromId)) continue;
    // Repoint, drop duplicates, and never list an exercise as its own swap.
    const swapIds = [...new Set(ex.swapIds.map(repoint))].filter((id) => id !== ex.id);
    await exercises.put({ ...ex, swapIds });
  }
  await exercises.delete(fromId);

  await tx.done;
  notify();
}
/** Deletes exercises with no logs that aren't in the routine and aren't anyone's swap. Called after a workout ends / on init. */
export async function pruneUnusedExercises(): Promise<void> {
  const tx = (await db()).transaction(['exercises', 'logs', 'routine', 'workouts'], 'readwrite');
  const keep = new Set<string>();
  for (const log of await tx.objectStore('logs').getAll()) keep.add(log.exerciseId);
  const routine = await tx.objectStore('routine').get('routine');
  for (const d of routine?.days ?? []) for (const s of d.slots) keep.add(s.exerciseId);
  // Also keep anything in today's workout plans, so a just-swapped-in exercise survives a reload mid-workout.
  const today = dayKey();
  for (const w of await tx.objectStore('workouts').getAll()) {
    if (w.date === today) for (const s of w.plan) keep.add(s.exerciseId);
  }
  const exercises = tx.objectStore('exercises');
  const all = await exercises.getAll();
  for (const ex of all) for (const id of ex.swapIds) keep.add(id);
  for (const ex of all) if (!keep.has(ex.id)) await exercises.delete(ex.id);
  await tx.done;
  notify();
}

// ---------- workouts & logs ----------

/** Today's workout for this routine day if one exists, else a new one via logic/routine.ts startWorkout() (saved). */
export async function getOrStartWorkout(dayId: string, today: DayKey): Promise<Workout> {
  const tx = (await db()).transaction(['workouts', 'routine'], 'readwrite');
  const workouts = tx.objectStore('workouts');
  const existing = (await workouts.getAll()).find((w) => w.dayId === dayId && w.date === today);
  if (existing) {
    await tx.done;
    return existing;
  }
  const routine = await tx.objectStore('routine').get('routine');
  if (!routine) throw new Error('Routine missing — call init() first.');
  const w = startWorkout(routine, dayId, today, newId(), Date.now());
  await workouts.put(w);
  await tx.done;
  notify();
  return w;
}
export async function saveWorkout(w: Workout): Promise<void> {
  await (await db()).put('workouts', w);
  notify();
}
/** For Boxing: creates (or finds) today's boxing workout with boxingDone = true. */
export async function markBoxingDone(today: DayKey): Promise<void> {
  const boxing = (await getRoutine()).days.find((d) => d.kind === 'boxing');
  if (!boxing) throw new Error('There’s no Boxing day in the routine.');
  const w = await getOrStartWorkout(boxing.id, today);
  await saveWorkout({ ...w, boxingDone: true });
}
export async function listWorkouts(): Promise<Workout[]> {
  return (await db()).getAll('workouts');
}
export async function logsForExercise(exerciseId: string): Promise<ExerciseLog[]> {
  return (await db()).getAllFromIndex('logs', 'exerciseId', exerciseId);
}
export async function logsForWorkout(workoutId: string): Promise<ExerciseLog[]> {
  return (await db()).getAllFromIndex('logs', 'workoutId', workoutId);
}
export async function allLogs(): Promise<ExerciseLog[]> {
  return (await db()).getAll('logs');
}
/** Insert or replace by id. */
export async function saveLog(log: ExerciseLog): Promise<void> {
  await (await db()).put('logs', log);
  notify();
}
export async function deleteLog(id: string): Promise<void> {
  await (await db()).delete('logs', id);
  notify();
}

// ---------- food ----------

export async function foodFor(date: DayKey): Promise<FoodEntry[]> {
  return (await db()).getAllFromIndex('food', 'date', date);
}
export async function allFood(): Promise<FoodEntry[]> {
  return (await db()).getAll('food');
}
/** Adds an entry. Creates the day's FoodDay (status 'open', current targets) if missing; if the day was closed, it stays closed. */
export async function addFood(date: DayKey, kcal: number, protein: number): Promise<FoodEntry> {
  const tx = (await db()).transaction(['food', 'foodDays', 'settings'], 'readwrite');
  const entry: FoodEntry = { id: newId(), date, kcal, protein, at: Date.now() };
  await tx.objectStore('food').put(entry);
  const days = tx.objectStore('foodDays');
  if (!(await days.get(date))) {
    const s = await tx.objectStore('settings').get('settings');
    if (!s) throw new Error('Settings missing — call init() first.');
    // A brand-new past day can only come from History (filling in a forgotten day): mark it
    // `reopened` so the morning close-out prompt leaves it to you to Confirm there.
    const past = date < dayKey();
    await days.put({ date, status: 'open', kcalTarget: s.kcalTarget, proteinTarget: s.proteinTarget, ...(past ? { reopened: true } : {}) });
  }
  await tx.done;
  notify();
  return entry;
}
export async function updateFood(e: FoodEntry): Promise<void> {
  await (await db()).put('food', e);
  notify();
}
export async function deleteFood(id: string): Promise<void> {
  await (await db()).delete('food', id);
  notify();
}
export async function listFoodDays(): Promise<FoodDay[]> {
  return (await db()).getAll('foodDays');
}
/** Creates the FoodDay with current targets if missing (e.g. closing a day with no entries). */
export async function closeDay(date: DayKey, status: 'complete' | 'incomplete'): Promise<void> {
  const tx = (await db()).transaction(['foodDays', 'settings'], 'readwrite');
  const days = tx.objectStore('foodDays');
  const day = await days.get(date);
  if (day) {
    await days.put({ ...day, status, reopened: undefined });
  } else {
    const s = await tx.objectStore('settings').get('settings');
    if (!s) throw new Error('Settings missing — call init() first.');
    await days.put({ date, status, kcalTarget: s.kcalTarget, proteinTarget: s.proteinTarget });
  }
  await tx.done;
  notify();
}
/** Back to 'open' (from History, to fix a mistake). Marked `reopened` so the close-out prompt leaves it alone. */
export async function reopenDay(date: DayKey): Promise<void> {
  const tx = (await db()).transaction('foodDays', 'readwrite');
  const day = await tx.store.get(date);
  if (day) await tx.store.put({ ...day, status: 'open', reopened: true });
  await tx.done;
  notify();
}

// ---------- export / import ----------

export async function exportAll(): Promise<ExportFile> {
  const tx = (await db()).transaction(STORES, 'readonly');
  const settings = await tx.objectStore('settings').get('settings');
  const routine = await tx.objectStore('routine').get('routine');
  const file: ExportFile = {
    app: 'lift-log',
    version: 1,
    exportedAt: Date.now(),
    settings: settings!,
    routine: routine!,
    exercises: await tx.objectStore('exercises').getAll(),
    workouts: await tx.objectStore('workouts').getAll(),
    logs: await tx.objectStore('logs').getAll(),
    food: await tx.objectStore('food').getAll(),
    foodDays: await tx.objectStore('foodDays').getAll(),
  };
  await tx.done;
  if (!settings || !routine) throw new Error('Nothing to export yet — the app hasn’t been set up.');
  return file;
}
/** Validates the file (app === 'lift-log', version 1, arrays present) and replaces ALL data in one transaction. Throws a readable Error if invalid. */
export async function importAll(f: ExportFile): Promise<void> {
  validate(f);
  const tx = allStoresTx(await db());
  for (const name of STORES) await tx.objectStore(name).clear();
  await writeAll(tx, f);
  await tx.done;
  notify();
}
/** Wipes everything (used by tests / acceptance check 12). Next init() re-seeds. */
export async function clearAll(): Promise<void> {
  const tx = allStoresTx(await db());
  for (const name of STORES) await tx.objectStore(name).clear();
  await tx.done;
  notify();
}

/** Random id for new records. */
export const newId = (): string => crypto.randomUUID();

// ---------- private helpers ----------

const allStoresTx = (d: IDBPDatabase<LiftLogDB>) => d.transaction(STORES, 'readwrite');
type AllStoresTx = ReturnType<typeof allStoresTx>;

async function writeAll(tx: AllStoresTx, f: ExportFile): Promise<void> {
  await tx.objectStore('settings').put(f.settings);
  await tx.objectStore('routine').put(f.routine);
  for (const e of f.exercises) await tx.objectStore('exercises').put(e);
  for (const w of f.workouts) await tx.objectStore('workouts').put(w);
  for (const l of f.logs) await tx.objectStore('logs').put(l);
  for (const e of f.food) await tx.objectStore('food').put(e);
  for (const d of f.foodDays) await tx.objectStore('foodDays').put(d);
}

function validate(f: unknown): asserts f is ExportFile {
  const bad = (why: string): never => {
    throw new Error(`This isn’t a valid Lift Log backup: ${why}`);
  };
  if (!f || typeof f !== 'object') bad('the file is empty or not JSON data.');
  const o = f as Record<string, unknown>;
  if (o.app !== 'lift-log') bad('it wasn’t exported from Lift Log.');
  if (o.version !== 1) bad(`it’s version ${String(o.version)}, but this app reads version 1.`);
  const s = o.settings as Settings | undefined;
  if (!s || s.id !== 'settings' || typeof s.kcalTarget !== 'number' || typeof s.proteinTarget !== 'number') {
    bad('the settings (calorie and protein targets) are missing.');
  }
  const r = o.routine as Routine | undefined;
  if (!r || r.id !== 'routine' || !Array.isArray(r.days)) bad('the routine is missing.');
  for (const key of ['exercises', 'workouts', 'logs', 'food', 'foodDays'] as const) {
    if (!Array.isArray(o[key])) bad(`the “${key}” list is missing.`);
  }
  const hasId = (k: 'exercises' | 'workouts' | 'logs' | 'food') =>
    (o[k] as unknown[]).every((x) => !!x && typeof (x as { id?: unknown }).id === 'string');
  for (const k of ['exercises', 'workouts', 'logs', 'food'] as const) if (!hasId(k)) bad(`an item in “${k}” has no id.`);
  const all = <T>(k: string, ok: (x: T) => boolean) => (o[k] as T[]).every(ok);
  if (!all<Exercise>('exercises', (e) => typeof e.name === 'string' && Array.isArray(e.swapIds))) bad('an exercise is incomplete.');
  if (!all<Workout>('workouts', (w) => typeof w.date === 'string' && Array.isArray(w.plan))) bad('a workout is incomplete.');
  if (!all<ExerciseLog>('logs', (l) => typeof l.exerciseId === 'string' && Array.isArray(l.sets))) bad('a logged session is incomplete.');
  if (!r!.days.every((d) => typeof d.id === 'string' && Array.isArray(d.slots))) bad('a routine day is incomplete.');
  if (!(o.foodDays as unknown[]).every((x) => !!x && typeof (x as { date?: unknown }).date === 'string')) {
    bad('an item in “foodDays” has no date.');
  }
}
