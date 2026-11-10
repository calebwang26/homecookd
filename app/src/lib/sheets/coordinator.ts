// @machine
// The one owner of every sheet's state (./machine.ts), so sheets and screens can wait on each other
// instead of guessing delays. BottomSheet reports its state here; nothing else writes it.
//
//   afterClose(() => router.push(...))        once every sheet up now has gone (+ SETTLE_MS)
//   afterClose(() => pick.record(), 600)      ... and never sooner than 600 ms (a native camera or picker)
//   useSheetsUp()                             how many sheets' Modals are up (root hosts wait for 0)
//   showEventFor(id)                          what `visible` turning true becomes: held while any other is up
//   pickToastViewport(viewports)              the newest viewport not inside a sheet that isn't open
//
// afterClose never waits forever: AFTER_CLOSE_CAP_MS (or minMs, if longer) runs it anyway.
import { useSyncExternalStore } from 'react';

import { motion } from '../../theme/tokens';
import { CLOSING_WAIT_MS, isUp, SETTLE_MS, showEvent, type SheetEvent, type SheetState } from './machine';

const sheets = new Map<string, SheetState>();
const listeners = new Set<() => void>();
let version = 0;

/** Swapped by scripts/test-sheets.mjs for a fake clock. */
export const clock = {
  now: () => Date.now(),
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

function changed() {
  version += 1;
  for (const l of [...listeners]) l();
}

export function subscribeSheets(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** BottomSheet's report of its own state (from an effect). */
export function reportSheet(id: string, state: SheetState) {
  if (sheets.get(id) === state) return;
  sheets.set(id, state);
  changed();
}

/** BottomSheet unmounted. */
export function forgetSheet(id: string) {
  if (!sheets.has(id)) return;
  sheets.delete(id);
  changed();
}

export function sheetState(id: string): SheetState | undefined {
  return sheets.get(id);
}

/** Sheets whose Modal is up, `except` one. */
export function upCount(except?: string): number {
  let n = 0;
  for (const [id, s] of sheets) if (id !== except && isUp(s)) n += 1;
  return n;
}

/** Another sheet's Modal is still going away. */
export function othersClosing(except?: string): boolean {
  for (const [id, s] of sheets) if (id !== except && s === 'closing') return true;
  return false;
}

/**
 * The event `visible` turning true becomes on sheet `id` (BottomSheet, before paint): `showBehind` while any
 * other sheet's Modal is up, as the coordinator has it now. A sheet hidden in this same commit still reads
 * `open` here (it reports `closing` from its effect), so it counts: presenting now would be over it.
 */
export function showEventFor(id: string): SheetEvent {
  return showEvent(upCount(id) > 0);
}

export function useSheetsUp(): number {
  return useSyncExternalStore(subscribeSheets, () => upCount(), () => 0);
}

export function useOthersClosing(id: string): boolean {
  return useSyncExternalStore(subscribeSheets, () => othersClosing(id), () => false);
}

/** Re-renders on any sheet change (Toast's viewport choice). */
export function useSheetsVersion(): number {
  return useSyncExternalStore(subscribeSheets, () => version, () => 0);
}

/** The longest afterClose waits for sheets to go: one close, the closing cap and the settle. */
export const AFTER_CLOSE_CAP_MS = motion.sheetCloseMs + CLOSING_WAIT_MS + SETTLE_MS;

/**
 * Runs `fn` once every sheet whose Modal is up right now has unmounted, SETTLE_MS later, and never
 * sooner than `minMs` from now. Call it in the same handler that closes a sheet: that sheet still
 * counts as up. Returns a cancel.
 */
export function afterClose(fn: () => void, minMs = 0): () => void {
  const start = clock.now();
  const waitFor = [...sheets].filter(([, s]) => isUp(s)).map(([id]) => id);
  let done = false;
  let timer: unknown = null;
  const run = () => {
    if (done) return;
    done = true;
    off();
    clock.clear(cap);
    if (timer != null) clock.clear(timer);
    fn();
  };
  const check = () => {
    if (done || timer != null) return;
    if (waitFor.some((id) => isUp(sheets.get(id)))) return;
    timer = clock.set(run, Math.max(SETTLE_MS, minMs - (clock.now() - start)));
  };
  const off = subscribeSheets(check);
  const cap = clock.set(run, Math.max(minMs, AFTER_CLOSE_CAP_MS));
  check();
  return () => {
    if (done) return;
    done = true;
    off();
    clock.clear(cap);
    if (timer != null) clock.clear(timer);
  };
}

/** afterClose as a promise: `setSheet(false); await whenSheetsClosed(600); pick.record();` */
export function whenSheetsClosed(minMs = 0): Promise<void> {
  return new Promise((resolve) => {
    afterClose(resolve, minMs);
  });
}

export type ToastViewportRef = { id: string; sheetId?: string };

/** The newest viewport that is on screen: the root's, or one inside a sheet that is open (not held or closing). */
export function pickToastViewport(viewports: readonly ToastViewportRef[], stateOf: (sheetId: string) => SheetState | undefined = sheetState): string | null {
  for (let i = viewports.length - 1; i >= 0; i -= 1) {
    const v = viewports[i];
    if (!v.sheetId || stateOf(v.sheetId) === 'open') return v.id;
  }
  return null;
}
