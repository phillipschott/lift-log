import { describe, expect, it } from 'vitest';
import type { ExerciseLog, FoodDay, FoodEntry, Workout } from '../data/types';
import {
  boxingPerWeek,
  firstRecordDate,
  liftDaysPerWeek,
  macroHitsPerWeek,
  topWeightSeries,
  weekBuckets,
} from './progress';

// 2026-11-09 is a Monday.
const TODAY = '2026-11-11'; // Wed
let n = 0;
const log = (dayId: string, date: string, loads: number[] = [50], exerciseId = 'x'): ExerciseLog => ({
  id: `l${++n}`,
  workoutId: 'w',
  date,
  dayId,
  exerciseId,
  targetSets: 3,
  targetReps: 10,
  sets: loads.map((v, i) => ({ load: { value: v, mode: 'total' }, reps: 10, at: n * 10 + i })),
});
const box = (date: string, done = true): Workout => ({ id: `b${++n}`, date, dayId: 'boxing', plan: [], startedAt: 0, boxingDone: done });
const fday = (date: string, status: FoodDay['status'] = 'complete'): FoodDay => ({ date, status, kcalTarget: 2000, proteinTarget: 150 });
const eat = (date: string, kcal: number, protein: number): FoodEntry => ({ id: `f${++n}`, date, kcal, protein, at: 0 });

describe('weekBuckets', () => {
  it('no records → just this week', () => {
    expect(weekBuckets(TODAY, '12w', null)).toEqual(['2026-11-09']);
    expect(weekBuckets(TODAY, 'all', null)).toEqual(['2026-11-09']);
  });

  it('new install → one week, not 12 empty ones', () => {
    expect(weekBuckets(TODAY, '12w', '2026-11-10')).toEqual(['2026-11-09']);
  });

  it('12w caps at 12 Mondays ending this week; all goes back to the first record', () => {
    const w12 = weekBuckets(TODAY, '12w', '2026-01-03');
    expect(w12).toHaveLength(12);
    expect(w12[11]).toBe('2026-11-09');
    expect(w12[0]).toBe('2026-08-24');
    const all = weekBuckets(TODAY, 'all', '2026-10-21'); // a Wednesday
    expect(all).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('a Sunday record belongs to the week starting the Monday before', () => {
    expect(weekBuckets(TODAY, 'all', '2026-11-08')).toEqual(['2026-11-02', '2026-11-09']);
  });
});

describe('per-week counts', () => {
  const weeks = ['2026-11-02', '2026-11-09'];

  it('lift days = distinct routine days with a set; empty logs ignored', () => {
    const logs = [
      log('day1', '2026-11-02'),
      log('day1', '2026-11-04', [50], 'y'), // same routine day again → still 1
      log('day2', '2026-11-05'),
      { ...log('day3', '2026-11-06'), sets: [] },
      log('day1', '2026-11-10'),
      log('day1', '2026-10-30'), // before range
      log('day2', '2026-11-12'), // after today
    ];
    expect(liftDaysPerWeek(weeks, logs, TODAY)).toEqual([2, 1]);
  });

  it('boxing = distinct dates with boxingDone', () => {
    const ws = [box('2026-11-03'), box('2026-11-03'), box('2026-11-07'), box('2026-11-10', false), box('2026-11-11')];
    expect(boxingPerWeek(weeks, ws, TODAY)).toEqual([2, 1]);
  });

  it('macros count only complete days, using that day’s targets', () => {
    const days = [
      fday('2026-11-02'), // both
      fday('2026-11-03'), // protein only
      { ...fday('2026-11-04'), kcalTarget: 3000 }, // kcal hit thanks to its own target
      fday('2026-11-05', 'incomplete'),
      fday('2026-11-10', 'open'),
    ];
    const food = [
      eat('2026-11-02', 1900, 160),
      eat('2026-11-03', 2500, 150),
      eat('2026-11-04', 2800, 100),
      eat('2026-11-05', 1000, 200),
      eat('2026-11-10', 1000, 200),
    ];
    expect(macroHitsPerWeek(weeks, days, food, TODAY)).toEqual([
      { protein: 2, kcal: 2, confirmed: 3 },
      { protein: 0, kcal: 0, confirmed: 0 },
    ]);
  });
});

describe('topWeightSeries', () => {
  it('top weight per session in range; most recently trained first', () => {
    const logs = [
      log('day1', '2026-10-01', [40, 45, 45], 'a'),
      log('day1', '2026-11-02', [45, 50, 47.5], 'a'),
      log('day2', '2026-11-03', [100], 'b'),
      log('day1', '2026-11-09', [50, 50], 'a'),
      { ...log('day2', '2026-11-10', [], 'c') },
    ];
    const s = topWeightSeries(logs, '2026-10-26');
    expect(s.map((x) => x.exerciseId)).toEqual(['a', 'b']);
    expect(s[0].points.map((p) => [p.date, p.load.value])).toEqual([
      ['2026-11-02', 50],
      ['2026-11-09', 50],
    ]);
    expect(s[0].lastDate).toBe('2026-11-09');
  });

  it('keeps an exercise with no sessions in range (empty points)', () => {
    const s = topWeightSeries([log('day1', '2026-01-05', [30], 'old')], '2026-10-26');
    expect(s).toHaveLength(1);
    expect(s[0].points).toEqual([]);
  });
});

describe('firstRecordDate', () => {
  it('earliest of logs with sets, workouts, food days and entries', () => {
    expect(firstRecordDate([], [], [], [])).toBeNull();
    expect(
      firstRecordDate([{ ...log('d', '2026-01-01'), sets: [] }, log('d', '2026-03-01')], [box('2026-02-10')], [fday('2026-02-20')], [eat('2026-02-05', 1, 1)]),
    ).toBe('2026-02-05');
  });
});
