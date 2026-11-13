// History → Food: running deficit + protein for this week and this month (confirmed days only),
// then the list of days. Deficit = maintenance (sedentary TDEE, Settings) − calories eaten,
// before exercise; ≈ lbs uses 3,500 kcal per lb.
import { useState } from 'preact/hooks';
import type { DayKey, FoodDay, FoodEntry } from '../data/types';
import * as db from '../data/db';
import { formatDay } from '../logic/dates';
import {
  DEFAULT_MAINTENANCE,
  MARK_EMOJI,
  PROTEIN_EMOJI,
  dayMark,
  monthStart,
  periodSummary,
  proteinMark,
  totalsFor,
  type PeriodSummary,
} from '../logic/food';
import { weekStart } from '../logic/week';
import { Sheet, fmtInt, useDb } from './common';
import { posNum } from './hist-util';

const STATUS: Record<FoodDay['status'], string> = {
  open: 'Not closed yet',
  complete: 'Confirmed',
  incomplete: 'Marked incomplete',
};

/** "−1,000 kcal" for a deficit, "+300 kcal" for a surplus. */
const signedKcal = (deficit: number) => `${deficit >= 0 ? '−' : '+'}${fmtInt(Math.abs(deficit))}`;

function SummaryCard(props: { title: string; s: PeriodSummary }) {
  const { title, s } = props;
  return (
    <div class="card hist-summary">
      <div class="row">
        <b class="spacer">{title}</b>
        <span class="muted hist-small">
          {s.days} confirmed day{s.days === 1 ? '' : 's'}
        </span>
      </div>
      {s.days === 0 ? (
        <div class="muted hist-small">No confirmed days yet.</div>
      ) : (
        <>
          <div class="row hist-sum-row">
            <span class="muted hist-sum-label">{s.deficit >= 0 ? 'Deficit' : 'Surplus'}</span>
            <span class={'hist-sum-big ' + (s.deficit >= 0 ? 'hist-up' : 'hist-down')}>{signedKcal(s.deficit)} kcal</span>
            <span class="muted">≈ {Math.abs(s.lbs).toFixed(1)} lb</span>
          </div>
          <div class="row hist-sum-row">
            <span class="muted hist-sum-label">Protein</span>
            <span>
              {s.protein.hit} hit · {s.protein.near} within 90% · {s.protein.under} under
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function FoodHistory(props: { today: DayKey }) {
  const { today } = props;
  const data = useDb(() => Promise.all([db.listFoodDays(), db.allFood(), db.getSettings()]), []);
  const [open, setOpen] = useState<DayKey | null>(null);
  if (!data) return null;
  const [days, food, settings] = data;
  const maintenance = settings.maintenanceKcal ?? DEFAULT_MAINTENANCE;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = [...new Set([...days.map((d) => d.date), ...food.map((e) => e.date)])]
    .filter((d) => d <= today)
    .sort((a, b) => b.localeCompare(a));
  const targetsOf = (d: DayKey) => byDate.get(d) ?? { kcalTarget: settings.kcalTarget, proteinTarget: settings.proteinTarget };
  const monthName = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { month: 'long' });

  return (
    <div>
      <div class="stack">
        <SummaryCard title="This week" s={periodSummary(days, food, weekStart(today), today, maintenance)} />
        <SummaryCard title={monthName} s={periodSummary(days, food, monthStart(today), today, maintenance)} />
        <div class="muted hist-small">
          vs {fmtInt(maintenance)} kcal/day maintenance, before exercise · confirmed days only
        </div>
      </div>
      {!dates.length && <p class="muted hist-empty">No food logged yet.</p>}
      <div class="stack hist-days">
        {dates.map((d) => {
          const t = totalsFor(food, d);
          const fd = byDate.get(d);
          const status = fd?.status ?? 'open';
          return (
            <button key={d} class="card hist-day" onClick={() => setOpen(d)}>
              <span class="hist-day-date spacer">{d === today ? 'Today' : formatDay(d)}</span>
              {status === 'incomplete' ? (
                <span class="muted">⚪ incomplete</span>
              ) : (
                <span class="hist-day-nums">
                  <span>{fmtInt(t.kcal)} kcal</span>
                  <span class={status === 'complete' ? (maintenance - t.kcal >= 0 ? 'hist-up' : 'hist-down') : 'muted'}>
                    {status === 'complete' ? signedKcal(maintenance - t.kcal) : d === today ? 'today' : 'open'}
                  </span>
                  <span>
                    {fmtInt(t.protein)}g {PROTEIN_EMOJI[proteinMark(targetsOf(d).proteinTarget, t.protein)]}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {open && (
        <DaySheet
          date={open}
          today={today}
          day={byDate.get(open)}
          entries={food.filter((e) => e.date === open)}
          targets={targetsOf(open)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function DaySheet(props: {
  date: DayKey;
  today: DayKey;
  day: FoodDay | undefined;
  entries: FoodEntry[];
  targets: { kcalTarget: number; proteinTarget: number };
  onClose: () => void;
}) {
  const { date, day, entries, targets } = props;
  const status = day?.status ?? 'open';
  const t = totalsFor(entries, date);
  const [edit, setEdit] = useState<string | null>(null);
  const close = (s: 'complete' | 'incomplete') => db.closeDay(date, s).then(props.onClose);

  return (
    <Sheet onClose={props.onClose}>
      <div class="row">
        <h2 class="spacer" style={{ margin: 0 }}>
          {MARK_EMOJI[dayMark(day, t)]} {formatDay(date)}
        </h2>
        <span class="muted hist-small">{STATUS[status]}</span>
      </div>
      <p class="hist-sheet-totals">
        {fmtInt(t.kcal)} / {fmtInt(targets.kcalTarget)} kcal · {fmtInt(t.protein)} / {fmtInt(targets.proteinTarget)}g protein
      </p>

      {entries.length > 0 && (
        <ul class="hist-entries">
          {entries.map((e) =>
            edit === e.id ? (
              <EntryEditor key={e.id} entry={e} onDone={() => setEdit(null)} />
            ) : (
              <li key={e.id}>
                {status === 'open' ? (
                  <button class="hist-entry" onClick={() => setEdit(e.id)}>
                    {fmtInt(e.kcal)} kcal · {fmtInt(e.protein)}g
                  </button>
                ) : (
                  <span class="hist-entry">
                    {fmtInt(e.kcal)} kcal · {fmtInt(e.protein)}g
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {status === 'open' && date < props.today && <AddRow date={date} />}

      <div class="stack hist-sheet-actions">
        {status !== 'open' ? (
          <button class="block" onClick={() => db.reopenDay(date)}>
            Reopen
          </button>
        ) : (
          date < props.today && (
            <>
              <button class="primary block" onClick={() => close('complete')}>
                Confirm
              </button>
              <button class="block" onClick={() => close('incomplete')}>
                Mark incomplete
              </button>
            </>
          )
        )}
        <button class="ghost block" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** Fix a past day's entry (only while the day is open). */
function EntryEditor(props: { entry: FoodEntry; onDone: () => void }) {
  const [kcal, setKcal] = useState(String(props.entry.kcal));
  const [protein, setProtein] = useState(String(props.entry.protein));
  const save = () => {
    const k = Number(kcal) || 0;
    const p = Number(protein) || 0;
    db.updateFood({ ...props.entry, kcal: k, protein: p }).then(props.onDone);
  };
  return (
    <li class="hist-entry-edit">
      <div class="row">
        <input type="number" inputMode="numeric" value={kcal} onInput={(e) => setKcal(e.currentTarget.value)} aria-label="Calories" />
        <input type="number" inputMode="numeric" value={protein} onInput={(e) => setProtein(e.currentTarget.value)} aria-label="Protein (g)" />
      </div>
      <div class="row">
        <button class="primary spacer" onClick={save}>
          Save
        </button>
        <button class="danger" onClick={() => db.deleteFood(props.entry.id).then(props.onDone)}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** Add a forgotten entry to a past, still-open day (History day sheet and the close-out prompt). */
export function AddRow(props: { date: DayKey }) {
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const add = () => {
    const k = posNum(kcal) ?? 0;
    const p = posNum(protein) ?? 0;
    if (!k && !p) return;
    db.addFood(props.date, k, p).then(() => {
      setKcal('');
      setProtein('');
    });
  };
  return (
    <div class="row hist-add">
      <input type="number" inputMode="numeric" placeholder="kcal" value={kcal} onInput={(e) => setKcal(e.currentTarget.value)} />
      <input type="number" inputMode="numeric" placeholder="protein g" value={protein} onInput={(e) => setProtein(e.currentTarget.value)} />
      <button onClick={add}>+ Add</button>
    </div>
  );
}
