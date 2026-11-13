import { useState } from 'preact/hooks';
import * as db from '../data/db';
import type { FoodDay, FoodEntry } from '../data/types';
import { formatDay } from '../logic/dates';
import { totalsFor } from '../logic/food';
import { fmtInt } from './common';
import { AddRow } from './hist-food';

/** Shown before anything else when an earlier day with food entries is still open. */
export function CloseOut(props: { day: FoodDay; entries: FoodEntry[] }) {
  const { day } = props;
  const t = totalsFor(props.entries, day.date);
  const [busy, setBusy] = useState(false);
  const close = async (status: 'complete' | 'incomplete') => {
    if (busy) return;
    setBusy(true);
    try {
      await db.closeDay(day.date, status);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="screen closeout">
      <div class="spacer" />
      <h1>Close out {formatDay(day.date)}?</h1>
      <p class="closeout-totals">
        {fmtInt(t.kcal)} / {fmtInt(day.kcalTarget)} kcal · {fmtInt(t.protein)} / {fmtInt(day.proteinTarget)}g
      </p>
      <div class="closeout-add">
        <div class="muted">+ Add forgotten food</div>
        <AddRow date={day.date} />
      </div>
      <div class="spacer" />
      <div class="stack">
        <button class="primary block big" disabled={busy} onClick={() => close('complete')}>
          Confirm
        </button>
        <button class="block big" disabled={busy} onClick={() => close('incomplete')}>
          Mark incomplete
        </button>
      </div>
    </div>
  );
}
