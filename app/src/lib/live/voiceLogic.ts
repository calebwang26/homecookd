// Cook mode's voice rules, pure (node scripts/test-voice-ui.mjs): what each `say` from the voice service
// means for homie (docs/build/STACK.md "kid cooking additions"), which `say_end` and transcript belong
// to what, when voice starts on its own, when the phone reads aloud itself, app-only moments and the
// read-aloud offer's end, the kid's spoken yes or no, when homie is 'thinking', the kitchen timers the
// app counts down, what the pot shows, which of the cook's answers to offer the kid, and what keeps
// Cartesia from billing for audio nobody said (which mic frames go out, the app leaving the screen).
import type { HomieMoment, HomieState } from '@/lib/homie/store';

export type SayKind = 'step' | 'reply' | 'hint' | 'translation' | 'nudge' | 'offer' | 'greeting' | 'timer';
const KINDS: ReadonlySet<string> = new Set<SayKind>(['step', 'reply', 'hint', 'translation', 'nudge', 'offer', 'greeting', 'timer']);

/** An older service (Track B) sends no kind; it marks a translation with `translation: true`. */
export function sayKind(m: { kind?: unknown; translation?: unknown }): SayKind {
  if (typeof m.kind === 'string' && KINDS.has(m.kind)) return m.kind as SayKind;
  return m.translation ? 'translation' : 'reply';
}

export type OfferKind = 'read' | 'story';

/** homie asking for a tap: read the steps out loud, or hear the cook's story about this step. */
export function offerOf(kind: SayKind, text: string): OfferKind | null {
  if (kind === 'offer') return 'read';
  if (kind === 'nudge' && /\bstor(y|ies)\b/i.test(text)) return 'story';
  return null;
}

