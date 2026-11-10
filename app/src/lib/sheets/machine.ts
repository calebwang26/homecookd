// @machine
// One sheet's lifecycle (components/ui/BottomSheet), as a table. Its native Modal is up in `open` and
// `closing`; the coordinator (./coordinator.ts) holds every sheet's state so they can wait on each other.
//
//   hidden   no Modal. `show`: open. `showBehind` (another sheet's Modal is up): held.
//   held     waiting to present. `settled` (every other Modal gone, then SETTLE_MS): open. `hide` drops it
//            unseen. `drop` (still waiting after HELD_MAX_MS): hidden, and its owner hears onDropped.
//   open     the Modal is up and the sheet slides in. `hide`: closing.
//   closing  sliding out, the Modal still up. `closeDone` (sheetCloseMs later) unmounts it; shown again
//            mid-way (`show` or `showBehind`) it's open again with no remount.
//
// The invariant: a sheet's Modal never presents while another sheet's Modal is up or still going away (iOS
// refuses it, and the refused Modal leaves the screen taking no taps: #402, and iOS journey 4 after the AI
// consent sheet, run 42838822300). A sheet that becomes visible while any other sheet's Modal is up (a
// sheet inside its content aside) is held, and a held sheet waits on the others' state, not on a timer
// (coordinator.holdSheet). Every move is recorded in the coordinator when it's decided (moveSheet), so a
// sheet deciding later in the same commit already sees it.
import { machine } from '../machine';

export const SHEET_EVENTS = ['show', 'showBehind', 'settled', 'hide', 'closeDone', 'drop'] as const;
export type SheetEvent = (typeof SHEET_EVENTS)[number];
export type SheetState = 'hidden' | 'held' | 'open' | 'closing';

export const sheetMachine = machine<SheetState, SheetEvent>('sheet', SHEET_EVENTS, {
  hidden: { show: 'open', showBehind: 'held' },
  held: { settled: 'open', hide: 'hidden', drop: 'hidden' },
  open: { hide: 'closing' },
  closing: { show: 'open', showBehind: 'open', closeDone: 'hidden' },
});

/** After every other sheet's Modal is gone, a few frames before a held sheet presents. */
export const SETTLE_MS = 60;
/**
 * The longest afterClose waits behind a closing sheet, and how long a Modal that isn't a BottomSheet
 * (coordinator.releaseModal: StepPlayerFull's fade) still counts as closing after it unmounts.
 */
export const CLOSING_WAIT_MS = 600;
/**
 * A held sheet gives up after this long (`drop`) instead of presenting over a Modal that is still up,
 * which is what freezes the screen. Long enough for someone to read the sheet in front of it (two root
 * asks at once), so it only ends a wait that a bug left behind.
 */
export const HELD_MAX_MS = 30_000;

/** Its native Modal is up. */
export const isUp = (s: SheetState | undefined): boolean => s === 'open' || s === 'closing';

/** `visible` turned true (on mount too): it waits while any other sheet's Modal is up. */
export function showEvent(othersUp: boolean): SheetEvent {
  return othersUp ? 'showBehind' : 'show';
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
