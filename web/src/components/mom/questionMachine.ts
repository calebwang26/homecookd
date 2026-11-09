// Mom's answer screen (/a, QuestionScreen) as one explicit machine: the phase of the mic, which
// question she's on, and what the screen shows and allows in each phase. Pure: no React, no timers,
// no browser. QuestionScreen sends events and runs the commands; it never sets a phase itself.
// The pattern: docs/agents/STATE-MACHINES.md. The test (questionMachine.test.ts) checks every
// phase × event cell against the table below.
//
//   idle ──PRESS──▶ arming ──MIC_OK──▶ recording ──STOP──▶ saving ──SAVED──▶ saved ──NEXT──▶ idle (next question)
//                     │ MIC_DENIED | MIC_TIMEOUT ▶ blocked | elsewhere   │ LET_GO_SHORT ▶ recording (tap)
//                     │ MIC_LATE ▶ idle   BEGIN_FAILED ▶ blocked           NEXT on the last ▶ finishing
//   saving ──CLIP_OK──▶ saving (sends it)   ──CLIP_SHORT | CLIP_QUIET──▶ idle (with a note)
//   saving ──SAVE_RETRY──▶ retry ──RETRY_TAP──▶ saving        saving ──SAVE_REDO──▶ idle (failed; refused the 2nd time)
//   blocked ──MIC_RETRY──▶ idle, or one reload (back to this question), then blocked with help
//   finishing ──FINISH_FAILED──▶ sendFailed ──NEXT (Done) | RETRY_TAP──▶ finishing
//
// Guards: a mic answer only counts while arming; a clip or a save answer only while saving; a mic
// retry only while blocked; NEXT and BACK only where Skip and Back are enabled. Every other cell is
// null: the event is ignored.
//
// Invariant: a recording in flight is never dropped silently. While she is recording, or her answer
// or her Send is in flight, Back and Skip are disabled and a press doesn't start another recording.
// Everywhere else she can always go Back or Skip (decision 3, Caleb's yes on Nov 8):
//   arming: Back and Skip work, and a mic prompt that never answers gives up after ARM_MS into blocked;
//   elsewhere (an in-app browser) and a browser that can't record show Skip and a Copy link way out;
//   a refused mic retry reloads once, back to the same question, then explains instead of looping;
//   an answer refused twice in a row says so, instead of "Try again" forever;
//   a failed Send says so, with Try again, instead of going on to "Sent".
import type { WordKey } from '@/lib/dish/words';

export type Note = 'short' | 'quiet' | 'failed' | 'refused' | null;

/** The mic's phase. `P` is what a retry resends (QuestionScreen's Pending), opaque here. */
export type Phase<P = unknown> =
  | { k: 'idle'; note: Note }
  | { k: 'arming' }
  | { k: 'recording'; tap: boolean }
  | { k: 'saving' }
  | { k: 'saved' }
  | { k: 'retry'; pending: P }
  | { k: 'blocked'; help: boolean }
  | { k: 'elsewhere' }
  | { k: 'finishing' }
  | { k: 'sendFailed' };

export type PhaseKind = Phase['k'];
export const PHASES: readonly PhaseKind[] = ['idle', 'arming', 'recording', 'saving', 'saved', 'retry', 'blocked', 'elsewhere', 'finishing', 'sendFailed'];

/** `index` is the question shown, of `n`; `redos` counts refusals in a row on this question. */
export type QState<P = unknown> = { phase: Phase<P>; index: number; n: number; redos: number };

