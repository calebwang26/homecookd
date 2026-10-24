// The recording screen's rules, pure (node scripts/test-recording-ui.mjs): the line under the big
// button in each of homie's phases, when filming starts by itself, the pot for the voice service's
// state, and what "not now" sends.
import type { HomieState } from '@/lib/homie/store';
import type { CookWords, Line } from '@/lib/homie/strings';

import type { RecordWords } from './words';

export type RecordPhase = 'connecting' | 'intro' | 'recording' | 'wrapping_up' | 'ended';
export type ServerState = 'listening' | 'thinking' | 'speaking' | 'quiet';
export type AskKind = 'intro' | 'amount' | 'cue' | 'substitution' | 'story' | 'reaction' | 'end' | 'closing' | 'optin';
export type Ask = { promptId: string; text: string; textEn: string; kind: AskKind };

export type RecordingView = {
  /** The one line under the button ("माझं झालं" / "Tap when you're done" while filming). */
  line: Line;
  /** Filming: the button breathes and a tap is "I'm done". */
  live: boolean;
};

/** Before filming the button rests under "homie is saying hello"; while filming it is the stop button. */
export function recordingView(phase: RecordPhase, w: { cook: CookWords; record: RecordWords }): RecordingView {
  switch (phase) {
    case 'connecting':
      return { line: w.cook.line('gettingReady'), live: false };
    case 'intro':
      return { line: w.cook.line('sayingHello'), live: false };
    case 'recording':
      return { line: w.record.line('stop'), live: true };
    case 'wrapping_up':
    case 'ended':
      return { line: w.cook.line('wrappingUp'), live: false };
  }
}

/**
 * Filming starts by itself once homie's hello has been said (`introDone`) and the phone has finished
 * playing it: starting while it still plays would make the service cut the hello off. (The screen
 * starts it once.)
 */
export function shouldAutoStart(s: { phase: RecordPhase; introDone: boolean; aiSpeaking: boolean; error: boolean }): boolean {
  return s.phase === 'intro' && s.introDone && !s.aiSpeaking && !s.error;
}

/** The pot for the voice service's `state` ('speaking' comes from the say itself: pulseLit). */
export function potFor(state: ServerState, micOn: boolean): HomieState | null {
  if (state === 'speaking') return null;
  if (state === 'thinking') return 'thinking';
  return micOn ? 'listening' : 'off';
}

/** An end question or the stories opt-in waits for her next words, so "not now" is said as words. */
export function notNowMessage(kind: AskKind): { type: 'not_now' } | { type: 'text'; text: string } {
  return kind === 'end' || kind === 'optin' ? { type: 'text', text: 'not now' } : { type: 'not_now' };
}

/** homie's question with its English under it (none when it's already English). */
export function askLine(ask: Pick<Ask, 'text' | 'textEn'>): Line {
  const en = ask.textEn?.trim();
  return { text: ask.text, en: en && en !== ask.text.trim() ? en : null };
}
