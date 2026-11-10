import * as db from '../data/db';
import type { DayKey } from '../data/types';
import type { Screen } from '../app';
import { BOXING_PER_WEEK, weekStatus } from '../logic/week';
import { fmtInt, useDb } from './common';
import { loadTodayFood } from './foodTargets';

export function Home(props: { today: DayKey; go: (s: Screen) => void }) {
  const { today, go } = props;
  const routine = useDb(() => db.getRoutine(), []);
  const food = useDb(() => loadTodayFood(today), [today]);
  const week = useDb(
    async () => weekStatus(await db.getRoutine(), await db.listWorkouts(), await db.allLogs(), today),
    [today],
  );
  const next = week?.upNext ? routine?.days.find((d) => d.id === week.upNext) : undefined;
  const others = routine?.days.filter((d) => d.id !== next?.id) ?? [];
  const todo = others.filter((d) => !week?.done.has(d.id));
  const doneDays = others.filter((d) => week?.done.has(d.id));

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

      {routine && week && (
        <>
          {next ? (
            <button class="card up-next" onClick={() => go({ name: 'workout', dayId: next.id })}>
              <span class="muted up-next-label">{week.upNextStarted ? 'Today' : 'Up next'}</span>
              <span class="row">
                <span class="spacer up-next-name">{next.name}</span>
                <span aria-hidden="true">›</span>
              </span>
            </button>
          ) : (
            <div class="card up-next week-done">
              {routine.days.every((d) => d.kind !== 'boxing' || week.done.has(d.id)) ? 'Week done 💪' : 'Lifts done 💪'}
            </div>
          )}

          {/* To do (routine order), then a dimmed "Done this week" group at the bottom. */}
          <div class="day-list">
            {todo.map((d) => (
              <button
                key={d.id}
                class={'day-btn' + (d.kind === 'boxing' ? ' boxing' : '')}
                onClick={() => go({ name: 'workout', dayId: d.id })}
              >
                <span class="spacer">{d.name}</span>
                {d.kind === 'boxing' && week.boxing.get(d.id) ? (
                  <span>
                    {week.boxing.get(d.id)}/{BOXING_PER_WEEK}
                  </span>
                ) : null}
              </button>
            ))}
            {doneDays.length > 0 && <div class="group-label">Done this week</div>}
            {doneDays.map((d) => (
              <button key={d.id} class="day-btn done" onClick={() => go({ name: 'workout', dayId: d.id })}>
                <span class="spacer">{d.name}</span>
                <span class="done-word">✓ Done</span>
              </button>
            ))}
          </div>
        </>
      )}

      <button class="block history-btn" onClick={() => go({ name: 'history' })}>
        History
      </button>
    </div>
  );
}
