import { useEffect, useRef, useState } from 'preact/hooks';
import * as db from '../data/db';
import type { Exercise } from '../data/types';
import { useDb } from './common';

/**
 * Full-screen picker: one search box that filters as you type.
 * Ready-made swaps (★) first, then every other exercise A–Z, then "+ Create '…'"
 * at the bottom when nothing matches the typed name exactly.
 */
export function SwapPicker(props: { current: Exercise; onPick: (ex: Exercise) => void; onClose: () => void }) {
  const { current } = props;
  const all = useDb(() => db.listExercises(), []);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const query = q.trim().toLowerCase();
  const matches = (e: Exercise) => !query || e.name.toLowerCase().includes(query);
  const others = (all ?? []).filter((e) => e.id !== current.id);
  const swaps = current.swapIds
    .map((id) => others.find((e) => e.id === id))
    .filter((e): e is Exercise => !!e && matches(e));
  const rest = others
    .filter((e) => !current.swapIds.includes(e.id) && matches(e))
    .sort((a, b) => a.name.localeCompare(b.name));
  const exact = (all ?? []).some((e) => e.name.trim().toLowerCase() === query);

  const create = async () => {
    const ex = await db.createExercise(q.trim(), current.mode);
    props.onPick(ex);
  };

  return (
    <div class="picker">
      <div class="row picker-head">
        <input
          ref={input}
          type="search"
          placeholder={`Swap ${current.name} for…`}
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
          autoComplete="off"
          autoCorrect="off"
        />
        <button class="ghost" onClick={props.onClose}>
          Cancel
        </button>
      </div>
      <div class="picker-list">
        {swaps.map((e) => (
          <button key={e.id} class="pick" onClick={() => props.onPick(e)}>
            <span class="star">★</span> {e.name}
          </button>
        ))}
        {rest.map((e) => (
          <button key={e.id} class="pick" onClick={() => props.onPick(e)}>
            {e.name}
          </button>
        ))}
        {query && !exact && (
          <button class="pick create" onClick={create}>
            + Create '{q.trim()}'
          </button>
        )}
      </div>
    </div>
  );
}
