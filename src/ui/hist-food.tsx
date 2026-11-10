// History → Food: 7/30-day hit rates (kcal and protein separately) and the list of past days.
import { useState } from 'preact/hooks';
import type { DayKey, FoodDay, FoodEntry } from '../data/types';
import * as db from '../data/db';
import { formatDay } from '../logic/dates';
import { MARK_EMOJI, dayMark, hitRates, pct, totalsFor } from '../logic/food';
import { Sheet, fmtInt, useDb } from './common';
import { posNum } from './hist-util';

const STATUS: Record<FoodDay['status'], string> = {
  open: 'Not closed yet',
  complete: 'Confirmed',
  incomplete: 'Marked incomplete',
};

export function FoodHistory(props: { today: DayKey }) {
  const { today } = props;
  const data = useDb(() => Promise.all([db.listFoodDays(), db.allFood(), db.getSettings()]), []);
  const [open, setOpen] = useState<DayKey | null>(null);
  if (!data) return null;
  const [days, food, settings] = data;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = [...new Set([...days.map((d) => d.date), ...food.map((e) => e.date)])]
    .filter((d) => d <= today)
    .sort((a, b) => b.localeCompare(a));
  const targetsOf = (d: DayKey) => byDate.get(d) ?? { kcalTarget: settings.kcalTarget, proteinTarget: settings.proteinTarget };

  const rateLine = (n: number) => {
    const r = hitRates(days, food, today, n);
    if (!r.kcal.of) return `Last ${n} days: —`;
    return (
      <>
        Last {n} days: kcal {pct(r.kcal)}% · protein {pct(r.protein)}%{' '}
        <span class="muted hist-nowrap">
          ({r.kcal.of} day{r.kcal.of === 1 ? '' : 's'})
        </span>
      </>
    );
  };

  return (
    <div>
      <div class="card hist-rates">
        <div>{rateLine(7)}</div>
        <div>{rateLine(30)}</div>
        <div class="muted hist-small">Confirmed days only.</div>
      </div>
      {!dates.length && <p class="muted hist-empty">No food logged yet.</p>}
      <div class="stack hist-days">
        {dates.map((d) => {
          const t = totalsFor(food, d);
          const tg = targetsOf(d);
          return (
            <button key={d} class="card hist-day" onClick={() => setOpen(d)}>
              <span class="hist-mark">{MARK_EMOJI[dayMark(byDate.get(d), t)]}</span>
              <span class="spacer">
                <span class="hist-day-date">{d === today ? 'Today' : formatDay(d)}</span>
                <span class="muted hist-small">
                  {fmtInt(t.kcal)} / {fmtInt(tg.kcalTarget)} kcal · {fmtInt(t.protein)} / {fmtInt(tg.proteinTarget)}g
                </span>
              </span>
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

/** Add a forgotten entry to a past, still-open day. */
function AddRow(props: { date: DayKey }) {
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
