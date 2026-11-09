// Mom's answer screen (/a, QuestionScreen) as one explicit machine: the phase of the mic, which
// question she's on, and what the screen shows and allows in each phase. Pure: no React, no timers,
// no browser. QuestionScreen sends events and runs the commands; it never sets a phase itself.
// The pattern: docs/agents/STATE-MACHINES.md. The test (questionMachine.test.ts) checks every
// phase × event cell against the table below.
//
//   idle ──PRESS──▶ arming ──MIC_OK──▶ recording ──STOP──▶ saving ──SAVED──▶ saved ──NEXT──▶ idle (next question)
//                     │ MIC_DENIED ▶ blocked | elsewhere    │ LET_GO_SHORT ▶ recording (tap)   │ NEXT on the last ▶ finishing
//                     │ MIC_LATE ▶ idle   BEGIN_FAILED ▶ blocked
//   saving ──CLIP_OK──▶ saving (sends it)   ──CLIP_SHORT | CLIP_QUIET──▶ idle (with a note)
//   saving ──SAVE_RETRY──▶ retry ──RETRY_TAP──▶ saving
//   saving ──SAVE_REDO──▶ idle (failed)                       blocked ──MIC_RETRY──▶ idle, or reload the page
//
// Guards: a mic answer only counts while arming; a clip or a save answer only while saving; NEXT
// and BACK only where Skip and Back are enabled. Every other cell is null: the event is ignored, as
// the early returns in QuestionScreen ignored it before.
//
// Invariant: a recording in flight is never dropped silently. While she is recording or her answer
// is saving, Back and Skip are disabled and a press doesn't start another recording.
//
// Today's behaviour, kept on purpose until Caleb's yes on decision 3 (STATE-MACHINES.md):
//   arming disables Back and Skip, even if the browser's mic prompt never answers;
//   elsewhere (an in-app browser) hides the mic and Skip;
//   a refused mic retry reloads the page (Safari keeps "Don't Allow" until a reload);
//   MIC_RETRY is honoured in any phase, because the reply can land after she skipped on.
import type { WordKey } from '@/lib/dish/words';

export type Note = 'short' | 'quiet' | 'failed' | null;

/** The mic's phase. `P` is what a retry resends (QuestionScreen's Pending), opaque here. */
export type Phase<P = unknown> =
  | { k: 'idle'; note: Note }
  | { k: 'arming' }
  | { k: 'recording'; tap: boolean }
  | { k: 'saving' }
  | { k: 'saved' }
  | { k: 'retry'; pending: P }
  | { k: 'blocked' }
  | { k: 'elsewhere' }
  | { k: 'finishing' };

export type PhaseKind = Phase['k'];
export const PHASES: readonly PhaseKind[] = ['idle', 'arming', 'recording', 'saving', 'saved', 'retry', 'blocked', 'elsewhere', 'finishing'];

/** `index` is the question shown, of `n`. */
export type QState<P = unknown> = { phase: Phase<P>; index: number; n: number };

export type QEvent<P = unknown> =
  | { type: 'PRESS' } // a press or tap on the mic while idle
  | { type: 'MIC_OK'; tap: boolean } // the mic opened and the recorder started
  | { type: 'MIC_DENIED'; inApp: boolean } // the mic was refused or is missing
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
  | { type: 'RETRY_TAP'; pending: P } // Try again after SAVE_RETRY
  | { type: 'MIC_RETRY'; ok: boolean } // Try again on a blocked mic: did it open?
  | { type: 'NEXT' } // Skip / Next / Done, or SAVED_MS after a save
  | { type: 'BACK' }; // Back: the question before, or out to the guess on the first

export type QEventType = QEvent['type'];
export const EVENTS: readonly QEventType[] = [
  'PRESS', 'MIC_OK', 'MIC_DENIED', 'MIC_LATE', 'BEGIN_FAILED', 'LET_GO_SHORT', 'STOP', 'CLIP_SHORT', 'CLIP_QUIET',
  'CLIP_OK', 'SAVED', 'SAVE_RETRY', 'SAVE_REDO', 'SAVE_GONE', 'RETRY_TAP', 'MIC_RETRY', 'NEXT', 'BACK',
];

/**
 * What QuestionScreen does on arriving: `open` asks for the mic and `begin`s; `stop` stops the recorder
 * and reads the clip; `save` sends the clip; `scheduleNext` sends NEXT after SAVED_MS; `finish` calls
 * onFinish; `leave` calls onBack; `reload` reloads the page.
 */
