// Tiny hand-rolled SVG line chart: top weight per session over time.
import type { DayKey, Load } from '../data/types';
import { daysBetween } from '../logic/dates';
import { formatLoad } from '../logic/flags';
import { shortDay } from './hist-util';

export interface Point {
  date: DayKey;
  load: Load;
}

const W = 340;
const H = 170;
const L = 58; // room for weight labels
const R = 14;
const T = 14;
const B = 30; // room for date labels

export function WeightChart(props: { points: Point[]; today: DayKey }) {
  const pts = props.points;
  if (pts.length === 0) return null;
  const first = pts[0].date;
  const last = pts[pts.length - 1].date;
  const span = daysBetween(first, last);
  const values = pts.map((p) => p.load.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minLoad = pts.find((p) => p.load.value === min)!.load;
  const maxLoad = pts.find((p) => p.load.value === max)!.load;

  const plotW = W - L - R;
  const plotH = H - T - B;
  const x = (d: DayKey) => (span === 0 ? L + plotW / 2 : L + (daysBetween(first, d) / span) * plotW);
  const y = (v: number) => (max === min ? T + plotH / 2 : T + ((max - v) / (max - min)) * plotH);
  const line = pts.map((p) => `${x(p.date).toFixed(1)},${y(p.load.value).toFixed(1)}`).join(' ');
  const flat = max === min;

  return (
    <svg class="hist-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Working weight from ${formatLoad(pts[0].load)} to ${formatLoad(pts[pts.length - 1].load)}`}>
      {/* guide lines at max and min */}
      <line class="hist-grid" x1={L} x2={W - R} y1={y(max)} y2={y(max)} />
      {!flat && <line class="hist-grid" x1={L} x2={W - R} y1={y(min)} y2={y(min)} />}
      <text class="hist-axis" x={L - 8} y={y(max) + 4} text-anchor="end">
        {formatLoad(maxLoad)}
      </text>
      {!flat && (
        <text class="hist-axis" x={L - 8} y={y(min) + 4} text-anchor="end">
          {formatLoad(minLoad)}
        </text>
      )}
      <text class="hist-axis" x={L} y={H - 8} text-anchor={span === 0 ? 'middle' : 'start'} dx={span === 0 ? plotW / 2 : 0}>
        {shortDay(first, props.today)}
      </text>
      {span > 0 && (
        <text class="hist-axis" x={W - R} y={H - 8} text-anchor="end">
          {shortDay(last, props.today)}
        </text>
      )}
      {pts.length > 1 && <polyline class="hist-line" points={line} />}
      {pts.map((p, i) => (
        <circle key={i} class="hist-dot" cx={x(p.date)} cy={y(p.load.value)} r={4} />
      ))}
    </svg>
  );
}
