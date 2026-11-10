import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from './db';
import { addDays, dayKey } from '../logic/dates';
import type { ExportFile } from './types';

const today = dayKey();
const yesterday = addDays(today, -1);

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
    expect(logs[0].date).toBe(today);
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
    const e = await db.addFood(empty, 100, 10);
    await db.deleteFood(e.id);
    await db.addFood(yesterday, 500, 40);
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
    expect(await db.getSettings()).toEqual({ id: 'settings', kcalTarget: 1800, proteinTarget: 200 });
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
});

describe('workouts', () => {
  it('getOrStartWorkout returns the same workout for the same day and date', async () => {
    const a = await db.getOrStartWorkout('day2', today);
    const b = await db.getOrStartWorkout('day2', today);
    expect(b).toEqual(a);
    expect(a.plan.map((s) => s.exerciseId)).toContain('face-pulls');
    const c = await db.getOrStartWorkout('day2', yesterday);
    expect(c.id).not.toBe(a.id);
    // The seeded Day 1 workout is today's Day 1 workout.
    expect((await db.getOrStartWorkout('day1', today)).id).toBe('seed-workout');
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
    expect((await db.createExercise('squat', 'total')).id).toBe('squat');
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
    expect(squat.swapIds).toEqual(['leg-press']);
    expect(after.find((e) => e.id === 'squat')!.swapIds).toEqual([]);
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
