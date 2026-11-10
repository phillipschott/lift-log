import { useEffect, useState } from 'preact/hooks';
import * as db from './data/db';
import { dayKey } from './logic/dates';
import { pendingCloseOuts } from './logic/food';
import { useDb } from './ui/common';
import { Home } from './ui/Home';
import { Food } from './ui/Food';
import { Workout } from './ui/Workout';
import { CloseOut } from './ui/CloseOut';
import { History } from './ui/History';
import { Settings } from './ui/Settings';

export type Screen =
  | { name: 'home' }
  | { name: 'workout'; dayId: string }
  | { name: 'food' }
  | { name: 'history' }
  | { name: 'settings' };

/** Today's DayKey, refreshed when the app comes back to the foreground (3 a.m. rollover). */
function useToday(): string {
  const [today, setToday] = useState(dayKey());
  useEffect(() => {
    const check = () => setToday(dayKey());
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const t = setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      clearInterval(t);
    };
  }, []);
  return today;
}

export function App() {
  const today = useToday();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const pending = useDb(
    async () => {
      const [days, food] = await Promise.all([db.listFoodDays(), db.allFood()]);
      const { prompt } = pendingCloseOuts(days, food, today);
      return { day: prompt[0], food };
    },
    [today],
  );

  useEffect(() => window.scrollTo(0, 0), [screen]);

  if (!pending) return null;
  if (pending.day) return <CloseOut key={pending.day.date} day={pending.day} entries={pending.food} />;

  const home = () => setScreen({ name: 'home' });
  switch (screen.name) {
    case 'workout':
      return <Workout key={screen.dayId} dayId={screen.dayId} today={today} onBack={home} />;
    case 'food':
      return <Food today={today} onBack={home} />;
    case 'history':
      return <History onBack={home} />;
    case 'settings':
      return <Settings onBack={home} />;
    default:
      return <Home today={today} go={setScreen} />;
  }
}
