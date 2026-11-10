// @machine
// The one owner of every sheet's state (./machine.ts), so sheets and screens can wait on each other
// instead of guessing delays. BottomSheet records each of its moves here when it decides it (moveSheet),
// and a Modal that isn't a BottomSheet claims a place too (useModalClaim); nothing else writes it.
//
//   afterClose(() => router.push(...))        once every sheet up now has gone (+ SETTLE_MS)
//   afterClose(() => pick.record(), 600)      ... and never sooner than 600 ms (a native camera or picker)
//   useSheetsUp()                             how many sheets' Modals are up (root hosts wait for 0)
//   showEventFor(id, ancestors)               what `visible` turning true becomes: held while another is up
//   moveSheet(id, state, event)               a sheet's move, recorded at once; returns the next state
//   modalGone(id)                             its Modal unmounted in this commit: hidden from now
//   holdSheet(id, ancestors, { settle, drop }) a held sheet's wait: every other Modal gone, then SETTLE_MS
//   useModalClaim()                           a raw <Modal> (StepPlayerFull) counts while up and as it goes
//   pickToastViewport(viewports)              the newest viewport not inside a sheet that isn't open
//
// afterClose never waits forever: AFTER_CLOSE_CAP_MS (or minMs, if longer) runs it anyway. A held sheet
// never waits forever either: HELD_MAX_MS drops it.
import { useId, useLayoutEffect, useSyncExternalStore } from 'react';

import { motion } from '../../theme/tokens';
import { CLOSING_WAIT_MS, HELD_MAX_MS, isUp, SETTLE_MS, sheetMachine, showEvent, type SheetEvent, type SheetState } from './machine';

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

/** A sheet's state, as it is now: written by moveSheet and modalGone (BottomSheet) and the raw Modal claim. */
export function reportSheet(id: string, state: SheetState) {
  if (sheets.get(id) === state) return;
  sheets.set(id, state);
  changed();
}

/**
 * Sheet `id`'s Modal unmounted in this commit (BottomSheet's layout-effect cleanup, the commit that tells UIKit
 * to take it away): it's hidden from now, so a held sheet's SETTLE_MS starts no earlier than that.
 */
export function modalGone(id: string) {
  if (sheets.has(id)) reportSheet(id, 'hidden');
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

/**
 * Sheet `id` moves on `event` from `current`. The next state is recorded here at once, from the layout effect
 * or timer that decided it, not from a later effect: a sheet deciding in the same commit already sees it, so
 * two sheets shown together present one at a time. Returns the next state, null when the table has no move.
 */
export function moveSheet(id: string, current: SheetState, event: SheetEvent): SheetState | null {
  const next = sheetMachine.transition(current, event);
  if (next) reportSheet(id, next);
  return next;
}

/** Sheets whose Modal is up, but `except` and the sheets it sits inside (`ancestors`: it presents over those). */
export function upCount(except?: string, ancestors: readonly string[] = []): number {
  let n = 0;
  for (const [id, s] of sheets) if (id !== except && !ancestors.includes(id) && isUp(s)) n += 1;
  return n;
}

/**
 * The event `visible` turning true (on mount too) becomes on sheet `id`: `showBehind` while any other sheet's
 * Modal is up, its ancestors aside. A sheet hidden earlier in this same commit already reads `closing` here
 * (moveSheet), and one hidden later still reads `open`: either way it counts.
 */
export function showEventFor(id: string, ancestors: readonly string[] = []): SheetEvent {
  return showEvent(upCount(id, ancestors) > 0);
}

/**
 * A held sheet's wait. It presents (`settle`) SETTLE_MS after no other sheet's Modal is up (its ancestors
 * aside); a Modal that comes up meanwhile starts the wait again. After HELD_MAX_MS it gives up (`drop`)
 * instead of presenting over a Modal that is still up. Returns a cancel (the sheet hid, moved on or unmounted).
 * It waits on the others' state, so React's flush order doesn't matter. Before, a held sheet settled on a
 * 60 ms timer, and was safe only because React 19.2.3 (RN 0.86's ReactFabric-prod.js) re-armed it in the same
 * JS task: layout-effect dispatches run at Sync priority (line 9755), the commit ends in the sync-work loop
 * (9825, `do … while (didPerformSomeWork)` at 2079), and a Sync commit's passive effects flush at once (9817).
 */
export function holdSheet(id: string, ancestors: readonly string[], on: { settle: () => void; drop: () => void }): () => void {
  let done = false;
  let settling: unknown = null;
  const stop = () => {
    done = true;
    off();
    clock.clear(cap);
    if (settling != null) clock.clear(settling);
    settling = null;
  };
  const check = () => {
    if (done) return;
    if (upCount(id, ancestors) > 0) {
      if (settling != null) clock.clear(settling);
      settling = null;
    } else if (settling == null) {
      settling = clock.set(() => {
        settling = null;
        if (done || upCount(id, ancestors) > 0) return;
        stop();
        on.settle();
      }, SETTLE_MS);
    }
  };
  const off = subscribeSheets(check);
  const cap = clock.set(() => {
    if (done) return;
    stop();
    on.drop();
  }, HELD_MAX_MS);
  check();
  return () => {
    if (!done) stop();
  };
}

/** A Modal that isn't a BottomSheet came up: it counts as a sheet that is open. */
export function claimModal(id: string) {
  reportSheet(id, 'open');
}

/**
 * That Modal unmounted. UIKit is still taking it away (StepPlayerFull fades), so it counts as closing for
 * `closingMs` more, then it's forgotten. A sheet shown meanwhile waits behind it, as behind a closing sheet.
 */
export function releaseModal(id: string, closingMs: number = CLOSING_WAIT_MS) {
  if (!sheets.has(id)) return;
  reportSheet(id, 'closing');
  clock.set(() => {
    if (sheets.get(id) === 'closing') forgetSheet(id);
  }, closingMs);
}

/**
 * For a raw <Modal> mounted to open and unmounted to close (StepPlayerFull): claimed from its first layout
 * effect, released when it unmounts, also when the screen under it unmounts (React runs the cleanup).
 * scripts/test-sheets.mjs checks every raw <Modal> in src/ calls it.
 */
export function useModalClaim(closingMs: number = CLOSING_WAIT_MS) {
  const id = useId();
  useLayoutEffect(() => {
    claimModal(id);
    return () => releaseModal(id, closingMs);
  }, [id, closingMs]);
}

export function useSheetsUp(): number {
  return useSyncExternalStore(subscribeSheets, () => upCount(), () => 0);
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
