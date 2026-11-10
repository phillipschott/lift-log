import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as db from '../data/db';
import type { DayKey, Exercise, ExerciseLog, Load, LoadMode, SetLog, Slot, Workout as WorkoutT } from '../data/types';
import { contextLogs, dropBackTo, FLAG_LABEL, formatLoad, lastLog, stateForSlot } from '../logic/flags';
import { modifySlot, type Scope, type SlotChange } from '../logic/routine';
import { formatDay } from '../logic/dates';
import { BOXING_PER_WEEK, weekStart } from '../logic/week';
import { Sheet, Toast, TopBar, useDb } from './common';
import { SwapPicker } from './SwapPicker';

interface ToastState {
  id: number;
  text: string;
  action?: string;
  onAction?: () => void;
}
type ShowToast = (text: string, undo?: () => void) => void;

export function Workout(props: { dayId: string; today: DayKey; onBack: () => void }) {
  const routine = useDb(() => db.getRoutine(), []);
  const day = routine?.days.find((d) => d.id === props.dayId);
  if (!routine) return null;
  if (!day) return <TopBar title="Not found" onBack={props.onBack} />;
  if (day.kind === 'boxing') return <BoxingDay name={day.name} today={props.today} onBack={props.onBack} />;
  return <LiftDay name={day.name} {...props} />;
}

// ---------- Boxing: one tap ----------

