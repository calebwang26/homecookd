// Month in the kitchen on the phone (RETENTION-HANDOFF 3.7): a few story slides about last month, for
// anyone whose month had something in it.
//
//   recapApi.get('2026-11')          GET /recap?month=2026-11 (me) -> { empty: true } | Recap
//   readRecap(json)                  the slides the app knows, in story order (cover first, close last)
//   cardMonth(now)                   the month the Home card offers on the 1st-7th, else null
//   isRecapOpened / markRecapOpened  "opened" per person per month (lib/storage), so the card goes away
//   onRecapOpened(fn)                tells a mounted Home card the moment the recap was opened
//   recapCardNow / recapCardStored / rememberRecapCard
//                                    the card's answer per person per month (memory, then storage), so
//                                    a Home drawn again that week has it with its first layout
//
// The call goes through its own small fetch so lib/api.ts stays as it is (the same headers the api
// client sends, from getApiAuth; the moveApi.ts pattern), plus x-tz (getApiTimeZone, like
// lib/tableApi.ts: none while the web `?as=` dev aid borrows the build's code, so a screenshot never
// stores a zone on that family's profile). React-free on purpose: the logic here
// runs under Node in scripts/test-recap.mjs. The server's shapes are supabase/functions/api/recap.ts &
// recapPr.ts; every number on a slide is a count from the database for that month.
import { API_URL, getApiAuth, getApiTimeZone } from './api';
import { AWS_ON } from './aws/config';
import { isAwsError } from './aws/errors';
import { messages as awsMessages } from './aws/messages';
import { kvGet, kvSet } from './storage';

export type RecapPhoto = { message_id: string; photo_url: string; recipe_id: string | null; at: string };
/** A kid on the cook's "dishes cooked" slide: who, never how often (guardrail 4: no sibling rankings). */
export type RecapFace = { profile_id: string };
export type RecapClip = { recipe_id: string; cook_id: string; start_s: number | null; plays: number };

export type RecapSlide =
  | { type: 'cover'; title: string }
  | { type: 'cooked'; title: string; value: number; photos: RecapPhoto[] }
  | { type: 'most_made'; title: string; value: number; recipe_id: string; cook_id: string }
  | { type: 'voices'; title: string; value: number; seconds: number; clip: RecapClip }
  | { type: 'hearts_left'; title: string; value: number }
  | { type: 'then_now'; title: string; photos: [RecapPhoto, RecapPhoto] }
  | { type: 'dishes_cooked'; title: string; value: number; faces: RecapFace[] }
  | { type: 'most_loved'; title: string; value: number; recipe_id: string }
  | { type: 'postcards'; title: string; value: number; photos: RecapPhoto[] }
  | { type: 'answered'; title: string; value: number }
  | { type: 'close'; title: string };
export type RecapSlideType = RecapSlide['type'];

export type Recap = { month: string; role: 'cook' | 'learner'; slides: RecapSlide[] };
export type RecapResult = { empty: true } | Recap;

export const isEmptyRecap = (r: RecapResult | null | undefined): r is { empty: true } | null | undefined => !r || 'empty' in r;

// ---------------------------------------------------------------------------------------------
// Months, on the phone's own calendar. The server counts in the person's stored zone (kept fresh by
// x-tz on every call), which is normally this phone's, and the month is always sent.

/**
 * The first month with an edition: the first Home card shows Dec 1-7, for November (handoff 3.7). The
 * server's recapPr.ts FIRST_MONTH must match.
 * TODO(caleb): an October edition (card & push on Nov 1) means '2026-10' on both sides.
 */
