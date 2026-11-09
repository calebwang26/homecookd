// The last 20 events of each state machine on the site (Mom's page: momMachine, questionMachine), so a check that
// fails on a stuck screen shows the events that led there. The app keeps the same history (app/src/lib/machine.ts).
//
// Development builds only (`next dev`, which the QA scripts in web/scripts/qa run against): a production build
// compiles `record` to nothing. It stays in this tab's memory and is never sent anywhere (/privacy: the site has no
// error reporting). Only names are kept, an event's type and the two states, never what it carries (her recording,
// a token).
//
// The QA scripts read it from the page with `window.__homecookdMachines()` when a check fails.

export const HISTORY_SIZE = 20;

/** One event: its type, the state it came in, the state it led to (null: it did nothing), when (ms since page load). */
export type MachineStep = { event: string; from: string; to: string | null; t: number };

const histories = new Map<string, MachineStep[]>();
// React runs a setState updater twice in development (Strict Mode), so the same event object can arrive twice.
const lastEvent = new Map<string, object>();

const on = () => process.env.NODE_ENV !== 'production';

/** Keep one event of machine `name`. Call it where the event is sent, with the states' names. */
export function record(name: string, event: { type: string }, from: string, to: string | null): void {
  if (!on()) return;
  const h = histories.get(name) ?? [];
  const last = h[h.length - 1];
  if (lastEvent.get(name) === event && last?.from === from) return;
  lastEvent.set(name, event);
  h.push({ event: event.type, from, to, t: Math.round(typeof performance === 'undefined' ? 0 : performance.now()) });
  if (h.length > HISTORY_SIZE) h.splice(0, h.length - HISTORY_SIZE);
  histories.set(name, h);
  if (typeof window !== 'undefined') (window as unknown as { __homecookdMachines?: typeof machineHistory }).__homecookdMachines = machineHistory;
}

/** Every machine's recent events, oldest first (copies). */
export function machineHistory(): Record<string, MachineStep[]> {
  return Object.fromEntries([...histories].map(([name, h]) => [name, h.map((x) => ({ ...x }))]));
}

/** Forget every history (tests). */
export function clearMachineHistory(): void {
  histories.clear();
  lastEvent.clear();
}
