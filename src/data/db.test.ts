import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from './db';
import { addDays, dayKey } from '../logic/dates';
import { pendingCloseOuts } from '../logic/food';
import type { ExportFile } from './types';

const today = dayKey();
const yesterday = addDays(today, -1);

/** Log food as if it were entered on that day itself (moves the clock to noon that day). */
async function addOnTheDay(date: string, kcal: number, protein: number) {
  const [y, m, d] = date.split('-').map(Number);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(y, m - 1, d, 12));
  try {
    return await db.addFood(date, kcal, protein);
  } finally {
    vi.useRealTimers();
  }
}
afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  await db.clearAll();
  await db.init();
});

const withoutStamp = ({ exportedAt: _, ...rest }: ExportFile) => rest;

describe('init', () => {
  it('seeds the routine and the shoulder-press log on first launch', async () => {
    const r = await db.getRoutine();
    expect(r.days.map((d) => d.id)).toEqual(['day1', 'day2', 'day3', 'day4', 'boxing']);
    const logs = await db.logsForExercise('seated-shoulder-press');
    expect(logs).toHaveLength(1);
    expect(logs[0].sets.map((s) => s.reps)).toEqual([10, 10, 7]);
    expect(logs[0].date < today).toBe(true); // seeded a week back, not on install day
    expect((await db.getSettings()).kcalTarget).toBe(2000);
  });

  it('does not duplicate on a second init', async () => {
    const before = await db.exportAll();
    await db.init();
    await Promise.all([db.init(), db.init()]);
    expect(withoutStamp(await db.exportAll())).toEqual(withoutStamp(before));
  });

  it('auto-closes a past open day with no entries, but leaves one with entries open', async () => {
    const empty = addDays(today, -2);
    const e = await addOnTheDay(empty, 100, 10);
    await db.deleteFood(e.id);
    await addOnTheDay(yesterday, 500, 40);
    await db.init();
    const days = await db.listFoodDays();
    expect(days.find((d) => d.date === empty)?.status).toBe('incomplete');
    expect(days.find((d) => d.date === yesterday)?.status).toBe('open');
  });
});

describe('subscribe', () => {
  it('notifies on writes and stops after unsubscribe', async () => {
    let n = 0;
    const off = db.subscribe(() => n++);
    await db.addFood(today, 1, 1);
    expect(n).toBe(1);
    off();
    await db.addFood(today, 1, 1);
    expect(n).toBe(1);
  });
});

describe('food', () => {
  it('addFood creates a FoodDay with current targets and adds stack', async () => {
    await db.addFood(today, 300, 20);
    await db.addFood(today, 400, 30);
    await db.addFood(today, 500, 40);
    const entries = await db.foodFor(today);
    expect(entries).toHaveLength(3);
    expect(entries.reduce((t, e) => t + e.kcal, 0)).toBe(1200);
    const days = await db.listFoodDays();
    expect(days).toEqual([{ date: today, status: 'open', kcalTarget: 2000, proteinTarget: 180 }]);
  });

  it("setTargets changes today's open FoodDay but not a past closed one", async () => {
    await db.addFood(yesterday, 100, 10);
    await db.closeDay(yesterday, 'complete');
    await db.addFood(today, 100, 10);
    await db.setTargets(1800, 200);
    const days = await db.listFoodDays();
    expect(days.find((d) => d.date === today)).toMatchObject({ kcalTarget: 1800, proteinTarget: 200 });
    expect(days.find((d) => d.date === yesterday)).toMatchObject({ kcalTarget: 2000, proteinTarget: 180 });
    // Other settings (maintenance) are kept, not wiped.
    expect(await db.getSettings()).toMatchObject({ id: 'settings', kcalTarget: 1800, proteinTarget: 200, maintenanceKcal: 2200 });
  });

  it('setMaintenance changes maintenance and keeps the targets', async () => {
    await db.setMaintenance(2350);
    expect(await db.getSettings()).toMatchObject({ id: 'settings', kcalTarget: 2000, proteinTarget: 180, maintenanceKcal: 2350 });
  });

  it('closeDay creates a missing day, reopenDay sets it back to open, adding to a closed day keeps it closed', async () => {
    await db.closeDay(yesterday, 'incomplete');
    expect((await db.listFoodDays())[0]).toEqual({ date: yesterday, status: 'incomplete', kcalTarget: 2000, proteinTarget: 180 });
    await db.closeDay(yesterday, 'complete');
    await db.addFood(yesterday, 100, 10);
    expect((await db.listFoodDays())[0].status).toBe('complete');
    await db.reopenDay(yesterday);
    expect((await db.listFoodDays())[0].status).toBe('open');
  });

  it('bug 2026-11-13: forgot dinner → marked incomplete → Reopen lets you edit, with no close-out prompt', async () => {
    await addOnTheDay(yesterday, 1350, 120);
    await db.closeDay(yesterday, 'incomplete');
    await db.reopenDay(yesterday);
    // The prompt must not grab the reopened day, and init() must not auto-close it.
    expect(pendingCloseOuts(await db.listFoodDays(), await db.allFood(), today).prompt).toHaveLength(0);
    await db.init();
    expect((await db.listFoodDays()).find((d) => d.date === yesterday)?.status).toBe('open');
    // Add the forgotten dinner, then confirm from History: the reopened mark is cleared.
    await db.addFood(yesterday, 700, 55);
    await db.closeDay(yesterday, 'complete');
    const d = (await db.listFoodDays()).find((x) => x.date === yesterday)!;
    expect(d.status).toBe('complete');
    expect(d.reopened).toBeUndefined();
    expect((await db.foodFor(yesterday)).reduce((t, e) => t + e.kcal, 0)).toBe(2050);
  });

  it('forgot a whole day: adding food to it later from History never triggers the prompt', async () => {
    const twoAgo = addDays(today, -2);
    // Nothing logged that day; add it now from History.
    await db.addFood(twoAgo, 2000, 170);
    expect(pendingCloseOuts(await db.listFoodDays(), await db.allFood(), today).prompt).toHaveLength(0);
    expect((await db.listFoodDays()).find((d) => d.date === twoAgo)).toMatchObject({ status: 'open', reopened: true });
    await db.closeDay(twoAgo, 'complete');
    expect((await db.listFoodDays()).find((d) => d.date === twoAgo)?.status).toBe('complete');
  });

  it('a day you never closed still gets the morning prompt', async () => {
    await addOnTheDay(yesterday, 1350, 120);
    expect(pendingCloseOuts(await db.listFoodDays(), await db.allFood(), today).prompt.map((x) => x.date)).toEqual([yesterday]);
  });
});

