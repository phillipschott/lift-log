// History → Progress: one glance page. Weeks (lift days + boxing), Lifts (start → current +
// sparkline), Macros (protein / kcal hit days per week). Hand-rolled SVG, no hover needed:
// every number that matters is printed, and each chart has a text summary for VoiceOver.
import { useState } from 'preact/hooks';
import type { DayKey, Exercise, ExerciseLog } from '../data/types';
import * as db from '../data/db';
import { daysBetween } from '../logic/dates';
import { formatLoad, stateForSlot } from '../logic/flags';
import {
  boxingPerWeek,
  firstRecordDate,
  liftDaysPerWeek,
  macroHitsPerWeek,
  topWeightSeries,
  weekBuckets,
  type Range,
  type SeriesPoint,
  RANGE_WEEKS,
} from '../logic/progress';
import { BOXING_PER_WEEK } from '../logic/week';
import { useDb } from './common';
import { byDate, shortDay, signed } from './hist-util';

const RANGE_KEY = 'lift-log.progress-range';

function loadRange(): Range {
  try {
    return localStorage.getItem(RANGE_KEY) === 'all' ? 'all' : '12w';
  } catch {
    return '12w';
  }
}
function saveRange(r: Range) {
  try {
    localStorage.setItem(RANGE_KEY, r);
  } catch {
    /* fine if lost */
  }
}

export function Progress(props: { today: DayKey; onPick: (exId: string) => void }) {
  const { today } = props;
  const [range, setRange] = useState<Range>(loadRange);
  const data = useDb(
    () => Promise.all([db.listExercises(), db.allLogs(), db.listWorkouts(), db.listFoodDays(), db.allFood(), db.getRoutine()]),
    [],
  );
  if (!data) return null;
  const [exercises, logs, workouts, foodDays, food, routine] = data;

  const weeks = weekBuckets(today, range, firstRecordDate(logs, workouts, foodDays, food));
  const liftDays = routine.days.filter((d) => d.kind === 'lift').length || 4;
  const lifts = liftDaysPerWeek(weeks, logs, today);
  const boxing = boxingPerWeek(weeks, workouts, today);
  const macros = macroHitsPerWeek(weeks, foodDays, food, today);
  const anyWorkout = logs.some((l) => l.sets.length) || workouts.some((w) => w.boxingDone);
  const tracked = macros.map((m) => m.confirmed > 0);
  const anyConfirmed = foodDays.some((d) => d.status === 'complete');
  const pick = (r: Range) => {
    setRange(r);
    saveRange(r);
  };

  return (
    <div class="prog">
      <div class="prog-range" role="group" aria-label="Range">
        {(['12w', 'all'] as const).map((r) => (
          <button key={r} aria-pressed={range === r} class={range === r ? 'on' : ''} onClick={() => pick(r)}>
            {r === '12w' ? `${RANGE_WEEKS} wk` : 'All'}
          </button>
        ))}
      </div>

      <h2 class="prog-h">Weeks</h2>
      {anyWorkout ? (
        <div class="card prog-card">
          <ChartHead label="Lift days" values={lifts} max={liftDays} />
          <WeekBars name="Lift days" values={lifts} max={liftDays} weeks={weeks} today={today} height={92} />
          <ChartHead label="Boxing" values={boxing} max={BOXING_PER_WEEK} />
          <WeekBars name="Boxing sessions" values={boxing} max={BOXING_PER_WEEK} weeks={weeks} today={today} height={46} />
          <WeekAxis weeks={weeks} today={today} />
        </div>
      ) : (
        <p class="muted prog-empty">No workouts yet.</p>
      )}

      <h2 class="prog-h">Lifts</h2>
      <LiftRows exercises={exercises} logs={logs} from={weeks[0]} today={today} onPick={props.onPick} />

      <h2 class="prog-h">Macros</h2>
      {anyConfirmed ? (
        <div class="card prog-card">
          <ChartHead label="Protein hit" values={macros.map((m) => m.protein)} max={7} counted={tracked} />
          <WeekBars name="Days hitting protein" values={macros.map((m) => m.protein)} max={7} weeks={weeks} today={today} height={70} counted={tracked} />
          <ChartHead label="Calories at/under" values={macros.map((m) => m.kcal)} max={7} counted={tracked} />
          <WeekBars name="Days at or under calories" values={macros.map((m) => m.kcal)} max={7} weeks={weeks} today={today} height={70} counted={tracked} />
          <WeekAxis weeks={weeks} today={today} />
          <p class="muted prog-note">Confirmed days only.</p>
        </div>
      ) : (
        <p class="muted prog-empty">No confirmed food days yet.</p>
      )}
    </div>
  );
}

