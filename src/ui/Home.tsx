import * as db from '../data/db';
import type { DayKey, RoutineDay } from '../data/types';
import type { Screen } from '../app';
import { BOXING_PER_WEEK, weekStatus } from '../logic/week';
import { fmtInt, useDb } from './common';
import { loadTodayFood } from './foodTargets';

/** "Day 3 — Legs" → "Legs" */
const shortName = (d: RoutineDay) => d.name.split('—').pop()!.trim();

export function Home(props: { today: DayKey; go: (s: Screen) => void }) {
  const { today, go } = props;
  const routine = useDb(() => db.getRoutine(), []);
  const food = useDb(() => loadTodayFood(today), [today]);
  const week = useDb(
    async () => weekStatus(await db.getRoutine(), await db.listWorkouts(), await db.allLogs(), today),
    [today],
  );
  const next = week?.upNext ? routine?.days.find((d) => d.id === week.upNext) : undefined;

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
          <div class="week-strip" aria-label="This week">
            <span class="muted">This week</span>
            {routine.days.map((d) => {
              const boxed = week.boxing.get(d.id) ?? 0;
              const partial = d.kind === 'boxing' && boxed > 0 && !week.done.has(d.id);
              return (
                <span key={d.id} class={week.done.has(d.id) ? 'wk done' : partial ? 'wk partial' : 'wk'}>
                  {week.done.has(d.id) ? '✓' : partial ? '◑' : '○'} {shortName(d)}
                  {d.kind === 'boxing' && ` ${Math.min(boxed, BOXING_PER_WEEK)}/${BOXING_PER_WEEK}`}
                </span>
              );
            })}
          </div>

          {next ? (
            <button class="card up-next" onClick={() => go({ name: 'workout', dayId: next.id })}>
              <span class="muted up-next-label">Up next</span>
              <span class="row">
                <span class="spacer up-next-name">{next.name}</span>
                <span aria-hidden="true">›</span>
              </span>
            </button>
          ) : (
            <div class="card up-next week-done">Week done 💪</div>
          )}

          <div class="day-list">
            {routine.days
              .filter((d) => d.id !== next?.id)
              .map((d) => (
                <button
                  key={d.id}
                  class={'day-btn' + (d.kind === 'boxing' ? ' boxing' : '')}
                  onClick={() => go({ name: 'workout', dayId: d.id })}
                >
                  <span class="spacer">{d.name}</span>
                  {week.done.has(d.id) ? (
                    <span class="done-mark">✓</span>
                  ) : d.kind === 'boxing' && week.boxing.get(d.id) ? (
                    <span class="muted">
                      {week.boxing.get(d.id)}/{BOXING_PER_WEEK}
                    </span>
                  ) : null}
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
