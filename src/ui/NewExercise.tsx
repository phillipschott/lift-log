// "New exercise": the name is always built as "Movement · equipment", and the units follow the
// equipment (plate-loaded / dumbbell / barbell = per side, machine / cable = one number).
import { useState } from 'preact/hooks';
import * as db from '../data/db';
import type { Exercise, LoadMode } from '../data/types';

export const EQUIPMENT: { label: string; mode: LoadMode; hint: string }[] = [
  { label: 'machine', mode: 'total', hint: 'pin + weight stack' },
  { label: 'plate-loaded', mode: 'per-side', hint: 'you load plates' },
  { label: 'dumbbell', mode: 'per-side', hint: 'per hand' },
  { label: 'barbell', mode: 'per-side', hint: 'plates each side' },
  { label: 'high pulley', mode: 'total', hint: 'fixed top cable' },
  { label: 'adjustable pulley', mode: 'total', hint: 'slide up/down' },
  { label: 'cable', mode: 'total', hint: 'other cable' },
  { label: 'bodyweight', mode: 'bodyweight', hint: '+ added weight' },
];

/** "chest press" → "Chest press" */
const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};

/** Movements already in use (the part before " · "), for consistent spelling. */
function movementsOf(exercises: Exercise[]): string[] {
  return [...new Set(exercises.map((e) => e.name.split(' · ')[0].trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function NewExerciseForm(props: {
  exercises: Exercise[];
  initialMovement?: string;
  onCreate: (ex: Exercise) => void;
  onCancel: () => void;
}) {
  const [movement, setMovement] = useState(props.initialMovement ?? '');
  const [equip, setEquip] = useState<(typeof EQUIPMENT)[number] | null>(null);
  const [busy, setBusy] = useState(false);

  const m = tidy(movement);
  const known = movementsOf(props.exercises);
  const q = m.toLowerCase();
  const suggestions = q ? known.filter((k) => k.toLowerCase().includes(q) && k.toLowerCase() !== q).slice(0, 6) : [];
  const name = m && equip ? (equip.label === 'bodyweight' && !/bodyweight/i.test(m) ? `${m} · bodyweight` : `${m} · ${equip.label}`) : '';
  const existing = name ? props.exercises.find((e) => e.name.trim().toLowerCase() === name.toLowerCase()) : undefined;

  const create = async () => {
    if (!name || busy) return;
    if (existing) return props.onCreate(existing);
    setBusy(true);
    try {
      props.onCreate(await db.createExercise(name, equip!.mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="stack new-ex">
      <h2 style={{ margin: 0 }}>New exercise</h2>
      <label class="stack new-ex-field">
        <span class="muted">Movement</span>
        <input
          type="text"
          placeholder="e.g. Chest press, Lateral raise"
          value={movement}
          onInput={(e) => setMovement(e.currentTarget.value)}
          autoComplete="off"
          autoCorrect="off"
          autoFocus
        />
      </label>
      {suggestions.length > 0 && (
        <div class="chips">
          {suggestions.map((s) => (
            <button key={s} class="chip" onClick={() => setMovement(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div class="stack new-ex-field">
        <span class="muted">Equipment</span>
        <div class="chips">
          {EQUIPMENT.map((e) => (
            <button key={e.label} class={'chip' + (equip?.label === e.label ? ' on' : '')} onClick={() => setEquip(e)} title={e.hint}>
              {e.label}
            </button>
          ))}
        </div>
        {equip && <span class="muted hist-small">{equip.hint} · logged {equip.mode === 'per-side' ? 'per side (50/50)' : equip.mode === 'total' ? 'as one number' : 'as BW + added weight'}</span>}
      </div>
      <div class="new-ex-preview">
        {name ? (
          <>
            <b>{name}</b>
            {existing && <span class="muted"> · already exists — tap to use it</span>}
          </>
        ) : (
          <span class="muted">Type a movement and pick equipment</span>
        )}
      </div>
      <button class="primary block" disabled={!name || busy} onClick={create}>
        {existing ? 'Use it' : 'Create'}
      </button>
      <button class="ghost block" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}
