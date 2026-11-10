import type { DayKey } from '../data/types';

/** The day rolls over at 3 a.m.: a 12:30 a.m. snack counts toward the day before. */
export const ROLLOVER_HOUR = 3;

const pad = (n: number) => String(n).padStart(2, '0');

/** DayKey for a timestamp, in local time, with the 3 a.m. rollover. */
export function dayKey(ts: number = Date.now()): DayKey {
  const d = new Date(ts);
  d.setHours(d.getHours() - ROLLOVER_HOUR);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toUTC(k: DayKey): number {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

export function addDays(k: DayKey, n: number): DayKey {
  const d = new Date(toUTC(k) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "Mon Nov 9" */
export function formatDay(k: DayKey): string {
  const d = new Date(toUTC(k));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
}