/** "Lift days            this wk 2/4 · avg 3.1" */
function ChartHead(props: { label: string; values: number[]; max: number; counted?: boolean[] }) {
  const v = props.values;
  const now = v[v.length - 1] ?? 0;
  // Average over finished weeks only (and, for macros, only weeks that had a confirmed day).
  const past = v.slice(0, -1).filter((_, i) => props.counted?.[i] ?? true);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  return (
    <div class="prog-head">
      <span class="prog-label">{props.label}</span>
      <span class="muted prog-sum">
        {avg !== null && <>avg {avg.toFixed(1)} · </>}
        this wk <b class="prog-now">{now}</b>/{props.max}
      </span>
    </div>
  );
}

// ---------- weekly bars ----------

const W = 326; // ≈ card content width at 390px, so 1 viewBox unit ≈ 1 CSS px
const TOP = 18; // room for the value label above a bar

/** Slot geometry shared by bars and the axis so columns line up. ≤12 weeks: fixed 12-slot grid, filling left → right. */
function slots(n: number) {
  const slot = W / Math.max(n, RANGE_WEEKS);
  const bar = Math.min(24, Math.max(2, slot - Math.max(2, slot * 0.35)));
  return { slot, bar, cx: (i: number) => slot * i + slot / 2 };
}

