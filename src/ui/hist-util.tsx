// Small helpers shared by the History and Settings screens.
import type { DayKey, ExerciseLog, Load } from '../data/types';

/** "Nov 9" (adds the year when it isn't the current one: "Nov 9, 2025"). */
export function shortDay(k: DayKey, today: DayKey): string {
  const [y, m, d] = k.split('-').map(Number);
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return k.slice(0, 4) === today.slice(0, 4) ? s : `${s}, ${y}`;
}

/** Oldest first; same-day sessions by when their first set was logged. */
export function byDate(logs: ExerciseLog[]): ExerciseLog[] {
  return [...logs].sort((a, b) => a.date.localeCompare(b.date) || (a.sets[0]?.at ?? 0) - (b.sets[0]?.at ?? 0));
}

/** Heaviest load logged in a session. */
export function topLoad(log: ExerciseLog): Load | null {
  let top: Load | null = null;
  for (const s of log.sets) if (!top || s.load.value > top.value) top = s.load;
  return top;
}

/** "+10", "−2.5", "±0" */
export function signed(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : '±0';
}

/** Parse a number input; null when empty or not a positive number. */
export function posNum(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}
