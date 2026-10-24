// "Send it home, get one back" (docs/build/RETENTION-HANDOFF.md 3.4, retention PR 3): the parts with
// no React and no network, so scripts/test-cooking.mjs runs them under Node.
//
//   canPostcard(cook, meId)         the postcard step only for another family member's dish
//   madeItWords(told, cookName)     the burst: "You made it" + "We told Dad." (never speaks for the cook)
//   postcardAsk / ratingAsk         "Show Dad how it came out" / "How close to Dad’s?"
//   nextRating(current, tapped)     tap a pot to rate, the same pot again to take it back (optional)
//   ratingWords(n)                  "4 of 5 pots" (screen readers)
//   isPostcard(m)                   a `cooked` message that carries a photo
//   postcardTilt(id)                one steady 1-1.5° tilt per card (callers drop it under Reduce Motion)
//   likedIds(messages, meId)        cooked messages I already answered "Just like mine"
//   kitchenStamp(last)              when the cook's Home refetches a thread (a postcard changes no time)
//   watchForPostcard(msgs, me, now) an open chat also watches for a postcard on a card already on screen
//   rankMine(rows, at, kind)        the cook's own rows, a postcard still waiting for its answer on top
//   HOLD_HINT(_SPOKEN)              what a too-short hold on the mic says (in the pill / aloud)
//   HOLD_TAP_SPOKEN                 what a screen reader's plain double-tap on the mic hears
//   holdEnd(how, note)              what the end of a hold does: wait to send, "Hold longer", or "Not sent"
//   HOLD_CUT(_SPOKEN)               what a hold the phone took away says (a call, the notification shade)
//   undoWindowMs(screenReader)      how long a lifted note waits ("Sending… Undo") before it goes
//   holdPress(state) / holdWait(e)  a touch while it waits takes it back; time running out sends it
//
// Copy rules (handoff section 5): the app never speaks for the cook (no "Dad will love this"), no
// gendered pronouns, no guilt words.

/** At most this many pots (the server's check: 1-5). TODO(caleb): pots vs dumplings (handoff 8.3). */
export const RATING_MAX = 5;

/** Shown in place of "Hold to talk" after a hold too short to be a voice note (lib/voice MIN_VOICE_S). */
export const HOLD_HINT = 'Hold longer';
/** What VoiceOver / TalkBack hear with it. */
export const HOLD_HINT_SPOKEN = 'Too short. Hold the button while you talk, then let go.';
/** Shown after a hold the phone took away mid-note (nothing went out). */
export const HOLD_CUT = 'Not sent';
export const HOLD_CUT_SPOKEN = 'Not sent. Hold the button while you talk, then let go.';
/**
 * A VoiceOver / TalkBack double-tap is a tap, not a hold, so it can't record: it hears how to hold
 * (their double-tap-and-hold passes a real hold through to the pill).
 */
export const HOLD_TAP_SPOKEN = 'To record, double-tap and hold while you talk, then let go.';

/**
 * What the end of a "Hold to talk" hold does. Only a finger lifted on purpose (`lift`) sends, and only
 * a note long enough to be one (else "Hold longer"); even then it first waits (`wait`: "Sending… Undo",
 * undoWindowMs) so a false start, a cough or half a thought can be taken back before the kid gets it.
 * A touch taken away (`cut`: the phone took it for a call or the notification shade) never sends a
 * cut-off note. A scroll can't take the touch at all (HoldToTalk refuses to give it up and holds the
 * page still).
 */
export function holdEnd(how: 'lift' | 'cut', note: boolean): 'wait' | 'short' | 'cut' {
  if (how === 'cut') return 'cut';
  return note ? 'wait' : 'short';
}

/** How long a lifted note waits before it goes: long enough to tap Undo, short enough to feel sent. */
export const UNDO_MS = 3000;
/** With VoiceOver / TalkBack on: hearing "Sending to Leo. Undo." and reaching the button takes longer. */
export const UNDO_MS_SCREEN_READER = 6000;
export const undoWindowMs = (screenReader: boolean) => (screenReader ? UNDO_MS_SCREEN_READER : UNDO_MS);

/** The pill while a note waits to go: "Sending…" and the one thing to do, "Undo". */
export const HOLD_WAIT = 'Sending…';
export const HOLD_UNDO = 'Undo';
export const holdWaitSpoken = (toName: string) => `Sending to ${toName.trim()}. Tap to undo.`;
/** After Undo: nothing went out. */
export const HOLD_UNDONE = 'Not sent';

/**
 * What a new touch on the pill does: while a note waits to go, it takes it back (`undo`, on touch-down,
 * so a tap just in time always wins); while one uploads, nothing (`busy`); otherwise a new hold.
 */
export function holdPress(state: string): 'undo' | 'busy' | 'record' {
  if (state === 'waiting') return 'undo';
  if (state === 'sending') return 'busy';
  return 'record';
}

/**
 * The end of a note's wait: a tap takes it back (`undone`, nothing goes to the kid). The time running
 * out sends it, and so does the row going away first (the sheet closed, the row cleared): the cook let
 * go to send and only Undo un-sends.
 */
export function holdWait(event: 'tap' | 'time' | 'leave'): 'undone' | 'send' {
  return event === 'tap' ? 'undone' : 'send';
}

type Person = { id: string; name: string; memorial?: boolean | null };

/**
 * The postcard step shows when the dish's cook is someone else in the family who can read it: not me,
 * not a memorial profile (guardrail 2). Anyone else (my own dish, a dish whose cook isn't in the
 * family, a YouTube dish) keeps the old "Want to share the love?" prompt.
 */
