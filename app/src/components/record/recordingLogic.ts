// The recording screen's rules, pure (node scripts/test-recording-ui.mjs): what it shows in each of
// homie's phases, the elapsed clock, the pot for the voice service's state, homie's question as a
// moment, and what "Not now" sends.
import type { HomieMoment, HomieState } from '@/lib/homie/store';
import type { CookWords, WordKey } from '@/lib/homie/strings';

export type RecordPhase = 'connecting' | 'intro' | 'recording' | 'wrapping_up' | 'ended';
export type ServerState = 'listening' | 'thinking' | 'speaking' | 'quiet';
export type AskKind = 'intro' | 'amount' | 'cue' | 'substitution' | 'story' | 'reaction' | 'end' | 'closing' | 'optin';
export type Ask = { promptId: string; text: string; textEn: string; kind: AskKind };

/** "12:34", or "1:02:03" past an hour. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type RecordingView = {
  /** The status pill's words. */
  status: WordKey;
  /** The red dot is on (filming). */
  live: boolean;
  /** The one big button. */
  button: 'start' | 'done' | null;
  /** The clock: running, stopped where it ended, or not yet. */
  clock: 'running' | 'stopped' | 'none';
};

/**
 * `introDone`: homie finished its hello, so "Start cooking" shows. A phone recording films in the
 * phone's own camera, so this screen only shows its intro and its end.
 */
export function recordingView(phase: RecordPhase, source: 'phone' | 'glasses', introDone: boolean): RecordingView {
  const filming: WordKey = source === 'glasses' ? 'recordingGlasses' : 'recordingPhone';
  switch (phase) {
    case 'connecting':
      return { status: 'gettingReady', live: false, button: null, clock: 'none' };
    case 'intro':
      return { status: 'sayingHello', live: false, button: introDone ? 'start' : null, clock: 'none' };
    case 'recording':
      return { status: filming, live: true, button: 'done', clock: 'running' };
    case 'wrapping_up':
    case 'ended':
      return { status: 'wrappingUp', live: false, button: null, clock: 'stopped' };
  }
}

/** Where the cook goes once homie says goodbye: glasses videos upload from the VM; a phone's goes through Send. */
export function afterEnd(source: 'phone' | 'glasses'): 'home' | 'send' {
  return source === 'glasses' ? 'home' : 'send';
}

/** The pot for the voice service's `state` ('speaking' comes from the say itself: pulseLit). */
export function potFor(state: ServerState, micOn: boolean): HomieState | null {
  if (state === 'speaking') return null;
  if (state === 'thinking') return 'thinking';
  return micOn ? 'listening' : 'off';
}

/** An end question or the stories opt-in waits for her next words, so "Not now" is said as words. */
export function notNowMessage(kind: AskKind): { type: 'not_now' } | { type: 'text'; text: string } {
  return kind === 'end' || kind === 'optin' ? { type: 'text', text: 'not now' } : { type: 'not_now' };
}

/** homie's question as a moment (the screen adds onChoose). The opt-in asks Yes / Not now. */
export function askMoment(ask: Ask, w: CookWords, micOn: boolean): Omit<HomieMoment, 'onChoose'> {
  const opt = (id: string, key: WordKey, extra: { kind?: 'primary'; keepOpen?: boolean } = {}) => {
    const l = w.line(key);
    return { id, label: l.text, sublabel: l.en ?? undefined, ...extra };
  };
  const heard = w.line('justSayIt');
  return {
    id: ask.promptId,
    question: ask.text,
    questionEn: ask.textEn && ask.textEn !== ask.text ? ask.textEn : undefined,
    listening: micOn ? { label: heard.text, sublabel: heard.en ?? undefined } : undefined,
    options:
      ask.kind === 'optin'
        ? [opt('yes', 'yes', { kind: 'primary' }), opt('not_now', 'notNow')]
        : [opt('again', 'sayItAgain', { keepOpen: true }), opt('not_now', 'notNow')],
  };
}

/** "Shreya साठी · Chicken biryani" / "for Shreya · Chicken biryani". */
export function forLine(w: CookWords, kid: string | null | undefined, dish: string | null | undefined): string | null {
  const parts = [kid?.trim() ? w.text('forKid', { kid: kid.trim() }) : null, dish?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
