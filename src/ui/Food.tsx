import { useRef, useState } from 'preact/hooks';
import * as db from '../data/db';
import type { DayKey, FoodEntry } from '../data/types';
import { fmtInt, Sheet, TopBar, useDb } from './common';
import { loadTodayFood } from './foodTargets';

const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const time = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function Food(props: { today: DayKey; onBack: () => void }) {
  const { today } = props;
  const food = useDb(() => loadTodayFood(today), [today]);
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const kcalRef = useRef<HTMLInputElement>(null);

  const canAdd = num(kcal) > 0 || num(protein) > 0;
  const add = () => {
    if (!canAdd) {
      kcalRef.current?.focus();
      return;
    }
    db.addFood(today, num(kcal), num(protein));
    setKcal('');
    setProtein('');
    kcalRef.current?.focus(); // keep the keypad up for the next add
  };

  const closed = food?.day && food.day.status !== 'open';

  return (
    <div class="screen food">
      <TopBar title="Food" onBack={props.onBack} />

      {food && (
        <div class="card totals">
          <div class="total-line">
            <b>{fmtInt(food.totals.kcal)}</b> <span class="muted">/ {fmtInt(food.kcalTarget)} kcal</span>
          </div>
          <div class="total-line">
            <b>{fmtInt(food.totals.protein)}</b> <span class="muted">/ {fmtInt(food.proteinTarget)}g protein</span>
          </div>
        </div>
      )}

      <form
        class="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label class="field">
          <span class="muted">kcal</span>
          <input
            ref={kcalRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="next"
            placeholder="0"
            value={kcal}
            onInput={(e) => setKcal(e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="muted">protein g</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            placeholder="0"
            value={protein}
            onInput={(e) => setProtein(e.currentTarget.value)}
          />
        </label>
        {/* pointerdown preventDefault keeps the input focused so the keypad stays up */}
        <button type="submit" class="primary add-btn" onPointerDown={(e) => e.preventDefault()}>
          + Add
        </button>
      </form>

      {food && food.entries.length > 0 && (
        <div class="entry-list">
          {[...food.entries].reverse().map((e) => (
            <button key={e.id} class="entry" onClick={() => setEditing(e)}>
              <span class="muted entry-time">{time(e.at)}</span>
              <span class="spacer">
                {fmtInt(e.kcal)} kcal · {fmtInt(e.protein)}g
              </span>
              <span class="muted">›</span>
            </button>
          ))}
        </div>
      )}

      <div class="spacer" />

      {food &&
        (closed ? (
          <p class="muted center closed-note">
            Today is closed{food.day!.status === 'incomplete' ? ' (incomplete)' : ' ✓'}. You can still add food.
          </p>
        ) : (
          <button class="block big" onClick={() => db.closeDay(today, 'complete')}>
            Close out today
          </button>
        ))}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditEntry(props: { entry: FoodEntry; onClose: () => void }) {
  const [kcal, setKcal] = useState(String(props.entry.kcal));
  const [protein, setProtein] = useState(String(props.entry.protein));
  const save = async () => {
    await db.updateFood({ ...props.entry, kcal: num(kcal), protein: num(protein) });
    props.onClose();
  };
  const del = async () => {
    await db.deleteFood(props.entry.id);
    props.onClose();
  };
  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">Edit {time(props.entry.at)} add</h2>
      <div class="add-row">
        <label class="field">
          <span class="muted">kcal</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={kcal} onInput={(e) => setKcal(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="muted">protein g</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={protein}
            onInput={(e) => setProtein(e.currentTarget.value)}
          />
        </label>
      </div>
      <div class="sheet-actions">
        <button class="danger" onClick={del}>
          Delete
        </button>
        <button class="primary spacer" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