function BoxingDay(props: { name: string; today: DayKey; onBack: () => void }) {
  // This week's boxing sessions (Mon–today), so one marked by mistake can be removed.
  const week = useDb(async () => {
    const from = weekStart(props.today);
    return (await db.listWorkouts()).filter((w) => w.boxingDone && w.date >= from && w.date <= props.today);
  }, [props.today]);
  const [busy, setBusy] = useState(false);
  const dates = [...new Set((week ?? []).map((w) => w.date))].sort().reverse();
  const doneToday = dates.includes(props.today);

  const remove = async (date: DayKey) => {
    setBusy(true);
    for (const w of week!.filter((x) => x.date === date)) await db.saveWorkout({ ...w, boxingDone: false });
    setBusy(false);
  };

  return (
    <div class="screen">
      <TopBar title={props.name} onBack={props.onBack} />
      <div class="spacer" />
      {week && (
        <div class="stack">
          <h2 style={{ marginBottom: 0 }}>
            This week{' '}
            <span class="muted">
              {Math.min(dates.length, BOXING_PER_WEEK)}/{BOXING_PER_WEEK}
            </span>
          </h2>
          {dates.length === 0 && <p class="muted">No boxing yet this week.</p>}
          {dates.map((d) => (
            <div key={d} class="card row boxing-row">
              <span class="spacer">
                {formatDay(d)}
                {d === props.today && <span class="muted"> · today</span>}
              </span>
              <button class="danger" disabled={busy} onClick={() => remove(d)}>
                Remove
              </button>
            </div>
          ))}
          {doneToday ? (
            <p class="muted center">Boxing is logged for today ✓</p>
          ) : (
            <button
              class="primary block huge"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await db.markBoxingDone(props.today);
                props.onBack();
              }}
            >
              Boxing done
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Lift day ----------

/** Plan order, but slots sharing a supersetGroup are pulled together into one block. */
function blocksOf(plan: Slot[]): Slot[][] {
  const seen = new Set<string>();
  const out: Slot[][] = [];
  for (const s of plan) {
    if (!s.supersetGroup) out.push([s]);
    else if (!seen.has(s.supersetGroup)) {
      seen.add(s.supersetGroup);
      out.push(plan.filter((x) => x.supersetGroup === s.supersetGroup));
    }
  }
  return out;
}

function LiftDay(props: { name: string; dayId: string; today: DayKey; onBack: () => void }) {
  const [workout, setWorkout] = useState<WorkoutT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exercises = useDb(() => db.listExercises(), []);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Every card starts collapsed; one open at a time.
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [modify, setModify] = useState<Slot | null>(null);
  const [swap, setSwap] = useState<{ slot: Slot; scope: Scope } | null>(null);

  useEffect(() => {
    db.getOrStartWorkout(props.dayId, props.today)
      .then(setWorkout)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [props.dayId, props.today]);

  const leave = async () => {
    try {
      await db.pruneUnusedExercises();
    } catch {
      /* never block leaving */
    }
    props.onBack();
  };

  const showToast: ShowToast = (text, undo) =>
    setToast({
      id: Date.now(),
      text,
      action: undo ? 'Undo' : undefined,
      onAction: undo
        ? () => {
            undo();
            setToast(null);
          }
        : undefined,
    });

  const apply = async (slotId: string, change: SlotChange, scope: Scope) => {
    if (!workout) return;
    const r = await db.getRoutine();
    const next = modifySlot(r, workout, slotId, change, scope);
    if (scope === 'permanent') await db.saveRoutine(next.routine);
    await db.saveWorkout(next.workout);
    setWorkout(next.workout);
  };

  const byId = new Map((exercises ?? []).map((e) => [e.id, e]));

  return (
    <div class="screen workout">
      <TopBar title={props.name} onBack={leave} />
      {error && <p class="muted">{error}</p>}
      {workout && exercises && (
        <div class="stack">
          {blocksOf(workout.plan).map((block) => {
            const cards = block.map((slot) => {
              const ex = byId.get(slot.exerciseId);
              if (!ex) return null;
              return (
                <ExerciseCard
                  key={workout.id + ':' + slot.id + ':' + slot.exerciseId}
                  slot={slot}
                  ex={ex}
                  workout={workout}
                  toast={showToast}
                  onModify={() => setModify(slot)}
                  open={openSlot === slot.id}
                  onToggle={() => setOpenSlot((cur) => (cur === slot.id ? null : slot.id))}
                  onFinished={() => setOpenSlot((cur) => (cur === slot.id ? null : cur))}
                />
              );
            });
            if (block.length === 1) return cards[0];
            return (
              <div class="superset" key={block[0].supersetGroup}>
                <div class="superset-tag">↔ Superset</div>
                {cards.map((c, i) => (
                  <Fragment key={block[i].id}>
                    {i > 0 && <div class="superset-link">↔</div>}
                    {c}
                  </Fragment>
                ))}
              </div>
            );
          })}
          {workout.plan.length === 0 && <p class="muted center">Nothing planned for today.</p>}
          <button class="primary block big finish" onClick={leave}>
            Done
          </button>
        </div>
      )}

      {modify && byId.get(modify.exerciseId) && (
        <ModifySheet
          slot={modify}
          ex={byId.get(modify.exerciseId)!}
          onClose={() => setModify(null)}
          onApply={(change, scope) => {
            setModify(null);
            apply(modify.id, change, scope);
          }}
          onSwap={(scope) => {
            setModify(null);
            setSwap({ slot: modify, scope });
          }}
        />
      )}

      {swap && byId.get(swap.slot.exerciseId) && (
        <SwapPicker
          current={byId.get(swap.slot.exerciseId)!}
          onClose={() => setSwap(null)}
          onPick={(ex) => {
            const s = swap;
            setSwap(null);
            apply(s.slot.id, { kind: 'swap', exerciseId: ex.id, sets: ex.defaults?.sets, reps: ex.defaults?.reps }, s.scope);
          }}
        />
      )}

      {toast && (
        <Toast
          key={toast.id}
          text={toast.text}
          action={toast.action}
          onAction={toast.onAction}
          onDone={() => setToast(null)}
          ms={toast.action ? 90_000 : undefined}
        />
      )}
    </div>
  );
}

// ---------- One exercise card ----------

const defaultFor = (mode: LoadMode): Load | null => (mode === 'bodyweight' ? { value: 0, mode } : null);

function ExerciseCard(props: {
  slot: Slot;
  ex: Exercise;
  workout: WorkoutT;
  toast: ShowToast;
  onModify: () => void;
  open: boolean;
  onToggle: () => void;
  onFinished: () => void;
}) {
  const { slot, ex, workout } = props;
  const logs = useDb(() => db.logsForExercise(ex.id), [ex.id]);
  // Local copy of this workout's log so taps are instant and never race the DB reload.
  const [mine, setMine] = useState<ExerciseLog | null>(null);
  const latest = useRef<ExerciseLog | null>(null);
  // Weight for the remaining rows once you change it (or a drop-back changes it). undefined = derived.
  const [pending, setPending] = useState<Load | null | undefined>(undefined);
  const [reps, setReps] = useState(slot.reps);
  const [extra, setExtra] = useState(false);
  const [weightSheet, setWeightSheet] = useState<{ logAfter: boolean } | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  useEffect(() => setReps(slot.reps), [slot.reps]);

  const prior = (logs ?? []).filter((l) => l.workoutId !== workout.id);
  const log = mine ?? (logs ?? []).find((l) => l.workoutId === workout.id) ?? null;
  latest.current = log;
  const sets = log?.sets ?? [];

  // Keep the stored targets in step with "Change sets × reps".
  useEffect(() => {
    const l = latest.current;
    if (l && (l.targetSets !== slot.sets || l.targetReps !== slot.reps)) save({ ...l, targetSets: slot.sets, targetReps: slot.reps });
  }, [slot.sets, slot.reps, !!log]);

  if (!logs) return <div class="card ex-card loading">{ex.name}</div>;

  const before = stateForSlot(ex, slot, workout.dayId, prior, workout.date);
  // Once all target sets are logged, show the flag this session earned (e.g. 🟢 Up it).
  // Drop-back logic always uses `before`.
  const shown = log && log.sets.length >= slot.sets ? stateForSlot(ex, slot, workout.dayId, [...prior, log], workout.date) : before;
  const last = lastLog(slot.start ? prior.filter((l) => l.dayId === workout.dayId) : contextLogs(prior, workout.dayId));
  // Recomputed every render (not kept in state) so a drop-back survives leaving the screen or a reload.
  const droppedTo = log && !log.keepHeavier ? dropBackTo(before, sets, slot.reps) : null;
  const derived = droppedTo ?? sets.at(-1)?.load ?? before.working ?? defaultFor(ex.mode);
  const load = pending !== undefined ? pending : derived;
  const mode = load?.mode ?? ex.mode;

  function save(next: ExerciseLog) {
    // All sets deleted: forget an earlier Undo so drop-back works again for this session.
    if (next.sets.length === 0) next = { ...next, keepHeavier: undefined };
    latest.current = next;
    setMine(next);
    if (next.sets.length === 0) db.deleteLog(next.id);
    else db.saveLog(next);
  }

  function logSet(r: number, at: Load | null = load) {
    if (!at) {
      setWeightSheet({ logAfter: true });
      return;
    }
    const base: ExerciseLog = latest.current ?? {
      id: db.newId(),
      workoutId: workout.id,
      date: workout.date,
      dayId: workout.dayId,
      exerciseId: ex.id,
      targetSets: slot.sets,
      targetReps: slot.reps,
      sets: [],
    };
    const set: SetLog = { load: at, reps: r, at: Date.now() };
    const next: ExerciseLog = { ...base, targetSets: slot.sets, targetReps: slot.reps, sets: [...base.sets, set] };
    save(next);
    setReps(slot.reps);
    if (next.sets.length >= slot.sets) setExtra(false);
    // Logging the last target set closes the card (one open at a time; you pick what's next).
    if (next.sets.length === slot.sets) props.onFinished();

    if (!next.keepHeavier) {
      const back = dropBackTo(before, next.sets, slot.reps);
      if (back && back.value !== at.value) {
        const heavy = at;
        setPending(back);
        props.toast(`Back to ${formatLoad(back)}`, () => {
          setPending(heavy);
          if (latest.current) save({ ...latest.current, keepHeavier: true });
        });
      }
    }
  }

  const showActive = sets.length < slot.sets || extra;
  const future = Math.max(0, slot.sets - sets.length - 1);
  const short = (s: SetLog) => s.reps < slot.reps;
  const lighter = (s: SetLog) => !!before.working && s.load.value < before.working.value;
  const complete = sets.length >= slot.sets;

  return (
    <div class={'card ex-card' + (props.open ? ' open' : ' collapsed') + (complete ? ' complete' : '')}>
      <div class="row ex-head" role="button" aria-expanded={props.open} onClick={props.onToggle}>
        <span class="ex-caret" aria-hidden="true">{props.open ? '▾' : '▸'}</span>
        <div class="spacer">
          <div class="ex-name">{ex.name}</div>
          <div class="muted ex-target">
            {slot.sets} × {slot.reps}
            {shown.flag && <span class={'flag ' + shown.flag}> · {FLAG_LABEL[shown.flag]}</span>}
          </div>
        </div>
        <span class={'ex-progress' + (complete ? ' done' : '')}>
          {complete ? '✓ ' : ''}
          {sets.length}/{slot.sets}
        </span>
        {props.open && (
          <button
            class="ghost modify-btn"
            onClick={(e) => {
              e.stopPropagation();
              props.onModify();
            }}
            aria-label={`Modify ${ex.name}`}
          >
            ⋯
          </button>
        )}
      </div>
      {props.open && (
      <>
      <div class="muted ex-last">
        {last ? `Last: ${formatLoad(last.sets[0].load)} — ${last.sets.map((s) => s.reps).join(', ')}` : 'First time'}
      </div>

      <div class="sets">
        {sets.map((s, i) => (
          <button key={s.at + ':' + i} class="set-row logged" onClick={() => setEditIdx(i)}>
            <span class="set-n">{i + 1}</span>
            <span class="spacer">
              {formatLoad(s.load)}
              {lighter(s) && <span class="muted"> ↓</span>}
            </span>
            <span class={'set-reps' + (short(s) ? ' short' : '')}>{s.reps}</span>
            <span class="tick">✓</span>
          </button>
        ))}

        {showActive && (
          <div class="active-row">
            <button class="weight-btn" onClick={() => setWeightSheet({ logAfter: false })}>
              {load ? formatLoad(load) : 'Set wt'}
            </button>
            <button class="step" onClick={() => setReps((r) => Math.max(0, r - 1))} aria-label="One fewer rep">
              −
            </button>
            <button class="primary reps-btn" onClick={() => logSet(reps)} aria-label={`Log set: ${reps} reps`}>
              {reps} <span class="reps-tick">✓</span>
            </button>
            <button class="step" onClick={() => setReps((r) => r + 1)} aria-label="One more rep">
              +
            </button>
          </div>
        )}

        {Array.from({ length: future }, (_, i) => (
          <div key={'f' + i} class="set-row future">
            <span class="set-n">{sets.length + 2 + i}</span>
            <span class="spacer">{load ? formatLoad(load) : 'set on first log'}</span>
            <span class="set-reps">{slot.reps}</span>
          </div>
        ))}

        {!showActive && (
          <button class="ghost extra-btn" onClick={() => setExtra(true)}>
            + set
          </button>
        )}
      </div>
      </>
      )}

      {weightSheet && (
        <WeightSheet
          title={ex.name}
          load={load}
          mode={mode}
          action={weightSheet.logAfter ? `Log ${reps} reps` : 'Done'}
          onClose={() => setWeightSheet(null)}
          onSave={(l) => {
            const after = weightSheet.logAfter;
            setWeightSheet(null);
            setPending(l);
            if (after) logSet(reps, l);
          }}
        />
      )}

      {editIdx !== null && sets[editIdx] && (
        <SetSheet
          n={editIdx + 1}
          set={sets[editIdx]}
          onClose={() => setEditIdx(null)}
          onSave={(s) => {
            const l = latest.current!;
            save({ ...l, sets: l.sets.map((x, i) => (i === editIdx ? s : x)) });
            setEditIdx(null);
          }}
          onDelete={() => {
            const l = latest.current!;
            save({ ...l, sets: l.sets.filter((_, i) => i !== editIdx) });
            setEditIdx(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Sheets ----------

const MODES: { mode: LoadMode; label: string }[] = [
  { mode: 'per-side', label: '/ side' },
  { mode: 'total', label: 'Total' },
  { mode: 'bodyweight', label: 'BW +' },
];

const parseNum = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Weight input + mode, shared by the weight sheet and the logged-set sheet. */
function LoadFields(props: { value: string; mode: LoadMode; onValue: (v: string) => void; onMode: (m: LoadMode) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.select();
  }, []);
  const bump = (d: number) => props.onValue(String(Math.max(0, (parseNum(props.value) ?? 0) + d)));
  return (
    <div class="stack">
      <div class="weight-edit">
        <button class="step" onClick={() => bump(-5)}>
          −5
        </button>
        <div class="weight-input">
          {props.mode === 'bodyweight' && <span class="muted unit">BW +</span>}
          <input
            ref={ref}
            type="text"
            inputMode="decimal"
            value={props.value}
            placeholder="0"
            onInput={(e) => props.onValue(e.currentTarget.value)}
          />
          {props.mode === 'per-side' && <span class="muted unit">/ side</span>}
        </div>
        <button class="step" onClick={() => bump(5)}>
          +5
        </button>
      </div>
      <div class="seg">
        {MODES.map((m) => (
          <button key={m.mode} class={m.mode === props.mode ? 'on' : ''} onClick={() => props.onMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WeightSheet(props: {
  title: string;
  load: Load | null;
  mode: LoadMode;
  action: string;
  onSave: (l: Load) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.load ? String(props.load.value) : '');
  const [mode, setMode] = useState<LoadMode>(props.mode);
  const v = parseNum(value) ?? (mode === 'bodyweight' ? 0 : null);
  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">{props.title}</h2>
      <p class="muted sheet-sub">Weight for the rest of today's sets</p>
      <LoadFields value={value} mode={mode} onValue={setValue} onMode={setMode} autoFocus />
      <button class="primary block big sheet-go" disabled={v === null} onClick={() => v !== null && props.onSave({ value: v, mode })}>
        {props.action}
      </button>
    </Sheet>
  );
}

export function SetSheet(props: { n: number; set: SetLog; onSave: (s: SetLog) => void; onDelete: () => void; onClose: () => void }) {
  const [value, setValue] = useState(String(props.set.load.value));
  const [mode, setMode] = useState<LoadMode>(props.set.load.mode);
  const [reps, setReps] = useState(props.set.reps);
  const v = parseNum(value) ?? (mode === 'bodyweight' ? 0 : null);
  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">Set {props.n}</h2>
      <LoadFields value={value} mode={mode} onValue={setValue} onMode={setMode} />
      <div class="reps-edit">
        <button class="step" onClick={() => setReps((r) => Math.max(0, r - 1))}>
          −
        </button>
        <div class="reps-val">
          {reps} <span class="muted">reps</span>
        </div>
        <button class="step" onClick={() => setReps((r) => r + 1)}>
          +
        </button>
      </div>
      <div class="sheet-actions">
        <button class="danger" onClick={props.onDelete}>
          Delete
        </button>
        <button
          class="primary spacer"
          disabled={v === null}
          onClick={() => v !== null && props.onSave({ ...props.set, load: { value: v, mode }, reps })}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

function ModifySheet(props: {
  slot: Slot;
  ex: Exercise;
  onApply: (c: SlotChange, scope: Scope) => void;
  onSwap: (scope: Scope) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState(String(props.slot.sets));
  const [reps, setReps] = useState(String(props.slot.reps));
  const s = parseInt(sets, 10);
  const r = parseInt(reps, 10);

  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">{props.ex.name}</h2>
      {!scope ? (
        <div class="stack">
          <button class="block big" onClick={() => setScope('today')}>
            Just today
          </button>
          <button class="block big" onClick={() => setScope('permanent')}>
            Permanently
          </button>
        </div>
      ) : !editing ? (
        <div class="stack">
          <p class="muted sheet-sub">{scope === 'today' ? 'Just today' : 'Permanently (changes the routine)'}</p>
          <button class="block big" onClick={() => props.onSwap(scope)}>
            Swap exercise
          </button>
          <button class="block big" onClick={() => setEditing(true)}>
            Change sets × reps
          </button>
          <button class="block big danger" onClick={() => props.onApply({ kind: 'remove' }, scope)}>
            Remove
          </button>
        </div>
      ) : (
        <div class="stack">
          <p class="muted sheet-sub">{scope === 'today' ? 'Just today' : 'Permanently'}</p>
          <div class="sr-edit">
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={sets} onInput={(e) => setSets(e.currentTarget.value)} aria-label="Sets" />
            <span class="muted">×</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={reps} onInput={(e) => setReps(e.currentTarget.value)} aria-label="Reps" />
          </div>
          <button
            class="primary block big"
            disabled={!(s > 0 && r > 0)}
            onClick={() => props.onApply({ kind: 'setsReps', sets: s, reps: r }, scope)}
          >
            Save
          </button>
        </div>
      )}
    </Sheet>
  );
}