export const FIRST_MONTH = '2026-11';
/** The Home card shows from the 1st to the 7th. */
export const CARD_LAST_DAY = 7;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** 'YYYY-MM' of `date` on this phone's calendar. */
export const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/** The month before the one `now` falls in. */
export function previousMonth(now: Date = new Date()): string {
  return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

/** 'October' for '2026-10' (empty for a malformed month). */
export const monthName = (month: string) => (isMonth(month) ? MONTHS[Number(month.slice(5, 7)) - 1] : '');

/** "Your October in the kitchen": the card, the cover and the push all say it this way. */
export const recapTitle = (month: string) => `Your ${monthName(month)} in the kitchen`;

/** The month a link asked for, or last month when it's missing or malformed. */
export const monthOrPrevious = (param: unknown, now: Date = new Date()) =>
  (isMonth(param) ? param : previousMonth(now));

/** The month the Home card offers: last month, on the 1st-7th only, never before FIRST_MONTH. */
export function cardMonth(now: Date = new Date()): string | null {
  if (now.getDate() > CARD_LAST_DAY) return null;
  const m = previousMonth(now);
  return m >= FIRST_MONTH ? m : null;
}

// ---------------------------------------------------------------------------------------------
// The slides

const KNOWN = new Set<RecapSlideType>([
  'cover', 'cooked', 'most_made', 'voices', 'hearts_left', 'then_now',
  'dishes_cooked', 'most_loved', 'postcards', 'answered', 'close',
]);
const isContent = (s: RecapSlide) => s.type !== 'cover' && s.type !== 'close';
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function photo(v: unknown): RecapPhoto | null {
  const p = v as Partial<RecapPhoto> | null;
  if (!p || !str(p.photo_url) || !/^https?:\/\//.test(p.photo_url) || !str(p.message_id)) return null;
  return { message_id: p.message_id, photo_url: p.photo_url, recipe_id: str(p.recipe_id) ? p.recipe_id : null, at: str(p.at) ? p.at : '' };
}
const photos = (v: unknown) => (Array.isArray(v) ? v.map(photo).filter((p): p is RecapPhoto => !!p) : []);

/** One slide as the app can show it, or null (an unknown type from a newer server, or missing fields). */
function slide(v: unknown): RecapSlide | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s.type !== 'string' || !KNOWN.has(s.type as RecapSlideType) || !str(s.title)) return null;
  const title = s.title;
  switch (s.type as RecapSlideType) {
    case 'cover':
    case 'close':
      return { type: s.type as 'cover' | 'close', title };
    case 'hearts_left':
    case 'answered':
      return num(s.value) ? { type: s.type as 'hearts_left' | 'answered', title, value: s.value } : null;
    case 'cooked':
    case 'postcards':
      return num(s.value) ? { type: s.type as 'cooked' | 'postcards', title, value: s.value, photos: photos(s.photos) } : null;
    case 'then_now': {
      const [a, b] = photos(s.photos);
      return a && b ? { type: 'then_now', title, photos: [a, b] } : null;
    }
    case 'most_made':
      return num(s.value) && str(s.recipe_id) && str(s.cook_id)
        ? { type: 'most_made', title, value: s.value, recipe_id: s.recipe_id, cook_id: s.cook_id }
        : null;
    case 'most_loved':
      return num(s.value) && str(s.recipe_id) ? { type: 'most_loved', title, value: s.value, recipe_id: s.recipe_id } : null;
    case 'dishes_cooked': {
      if (!num(s.value)) return null;
      // Each kid once, in the server's order (first cook of the month). Any per-kid count an older
      // server sent is dropped here, so no screen can rank the siblings by it.
      const ids = (Array.isArray(s.faces) ? s.faces : [])
        .map((f) => (f as Partial<RecapFace> | null)?.profile_id)
        .filter((id): id is string => str(id));
      const faces = [...new Set(ids)].map((profile_id) => ({ profile_id }));
      return { type: 'dishes_cooked', title, value: s.value, faces };
    }
    case 'voices': {
      const c = s.clip as Partial<RecapClip> | null;
      if (!num(s.value) || !num(s.seconds) || !c || !str(c.recipe_id) || !str(c.cook_id)) return null;
      const clip = { recipe_id: c.recipe_id, cook_id: c.cook_id, start_s: num(c.start_s) ? c.start_s : null, plays: num(c.plays) ? c.plays : 1 };
      return { type: 'voices', title, value: s.value, seconds: s.seconds, clip };
    }
  }
  return null;
}

/**
 * The server's answer as the story shows it: known, well-formed slides in the server's order, with the
 * cover first and the close last (one of each). Empty when nothing but the cover & close is left.
 */
export function readRecap(raw: unknown): RecapResult {
  const r = raw as Partial<Recap> & { empty?: boolean } | null;
  if (!r || r.empty === true || !isMonth(r.month) || !Array.isArray(r.slides)) return { empty: true };
  const all = r.slides.map(slide).filter((s): s is RecapSlide => !!s);
  const content = all.filter(isContent);
  if (!content.length) return { empty: true };
  const cover = all.find((s) => s.type === 'cover');
  const close = all.find((s) => s.type === 'close');
  return {
    month: r.month,
    role: r.role === 'cook' ? 'cook' : 'learner',
    slides: [...(cover ? [cover] : []), ...content, ...(close ? [close] : [])],
  };
}

/** A real line for the Home card: the first content slide's own title ("You cooked 3 family dishes"). */
export function recapTeaser(recap: RecapResult | null | undefined): string | null {
  if (isEmptyRecap(recap)) return null;
  const first = recap.slides.find(isContent);
  if (!first) return null;
  return first.type === 'then_now' ? 'Your first postcard beside your latest' : first.title;
}

// ---------------------------------------------------------------------------------------------
// The call

