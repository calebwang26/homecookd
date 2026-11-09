// @machine
// Whether the signed-in family's own dishes have been checked, so "No recipes yet" never shows before
// they could arrive (Caleb's yes, Nov 8: decision 4). library.json is empty now, so it says nothing.
//
//   signedOut  nobody picked: nothing to wait for. `signIn`: waiting.
//   waiting    the family's rows haven't answered for this person. `rows`: ready. `timeout`
//              (FAMILY_WAIT_MS, the read failed or never came): gaveUp. `signIn` (someone else): waiting.
//   ready      the rows answered. A new `signIn` waits again; `signOut`: signedOut.
//   gaveUp     shown as checked (the empty state, as before); rows arriving late still make it ready.
//
// The invariant: an empty list reads as "no recipes" only in signedOut, ready or gaveUp. The person each
// state is for (its key) is kept beside it by lib/recipes.ts, which sends `signIn` only when the key changes.
import { machine } from './machine';

export const LIBRARY_LOAD_EVENTS = ['signIn', 'signOut', 'rows', 'timeout'] as const;
export type LibraryLoadEvent = (typeof LIBRARY_LOAD_EVENTS)[number];
export type LibraryLoadState = 'signedOut' | 'waiting' | 'ready' | 'gaveUp';

export const libraryLoadMachine = machine<LibraryLoadState, LibraryLoadEvent>('libraryLoad', LIBRARY_LOAD_EVENTS, {
  signedOut: { signIn: 'waiting' },
  waiting: { rows: 'ready', timeout: 'gaveUp', signIn: 'waiting', signOut: 'signedOut' },
  ready: { signIn: 'waiting', signOut: 'signedOut' },
  gaveUp: { rows: 'ready', signIn: 'waiting', signOut: 'signedOut' },
});

/** How long an empty list waits for the family's rows before it shows as empty anyway. */
export const FAMILY_WAIT_MS = 8000;

/** An empty list here means the family has no dishes (or we stopped waiting). */
export function familyChecked(state: LibraryLoadState): boolean {
  return state !== 'waiting';
}
