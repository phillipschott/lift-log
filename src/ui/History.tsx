// History: Lifts (start → current per exercise, chart + session log) | Food (hit rates + day marks).
import { useState } from 'preact/hooks';
import type { Exercise, ExerciseLog } from '../data/types';
import * as db from '../data/db';
import { dayKey, formatDay } from '../logic/dates';
import { formatLoad, stateForSlot } from '../logic/flags';
import { Sheet, TopBar, useDb } from './common';
import { SetSheet } from './Workout';
import { WeightChart } from './hist-chart';
import { FoodHistory } from './hist-food';
import { byDate, shortDay, signed, topLoad } from './hist-util';
import './history.css';

type Tab = 'lifts' | 'food';

export function History(props: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('lifts');
  const [exId, setExId] = useState<string | null>(null);
  const today = dayKey();
  const data = useDb(() => Promise.all([db.listExercises(), db.allLogs()]), []);

  if (exId && data) {
    const ex = data[0].find((e) => e.id === exId);
    if (ex) return <LiftDetail ex={ex} logs={data[1].filter((l) => l.exerciseId === ex.id && l.sets.length)} today={today} onBack={() => setExId(null)} />;
  }

  return (
    <div>
      <TopBar title="History" onBack={props.onBack} />
      <div class="hist-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'lifts'} class={tab === 'lifts' ? 'on' : ''} onClick={() => setTab('lifts')}>
          Lifts
        </button>
        <button role="tab" aria-selected={tab === 'food'} class={tab === 'food' ? 'on' : ''} onClick={() => setTab('food')}>
          Food
        </button>
      </div>
      {tab === 'food' ? (
        <FoodHistory today={today} />
      ) : !data ? null : (
        <LiftList exercises={data[0]} logs={data[1]} today={today} onPick={setExId} />
      )}
    </div>
  );
}

function LiftList(props: { exercises: Exercise[]; logs: ExerciseLog[]; today: string; onPick: (id: string) => void }) {
  const byEx = new Map<string, ExerciseLog[]>();
  for (const l of props.logs) {
    if (!l.sets.length) continue;
    const a = byEx.get(l.exerciseId);
    if (a) a.push(l);
    else byEx.set(l.exerciseId, [l]);
  }
  const rows = props.exercises
    .filter((e) => byEx.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ex) => {
      const logs = byEx.get(ex.id)!;
      const start = ex.start ?? byDate(logs)[0].sets[0].load;
      const current = stateForSlot(ex, undefined, undefined, logs, props.today).working;
      const change = current ? signed(current.value - start.value) : '';
      return { ex, text: `${formatLoad(start)} → ${formatLoad(current)}`, change };
    });

  if (!rows.length) return <p class="muted hist-empty">No lifts logged yet.</p>;
  return (
    <div class="stack">
      {rows.map((r) => (
        <button key={r.ex.id} class="card hist-lift" onClick={() => props.onPick(r.ex.id)}>
          <span class="hist-lift-name">{r.ex.name}</span>
          <span class="hist-lift-load">
            {r.text} <span class={r.change.startsWith('+') ? 'hist-up' : r.change.startsWith('−') ? 'hist-down' : 'muted'}>({r.change})</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function LiftDetail(props: { ex: Exercise; logs: ExerciseLog[]; today: string; onBack: () => void }) {
  const sessions = byDate(props.logs);
  const points = sessions.map((l) => ({ date: l.date, load: topLoad(l)! }));
  const [editId, setEditId] = useState<string | null>(null);
  const editing = editId ? props.logs.find((l) => l.id === editId) : undefined;
  if (!sessions.length)
    return (
      <div>
        <TopBar title={props.ex.name} onBack={props.onBack} />
        <p class="muted hist-empty">No sessions left.</p>
      </div>
    );
  return (
    <div>
      <TopBar title={props.ex.name} onBack={props.onBack} />
      <div class="card hist-chart-card">
        <WeightChart points={points} today={props.today} />
      </div>
      <h2>Sessions</h2>
      <ul class="hist-sessions">
        {[...sessions].reverse().map((l) => {
          const top = topLoad(l)!;
          return (
            <li key={l.id} class="hist-session" role="button" onClick={() => setEditId(l.id)}>
              <span class="hist-edit-chev" aria-hidden="true">›</span>
              <span class="muted">{shortDay(l.date, props.today)}</span> · <b>{formatLoad(top)}</b> ·{' '}
              {l.sets.map((s, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {s.load.value < top.value ? (
                    <span class="hist-light" title="Below working weight">
                      ↓{formatLoad(s.load)}×{s.reps}
                    </span>
                  ) : (
                    s.reps
                  )}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      {editing && <SessionSheet ex={props.ex} log={editing} today={props.today} onClose={() => setEditId(null)} />}
    </div>
  );
}

/** Edit a past session: fix or delete a set, or delete the whole session. Flags/charts recompute from the data. */
function SessionSheet(props: { ex: Exercise; log: ExerciseLog; today: string; onClose: () => void }) {
  const { log } = props;
  const [setIdx, setSetIdx] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);

  const saveSets = async (sets: ExerciseLog['sets']) => {
    if (sets.length) await db.saveLog({ ...log, sets });
    else {
      await db.deleteLog(log.id);
      props.onClose();
    }
  };

  if (setIdx !== null && log.sets[setIdx])
    return (
      <SetSheet
        n={setIdx + 1}
        set={log.sets[setIdx]}
        onClose={() => setSetIdx(null)}
        onSave={(s) => {
          setSetIdx(null);
          saveSets(log.sets.map((x, i) => (i === setIdx ? s : x)));
        }}
        onDelete={() => {
          setSetIdx(null);
          saveSets(log.sets.filter((_, i) => i !== setIdx));
        }}
      />
    );

  return (
    <Sheet onClose={props.onClose}>
      <div class="stack">
        <h2 style={{ marginTop: 0 }}>
          {props.ex.name} <span class="muted">— {formatDay(log.date)}</span>
        </h2>
        <div class="hist-edit-sets">
          {log.sets.map((s, i) => (
            <button key={i} class="hist-edit-set" onClick={() => setSetIdx(i)}>
              <span class="muted">{i + 1}</span>
              <span class="spacer">{formatLoad(s.load)}</span>
              <b>{s.reps}</b>
              <span class="muted">›</span>
            </button>
          ))}
        </div>
        {confirm ? (
          <button
            class="danger block"
            onClick={async () => {
              await db.deleteLog(log.id);
              props.onClose();
            }}
          >
            Tap again to delete this session
          </button>
        ) : (
          <button class="danger block" onClick={() => setConfirm(true)}>
            Delete session
          </button>
        )}
        <button class="block" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