describe('workouts', () => {
  it('getOrStartWorkout returns the same workout for the same day and date', async () => {
    const a = await db.getOrStartWorkout('day2', today);
    const b = await db.getOrStartWorkout('day2', today);
    expect(b).toEqual(a);
    expect(a.plan.map((s) => s.exerciseId)).toContain('face-pulls');
    const c = await db.getOrStartWorkout('day2', yesterday);
    expect(c.id).not.toBe(a.id);
    // The seeded session is in the past, so today's Day 1 is a fresh workout.
    expect((await db.getOrStartWorkout('day1', today)).id).not.toBe('seed-history');
  });

  it('markBoxingDone creates or finds today’s boxing workout', async () => {
    await db.markBoxingDone(today);
    await db.markBoxingDone(today);
    const boxing = (await db.listWorkouts()).filter((w) => w.dayId === 'boxing');
    expect(boxing).toHaveLength(1);
    expect(boxing[0].boxingDone).toBe(true);
  });
});

describe('exercises', () => {
  it('createExercise returns the existing one on a case-insensitive duplicate name', async () => {
    const a = await db.createExercise('  Cable Crunch ', 'total');
    expect(a).toMatchObject({ name: 'Cable Crunch', start: null, swapIds: [] });
    const b = await db.createExercise('cable crunch', 'per-side');
    expect(b.id).toBe(a.id);
    expect((await db.createExercise('squat · DUMBBELL', 'total')).id).toBe('squat');
  });

  it('mergeExercise moves logs, repoints routine slots / swapIds / plans, deletes the source', async () => {
    const dup = await db.createExercise('Shoulder press (dup)', 'per-side');
    const w = await db.getOrStartWorkout('day2', yesterday);
    await db.saveWorkout({ ...w, plan: [{ ...w.plan[0], exerciseId: dup.id }] });
    await db.saveLog({
      id: 'dup-log', workoutId: w.id, date: yesterday, dayId: 'day2', exerciseId: dup.id,
      targetSets: 3, targetReps: 10, sets: [{ load: { value: 50, mode: 'per-side' }, reps: 10, at: 1 }],
    });
    const r = await db.getRoutine();
    r.days[1].slots[0].exerciseId = dup.id;
    await db.saveRoutine(r);
    const exercises = await db.listExercises();
    const squat = exercises.find((e) => e.id === 'squat')!;
    await db.mergeExercise('leg-press', 'squat'); // squat lists leg-press as a swap; must not become its own swap

    await db.mergeExercise(dup.id, 'seated-shoulder-press');
    expect((await db.logsForExercise('seated-shoulder-press')).map((l) => l.id).sort()).toEqual(['dup-log', 'seed-shoulder-press']);
    expect(await db.logsForExercise(dup.id)).toEqual([]);
    expect((await db.getRoutine()).days[1].slots[0].exerciseId).toBe('seated-shoulder-press');
    expect((await db.listWorkouts()).find((x) => x.id === w.id)!.plan[0].exerciseId).toBe('seated-shoulder-press');
    const after = await db.listExercises();
    expect(after.find((e) => e.id === dup.id)).toBeUndefined();
    expect(after.find((e) => e.id === 'leg-press')).toBeUndefined();
    expect(squat.swapIds).toEqual(['leg-press', 'leg-press-plate', 'hack-squat']);
    expect(after.find((e) => e.id === 'squat')!.swapIds).toEqual(['leg-press-plate', 'hack-squat']) // leg-press merged into squat is not its own swap;
  });

  it('mergeExercise repoints another exercise’s swapIds', async () => {
    const dup = await db.createExercise('Shrugs', 'per-side');
    await db.mergeExercise('shoulder-shrugs', dup.id);
    expect((await db.listExercises()).find((e) => e.id === 'face-pulls')!.swapIds).toEqual([dup.id]);
  });

  it('pruneUnusedExercises removes a never-logged, non-routine, non-swap exercise and keeps routine ones', async () => {
    const extra = await db.createExercise('Never used', 'total');
    const countBefore = (await db.listExercises()).length;
    await db.pruneUnusedExercises();
    const after = await db.listExercises();
    expect(after.find((e) => e.id === extra.id)).toBeUndefined();
    expect(after).toHaveLength(countBefore - 1);
    expect(after.find((e) => e.id === 'squat')).toBeDefined();
    expect(after.find((e) => e.id === 'leg-press')).toBeDefined(); // a swap
  });
});

