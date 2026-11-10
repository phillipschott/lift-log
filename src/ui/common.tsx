// Shared UI helpers used by every screen. Keep this file small.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as db from '../data/db';

/**
 * Load data from the DB and re-load whenever anything is written.
 *   const data = useDb(() => db.foodFor(today), [today]);   // undefined while loading
 */
export function useDb<T>(load: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const run = () => load().then((v) => alive && setValue(v));
    run();
    const unsub = db.subscribe(run);
    return () => {
      alive = false;
      unsub();
    };
  }, deps);
  return value;
}

/** Bottom sheet. Tap the backdrop to close. */
export function Sheet(props: { onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-backdrop" onClick={props.onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        {props.children}
      </div>
    </div>
  );
}

/** Toast with an optional action (e.g. "Back to 50/50 · Undo"). Auto-hides after `ms`. */
export function Toast(props: { text: string; action?: string; onAction?: () => void; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = setTimeout(props.onDone, props.ms ?? 6000);
    return () => clearTimeout(t);
  }, [props.text]);
  return (
    <div class="toast" role="status">
      <span class="spacer">{props.text}</span>
      {props.action && (
        <button class="ghost" onClick={props.onAction}>
          {props.action}
        </button>
      )}
    </div>
  );
}

/** Top bar with a back button and title. */
export function TopBar(props: { title: string; onBack: () => void; right?: ComponentChildren }) {
  return (
    <div class="row" style={{ marginBottom: 8 }}>
      <button class="ghost" onClick={props.onBack} aria-label="Back">
        ‹ Back
      </button>
      <h1 class="spacer" style={{ margin: 0, fontSize: 22, textAlign: 'center' }}>
        {props.title}
      </h1>
      <div style={{ minWidth: 64, textAlign: 'right' }}>{props.right}</div>
    </div>
  );
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
