// @machine
// One sheet's lifecycle (components/ui/BottomSheet), as a table. Its native Modal is up in `open` and
// `closing`; the coordinator (./coordinator.ts) holds every sheet's state so they can wait on each other.
//
//   hidden   no Modal. `show`: open. `showBehind` (another sheet's Modal may still be going): held.
//   held     waiting to present; `settled` (the wait timer) opens it, `hide` drops it unseen.
//   open     the Modal is up and the sheet slides in. `hide`: closing.
//   closing  sliding out, the Modal still up. `closeDone` (sheetCloseMs later) unmounts it; shown again
//            mid-way (`show` or `showBehind`) it's open again with no remount.
//
// The invariant: a sheet's Modal never presents while another sheet's Modal is still going away (iOS
// refuses it, or leaves an invisible Modal that takes every tap: #402).
// Which event `visible` becomes is decided outside the table (initialSheetState, showEvent): a sheet
// that becomes visible, created so or shown later, waits while any other sheet's Modal is up. That one
// may be hiding in this same tap and reports `closing` only from its effect (#402: "New message" →
// "Add family"; the AI consent sheet's "OK, continue" → Record's pre-record sheet, iOS journey 4).
import { machine } from '../machine';

export const SHEET_EVENTS = ['show', 'showBehind', 'settled', 'hide', 'closeDone'] as const;
export type SheetEvent = (typeof SHEET_EVENTS)[number];
export type SheetState = 'hidden' | 'held' | 'open' | 'closing';

export const sheetMachine = machine<SheetState, SheetEvent>('sheet', SHEET_EVENTS, {
  hidden: { show: 'open', showBehind: 'held' },
  held: { settled: 'open', hide: 'hidden' },
  open: { hide: 'closing' },
  closing: { show: 'open', showBehind: 'open', closeDone: 'hidden' },
});

/** After another sheet's Modal is gone, a few frames before this one presents. */
export const SETTLE_MS = 60;
/** The longest a sheet waits while another one is still closing. */
export const CLOSING_WAIT_MS = 600;

/** Its native Modal is up. */
export const isUp = (s: SheetState | undefined): boolean => s === 'open' || s === 'closing';

/** A sheet's first state: created visible, it waits when any other sheet's Modal is up. */
export function initialSheetState(visible: boolean, othersUp: boolean): SheetState {
  if (!visible) return 'hidden';
  return othersUp ? 'held' : 'open';
}

/** `visible` turned true on a sheet that already exists: like one created visible, it waits while any other Modal is up. */
export function showEvent(othersUp: boolean): SheetEvent {
  return othersUp ? 'showBehind' : 'show';
}

/** How long a held sheet waits before `settled`: the cap while another is closing, else a few frames. */
export function heldWaitMs(othersClosing: boolean): number {
  return othersClosing ? CLOSING_WAIT_MS : SETTLE_MS;
}

/**
 * A root host's sheet (the AI consent ask): rendered at the app's root, where UIKit won't present a Modal
 * over another one, so it waits until no sheet's Modal is up, then stays until it's no longer wanted.
 *   idle     `want`: waiting.
 *   waiting  `clear` (no sheet up): showing. `drop`: idle.
 *   showing  `drop`: idle (its own sheet being up doesn't matter any more).
 */
export const ROOT_HOST_EVENTS = ['want', 'clear', 'drop'] as const;
export type RootHostEvent = (typeof ROOT_HOST_EVENTS)[number];
export type RootHostState = 'idle' | 'waiting' | 'showing';
export const rootHostMachine = machine<RootHostState, RootHostEvent>('rootHost', ROOT_HOST_EVENTS, {
  idle: { want: 'waiting' },
  waiting: { clear: 'showing', drop: 'idle' },
  showing: { drop: 'idle' },
});