describe('export / import', () => {
  it('acceptance check 12: export → clear → import restores identical data', async () => {
    await db.addFood(yesterday, 700, 50);
    await db.closeDay(yesterday, 'complete');
    await db.addFood(today, 300, 20);
    await db.createExercise('Cable crunch', 'total');
    await db.markBoxingDone(today);
    const before = await db.exportAll();
    const json = JSON.parse(JSON.stringify(before)) as ExportFile;

    await db.clearAll();
    expect(await db.listExercises()).toEqual([]);
    await db.importAll(json);

    expect(withoutStamp(await db.exportAll())).toEqual(withoutStamp(before));
  });

  it('rejects garbage with a readable error and leaves data untouched', async () => {
    const before = withoutStamp(await db.exportAll());
    await expect(db.importAll(null as unknown as ExportFile)).rejects.toThrow(/valid Lift Log backup/);
    await expect(db.importAll({ hello: 'world' } as unknown as ExportFile)).rejects.toThrow(/exported from Lift Log/);
    const good = await db.exportAll();
    await expect(db.importAll({ ...good, version: 2 } as unknown as ExportFile)).rejects.toThrow(/version 2/);
    await expect(db.importAll({ ...good, logs: undefined } as unknown as ExportFile)).rejects.toThrow(/“logs” list is missing/);
    expect(withoutStamp(await db.exportAll())).toEqual(before);
  });
});

