// The voice service's stand-in for cook mode (lib/live/voice), used when the build has no
// EXPO_PUBLIC_VOICE_URL or Convex is stubbed, and only when the kid turns the mic on by hand. It can't
// understand speech, but it takes the PCM, so the mic streaming can be checked on a phone.
import { stubAskCook } from './convex';
import { MIC_SAMPLE_RATE } from './mic';

/** The part of a WebSocket cook mode uses, so the stub can stand in. */
export type Socket = {
  send: (data: ArrayBuffer | string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: ((e?: { code?: number }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  readyState: number;
};

/**
 * Reports the PCM it got every 3 s of audio (not as a finished turn, so the pot keeps listening).
 * Every 4th report asks the cook on the Convex stub, so the parent's side can be tried on one phone.
 */
export function stubSocket(recipeId: string, step: () => number): Socket {
  let bytes = 0;
  let reports = 0;
  const s: Socket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    send(data) {
      if (typeof data === 'string') return;
      bytes += data.byteLength;
      const seconds = Math.floor(bytes / (MIC_SAMPLE_RATE * 2));
      if (seconds >= (reports + 1) * 3) {
        reports += 1;
        s.onmessage?.({ data: JSON.stringify({ type: 'transcript', text: `Hearing you · ${seconds} s`, final: false }) });
        if (reports % 4 === 0) {
          const questionId = stubAskCook(recipeId, 'How do I know when it’s done?', step());
          s.onmessage?.({ data: JSON.stringify({ type: 'asked_cook', questionId }) });
        }
      }
    },
    close() {
      s.readyState = 3;
      setTimeout(() => s.onclose?.(), 0);
    },
  };
  setTimeout(() => {
    s.readyState = 1;
    s.onopen?.();
  }, 150);
  return s;
}
