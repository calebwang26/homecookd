// Cook mode's voice rules, pure (node scripts/test-voice-ui.mjs): what each `say` from the voice service
// means for homie (docs/build/STACK.md "kid cooking additions"), the kitchen timers the app counts down,
// what the pot shows, and which of the cook's answers to offer the kid.
import type { HomieState } from '@/lib/homie/store';

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
// Half duplex

const silences = new Map<number, ArrayBuffer>();

/** Zeros the size of a mic chunk: what the socket gets instead of the mic while the app plays sound. */
export function silence(bytes: number): ArrayBuffer {
  let s = silences.get(bytes);
  if (!s) {
    s = new ArrayBuffer(bytes);
    silences.set(bytes, s);
  }
  return s;
}
