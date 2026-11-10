import { render } from 'preact';
import './styles.css';
import './ui/screens.css';
import * as db from './data/db';
import { App } from './app';

const root = document.getElementById('app')!;

(async () => {
  try {
    await db.init();
    render(<App />, root);
  } catch (e) {
    render(
      <div class="stack">
        <h1>Lift Log</h1>
        <p>Couldn't open the app's storage.</p>
        <p class="muted">{e instanceof Error ? e.message : String(e)}</p>
        <button class="primary block" onClick={() => location.reload()}>
          Try again
        </button>
      </div>,
      root,
    );
  }
})();
