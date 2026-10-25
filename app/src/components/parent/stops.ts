// "Stopped · Undo" (Caleb, Oct 24: an x that just stops it, no confirm): a tap on a pending row's x
// marks it stopped at once and runs the real stop after UNDO_MS, unless Undo comes first. Module-level,
// so the wait survives switching tabs; the app going to the background runs every waiting stop now.
// Each id is 'waiting' (Undo still works), 'stopping' (the real stop is running) or 'gone' (it worked:
// the row stays hidden, even before Convex's live list catches up). A stop that fails is forgotten,
// so its row comes back as it was. Undo ignores a tap in the first UNDO_GUARD_MS: it sits where the x
// was, so a double tap on the x would otherwise undo the stop. Pure (no React Native), so
// scripts/test-parent-jobs.mjs runs it.
//   stopSoon(id, run)   undoStop(id)   flushStops()   const stops = useStops();  // id -> state
import { useSyncExternalStore } from 'react';

export const UNDO_MS = 5000;
/** With VoiceOver on: time to hear "Stopped" and find Undo. */
export const UNDO_MS_SCREEN_READER = 15_000;
export const UNDO_GUARD_MS = 700;

export type StopState = 'waiting' | 'stopping' | 'gone';
/** `run` resolves true once it's stopped, false (having said why) when it couldn't. */
type Run = () => Promise<boolean>;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const tappedAt = new Map<string, number>();
const runs = new Map<string, Run>();
let states: ReadonlyMap<string, StopState> = new Map();
const listeners = new Set<() => void>();

function set(id: string, state: StopState | null) {
  const next = new Map(states);
  if (state) next.set(id, state);
  else next.delete(id);
  states = next;
  for (const l of listeners) l();
}

function go(id: string) {
  const run = runs.get(id);
  if (!run || states.get(id) !== 'waiting') return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  runs.delete(id);
  set(id, 'stopping');
  void run()
    .catch(() => false)
    .then((ok) => set(id, ok ? 'gone' : null));
}

/** Marks `id` stopped now and runs `run` after `ms` (once). A second tap while it waits does nothing. */
export function stopSoon(id: string, run: Run, ms = UNDO_MS): void {
  if (states.has(id)) return;
  runs.set(id, run);
  tappedAt.set(id, Date.now());
  timers.set(id, setTimeout(() => go(id), ms));
  set(id, 'waiting');
}

/** Undo: true when the stop hadn't started yet (nothing was stopped). A tap right after the x is ignored. */
export function undoStop(id: string, now = Date.now()): boolean {
  if (states.get(id) !== 'waiting' || now - (tappedAt.get(id) ?? 0) < UNDO_GUARD_MS) return false;
  clearTimeout(timers.get(id));
  timers.delete(id);
  runs.delete(id);
  set(id, null);
  return true;
}

/** Runs every waiting stop now (the app is going to the background, where timers may never fire). */
export function flushStops(): void {
  for (const [id, state] of states) if (state === 'waiting') go(id);
}

/** `p`, or a rejection after `ms` (Convex queues a mutation while offline instead of failing it). */
export function inTime<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function stopState(id: string): StopState | null {
  return states.get(id) ?? null;
}

export function useStops(): ReadonlyMap<string, StopState> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => states,
    () => states,
  );
}