/** Column with a rounded 4px top, square at the baseline. */
function colPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** `counted[i] === false` = nothing to measure that week (no confirmed food days): faint track, no number. */
function WeekBars(props: { name: string; values: number[]; max: number; weeks: DayKey[]; today: DayKey; height: number; counted?: boolean[] }) {
  const { values, max, weeks, today } = props;
  const n = values.length;
  const { slot, bar, cx } = slots(n);
  const plotH = props.height - TOP;
  const showValues = slot >= 13; // values are single digits (≤7)
  const cur = n - 1;
  const y = (v: number) => TOP + plotH - (Math.min(v, max) / max) * plotH;
  const summary =
    `${props.name} per week, out of ${max}: ` +
    values
      .map((v, i) => `${i === cur ? 'this week so far' : 'week of ' + shortDay(weeks[i], today)} ${props.counted?.[i] === false && i !== cur ? 'not tracked' : v}`)
      .join(', ');

  return (
    <svg class="prog-svg" viewBox={`0 0 ${W} ${props.height}`} role="img" aria-label={summary}>
      {values.map((v, i) => {
        const x = cx(i) - bar / 2;
        const off = props.counted?.[i] === false && i !== cur;
        return (
          <g key={weeks[i]}>
            <rect class={off ? 'prog-track off' : 'prog-track'} x={x} y={TOP} width={bar} height={plotH} rx={Math.min(4, bar / 2)} />
            {v > 0 && <path class={i === cur ? 'prog-bar now' : 'prog-bar'} d={colPath(x, y(v), bar, TOP + plotH - y(v))} />}
            {showValues && !off && (
              <text class={i === cur ? 'prog-val now' : 'prog-val'} x={cx(i)} y={TOP - 5} text-anchor="middle">
                {v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Date labels under the columns: first week, this week, and one in between when there's room. */
function WeekAxis(props: { weeks: DayKey[]; today: DayKey }) {
  const { weeks, today } = props;
  const n = weeks.length;
  const { cx } = slots(n);
  const MIN_GAP = 64;
  const marks: { i: number; text: string }[] = [{ i: n - 1, text: 'This wk' }];
  if (n > 1 && cx(n - 1) - cx(0) >= MIN_GAP) marks.unshift({ i: 0, text: shortDay(weeks[0], today) });
  const mid = Math.floor((n - 1) / 2);
  if (n > 4 && cx(mid) - cx(0) >= MIN_GAP && cx(n - 1) - cx(mid) >= MIN_GAP) marks.splice(1, 0, { i: mid, text: shortDay(weeks[mid], today) });
  const anchor = (i: number) => {
    const x = cx(i);
    return x < 28 ? 'start' : x > W - 28 ? 'end' : 'middle';
  };
  const ax = (i: number) => {
    const a = anchor(i);
    return a === 'start' ? Math.max(0, cx(i) - 12) : a === 'end' ? Math.min(W, cx(i) + 12) : cx(i);
  };
  return (
    <svg class="prog-svg prog-axis" viewBox={`0 0 ${W} 20`} aria-hidden="true">
      {marks.map((m) => (
        <text key={m.i} class="prog-tick" x={ax(m.i)} y={15} text-anchor={anchor(m.i)}>
          {m.text}
        </text>
      ))}
    </svg>
  );
}

// ---------- lifts ----------

function LiftRows(props: { exercises: Exercise[]; logs: ExerciseLog[]; from: DayKey; today: DayKey; onPick: (id: string) => void }) {
  const { today } = props;
  const exById = new Map(props.exercises.map((e) => [e.id, e]));
  const rows = topWeightSeries(props.logs, props.from)
    .filter((s) => exById.has(s.exerciseId))
    .map((s) => {
      const ex = exById.get(s.exerciseId)!;
      const logs = props.logs.filter((l) => l.exerciseId === ex.id && l.sets.length);
      const start = ex.start ?? byDate(logs)[0].sets[0].load;
      const current = stateForSlot(ex, undefined, undefined, logs, today).working;
      const change = current ? signed(current.value - start.value) : '';
      return { ex, s, start, current, change };
    });
  if (!rows.length) return <p class="muted prog-empty">No lifts logged yet.</p>;

  return (
    <div class="prog-lifts">
      {rows.map((r) => (
        <button
          key={r.ex.id}
          class="prog-lift"
          onClick={() => props.onPick(r.ex.id)}
          aria-label={`${r.ex.name}: ${formatLoad(r.start)} to ${formatLoad(r.current)}, ${r.s.points.length} session${r.s.points.length === 1 ? '' : 's'} in range. Open details.`}
        >
          <span class="prog-lift-text">
            <span class="prog-lift-name">{r.ex.name}</span>
            <span class="prog-lift-load">
              {formatLoad(r.start)} → <b>{formatLoad(r.current)}</b>{' '}
              {r.change && r.change !== '±0' && <span class={r.change.startsWith('+') ? 'hist-up' : 'hist-down'}>{r.change}</span>}
            </span>
          </span>
          <Spark points={r.s.points} from={props.from} today={today} />
          <span class="prog-chev" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </div>
  );
}

const SW = 92;
const SH = 34;
const SP = 5; // inset so the end dot isn't clipped

/** Top weight per session, x by date across the range so sparklines line up in time. */
function Spark(props: { points: SeriesPoint[]; from: DayKey; today: DayKey }) {
  const pts = props.points;
  if (!pts.length)
    return (
      <span class="prog-spark prog-spark-none muted" aria-hidden="true">
        —
      </span>
    );
  const span = Math.max(1, daysBetween(props.from, props.today));
  const vals = pts.map((p) => p.load.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (d: DayKey) => SP + (daysBetween(props.from, d) / span) * (SW - 2 * SP);
  const y = (v: number) => (max === min ? SH / 2 : SP + ((max - v) / (max - min)) * (SH - 2 * SP));
  const last = pts[pts.length - 1];
  return (
    <svg class="prog-spark" viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">
      <line class="prog-spark-base" x1={SP} x2={SW - SP} y1={SH - 1} y2={SH - 1} />
      {pts.length > 1 && <polyline class="prog-spark-line" points={pts.map((p) => `${x(p.date).toFixed(1)},${y(p.load.value).toFixed(1)}`).join(' ')} />}
      <circle class="prog-spark-dot" cx={x(last.date)} cy={y(last.load.value)} r={4} />
    </svg>
  );
}
