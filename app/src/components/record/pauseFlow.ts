// @machine
// state-machine-test: app/scripts/test-pause-flow.mjs
// Filming in the app, as the cook sees it (Caleb, Nov 12: "the only button is pause, and after they pause, they can
// click 'im done'"). She sets the phone up to cook, then moves on to another part of the cooking (cutting up the
// vegetables) out of the shot: she pauses, moves the phone and keeps filming. Every part is its own file
// (components/record/filming.ts), and "I'm done" sends them all, in order, as one recording.
//
//   idle     before filming. `start`: filming.
//   filming  the one button is Pause; "I'm done" isn't shown. `tapPause`: paused. `leaveApp` (a lock, a call):
//            away. `cameraStops` (a file failed, a flip never came up): stopped.
//   paused   she paused. The camera picture stays live so she can move the phone. The big button is Keep filming,
//            and "I'm done" shows. Leaving the app and coming back changes nothing: it never films by itself.
//   away     she left the app while filming. `backSoon` (a short trip, cameraLogic resumesBySelf): filming again
//            by itself. Otherwise the same screen as paused, with its own line.
//   stopped  the camera stopped by itself: the same screen, "The camera stopped. Your video so far is saved."
//   done     "I'm done": every file goes, in order (filming.ts stop).
//   From paused, away and stopped: `keepFilming` films again (if the camera can't, `cameraStops`: stopped), and
//   `imDone` ends it.
//
// The state comes from filming.ts's view (`flowState`): its phase, `trouble`, and `pausedBy` (whose pause it is),
// so the screen reads one state and never keeps flags of its own.
import { machine } from '../../lib/machine';

import { resumesBySelf, type CameraPhase } from './cameraLogic';
import type { Line, RecordWords } from './words';

export const PAUSE_FLOW_EVENTS = ['start', 'tapPause', 'leaveApp', 'backSoon', 'cameraStops', 'keepFilming', 'imDone'] as const;
export type PauseFlowEvent = (typeof PAUSE_FLOW_EVENTS)[number];
export type PauseFlowState = 'idle' | 'filming' | 'paused' | 'away' | 'stopped' | 'done';

const offScreen = { keepFilming: 'filming', imDone: 'done', cameraStops: 'stopped' } as const;

export const pauseFlowMachine = machine<PauseFlowState, PauseFlowEvent>('pauseFlow', PAUSE_FLOW_EVENTS, {
  idle: { start: 'filming' },
  filming: { tapPause: 'paused', leaveApp: 'away', cameraStops: 'stopped' },
  paused: offScreen,
  away: { ...offScreen, backSoon: 'filming' },
  stopped: { keepFilming: 'filming', imDone: 'done' },
  done: {},
});

/** Whose pause it is (filming.ts view `pausedBy`): her tap, or leaving the app. A camera that stopped is `trouble`. */
export type PausedBy = 'her' | 'away';

/** The state, from filming.ts's view. */
export function flowState(v: { phase: CameraPhase; trouble: boolean; pausedBy: PausedBy | null }): PauseFlowState {
  if (v.phase !== 'paused') return v.phase;
  if (v.trouble) return 'stopped';
  return v.pausedBy === 'her' ? 'paused' : 'away';
}

/** What the big button does in each state. */
export function pressAction(s: PauseFlowState): 'pause' | 'keepFilming' | null {
  if (s === 'filming') return 'pause';
  if (s === 'paused' || s === 'away' || s === 'stopped') return 'keepFilming';
  return null;
}

/** "I'm done" shows only while paused, never while filming (Caleb, Nov 12). */
export const showsImDone = (s: PauseFlowState) => pressAction(s) === 'keepFilming';

/** Back in the app: films again by itself only after a short trip away from filming, never after her own pause. */
export function resumesOnReturn(s: PauseFlowState, awayMs: number, reachedBackground: boolean): boolean {
  return pauseFlowMachine.transition(s, 'backSoon') !== null && resumesBySelf(awayMs, reachedBackground);
}

/**
 * The line under the big button, both parts in her language. While filming it says what a tap does ("Tap to
 * pause"), never a state: a bare "Pause" reads as if it were paused (Caleb, Nov 12). Paused, it says what the button
 * does ("Keep filming") and, small, why it is paused. Null: the screen's own line (before and after filming).
 */
export function flowLine(s: PauseFlowState, w: RecordWords): Line | null {
  if (s === 'filming') return { text: w.text('tapToPause'), en: w.text('moveCamera') };
  const why = s === 'paused' ? 'pausedMove' : s === 'away' ? 'stopped' : s === 'stopped' ? 'cameraTrouble' : null;
  return why ? { text: w.text('keepFilming'), en: w.text(why) } : null;
}

/** The pill on the camera card: "Recording · 4:07", "Paused · 4:07", or "Stopped" (the camera stopped by itself). */
export function pillLabel(s: PauseFlowState, clock: string): string | null {
  if (s === 'filming') return `Recording · ${clock}`;
  if (s === 'paused' || s === 'away') return `Paused · ${clock}`;
  if (s === 'stopped') return 'Stopped';
  return null;
}