// A plain field, not a constructor parameter property: Node's type stripping can't run those.
export class RecapError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 10_000;

async function call<T>(path: string): Promise<T> {
  if (AWS_ON) {
    // GET /v1/recap keeps Supabase's shape (MESSAGES.md).
    const month = new URLSearchParams(path.split('?')[1] ?? '').get('month');
    try {
      return (await awsMessages.recap(month)) as T;
    } catch (e) {
      throw new RecapError(isAwsError(e) ? e.status : 0, isAwsError(e) ? e.message : 'Can’t reach your family right now. Try again.');
    }
  }
  const auth = getApiAuth();
  if (!auth.profileId || (!auth.key && !auth.code)) throw new RecapError(0, 'Pick who you are first.');
  const headers: Record<string, string> = { accept: 'application/json', 'x-profile-id': auth.profileId };
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  // Keeps profiles.tz fresh like every signed-in call; the month itself is always in the query.
  const tz = getApiTimeZone();
  if (tz) headers['x-tz'] = tz;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers, signal: ctl.signal });
  } catch {
    throw new RecapError(0, 'Can’t reach your family right now. Try again.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new RecapError(res.status, data?.error || 'Something went wrong. Try again.');
  return data as T;
}

export const recapApi = {
  /** GET /recap?month=YYYY-MM for the person this phone acts as. */
  get: async (month: string): Promise<RecapResult> =>
    readRecap(await call<unknown>(`/recap?month=${encodeURIComponent(month)}`)),
};

// ---------------------------------------------------------------------------------------------
// Opened, per person per month (this phone only: it hides the Home card, nothing more)

export const openedKey = (profileId: string, month: string) => `recap.opened.${profileId}.${month}`;
const openedNow = new Set<string>();
const listeners = new Set<(key: string) => void>();

export async function isRecapOpened(profileId: string, month: string): Promise<boolean> {
  const key = openedKey(profileId, month);
  return openedNow.has(key) || (await kvGet(key)) === '1';
}

export async function markRecapOpened(profileId: string, month: string): Promise<void> {
  const key = openedKey(profileId, month);
  if (!openedNow.has(key)) {
    openedNow.add(key);
    for (const l of listeners) l(key);
  }
  await kvSet(key, '1');
}

/** Called with the opened key the moment a recap is opened (a mounted Home card hides itself). */
export function onRecapOpened(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------------------------
// The Home card's answer, remembered per person per month (memory for this run, storage across
// launches), so a Home drawn again that week shows the card, or no card, with its first layout instead
// of waiting for GET /recap. Last month's numbers don't change once it's over, and a failed call is
// never remembered.

/** What this phone knows about the card: opened, an empty month, or a card with its line. */
export type RecapCardKnown = 'opened' | 'empty' | { teaser: string | null };

export const cardKey = (profileId: string, month: string) => `recap.card.${profileId}.${month}`;
const cardsNow = new Map<string, 'empty' | { teaser: string | null }>();

/** What this run already knows, without waiting (undefined: nothing yet). */
export function recapCardNow(profileId: string, month: string): RecapCardKnown | undefined {
  if (openedNow.has(openedKey(profileId, month))) return 'opened';
  return cardsNow.get(cardKey(profileId, month));
}

/** recapCardNow, else what this phone stored on an earlier launch. */
export async function recapCardStored(profileId: string, month: string): Promise<RecapCardKnown | undefined> {
  const now = recapCardNow(profileId, month);
  if (now) return now;
  if ((await kvGet(openedKey(profileId, month))) === '1') {
    openedNow.add(openedKey(profileId, month));
    return 'opened';
  }
  const raw = await kvGet(cardKey(profileId, month));
  if (raw === 'empty') {
    cardsNow.set(cardKey(profileId, month), 'empty');
    return 'empty';
  }
  try {
    const v = raw ? (JSON.parse(raw) as { teaser?: unknown } | null) : null;
    if (!v || typeof v !== 'object') return undefined;
    const card = { teaser: typeof v.teaser === 'string' && v.teaser ? v.teaser : null };
    cardsNow.set(cardKey(profileId, month), card);
    return card;
  } catch {
    return undefined;
  }
}

/** Remembers GET /recap's answer for the card and returns it ('empty', or the card and its line). */
export async function rememberRecapCard(profileId: string, month: string, recap: RecapResult): Promise<'empty' | { teaser: string | null }> {
  const known = isEmptyRecap(recap) ? ('empty' as const) : { teaser: recapTeaser(recap) };
  cardsNow.set(cardKey(profileId, month), known);
  await kvSet(cardKey(profileId, month), known === 'empty' ? 'empty' : JSON.stringify(known));
  return known;
}
