// The recording screen's rules, pure (node scripts/test-recording-ui.mjs): the line under the big
// button in each of homie's phases, when filming starts by itself, the pot for the voice service's
// state, what "not now" sends, when homie's centred moment is up and what it shows (a question, or
// held between the wrap-up's questions), what the mic sends while the phone plays sound (half
// duplex), and how long the wrap-up may sit still before the app ends the recording without homie.
import type { HomieState } from '@/lib/homie/store';

import type { Line, RecordWords } from './words';

export type RecordPhase = 'connecting' | 'intro' | 'recording' | 'wrapping_up' | 'ended';
export type ServerState = 'listening' | 'thinking' | 'speaking' | 'quiet';
export type AskKind = 'intro' | 'amount' | 'show' | 'cue' | 'substitution' | 'story' | 'reaction' | 'end' | 'plate' | 'closing' | 'optin';
export type Ask = { promptId: string; text: string; textEn: string; kind: AskKind };

export type RecordingView = {
  /** The one line under the button ("माझं झालं" / "Tap when you're done" while filming). */
  line: Line;
  /** Filming: the button breathes and a tap is "I'm done". */
  live: boolean;
};

/** Before filming the button rests under "homie is saying hello"; while filming it is the stop button. */
export function recordingView(phase: RecordPhase, w: RecordWords): RecordingView {
  switch (phase) {
    case 'connecting':
      return { line: w.line('gettingReady'), live: false };
    case 'intro':
      return { line: w.line('sayingHello'), live: false };
    case 'recording':
      return { line: w.line('stop'), live: true };
    case 'wrapping_up':
    case 'ended':
      return { line: w.line('wrappingUp'), live: false };
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

/**
 * A line homie says while the wrap-up holds it in the centre with no question up (the count line,
 * "That's okay, no need to answer today"). `id` is new for every line, so the same words said twice
 * still count as a new line.
 */
export type HeldLine = { id: number; text: string; textEn?: string | null };

/** homie's centred moment (AskMoment): when it is up, and what it shows. */
export type MomentView = {
  /** homie big in the middle: a question is up, or the wrap-up holds homie there between questions. */
  open: boolean;
  /** The words under homie, keyed so a change crossfades in place: the question, else (held) homie's line. */
  words: { key: string; line: Line } | null;
  /** A question is up: the listening bars and "Just answer out loud", and a tap is "not now". */
  asking: boolean;
};

/** What lib/live/homie keeps from the service's hold: whether homie is held, and its line meanwhile. */
export type Held = { hold: boolean; said: HeldLine | null };
export const NOT_HELD: Held = { hold: false, said: null };

export type HeldEvent =
  | { type: 'hold'; on: boolean }
  /** A line homie starts saying; `askUp` = a question is on screen (then it is that question, or a nudge under it). */
  | { type: 'say'; line: HeldLine; askUp: boolean }
  | { type: 'ask' }
  /** A new or lost socket, a pause, the end: like the question, the hold goes with it. */
  | { type: 'reset' };

/**
 * The hold from the service's messages. Only a line said while held with no question up is shown
 * (so a reaction from earlier in the filming never turns up), and a question clears it: once that
 * question is answered, nothing stale comes back under homie.
 */
export function heldAfter(s: Held, e: HeldEvent): Held {
  switch (e.type) {
    case 'hold':
      return e.on ? (s.hold ? s : { hold: true, said: null }) : NOT_HELD;
    case 'say':
      return s.hold && !e.askUp ? { hold: true, said: e.line } : s;
    case 'ask':
      return s.said ? { ...s, said: null } : s;
    case 'reset':
      return NOT_HELD;
  }
}

const CLOSED: MomentView = { open: false, words: null, asking: false };

/**
 * The voice service's `{type:"hold", on}` keeps homie in the middle across the wrap-up's run of
 * questions, so it never goes back to its corner between two of them. With no hold (an older
 * service, or filming) it is up exactly while a question is. The plate photo has its own view
 * (PlateMoment), and once the recording has ended nothing holds homie.
 */
export function momentView(s: { ask: Ask | null; hold: boolean; said: HeldLine | null; ended: boolean }): MomentView {
  if (s.ended || s.ask?.kind === 'plate') return CLOSED;
  if (s.ask) return { open: true, words: { key: `ask:${s.ask.promptId}`, line: askLine(s.ask) }, asking: true };
  if (!s.hold) return CLOSED;
  return { open: true, words: s.said ? { key: `said:${s.said.id}`, line: askLine({ text: s.said.text, textEn: s.said.textEn ?? '' }) } : null, asking: false };
}

/**
 * Half duplex (docs/build/STACK.md): while homie is lit or speaking, or anything plays on the phone's
 * shared player (homie's say, a clip), the voice service gets silence instead of the mic, so it never
 * hears the phone's own sound as her words. The recorder itself keeps running.
 */
export function micQuiet(homie: HomieState, player: { key: string | null; phase: string }): boolean {
  if (homie === 'lit' || homie === 'speaking') return true;
  return !!player.key && (player.phase === 'loading' || player.phase === 'playing');
}

const silences = new Map<number, ArrayBuffer>();

/** Zeros the size of a mic chunk: what the socket gets instead of the mic while the phone plays sound. */
export function silence(bytes: number): ArrayBuffer {
  let s = silences.get(bytes);
  if (!s) {
    s = new ArrayBuffer(bytes);
    silences.set(bytes, s);
  }
  return s;
}

/** homie's wrap-up with nothing moving (no phase, question or line) for this long has stalled. */
export const WRAP_STALL_MS = 120_000;
/** ...or this long once the voice service reported an error or its connection was lost. */
export const WRAP_TROUBLE_MS = 20_000;

/** How long the wrap-up may sit still before the app ends the recording itself (live.endRecording). */
export function wrapStallMs(trouble: boolean): number {
  return trouble ? WRAP_TROUBLE_MS : WRAP_STALL_MS;
}
