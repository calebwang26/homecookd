// @machine
// state-machine-test: app/scripts/test-send.mjs
// Home's "Send again" on a recording whose upload gave up (Caleb, Nov 10: "Yes, if he'll upload, should say send
// again"). It is Send's own machine (components/record/sendMachine: idle → asking → uploading → creatingJob → sent →
// done, or failed → idle), one per recording, held here so one tap is one send exactly as on the Send screen: only
// idle takes `tap`, so a tap during her consent, the upload or the job does nothing, and a failure says why for
// ERROR_MS, then the button is back for her own next try. The send itself is the one a launch does for that note
// (components/record/useResendUnsent sendNoteAgain): its old job stopped, its kept videos sent again (sendDraft).
//
//   await sendAgain(noteId, { consent, send, failed })   her tap (components/parent/PendingRecipes)
//   sendAgainLook(noteId)                                 the row's button: 'offer' | 'sending' | 'error'
//   useSendAgainVersion()                                 re-renders Home on any change
import { useSyncExternalStore } from 'react';

import { realClock, runSend, sendMachine, type SendClock, type SendEvent, type SendState, type SendSteps } from '@/components/record/sendMachine';
import { holdMachine } from '@/lib/machine';

/** The spinner's least time, so a quick send doesn't flash. */
export const SEND_AGAIN_LEAST_MS = 450;

type Held = { now: () => SendState; send: (event: SendEvent) => boolean };

const held = new Map<string, Held>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Where that recording's Send again is ('idle' when she hasn't tapped it, or the last tap is over). */
export function sendAgainState(noteId: string): SendState {
  return held.get(noteId)?.now() ?? 'idle';
}

/** The row's button in that state: tappable, its spinner (her consent, the upload, the job, sent), or "Didn't send". */
export function sendAgainLook(noteId: string): 'offer' | 'sending' | 'error' {
  const s = sendAgainState(noteId);
  return s === 'idle' ? 'offer' : s === 'failed' ? 'error' : 'sending';
}

export function useSendAgainVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/**
 * One tap on that recording's Send again, start to end (runSend). 'ignored': a send of it is already going, so
 * nothing happens. Once the tap is over (sent, she said no, or it failed and its "Didn't send" has shown), the
 * next one starts from idle: a new send of the same recording that gives up again offers the button again.
 */
export async function sendAgain(
  noteId: string,
  steps: Pick<SendSteps, 'consent' | 'send' | 'failed'>,
  clock: SendClock = realClock,
): Promise<'ignored' | 'declined' | 'sent' | 'failed'> {
  let m = held.get(noteId);
  if (!m) {
    m = holdMachine<SendState, SendEvent>(sendMachine, 'idle', changed);
    held.set(noteId, m);
  }
  const mine = m;
  const result = await runSend((e) => mine.send(e), { ...steps, fade: () => {}, alive: () => held.get(noteId) === mine }, SEND_AGAIN_LEAST_MS, clock);
  if (result !== 'ignored' && held.get(noteId) === mine) {
    held.delete(noteId);
    changed();
  }
  return result;
}
