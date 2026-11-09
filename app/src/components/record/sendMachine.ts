// @machine
// state-machine-test: app/scripts/test-send.mjs
// Send's big button (app/send.tsx) as a table: docs/agents/STATE-MACHINES.md row 5, and decision 8 (Caleb,
// Nov 8): from the first tap until "On its way" shows, Send can't be tapped again.
//
//   idle         Send can be tapped. `tap` (videos, a dish and a cook are all there): asking.
//   asking       her yes to the AI companies (lib/aiConsent; its sheet if she hasn't answered).
//                `consented`: uploading. `declined`: idle.
//   uploading    the hello voice note goes up, the videos are kept on the phone with a note (sendKept) and
//                their background upload starts. `started`: creatingJob. `failed`: failed.
//   creatingJob  jobs.create is asked for (the home card asks again until it's made: jobRetry.ts) and who
//                gets the recipe is saved (POST /pending-sends). `sent`: sent. `failed`: failed.
//   sent         it's sent: the button keeps its spinner while the screen fades. `shown`: done.
//   done         "On its way to Leo" (SuccessBurst); the screen leaves when it ends. Nothing moves it.
//   failed       "Didn't send" and why, for ERROR_MS. `cleared`: idle, where she taps again (the retry).
//
// The invariant: one tap, one send. Only idle takes `tap`, and the screen moves the state the moment it's
// tapped (useMachineNow), so a second tap in the same frame, during her consent, the upload, the fade or
// the burst does nothing.
// The resend path: from `uploading` on, the send has a note on the phone (sendKept). If the app dies before
// the note goes (every video up and the job made), the next launch sends it again (useResendUnsent,
// unsentLogic.resendStep), never this screen. A failure before any upload exists puts the note back as it
// was, so her own tap after `failed` is the only second try.
import { machine } from '@/lib/machine';

export const SEND_EVENTS = ['tap', 'consented', 'declined', 'started', 'sent', 'failed', 'shown', 'cleared'] as const;
export type SendEvent = (typeof SEND_EVENTS)[number];
export type SendState = 'idle' | 'asking' | 'uploading' | 'creatingJob' | 'sent' | 'done' | 'failed';

export const sendMachine = machine<SendState, SendEvent>('send', SEND_EVENTS, {
  idle: { tap: 'asking' },
  asking: { consented: 'uploading', declined: 'idle' },
  uploading: { started: 'creatingJob', failed: 'failed' },
  creatingJob: { sent: 'sent', failed: 'failed' },
  sent: { shown: 'done' },
  done: {},
  failed: { cleared: 'idle' },
});

/** The button's look in each state (ActionButton): the spinner from the upload until the burst. */
export function buttonState(s: SendState): 'idle' | 'loading' | 'error' {
  if (s === 'failed') return 'error';
  return s === 'uploading' || s === 'creatingJob' || s === 'sent' ? 'loading' : 'idle';
}

/** The screen is locked (Back, the swipe, the videos, the people, the dish, the hello): the send is going. */
export const sending = (s: SendState) => buttonState(s) === 'loading';

/** The fade before the burst, and how long "Didn't send" stays on the button (as send.tsx had them). */
export const FADE_MS = 220;
export const ERROR_MS = 1800;

export type SendClock = { now: () => number; wait: (ms: number) => Promise<void> };
export const realClock: SendClock = { now: () => Date.now(), wait: (ms) => new Promise((r) => setTimeout(r, ms)) };

export type SendSteps = {
  /** Her yes to the AI companies (ensureAiConsent). */
  consent: () => Promise<boolean>;
  /** The send: calls `started()` once the background upload has started, resolves once it's sent. */
  send: (started: () => void) => Promise<void>;
  /** Sent, and the spinner's least time is over: fade the screen out. */
  fade: () => void;
  /** It failed (after the spinner's least time): say why. */
  failed: (e: unknown) => void;
  /** The screen is still there. */
  alive: () => boolean;
};

/**
 * One tap on Send, start to end, moving the machine through `go` (which says whether an event moved it).
 * A tap the machine doesn't take ('ignored') does nothing at all: no consent ask, no upload.
 */
export async function runSend(
  go: (event: SendEvent) => boolean,
  steps: SendSteps,
  leastMs: number,
  clock: SendClock = realClock,
): Promise<'ignored' | 'declined' | 'sent' | 'failed'> {
  if (!go('tap')) return 'ignored';
  if (!(await steps.consent())) {
    go('declined');
    return 'declined';
  }
  go('consented');
  const from = clock.now();
  const least = async () => {
    const wait = leastMs - (clock.now() - from);
    if (wait > 0) await clock.wait(wait);
  };
  try {
    await steps.send(() => void go('started'));
  } catch (e) {
    await least();
    if (!steps.alive()) return 'failed';
    go('failed');
    steps.failed(e);
    await clock.wait(ERROR_MS);
    if (steps.alive()) go('cleared');
    return 'failed';
  }
  go('sent');
  await least();
  if (!steps.alive()) return 'sent';
  steps.fade();
  await clock.wait(FADE_MS);
  if (steps.alive()) go('shown');
  return 'sent';
}