export type Cmd = 'open' | 'stop' | 'save' | 'scheduleNext' | 'finish' | 'leave' | 'reload';
export type Step<P = unknown> = { state: QState<P>; cmd?: Cmd };

const idle = (note: Note = null) => ({ k: 'idle', note }) as const;

/** Skip, Next and Done (and the timer after a save) move on here. */
const CAN_NEXT: readonly PhaseKind[] = ['idle', 'retry', 'blocked', 'saved'];
/** Back works here. */
const CAN_BACK: readonly PhaseKind[] = ['idle', 'retry', 'blocked', 'elsewhere'];

export function transition<P>(s: QState<P>, e: QEvent<P>): Step<P> | null {
  const k = s.phase.k;
  const at = (phase: Phase<P>, cmd?: Cmd): Step<P> => ({ state: { ...s, phase }, cmd });
  switch (e.type) {
    case 'PRESS':
      return k === 'idle' ? at({ k: 'arming' }, 'open') : null;
    case 'MIC_OK':
      return k === 'arming' ? at({ k: 'recording', tap: e.tap }) : null;
    case 'MIC_DENIED':
      return k === 'arming' ? at({ k: e.inApp ? 'elsewhere' : 'blocked' }) : null;
    case 'MIC_LATE':
      return k === 'arming' ? at(idle()) : null;
    case 'BEGIN_FAILED':
      return k === 'arming' ? at({ k: 'blocked' }) : null;
    case 'LET_GO_SHORT':
      return k === 'recording' && s.phase.k === 'recording' && !s.phase.tap ? at({ k: 'recording', tap: true }) : null;
    case 'STOP':
      return k === 'recording' ? at({ k: 'saving' }, 'stop') : null;
    case 'CLIP_SHORT':
      return k === 'saving' ? at(idle('short')) : null;
    case 'CLIP_QUIET':
      return k === 'saving' ? at(idle('quiet')) : null;
    case 'CLIP_OK':
      return k === 'saving' ? at({ k: 'saving' }, 'save') : null;
    case 'SAVED':
      return k === 'saving' ? at({ k: 'saved' }, 'scheduleNext') : null;
    case 'SAVE_RETRY':
      return k === 'saving' ? at({ k: 'retry', pending: e.pending }) : null;
    case 'SAVE_REDO':
      return k === 'saving' ? at(idle('failed')) : null;
    case 'SAVE_GONE':
      return null; // MomApp shows another screen; this one stays as it was until it unmounts
    case 'RETRY_TAP':
      return k === 'retry' ? at({ k: 'saving' }, 'save') : null;
    case 'MIC_RETRY':
      // Any phase: the reply can land after she skipped on (kept as it was; see the header).
      return e.ok ? at(idle()) : at(s.phase, 'reload');
    case 'NEXT':
      if (!CAN_NEXT.includes(k)) return null;
      return s.index < s.n - 1 ? { state: { ...s, index: s.index + 1, phase: idle() } } : at({ k: 'finishing' }, 'finish');
    case 'BACK':
      if (!CAN_BACK.includes(k)) return null;
      return s.index > 0 ? { state: { ...s, index: s.index - 1, phase: idle() } } : at(s.phase, 'leave');
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
};

function labelOf(p: Phase): WordKey {
  switch (p.k) {
    case 'idle':
      return p.note === 'short' ? 'm3.short' : p.note === 'quiet' ? 'm3.quiet' : p.note === 'failed' ? 'm3.failed' : 'm3.hold';
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
      return 'm3.blocked';
    case 'elsewhere':
      return 'm3.elsewhere';
  }
}

/** What the screen shows and allows. `canRecord`: this browser can record at all (MediaRecorder + getUserMedia). */
export function view(p: Phase, canRecord: boolean): QView {
  const saving = p.k === 'saving' || p.k === 'finishing';
  const busy = saving || p.k === 'arming' || p.k === 'recording' || p.k === 'saved';
  const retrying = p.k === 'retry' || p.k === 'blocked';
  const micShown = canRecord && p.k !== 'elsewhere';
  return {
    label: canRecord ? labelOf(p) : 'm3.elsewhere',
    mic: p.k === 'recording' ? 'rec' : p.k === 'saved' ? 'saved' : saving ? 'saving' : retrying ? 'retry' : 'idle',
    micShown,
    micDisabled: saving || p.k === 'saved',
    retrying,
    spinner: saving,
    backEnabled: !busy,
    skipShown: micShown,
    skipEnabled: !busy,
  };
}
