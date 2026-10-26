// Small helpers shared by the inboxes and the chat: dish names, pronouns, inbox times, previews,
// and "is this question still waiting for an answer?".
import type { Message, Profile } from '@/lib/api';
import { clock, daysAgo } from '@/lib/format';
import { isQuestion } from '@/lib/messaging';
import type { LibraryEntry } from '@/lib/types';
import { english, type T, type WordKey } from '@/lib/words/words';

const SHORT_DAYS: readonly WordKey[] = [
  'messages.time.sun',
  'messages.time.mon',
  'messages.time.tue',
  'messages.time.wed',
  'messages.time.thu',
  'messages.time.fri',
  'messages.time.sat',
];
const MON: readonly WordKey[] = [
  'messages.time.jan',
  'messages.time.feb',
  'messages.time.mar',
  'messages.time.apr',
  'messages.time.may',
  'messages.time.jun',
  'messages.time.jul',
  'messages.time.aug',
  'messages.time.sep',
  'messages.time.oct',
  'messages.time.nov',
  'messages.time.dec',
];

/** Inbox row time like the bible: "8:30 pm" today, "Yesterday", "Sat" this week, else "Sep 28". */
export function inboxTime(iso: string | null | undefined, now: Date = new Date(), t: T = english): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ago = daysAgo(d, now);
  if (ago <= 0) return clock(d, t);
  if (ago === 1) return t('messages.time.yesterday');
  if (ago < 7) return t(SHORT_DAYS[d.getDay()]);
  return t('messages.time.date', { month: t(MON[d.getMonth()]), day: d.getDate() });
}

const SHE = /^(mom|mum|mother|mama|grandma|granny|nai ?nai|po ?po|ma|aunt|auntie|aunty|sister|sis|daughter|wife|grandmother|nana)\b/i;
const HE = /^(dad|father|papa|pa|grandpa|grandfather|uncle|brother|bro|son|husband|ye ?ye|gong ?gong)\b/i;

/** "she" / "he" / "they" from a profile's relation (or name, for Mom/Dad/Grandma). */
export function pronoun(p: Pick<Profile, 'name' | 'relation'> | null | undefined): 'she' | 'he' | 'they' {
  const s = `${p?.relation ?? ''}`.trim() || `${p?.name ?? ''}`.trim();
  if (SHE.test(s)) return 'she';
  if (HE.test(s)) return 'he';
  return 'they';
}

/** "her" / "his" / "their". */
export function possessivePronoun(p: Pick<Profile, 'name' | 'relation'> | null | undefined): 'her' | 'his' | 'their' {
  const x = pronoun(p);
  return x === 'she' ? 'her' : x === 'he' ? 'his' : 'their';
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * A dish title without its cook's possessive ("Dad's Sunday Chili" -> "Sunday Chili") when the
 * conversation already says whose it is.
 */
export function dishName(entry: Pick<LibraryEntry, 'title' | 'cook_name'> | null | undefined): string {
  if (!entry) return '';
  const t = entry.title.trim();
  const cook = entry.cook_name.trim();
  if (!cook) return t;
  const re = new RegExp(`^${cook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['’]s?\\s+`, 'i');
  const stripped = t.replace(re, '');
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : t;
}

/** True when the recipe belongs to this profile (cook name matches). */
export function isCookOf(entry: Pick<LibraryEntry, 'cook_name'> | null | undefined, p: Pick<Profile, 'name'> | null | undefined): boolean {
  return !!entry && !!p && norm(entry.cook_name) === norm(p.name);
}

/**
 * The question still waiting for `me` to answer: the newest question the other person sent with
 * nothing from me after it (their non-questions, like "I made it", don't close it; a heart I sent
 * from Home answers nothing either).
 */
export function waitingQuestion<T extends Message>(messages: T[] | null | undefined, meId: string | null | undefined): T | null {
  if (!messages?.length || !meId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'reaction') continue;
    if (m.sender_id === meId) return null;
    if (isQuestion(m)) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The family circle

/** A message the server treats as a question: a `question`; in a 1:1 chat also a `step` with words. */
export function isServerQuestion(m: Pick<Message, 'kind' | 'body'>, pair: boolean): boolean {
  return m.kind === 'question' || (pair && m.kind === 'step' && !!(m.body ?? '').trim());
}

/**
 * Who answered each question: the server's `answered_by`, else the first reply to it here (covers
 * replies made since the last full fetch). Circle: a cook other than the asker; 1:1 (`pair`): the
 * other person.
 */
export function answeredBy(messages: Message[], isCook: (id: string) => boolean, opts: { pair?: boolean } = {}): Map<string, string> {
  const pair = !!opts.pair;
  const out = new Map<string, string>();
  const asker = new Map<string, string>();
  for (const m of messages) {
    if (!isServerQuestion(m, pair)) continue;
    asker.set(m.id, m.sender_id);
    if (m.answered_by) out.set(m.id, m.answered_by);
  }
  for (const m of messages) {
    // A reply still sending (or failed) answers nothing yet.
    if ((m as { local?: string }).local) continue;
    const q = m.reply_to;
    if (!q || out.has(q) || !asker.has(q) || asker.get(q) === m.sender_id || (!pair && !isCook(m.sender_id))) continue;
    out.set(q, m.sender_id);
  }
  return out;
}

/** Circle questions from others still waiting for an answer, oldest first. */
export function openCircleQuestions<T extends Message>(messages: T[], meId: string | null | undefined, answered: Map<string, string>): T[] {
  return messages.filter((m) => m.kind === 'question' && m.sender_id !== meId && !answered.has(m.id));
}

const ASKS = /^(how|what|when|where|why|which|who|can|could|should|would|do|does|did|is|are|was|any)\b/i;

/**
 * Words that read as a question: a "?" anywhere, or starting like one ("how long…", "can I…",
 * "should it…", "do you…"). "hello" and "made it!" don't.
 */
export function readsAsQuestion(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return !!t && (t.includes('?') || ASKS.test(t));
}

/** The words of a question (typed, else what was said), or a stand-in. */
export function questionWords(
  m: Pick<Message, 'body' | 'transcript' | 'step_order' | 'kind' | 'audio_url' | 'duration_s'>,
  t: T = english,
): string {
  const words = (m.body ?? '').trim() || (m.transcript ?? '').trim();
  if (words) return words;
  if (m.kind === 'question' && (m.audio_url || m.duration_s)) return t('messages.question.voice');
  if (m.step_order) return t('messages.question.aboutStep', { step: m.step_order });
  return t('messages.question.plain');
}
