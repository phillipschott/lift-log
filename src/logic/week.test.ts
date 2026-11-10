import { describe, expect, it } from 'vitest';
import type { ExerciseLog, Workout } from '../data/types';
import { buildSeed } from '../data/seed';
import { weekStart, weekStatus } from './week';

// 2026-11-09 is a Monday.
const MON = '2026-11-09';
const { routine } = buildSeed(MON, 0);
let n = 0;
const lift = (dayId: string, date: string, sets = 1): ExerciseLog => ({
  id: `l${++n}`,
  workoutId: 'w',
  date,
  dayId,
  exerciseId: 'x',
  targetSets: 3,
  targetReps: 10,
  sets: Array.from({ length: sets }, (_, i) => ({ load: { value: 50, mode: 'total' }, reps: 10, at: i })),
});
const boxing = (date: string): Workout => ({ id: `b${++n}`, date, dayId: 'boxing', plan: [], startedAt: 0, boxingDone: true });

describe('week', () => {
  it('weeks start Monday', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // Mon
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sun
    expect(weekStart('2026-11-16')).toBe('2026-11-16'); // next Mon
  });

  it('fresh week → Up next is Day 1', () => {
    expect(weekStatus(routine, [], [], MON).upNext).toBe('day1');
  });

  it('Push done → Up next Pull; skipped Pull stays Up next after doing Legs', () => {
    expect(weekStatus(routine, [], [lift('day1', MON)], '2026-11-10').upNext).toBe('day2');
    const s = weekStatus(routine, [], [lift('day1', MON), lift('day3', '2026-11-11')], '2026-11-12');
    expect(s.upNext).toBe('day2');
    expect([...s.done].sort()).toEqual(['day1', 'day3']);
  });

  it('a workout started today stays Up next even though it has ✓', () => {
    expect(weekStatus(routine, [], [lift('day1', MON)], MON).upNext).toBe('day1');
  });

  it('a workout with no sets logged does not count', () => {
    expect(weekStatus(routine, [], [lift('day1', MON, 0)], '2026-11-10').upNext).toBe('day1');
  });

  it('all four lift days → week done; Boxing ✓ but never Up next', () => {
    const logs = ['day1', 'day2', 'day3', 'day4'].map((d, i) => lift(d, `2026-11-1${i}`));
    const s = weekStatus(routine, [boxing('2026-11-10')], logs, '2026-11-14');
    expect(s.upNext).toBe(null);
    expect(s.done.has('boxing')).toBe(true);
    expect(weekStatus(routine, [boxing(MON)], [], MON).upNext).toBe('day1');
  });

  it('last week does not count; resets Monday', () => {
    const logs = ['day1', 'day2'].map((d) => lift(d, '2026-11-12'));
    const s = weekStatus(routine, [boxing('2026-11-13')], logs, '2026-11-16');
    expect(s.upNext).toBe('day1');
    expect(s.done.size).toBe(0);
  });
});