export type QEvent<P = unknown> =
  | { type: 'PRESS' } // a press or tap on the mic while idle
  | { type: 'MIC_OK'; tap: boolean } // the mic opened and the recorder started
  | { type: 'MIC_DENIED'; inApp: boolean } // the mic was refused or is missing
  | { type: 'MIC_TIMEOUT'; inApp: boolean } // the browser didn't answer within ARM_MS
  | { type: 'MIC_LATE' } // she let go while the browser asked: don't record behind her back
  | { type: 'BEGIN_FAILED' } // the mic opened but the recorder wouldn't start
  | { type: 'LET_GO_SHORT' } // a hold shorter than HOLD_MS: tap to start, tap to stop
  | { type: 'STOP' } // let go, a second tap, Enter, or the page hidden mid-answer
  | { type: 'CLIP_SHORT' } // under MIN_S, or nothing recorded
  | { type: 'CLIP_QUIET' } // no voice in it: never sent
  | { type: 'CLIP_OK' } // long enough and heard: send it
  | { type: 'SAVED' } // the answer is saved
  | { type: 'SAVE_RETRY'; pending: P } // not saved: Try again resends the same clip
  | { type: 'SAVE_REDO' } // refused: record it again
  | { type: 'SAVE_GONE' } // MomApp moved to another screen
  | { type: 'RETRY_TAP' } // Try again after SAVE_RETRY (the clip is in the retry phase), or after a failed Send
  | { type: 'MIC_RETRY'; ok: boolean; mayReload: boolean } // Try again on a blocked mic: did it open; may the page reload once?
  | { type: 'FINISH_FAILED' } // her Send didn't go through
  | { type: 'NEXT' } // Skip / Next / Done, or SAVED_MS after a save
  | { type: 'BACK' }; // Back: the question before, or out to the guess on the first

export type QEventType = QEvent['type'];
export const EVENTS: readonly QEventType[] = [
  'PRESS', 'MIC_OK', 'MIC_DENIED', 'MIC_TIMEOUT', 'MIC_LATE', 'BEGIN_FAILED', 'LET_GO_SHORT', 'STOP', 'CLIP_SHORT',
  'CLIP_QUIET', 'CLIP_OK', 'SAVED', 'SAVE_RETRY', 'SAVE_REDO', 'SAVE_GONE', 'RETRY_TAP', 'MIC_RETRY', 'FINISH_FAILED',
  'NEXT', 'BACK',
];

/**
 * What QuestionScreen does on arriving: `open` asks for the mic and `begin`s; `stop` stops the recorder
 * and reads the clip; `save` sends the clip; `scheduleNext` sends NEXT after SAVED_MS; `finish` calls
 * onFinish; `leave` calls onBack; `reload` reloads the page (once, back to this question).
 */
export type Cmd = 'open' | 'stop' | 'save' | 'scheduleNext' | 'finish' | 'leave' | 'reload';
export type Step<P = unknown> = { state: QState<P>; cmd?: Cmd };

/** A mic prompt that hasn't answered by now is treated as refused. */
export const ARM_MS = 8000;

const idle = (note: Note = null) => ({ k: 'idle', note }) as const;

/** Skip, Next and Done (and the timer after a save) move on here. */
const CAN_NEXT: readonly PhaseKind[] = ['idle', 'arming', 'retry', 'blocked', 'elsewhere', 'saved', 'sendFailed'];
/** Back works here. */
const CAN_BACK: readonly PhaseKind[] = ['idle', 'arming', 'retry', 'blocked', 'elsewhere', 'sendFailed'];