export function canPostcard(cook: Person | null | undefined, meId: string | null | undefined): cook is Person {
  return !!cook && !!cook.id && cook.id !== meId && cook.memorial !== true;
}

/** The burst after "I made it": a fact about me, and, when it went out, a fact about the note. */
export function madeItWords(told: boolean, cookName: string): { title: string; subtitle?: string } {
  const name = cookName.trim();
  return told && name ? { title: 'You made it', subtitle: `We told ${name}.` } : { title: 'You made it' };
}

/** "Dad’s", "Grandma’s" (always ’s: "James’s" reads aloud the way people say it). */
const possessive = (name: string) => `${name.trim()}’s`;

export const postcardAsk = (cookName: string) => `Show ${cookName.trim()} how it came out`;
export const ratingAsk = (cookName: string) => `How close to ${possessive(cookName)}?`;

/** Tapping pot `tapped` (1-5): rates it, or takes the rating back when it's the one already chosen. */
export function nextRating(current: number | null, tapped: number): number | null {
  const n = Math.min(RATING_MAX, Math.max(1, Math.round(tapped)));
  return current === n ? null : n;
}

/** A rating as the server stores it: a whole number 1-5, else null. */
export function cleanRating(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= RATING_MAX ? v : null;
}

export const ratingWords = (n: number) => `${n} of ${RATING_MAX} pots`;

/** A `cooked` message with a photo: drawn as a postcard (cook's Home, the chat). */
export const isPostcard = (m: { kind?: string | null; photo_url?: string | null } | null | undefined) =>
  m?.kind === 'cooked' && !!m.photo_url;

const TILTS = [-1.5, -1, 1, 1.5];

/** A slight tilt for a postcard, the same every time for the same card; at most 1.5°. */
export function postcardTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILTS[h % TILTS.length];
}

type Msg = { id: string; kind?: string | null; body?: string | null; sender_id?: string | null; reply_to?: string | null };

/** The cooked messages I have already answered "Just like mine" (one stamp each, never two). */
export function likedIds(messages: readonly Msg[], meId: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!meId) return out;
  for (const m of messages) {
    if (m.kind === 'reaction' && m.body === 'just_like_mine' && m.sender_id === meId && m.reply_to) out.add(m.reply_to);
  }
  return out;
}

/**
 * What the cook's Home keys a thread's refetch on (components/parent/kitchen.ts): its newest message,
 * whether that message carries a postcard, and how many of its cards do (GET /threads `postcards`).
 * A postcard updates the `cooked` card "I made it" already sent (no new message, no new time), so
 * without this the card would wait for the thread's next message. Never the photo's URL: its
 * signature is new on every poll.
 */
export function kitchenStamp(
  t: { last?: { created_at?: string | null; photo_url?: string | null; rating?: number | null } | null; postcards?: number | null } | null | undefined,
): string {
  const last = t?.last;
  if (!last) return t?.postcards ? `|${t.postcards}` : '';
  return `${last.created_at ?? ''}${last.photo_url ? '|photo' : ''}${last.rating ? `|${last.rating}` : ''}${t?.postcards ? `|${t.postcards}` : ''}`;
}

/** The update row's key: a postcard is a new row even when the plain "made it" row was cleared. */
export const madeKey = (m: { id: string; kind?: string | null; photo_url?: string | null }) => (isPostcard(m) ? `${m.id}:postcard` : m.id);

/** How long after a `cooked` card an open chat keeps watching for its postcard (it comes right after "I made it"). */
export const POSTCARD_WATCH_MS = 30 * 60_000;

/**
 * An open chat polls only for newer messages, but a postcard puts a photo on a `cooked` card already on
 * screen. While the chat holds a card from someone else recent enough to still get one, it also watches
 * the inbox's `postcards` count for the thread (GET /threads) and fetches the thread again when it
 * moves. My own cards don't count: my phone swaps my postcard in itself.
 */
export function watchForPostcard(
  messages: readonly { kind?: string | null; sender_id?: string | null; created_at?: string | null; local?: unknown }[],
  meId: string | null | undefined,
  now: number,
): boolean {
  if (!meId) return false;
  return messages.some((m) => {
    if (m.kind !== 'cooked' || m.local || !m.sender_id || m.sender_id === meId) return false;
    const at = Date.parse(m.created_at ?? '');
    return Number.isFinite(at) && now - at <= POSTCARD_WATCH_MS;
  });
}

/**
 * The cook's own update rows (questions for me, dishes made) newest first, except that a postcard still
 * waiting for its "Just like mine" ranks at least as high as the newest "made" row (first on a tie):
 * its push just said "Sent you a postcard." and opened Home, so a plain row must never push it behind
 * "See all". Questions newer than it stay above it (they need an answer too).
 */
export function rankMine<T>(rows: readonly T[], at: (r: T) => string, kind: (r: T) => 'ask' | 'made' | 'postcard'): T[] {
  const time = (r: T) => Date.parse(at(r)) || 0;
  let newestMade = 0;
  for (const r of rows) if (kind(r) !== 'ask') newestMade = Math.max(newestMade, time(r));
  const key = (r: T) => (kind(r) === 'postcard' ? Math.max(time(r), newestMade) : time(r));
  const first = (r: T) => (kind(r) === 'postcard' ? 1 : 0);
  return [...rows].sort((a, b) => key(b) - key(a) || first(b) - first(a));
}