describe('migration: clearer names (2026-11-17)', () => {
  /** Riley's phone data before the update: original seed names + exercises created on the phone. */
  async function oldPhoneData(): Promise<ExportFile> {
    const f = await db.exportAll();
    const old = Object.fromEntries(Object.entries(db.RENAMES_2026_11).map(([id, [o]]) => [id, o]));
    f.settings = { ...f.settings, migrations: undefined };
    f.exercises = f.exercises
      .filter((e) => e.id !== 'leg-press-plate' && e.id !== 'hack-squat')
      .map((e) => (old[e.id] ? { ...e, name: old[e.id] } : e))
      .map((e) => (e.id === 'squat' ? { ...e, swapIds: ['leg-press'] } : e))
      .map((e) => (e.id === 'flat-press-machine' ? { ...e, mode: 'total' as const, start: { value: 105, mode: 'total' as const } } : e))
      .map((e) => (e.id === 'cable-row' ? { ...e, name: 'My row' } : e)); // a name Riley changed himself
    const mk = (id: string, name: string) => ({ id, name, mode: 'total' as const, start: null, swapIds: [], createdAt: 1 });
    f.exercises.push(mk('u-legpress', 'Leg Press Machine'), mk('u-calf', 'Calf Raise Machine'), mk('u-abd', 'Abduction Machine'));
    const lg = (id: string, exerciseId: string, value: number) => ({
      id, workoutId: 'w-' + id, date: yesterday, dayId: 'day3', exerciseId, targetSets: 3, targetReps: 12,
      sets: [12, 12, 12].map((reps, i) => ({ load: { value, mode: 'total' as const }, reps, at: i })),
    });
    f.logs.push(lg('l1', 'u-legpress', 240), lg('l2', 'u-calf', 300), lg('l3', 'u-abd', 110));
    return f;
  }

  it('renames, merges the two pairs, adds the plate-loaded leg press + hack squat, keeps user renames', async () => {
    await db.importAll(await oldPhoneData());
    await db.init();
    const ex = await db.listExercises();
    const name = (id: string) => ex.find((e) => e.id === id)?.name;
    expect(name('flat-press-machine')).toBe('Chest press · plate-loaded');
    expect(ex.find((e) => e.id === 'flat-press-machine')?.mode).toBe('per-side');
    expect(name('triceps-pushdown')).toBe('Triceps pushdown · high pulley');
    expect(name('cable-pushdown')).toBe('Triceps pushdown · adjustable pulley');
    expect(name('cable-row')).toBe('My row'); // not overwritten
    // Merges keep the logged history on the seeded exercise; starting weight comes from the logs.
    expect(ex.some((e) => e.name === 'Leg Press Machine' || e.name === 'Calf Raise Machine')).toBe(false);
    expect(name('leg-press')).toBe('Leg press · machine');
    expect((await db.logsForExercise('leg-press')).map((l) => l.id)).toEqual(['l1']);
    expect(ex.find((e) => e.id === 'leg-press')?.start).toBe(null);
    expect((await db.logsForExercise('calf-raise-machine')).map((l) => l.id)).toEqual(['l2']);
    expect(ex.find((e) => e.name === 'Hip abduction · machine')?.id).toBe('u-abd');
    // Three separate leg machines as Squat swaps.
    expect(name('leg-press-plate')).toBe('Leg press · plate-loaded');
    expect(name('hack-squat')).toBe('Hack squat · plate-loaded');
    expect(ex.find((e) => e.id === 'squat')?.swapIds).toEqual(['leg-press', 'leg-press-plate', 'hack-squat']);
    // Runs once.
    expect((await db.getSettings()).migrations).toEqual(['names-2026-11', 'names-2026-11b']);
    await db.renameExercise('leg-press', 'Leg press · seated stack');
    await db.init();
    expect((await db.listExercises()).find((e) => e.id === 'leg-press')?.name).toBe('Leg press · seated stack');
  });
});

describe('migration: two phone-created exercises (2026-11-17b)', () => {
  it('merges "wide pull down (plates)" into Lat pulldown · plate-loaded and renames the curl machine', async () => {
    const f = await db.exportAll();
    f.settings = { ...f.settings, migrations: ['names-2026-11'] };
    const mk = (id: string, name: string) => ({ id, name, mode: 'per-side' as const, start: null, swapIds: [], createdAt: 1 });
    f.exercises.push(mk('u-wide', 'Wide Pull Down (plates)'), mk('u-curl', 'dumbbell curl machine (plates)'));
    f.logs.push({
      id: 'lw', workoutId: 'ww', date: yesterday, dayId: 'day2', exerciseId: 'u-wide', targetSets: 4, targetReps: 10,
      sets: [10, 10, 10, 10].map((reps, i) => ({ load: { value: 70, mode: 'per-side' as const }, reps, at: i })),
    });
    f.logs.push({
      id: 'lc', workoutId: 'ww', date: yesterday, dayId: 'day2', exerciseId: 'u-curl', targetSets: 3, targetReps: 10,
      sets: [10, 10, 10].map((reps, i) => ({ load: { value: 25, mode: 'per-side' as const }, reps, at: i })),
    });
    await db.importAll(f);
    await db.init();
    const ex = await db.listExercises();
    expect(ex.find((e) => e.id === 'u-wide')).toBeUndefined();
    expect(ex.find((e) => e.id === 'wide-pulldown')).toMatchObject({ name: 'Lat pulldown · plate-loaded', start: null });
    expect((await db.logsForExercise('wide-pulldown')).map((l) => l.id)).toEqual(['lw']);
    expect(ex.find((e) => e.id === 'u-curl')?.name).toBe('Preacher curl · plate-loaded');
    expect((await db.getSettings()).migrations).toEqual(['names-2026-11', 'names-2026-11b']);
  });
});