/** The label under the pot while a say plays; undefined is the overlay's own "AI voice". */
export function sayLabel(kind: SayKind, cookName: string): string | undefined {
  if (kind === 'translation') return `Translated from ${cookName}`;
  if (kind === 'hint') return 'AI hint';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The line to the service

/**
 * A `say_end` arrived; `open` lines had started without one. The service cuts a line off when it
 * starts the next one (or a clip), and that line's end arrives after the next one's `say`: an end
 * while a newer line is still open is the old line's (`stale`), never the current one's.
 */
export function endSay(open: number): { open: number; stale: boolean } {
  const left = Math.max(0, open - 1);
  return { open: left, stale: left > 0 };
}

/** A text the phone sent ({ type: "text" }), waiting for the service's echo. */
export type SentText = { key: string; at: number };
/** An echo comes back at once; one this late isn't (the service dropped that text). */
const ECHO_MAX_MS = 5000;

export const sentText = (text: string, at: number): SentText => ({ key: text.trim().toLowerCase(), at });

/**
 * The service repeats every { type: "text" } at once as a finished transcript. Where that echo is in
 * what this phone sent (-1: the kid really said it).
 */
export function echoAt(sent: readonly SentText[], text: string, now: number): number {
  const key = text.trim().toLowerCase();
  return sent.findIndex((s) => s.key === key && now - s.at <= ECHO_MAX_MS);
}

/**
 * The "Let Mom see" sheet is out of the way: it isn't up, and it won't come (its question needs the
 * server's answer first: `consent` stays 'unknown' until then). Voice starts, and homie asks, only
 * then (one thing asks at a time).
 */
export function consentSettled(v: { askConsent: boolean; liveOn: boolean; consent: string; startFailed: boolean }): boolean {
  return !v.askConsent && (!v.liveOn || v.consent !== 'unknown' || v.startFailed);
}

/**
 * "Leo is cooking" (lib/useCookingSession) is on for this visit: the same test as that hook's own
 * `on`. Off (a memorial cook, the web dev aid, no dish yet) there is no "Let Mom see" answer to wait
 * for, so it is consentSettled's `liveOn`.
 */
export function cookingSessionOn(v: { enabled: boolean; cookId?: string | null; memorial?: boolean | null; recipeId?: string | null; total: number }): boolean {
  return v.enabled && !!v.cookId && !v.memorial && !!v.recipeId && v.total >= 1;
}

/**
 * No voice line reads for the kid (Expo Go, web, no voice service, or the line gave up or failed):
 * the phone itself offers "read it out loud?" and reads each step in homie's voice.
 */
export function phoneReads(v: { voiceHere: boolean; live: boolean; unavailable: boolean }): boolean {
  return !v.live && (!v.voiceHere || v.unavailable);
}

// ---------------------------------------------------------------------------------------------
// App-only moments and the service's read-aloud offer (the shared contract with the voice service)

/** A moment the app opened on its own (not the service's offer or story nudge). */
export type AppMomentKind = 'answer' | 'story' | 'ask' | 'help';

/**
 * Which app-only moment this is, from the id cook mode gave it (components/cooking/CookMoments):
 * "<cook> answered your question" and "Ask <cook> anything". The read-aloud offer and the story
 * nudge are the service's own offers (its yes plays them), so they never count.
 */
export function appMomentKind(id: string | null | undefined): AppMomentKind | null {
  if (!id) return null;
  if (id.startsWith('answer:')) return 'answer';
  if (id.startsWith('ask:')) return 'ask';
  return null;
}

/**
 * What /cook gets when an app-only moment opens or closes: while one is open, the service still
 * streams transcripts, but a "yes" / "no" / "sure" is the moment's, not an answer to its own offer.
 */
export function momentMessage(kind: AppMomentKind | null): { type: 'moment'; open: true; kind: AppMomentKind } | { type: 'moment'; open: false } {
  return kind ? { type: 'moment', open: true, kind } : { type: 'moment', open: false };
}

/** The service's { type: "offer_closed", accepted }: the read-aloud offer is over (true: it reads). */
export function offerClosed(m: { accepted?: unknown }): boolean {
  return m.accepted === true;
}

/**
 * The read-aloud choice to keep after the service's offer_closed, or null when the phone already has
 * that answer. The service's answer wins when it differs: it heard the kid after the phone moved on.
 */
export function readAfterOfferClosed(current: 'yes' | 'no' | null, accepted: boolean): 'yes' | 'no' | null {
  const c = accepted ? 'yes' : 'no';
  return current === c ? null : c;
}

/**
 * The { type: "text" } that declines the service's read-aloud offer for this visit: sent for a tap
 * anywhere on the offer, or a "no" this phone remembers. Steps then change silently.
 */
export const DECLINE_TEXT = 'no';

// What homie takes for yes and for no (voice/src/cook.ts), so the phone and homie agree: yes is its
// `isYes` (a yes and anything after it, never a command), no is its `NO_REPLY` (a whole no, after
// fillers and "thanks"), and a no wins, as it does there ("ok, no" declines).
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|read it|read it out loud|do it|let'?s hear it)( .*)?$/;
const NO = /^(no|nope|nah|no no|not now|not right now|not yet|later|maybe later|no not now|no maybe later|i'?m good|no i'?m good|skip it)$/;
const COMMANDS = /^(next|next step|next one|what'?s next|done|go on|go back|back|previous|previous step|last step|step back|repeat|repeat that|again|say that again|one more time|what)$/;
const normalize = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
const command = (t: string) =>
  normalize(t)
    .replace(/^((um|uh|wait|okay|ok|so|hey|alright|and|now) )+/, '')
    .replace(/( (please|thanks|thank you))+$/, '');
const reply = (t: string) =>
  normalize(t)
    .replace(/^((um|uh|oh|ah|hmm|mm|well|wait|okay|ok|so|hey|alright|and|now) )+/, '')
    .replace(/( (please|thanks|thank you))+$/, '');

/** The kid's answer to homie's yes-or-no question, out loud; null for anything else ("next", a question). */
export function yesNo(text: string): 'yes' | 'no' | null {
  if (COMMANDS.test(command(text))) return null;
  if (NO.test(reply(text))) return 'no';
  return YES.test(normalize(text)) ? 'yes' : null;
}

// The service's `yesOrNo`: a whole reply that is only a yes ("yes please", "play it") or only a no.
const WHOLE_YES = /^(yes|yeah|yep|yup|sure|ok|okay|alright|please|of course|go ahead|do it|read it|read it to me|read it out loud|let'?s hear it|play it)( (yes|yeah|yep|sure|ok|okay|please))*$/;

/** A whole yes or no (voice/src/cook.ts yesOrNo): what the service holds for an app-only moment. */
export function wholeYesNo(text: string): 'yes' | 'no' | null {
  const c = reply(text);
  return WHOLE_YES.test(c) ? 'yes' : NO.test(c) ? 'no' : null;
}

/**
 * The kid's finished words: does homie start 'thinking' (an answer is on its way)? Not for the echo
 * of this phone's own text (a chip's, or the "no" for a tap on the offer), not for a whole yes or no
 * while an app-only moment is up (the service holds it for the phone), and not for a whole no while
 * any moment is up (the service closes its offer and says nothing back).
 */
export function thinksAfter(v: { echo: boolean; appMoment: boolean; momentUp: boolean; text: string }): boolean {
  if (v.echo) return false;
  const yn = wholeYesNo(v.text);
  if (v.appMoment && yn) return false;
  return !(v.momentUp && yn === 'no');
}

/** Messages that are homie doing something (an answer to the kid). */
export const HOMIE_ACTIONS: ReadonlySet<string> = new Set(['go_to_step', 'play_clip', 'asked_cook', 'timer', 'timer_done']);

/** 'thinking' ends with homie's answer: an action, a line, or the offer closing (a no gets no line). */
export function endsThinking(type: string): boolean {
  return HOMIE_ACTIONS.has(type) || type === 'say' || type === 'offer_closed';
}

export const SAY_YES_NO = 'Say “yes” or “no”';
export const TAP_TO_CLOSE = 'Tap anywhere to close';

/**
 * homie's yes-or-no question as a moment (Caleb, Oct 24): no buttons, the listening bars and "Say
 * “yes” or “no”"; a tap anywhere closes it ("not now", only for this visit). A phone that can't hear
 * the answer (no mic, mic off) gets one button for yes instead. onChoose gets 'yes' (the button) or
 * 'not_now' (a tap anywhere).
 */
export function yesNoMoment(m: { id: string; question: string; questionEn?: string; hearing: boolean; button: string; onChoose: (choice: string) => void }): HomieMoment {
  const base = { id: m.id, question: m.question, questionEn: m.questionEn, tapToClose: TAP_TO_CLOSE, onChoose: m.onChoose };
  return m.hearing ? { ...base, options: [], bars: true, prompt: { label: SAY_YES_NO } } : { ...base, options: [{ id: 'yes', label: m.button, kind: 'primary' }] };
}

/** What the pot shows on the cook screen, under homie's own lit / speaking beat. */
export function cookPotState(v: { status: 'off' | 'connecting' | 'listening' | 'error'; muted: boolean; thinking: boolean; timers: number; timerDue: boolean }): HomieState {
  if (v.timerDue) return 'timer';
  if (v.status === 'connecting') return 'thinking';
  if (v.status === 'listening' && !v.muted) return v.thinking ? 'thinking' : 'listening';
  return v.timers ? 'timer' : 'off';
}

// ---------------------------------------------------------------------------------------------
// Timers

export type CookTimer = { id: string; label: string; endsAt: number; totalS: number };
const MAX_TIMER_S = 24 * 3600;

/**
 * A `timer` message as this phone's countdown: it ends `seconds` from now on our clock (the service's
 * `endsAt` is on its clock). Null when it is malformed.
 */
export function parseTimer(m: { id?: unknown; seconds?: unknown; label?: unknown }, now: number): CookTimer | null {
  const seconds = Number(m.seconds);
  if (typeof m.id !== 'string' || !m.id || !Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMER_S) return null;
  const label = typeof m.label === 'string' && m.label.trim() ? m.label.trim() : 'timer';
  return { id: m.id, label, endsAt: now + Math.round(seconds * 1000), totalS: seconds };
}

/** Soonest first; a timer with the same id replaces the old one. */
export function withTimer(list: readonly CookTimer[], t: CookTimer): CookTimer[] {
  return [...list.filter((x) => x.id !== t.id), t].sort((a, b) => a.endsAt - b.endsAt);
}

export function withoutTimer(list: readonly CookTimer[], id: string): CookTimer[] {
  return list.filter((x) => x.id !== id);
}

/** One timer, not just its id: the service starts its ids again at "timer-1" on each socket. */
export function timerKey(t: Pick<CookTimer, 'id' | 'endsAt'>): string {
  return `${t.id}:${t.endsAt}`;
}

/** Whole seconds left, rounded up: 0 only once it is done. */
export function secondsLeft(t: Pick<CookTimer, 'endsAt'>, now: number): number {
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

/** "4:32", "12:00", "1:05:00". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "Rice timer, 4 minutes 32 seconds left" / "Rice timer is done". */
export function timerA11y(t: Pick<CookTimer, 'label' | 'endsAt'>, now: number): string {
  const name = t.label === 'timer' ? 'Timer' : `${t.label[0].toUpperCase()}${t.label.slice(1)} timer`;
  const left = secondsLeft(t, now);
  if (!left) return `${name} is done`;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '');
  const words = [part(Math.floor(left / 3600), 'hour'), part(Math.floor((left % 3600) / 60), 'minute'), part(left % 60, 'second')].filter(Boolean).join(' ');
  return `${name}, ${words} left`;
}

// ---------------------------------------------------------------------------------------------
// The cook's answers (Convex questions.forRecipe rows)

export type AnswerRow = {
  _id: string;
  _creationTime: number;
  status: string;
  text: string;
  askedByName?: string;
  answerAudioUrl?: string | null;
};

/**
 * The cook's voice answers to my questions about this dish that I haven't heard, newest first. Mine =
 * asked under my name, or sent to the cook from this cook mode (`mine`). Only questions asked after
 * `since`, so an old answer doesn't pop up forever.
 */
export function answersToHear<T extends AnswerRow>(
  rows: readonly T[],
  o: { myName?: string | null; mine?: ReadonlySet<string>; heard: ReadonlySet<string>; skipped?: ReadonlySet<string>; since: number },
): T[] {
  const name = o.myName?.trim().toLowerCase();
  return rows
    .filter((r) => r.status === 'answered' && !!r.answerAudioUrl && r._creationTime >= o.since)
    .filter((r) => o.mine?.has(r._id) || (!!name && r.askedByName?.trim().toLowerCase() === name))
    .filter((r) => !o.heard.has(r._id) && !o.skipped?.has(r._id))
    .sort((a, b) => b._creationTime - a._creationTime);
}

// ---------------------------------------------------------------------------------------------
// Half duplex and Cartesia credits (Ink 2 bills every second of audio it gets, silence too)

/**
 * A mic frame goes to /cook only when it is the kid's (Cartesia credit fix A): never one lib/live/mic
 * zeroed because the app makes sound (`quiet`), nor one while another screen is on top. Nothing is
 * sent instead; the service's own half duplex (voice/src/cook.ts hearing) is the backup.
 */
export function cookSendsFrame(v: { quiet: boolean; focused: boolean }): boolean {
  return !v.quiet && v.focused;
}

/** The app is on screen (React Native AppState): not in the background, nor under a system sheet. */
export function appInForeground(state: string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * What cook mode's voice line does when the app's state changes (Cartesia credit fix B). In the
 * background or under a system sheet ('inactive') the line was on (`lineOn`): it closes ('pause'),
 * so nothing streams. Back on top after a pause: it opens again ('resume'; the mic only if the kid
 * hadn't turned it off). The mic's own permission prompt (`asking`) makes iOS 'inactive' too: not a pause.
 */
export function appStateStep(v: { next: string; lineOn: boolean; paused: boolean; asking: boolean }): 'pause' | 'resume' | null {
  if (appInForeground(v.next)) return v.next === 'active' && v.paused ? 'resume' : null;
  if (v.next === 'inactive' && v.asking) return null;
  return v.lineOn && !v.paused ? 'pause' : null;
}

const silences = new Map<number, ArrayBuffer>();

/** Zeros the size of a mic chunk: what lib/live/mic hands on instead of the mic while the app plays sound. */
export function silence(bytes: number): ArrayBuffer {
  let s = silences.get(bytes);
  if (!s) {
    s = new ArrayBuffer(bytes);
    silences.set(bytes, s);
  }
  return s;
}
