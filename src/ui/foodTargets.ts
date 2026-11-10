// Small helper shared by Home and Food: today's totals and the targets in effect today.
import * as db from '../data/db';
import type { DayKey, FoodDay, FoodEntry } from '../data/types';
import { totalsFor, type Totals } from '../logic/food';

export interface TodayFood {
  entries: FoodEntry[];
  totals: Totals;
  kcalTarget: number;
  proteinTarget: number;
  /** undefined until the first add of the day creates it. */
  day: FoodDay | undefined;
}

export async function loadTodayFood(today: DayKey): Promise<TodayFood> {
  const [entries, days, settings] = await Promise.all([db.foodFor(today), db.listFoodDays(), db.getSettings()]);
  const day = days.find((d) => d.date === today);
  return {
    entries: [...entries].sort((a, b) => a.at - b.at),
    totals: totalsFor(entries, today),
    kcalTarget: day?.kcalTarget ?? settings.kcalTarget,
    proteinTarget: day?.proteinTarget ?? settings.proteinTarget,
    day,
  };
}
