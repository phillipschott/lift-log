// Settings → Edit routine: one day's exercises, sets × reps, reorder, remove, add.
import { useState } from 'preact/hooks';
import type { Exercise, LoadMode, Routine, RoutineDay, Slot } from '../data/types';
import * as db from '../data/db';
import { Sheet, TopBar } from './common';
import { posNum } from './hist-util';

export function DayEditor(props: { routine: Routine; day: RoutineDay; exercises: Exercise[]; onBack: () => void }) {
  const { routine, day, exercises } = props;
  const [adding, setAdding] = useState(false);
  const name = (id: string) => exercises.find((e) => e.id === id)?.name ?? '(deleted)';

  const save = (slots: Slot[]) =>
    db.saveRoutine({ ...routine, days: routine.days.map((d) => (d.id === day.id ? { ...d, slots } : d)) });
  const patch = (i: number, p: Partial<Slot>) => save(day.slots.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, by: number) => {
    const s = [...day.slots];
    [s[i], s[i + by]] = [s[i + by], s[i]];
    save(s);
  };
  const addEx = (ex: Exercise) => {
    setAdding(false);
    save([...day.slots, { id: db.newId(), exerciseId: ex.id, sets: ex.defaults?.sets ?? 3, reps: ex.defaults?.reps ?? 10 }]);
  };

  return (
    <div>
      <TopBar title={day.name} onBack={props.onBack} />
      <div class="stack">
        {day.slots.map((s, i) => (
          <div key={s.id} class="card hist-slot">
            <div class="hist-slot-name">{name(s.exerciseId)}</div>
            <div class="row hist-slot-controls">
              <NumField key={`s${s.sets}`} value={s.sets} label="Sets" onSave={(n) => patch(i, { sets: n })} />
              <span class="muted">×</span>
              <NumField key={`r${s.reps}`} value={s.reps} label="Reps" onSave={(n) => patch(i, { reps: n })} />
              <span class="spacer" />
              <button class="hist-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button class="hist-icon" aria-label="Move down" disabled={i === day.slots.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button class="hist-icon danger" aria-label="Remove" onClick={() => save(day.slots.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <button class="block" onClick={() => setAdding(true)}>
          + Add exercise
        </button>
      </div>
      {adding && <ExercisePicker exercises={exercises} onPick={addEx} onClose={() => setAdding(false)} allowCreate />}
    </div>
  );
}

function NumField(props: { value: number; label: string; onSave: (n: number) => void }) {
  return (
    <input
      class="hist-num"
      type="number"
      inputMode="numeric"
      aria-label={props.label}
      defaultValue={String(props.value)}
      onChange={(e) => {
        const n = posNum(e.currentTarget.value);
        if (n && Number.isInteger(n) && n !== props.value) props.onSave(n);
        else e.currentTarget.value = String(props.value);
      }}
    />
  );
}

const MODES: { mode: LoadMode; label: string }[] = [
  { mode: 'per-side', label: 'Per side (45/45)' },
  { mode: 'total', label: 'Total (105)' },
  { mode: 'bodyweight', label: 'Bodyweight' },
];

/**
 * Search box over existing exercises. With `allowCreate`, offers "+ Create" only when no
 * exercise has that exact name (case-insensitive), so duplicates don't pile up.
 */
export function ExercisePicker(props: {
  exercises: Exercise[];
  onPick: (ex: Exercise) => void;
  onClose: () => void;
  allowCreate?: boolean;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = props.exercises
    .filter((e) => !query || e.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  const exact = props.exercises.some((e) => e.name.trim().toLowerCase() === query);
  const create = (mode: LoadMode) => db.createExercise(q.trim(), mode).then(props.onPick);

  return (
    <Sheet onClose={props.onClose}>
      <h2 style={{ marginTop: 0 }}>{props.title ?? 'Add exercise'}</h2>
      <input type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus />
      <div class="hist-pick-list">
        {list.map((e) => (
          <button key={e.id} class="hist-pick" onClick={() => props.onPick(e)}>
            {e.name}
          </button>
        ))}
        {!list.length && !props.allowCreate && <p class="muted">No match.</p>}
      </div>
      {props.allowCreate && query && !exact && (
        <div class="hist-create">
          <div class="muted hist-small">+ Create “{q.trim()}” as:</div>
          {MODES.map((m) => (
            <button key={m.mode} class="block" onClick={() => create(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