export function transition<P>(s: QState<P>, e: QEvent<P>): Step<P> | null {
  const k = s.phase.k;
  const at = (phase: Phase<P>, cmd?: Cmd): Step<P> => ({ state: { ...s, phase }, cmd });
  const moveTo = (index: number): Step<P> => ({ state: { ...s, index, phase: idle(), redos: 0 } });
  switch (e.type) {
    case 'PRESS':
      return k === 'idle' ? at({ k: 'arming' }, 'open') : null;
    case 'MIC_OK':
      return k === 'arming' ? at({ k: 'recording', tap: e.tap }) : null;
    case 'MIC_DENIED':
    case 'MIC_TIMEOUT':
      return k === 'arming' ? at(e.inApp ? { k: 'elsewhere' } : { k: 'blocked', help: false }) : null;
    case 'MIC_LATE':
      return k === 'arming' ? at(idle()) : null;
    case 'BEGIN_FAILED':
      return k === 'arming' ? at({ k: 'blocked', help: false }) : null;
    case 'LET_GO_SHORT':
      return s.phase.k === 'recording' && !s.phase.tap ? at({ k: 'recording', tap: true }) : null;
    case 'STOP':
      return k === 'recording' ? at({ k: 'saving' }, 'stop') : null;
    case 'CLIP_SHORT':
      return k === 'saving' ? at(idle('short')) : null;
    case 'CLIP_QUIET':
      return k === 'saving' ? at(idle('quiet')) : null;
    case 'CLIP_OK':
      return k === 'saving' ? at({ k: 'saving' }, 'save') : null;
    case 'SAVED':
      return k === 'saving' ? { state: { ...s, phase: { k: 'saved' }, redos: 0 }, cmd: 'scheduleNext' } : null;
    case 'SAVE_RETRY':
      return k === 'saving' ? at({ k: 'retry', pending: e.pending }) : null;
    case 'SAVE_REDO':
      if (k !== 'saving') return null;
      return { state: { ...s, phase: idle(s.redos + 1 >= 2 ? 'refused' : 'failed'), redos: s.redos + 1 } };
    case 'SAVE_GONE':
      return null; // MomApp shows another screen; this one stays as it was until it unmounts
    case 'RETRY_TAP':
      if (k === 'retry') return at({ k: 'saving' }, 'save');
      if (k === 'sendFailed') return at({ k: 'finishing' }, 'finish');
      return null;
    case 'MIC_RETRY':
      if (k !== 'blocked') return null; // she moved on before the answer came: ignore it
      if (e.ok) return at(idle());
      return e.mayReload ? at(s.phase, 'reload') : at({ k: 'blocked', help: true });
    case 'FINISH_FAILED':
      return k === 'finishing' ? at({ k: 'sendFailed' }) : null;
    case 'NEXT':
      if (!CAN_NEXT.includes(k)) return null;
      return s.index < s.n - 1 ? moveTo(s.index + 1) : at({ k: 'finishing' }, 'finish');
    case 'BACK':
      if (!CAN_BACK.includes(k)) return null;
      return s.index > 0 ? moveTo(s.index - 1) : at(s.phase, 'leave');
  }
}

export type QView = {
  /** The line under the mic. */
  label: WordKey;
  /** The mic's look: `data-state` on the button. */
  mic: 'rec' | 'saved' | 'saving' | 'retry' | 'idle';
  /** The mic button is there at all (not in a browser that can't record, not in an in-app browser). */
  micShown: boolean;
  /** The mic button reads as disabled (a save is in flight or just landed). */
  micDisabled: boolean;
  /** The mic shows "Try again" instead of the glyph. */
  retrying: boolean;
  /** The spinner ring around the mic. */
  spinner: boolean;
  backEnabled: boolean;
  /** Skip / Next / Done is on the page at all, and whether it can be tapped. */
  skipShown: boolean;
  skipEnabled: boolean;
  /** "Copy link", to open the page in Safari or Chrome. */
  copyLink: boolean;
};

function labelOf(p: Phase): WordKey {
  switch (p.k) {
    case 'idle':
      return p.note === 'short' ? 'm3.short' : p.note === 'quiet' ? 'm3.quiet' : p.note === 'failed' ? 'm3.failed' : p.note === 'refused' ? 'm3.refused' : 'm3.hold';
    case 'arming':
      return 'm3.hold';
    case 'recording':
      return p.tap ? 'm3.tapStop' : 'm3.letGo';
    case 'saving':
    case 'finishing':
      return 'm3.saving';
    case 'saved':
      return 'm3.saved';
    case 'retry':
      return 'm3.failed';
    case 'blocked':
      return p.help ? 'm3.blockedHelp' : 'm3.blocked';
    case 'elsewhere':
      return 'm3.elsewhere';
    case 'sendFailed':
      return 'm3.sendFailed';
  }
}

/** What the screen shows and allows. `canRecord`: this browser can record at all (MediaRecorder + getUserMedia). */
export function view(p: Phase, canRecord: boolean): QView {
  const saving = p.k === 'saving' || p.k === 'finishing';
  // In flight: her voice or a request. Nothing else may move her off this question (the invariant).
  const busy = saving || p.k === 'recording' || p.k === 'saved';
  const retrying = p.k === 'retry' || p.k === 'blocked' || p.k === 'sendFailed';
  const micShown = canRecord && p.k !== 'elsewhere';
  return {
    label: canRecord ? labelOf(p) : 'm3.elsewhere',
    mic: p.k === 'recording' ? 'rec' : p.k === 'saved' ? 'saved' : saving ? 'saving' : retrying ? 'retry' : 'idle',
    micShown,
    micDisabled: saving || p.k === 'saved',
    retrying,
    spinner: saving,
    backEnabled: !busy,
    skipShown: true,
    skipEnabled: !busy,
    copyLink: !micShown,
  };
}
