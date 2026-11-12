// Settings: targets, edit routine, exercises (rename / merge), export / import. Nothing else.
import { useState } from 'preact/hooks';
import type { Exercise, ExportFile } from '../data/types';
import * as db from '../data/db';
import { dayKey } from '../logic/dates';
import { Sheet, Toast, TopBar, useDb } from './common';
import { DayEditor, ExercisePicker } from './hist-routine';
import { posNum } from './hist-util';
import { DEFAULT_MAINTENANCE } from '../logic/food';
import './history.css';

export function Settings(props: { onBack: () => void }) {
  const data = useDb(() => Promise.all([db.getSettings(), db.getRoutine(), db.listExercises()]), []);
  const [dayId, setDayId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (!data) return <TopBar title="Settings" onBack={props.onBack} />;
  const [settings, routine, exercises] = data;

  const day = dayId ? routine.days.find((d) => d.id === dayId) : undefined;
  if (day) return <DayEditor routine={routine} day={day} exercises={exercises} onBack={() => setDayId(null)} />;

  const saveTargets = (kcal: string, protein: string) => {
    const k = posNum(kcal);
    const p = posNum(protein);
    if (k && p && (k !== settings.kcalTarget || p !== settings.proteinTarget)) db.setTargets(Math.round(k), Math.round(p));
  };

  return (
    <div>
      <TopBar title="Settings" onBack={props.onBack} />

      <h2>Targets</h2>
      <div class="card stack">
        <label class="row hist-target">
          <span class="spacer">Calories (max)</span>
          <input
            key={`k${settings.kcalTarget}`}
            class="hist-num wide"
            type="number"
            inputMode="numeric"
            defaultValue={String(settings.kcalTarget)}
            onChange={(e) => saveTargets(e.currentTarget.value, String(settings.proteinTarget))}
          />
          <span class="muted hist-unit">kcal</span>
        </label>
        <label class="row hist-target">
          <span class="spacer">Protein (min)</span>
          <input
            key={`p${settings.proteinTarget}`}
            class="hist-num wide"
            type="number"
            inputMode="numeric"
            defaultValue={String(settings.proteinTarget)}
            onChange={(e) => saveTargets(String(settings.kcalTarget), e.currentTarget.value)}
          />
          <span class="muted hist-unit">g</span>
        </label>
        <label class="row hist-target">
          <span class="spacer">
            Maintenance
            <span class="muted hist-small" style={{ display: 'block' }}>
              sedentary day, for the deficit
            </span>
          </span>
          <input
            key={`m${settings.maintenanceKcal}`}
            class="hist-num wide"
            type="number"
            inputMode="numeric"
            defaultValue={String(settings.maintenanceKcal ?? DEFAULT_MAINTENANCE)}
            onChange={(e) => {
              const m = posNum(e.currentTarget.value);
              if (m) db.setMaintenance(Math.round(m));
            }}
          />
          <span class="muted hist-unit">kcal</span>
        </label>
      </div>

      <h2>Routine</h2>
      <div class="stack">
        {routine.days
          .filter((d) => d.kind === 'lift')
          .map((d) => (
            <button key={d.id} class="card hist-chev" onClick={() => setDayId(d.id)}>
              <span class="spacer">{d.name}</span>
              <span class="muted">{d.slots.length} ›</span>
            </button>
          ))}
      </div>

      <ExerciseSection exercises={exercises} onToast={setToast} />

      <h2>Backup</h2>
      <Backup onToast={setToast} />

      {toast && <Toast text={toast} onDone={() => setToast(null)} ms={4000} />}
    </div>
  );
}

// ---------- exercises: rename / merge duplicates ----------

function ExerciseSection(props: { exercises: Exercise[]; onToast: (t: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...props.exercises].sort((a, b) => a.name.localeCompare(b.name));
  const ex = openId ? props.exercises.find((e) => e.id === openId) : undefined;
  return (
    <details class="hist-details">
      <summary>
        <h2>Exercises</h2>
      </summary>
      <div class="hist-pick-list">
        {sorted.map((e) => (
          <button key={e.id} class="hist-pick" onClick={() => setOpenId(e.id)}>
            {e.name}
          </button>
        ))}
      </div>
      {ex && <ExerciseSheet ex={ex} all={props.exercises} onToast={props.onToast} onClose={() => setOpenId(null)} />}
    </details>
  );
}

function ExerciseSheet(props: { ex: Exercise; all: Exercise[]; onToast: (t: string) => void; onClose: () => void }) {
  const { ex } = props;
  const [name, setName] = useState(ex.name);
  const [picking, setPicking] = useState(false);
  const [into, setInto] = useState<{ ex: Exercise; sessions: number } | null>(null);

  const rename = () => {
    const n = name.trim();
    if (!n || n === ex.name) return;
    const clash = props.all.find((e) => e.id !== ex.id && e.name.trim().toLowerCase() === n.toLowerCase());
    if (clash) return props.onToast(`“${clash.name}” already exists — use Merge into…`);
    db.renameExercise(ex.id, n).then(() => props.onToast('Renamed'));
  };
  const pick = (target: Exercise) => {
    setPicking(false);
    db.logsForExercise(ex.id).then((logs) => setInto({ ex: target, sessions: logs.length }));
  };
  const merge = () =>
    db.mergeExercise(ex.id, into!.ex.id).then(() => {
      props.onClose();
      props.onToast(`Merged into ${into!.ex.name}`);
    });

  if (picking)
    return (
      <ExercisePicker
        title={`Merge “${ex.name}” into…`}
        exercises={props.all.filter((e) => e.id !== ex.id)}
        onPick={pick}
        onClose={() => setPicking(false)}
      />
    );

  return (
    <Sheet onClose={props.onClose}>
      {into ? (
        <div class="stack">
          <h2 style={{ marginTop: 0 }}>Merge into {into.ex.name}?</h2>
          <p>
            {into.sessions} session{into.sessions === 1 ? '' : 's'} will move from “{ex.name}” to “{into.ex.name}”, and “{ex.name}” will be
            deleted.
          </p>
          <button class="primary block" onClick={merge}>
            Merge
          </button>
          <button class="block" onClick={() => setInto(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div class="stack">
          <h2 style={{ marginTop: 0 }}>{ex.name}</h2>
          <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="Name" />
          <button class="primary block" disabled={!name.trim() || name.trim() === ex.name} onClick={rename}>
            Rename
          </button>
          <button class="block" onClick={() => setPicking(true)}>
            Merge into…
          </button>
          <button class="ghost block" onClick={props.onClose}>
            Done
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------- export / import ----------

function Backup(props: { onToast: (t: string) => void }) {
  const [pending, setPending] = useState<ExportFile | null>(null);

  const doExport = async () => {
    try {
      const json = JSON.stringify(await db.exportAll(), null, 2);
      const filename = `lift-log-${dayKey()}.json`;
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (e) {
          if ((e as Error).name !== 'AbortError') throw e;
        }
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      props.onToast(`Export failed: ${(e as Error).message}`);
    }
  };

  const onFile = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      setPending(JSON.parse(await f.text()) as ExportFile);
    } catch {
      props.onToast('That file isn’t a Lift Log backup (not valid JSON).');
    }
  };

  const doImport = async () => {
    const f = pending!;
    setPending(null);
    try {
      await db.importAll(f);
      props.onToast('Import complete');
    } catch (e) {
      props.onToast(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="stack">
      <button class="block" onClick={doExport}>
        Export
      </button>
      <label class="btn hist-file">
        Import
        <input type="file" accept="application/json,.json" onChange={(e) => onFile(e.currentTarget)} />
      </label>
      {pending && (
        <Sheet onClose={() => setPending(null)}>
          <div class="stack">
            <h2 style={{ marginTop: 0 }}>Import backup?</h2>
            <p>This replaces all data on this phone.</p>
            <button class="primary block" onClick={doImport}>
              Replace all data
            </button>
            <button class="block" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
