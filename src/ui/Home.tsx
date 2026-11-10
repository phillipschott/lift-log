import * as db from '../data/db';
import type { DayKey } from '../data/types';
import type { Screen } from '../app';
import { fmtInt, useDb } from './common';
import { loadTodayFood } from './foodTargets';

export function Home(props: { today: DayKey; go: (s: Screen) => void }) {
  const { today, go } = props;
  const routine = useDb(() => db.getRoutine(), []);
  const food = useDb(() => loadTodayFood(today), [today]);
  const boxedToday = useDb(
    async () => (await db.listWorkouts()).some((w) => w.date === today && w.boxingDone),
    [today],
  );

  return (
    <div class="screen home">
      <div class="row">
        <h1 class="spacer">Lift Log</h1>
        <button class="ghost small-link" onClick={() => go({ name: 'settings' })}>
          Settings
        </button>
      </div>

      {food && (
        <button class="card food-card" onClick={() => go({ name: 'food' })}>
          <div class="food-line">
            <b>{fmtInt(food.totals.kcal)}</b>
            <span class="muted"> / {fmtInt(food.kcalTarget)} kcal</span>
          </div>
          <div class="food-line">
            <b>{fmtInt(food.totals.protein)}</b>
            <span class="muted"> / {fmtInt(food.proteinTarget)}g protein</span>
          </div>
          <div class="muted food-hint">Tap to add food ›</div>
        </button>
      )}

      <div class="spacer" />

      <div class="day-list">
        {routine?.days.map((d) => (
          <button
            key={d.id}
            class={'day-btn' + (d.kind === 'boxing' ? ' boxing' : '')}
            onClick={() => go({ name: 'workout', dayId: d.id })}
          >
            <span class="spacer">{d.name}</span>
            {d.kind === 'boxing' && boxedToday && <span class="done-mark">✓ today</span>}
          </button>
        ))}
      </div>

      <button class="block history-btn" onClick={() => go({ name: 'history' })}>
        History
      </button>
    </div>
  );
}
