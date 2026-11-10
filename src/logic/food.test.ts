import { describe, expect, it } from 'vitest';
import type { FoodDay, FoodEntry } from '../data/types';
import { addDays, dayKey } from './dates';
import { dayMark, hitRates, pct, pendingCloseOuts, totalsFor } from './food';

const T0 = '2026-11-09';
let n = 0;
const entry = (date: string, kcal: number, protein: number): FoodEntry => ({ id: `f${++n}`, date, kcal, protein, at: n });
const day = (date: string, status: FoodDay['status'], kcalTarget = 2000, proteinTarget = 180): FoodDay => ({
  date,
  status,
  kcalTarget,
  proteinTarget,
});

describe('food', () => {
  it('#9 three adds stack; editing or deleting one updates the total', () => {
    let entries = [entry(T0, 500, 40), entry(T0, 640, 45), entry(T0, 100, 10)];
    expect(totalsFor(entries, T0)).toEqual({ kcal: 1240, protein: 95 });
    entries = entries.map((e, i) => (i === 1 ? { ...e, kcal: 700 } : e));
    expect(totalsFor(entries, T0).kcal).toBe(1300);
    entries = entries.filter((_, i) => i !== 2);
    expect(totalsFor(entries, T0)).toEqual({ kcal: 1200, protein: 85 });
  });

  it('#10 unclosed day with entries → close-out prompt; empty open day auto-closes', () => {
    const yesterday = addDays(T0, -1);
    const twoAgo = addDays(T0, -2);
    const days = [day(twoAgo, 'open'), day(yesterday, 'open'), day(T0, 'open')];
    const entries = [entry(yesterday, 1850, 172), entry(T0, 300, 20)];
    const p = pendingCloseOuts(days, entries, T0);
    expect(p.prompt.map((d) => d.date)).toEqual([yesterday]);
    expect(p.autoIncomplete.map((d) => d.date)).toEqual([twoAgo]);
  });

  it('day marks: ✅ both, 🟡 one, ❌ neither, ⚪ incomplete; at-or-under kcal, at-or-over protein', () => {
    expect(dayMark(day(T0, 'complete'), { kcal: 2000, protein: 180 })).toBe('both');
    expect(dayMark(day(T0, 'complete'), { kcal: 2001, protein: 180 })).toBe('one');
    expect(dayMark(day(T0, 'complete'), { kcal: 2100, protein: 150 })).toBe('none');
    expect(dayMark(day(T0, 'incomplete'), { kcal: 1800, protein: 190 })).toBe('incomplete');
    expect(dayMark(undefined, { kcal: 0, protein: 0 })).toBe('incomplete');
  });

  it('uses the target in effect that day', () => {
    // Target was 2200 that day; editing to 2000 later doesn't change the mark.
    expect(dayMark(day(T0, 'complete', 2200), { kcal: 2100, protein: 180 })).toBe('both');
  });

  it('#11 7- and 30-day hit rates, kcal and protein separately, confirmed days only', () => {
    const days: FoodDay[] = [];
    const entries: FoodEntry[] = [];
    // last 7 days: 5 confirmed (kcal hit 5/5, protein hit 4/5) + 1 incomplete (excluded)
    for (let i = 0; i < 5; i++) {
      const d = addDays(T0, -i);
      days.push(day(d, 'complete'));
      entries.push(entry(d, 1900, i === 0 ? 150 : 185));
    }
    days.push(day(addDays(T0, -5), 'incomplete'));
    entries.push(entry(addDays(T0, -5), 3000, 50));
    // day 20 ago: confirmed, missed both (in 30, not in 7)
    days.push(day(addDays(T0, -20), 'complete'));
    entries.push(entry(addDays(T0, -20), 2500, 100));
    // day 40 ago: outside both windows
    days.push(day(addDays(T0, -40), 'complete'));

    const r7 = hitRates(days, entries, T0, 7);
    expect(r7.kcal).toEqual({ hit: 5, of: 5 });
    expect(r7.protein).toEqual({ hit: 4, of: 5 });
    expect(pct(r7.protein)).toBe(80);
    const r30 = hitRates(days, entries, T0, 30);
    expect(r30.kcal).toEqual({ hit: 5, of: 6 });
    expect(r30.protein).toEqual({ hit: 4, of: 6 });
    expect(pct({ hit: 0, of: 0 })).toBe(null);
  });

  it('Q11: day rolls over at 3 a.m.', () => {
    expect(dayKey(new Date(2026, 10, 10, 0, 30).getTime())).toBe('2026-11-09');
    expect(dayKey(new Date(2026, 10, 10, 2, 59).getTime())).toBe('2026-11-09');
    expect(dayKey(new Date(2026, 10, 10, 3, 0).getTime())).toBe('2026-11-10');
  });
});
