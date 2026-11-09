// The kid's and Mom's pages talk to the Convex /dish/* routes (docs/build/DISH-ASK-SPEC.md §4). Every
// route is a POST with the token in the JSON body, or in the X-Dish-Token header for Mom's raw audio,
// so tokens never land in a URL the server logs. NEXT_PUBLIC_DISH_URL overrides the base (the local
// fake in scripts/qa/dish-fake-server.mjs).
//
// NEXT_PUBLIC_DISH_UPLOADS=links selects the new api's way of sending files (docs/build/DISH-MIGRATION.md): it
// hands out a link, the page PUTs to storage, and every call stays text/plain with the token in the body. Unset,
// the site sends raw files to Convex as it always has. The value is compiled in, so the switch goes with
// NEXT_PUBLIC_DISH_URL in the same build (docs/build/CUTOVER.md). It's written out at each use, not kept in a
// const, so a build without it holds none of the new flow's code (scripts/check-merge-safe.mjs reads the bundle).
import { CONVEX_SITE_URL } from '@/lib/recipe-web/config';
import type { Ask, AskItem, Card, CravingPeek, Edit, FileKind, QuestionId, Relation, SendVia } from './types';

export const DISH_URL = (process.env.NEXT_PUBLIC_DISH_URL || CONVEX_SITE_URL).trim().replace(/\/+$/, '');

/**
 * not-found 404 · rate 429 (a per-IP or per-link limit) · budget 429 (today's model budget is spent) · not-a-dish 422 · words 422 (a filtered word)
 * closed 409 · busy 5xx (a model failed, safe to retry) · bad other 4xx · network: no answer at all
 */
export type DishErrorKind = 'not-found' | 'rate' | 'budget' | 'not-a-dish' | 'words' | 'closed' | 'busy' | 'bad' | 'network';

export class DishError extends Error {
  constructor(
    public kind: DishErrorKind,
    message = '',
  ) {
    super(message || kind);
  }
}

const TIMEOUT_MS = 15_000;
/** Making a card waits on Claude (and Ink for a voice note): about 4–8 s, 60 s at most. */
const SLOW_MS = 60_000;
/** A photo or voice note going up to storage, and Mom's clip, which can be longer. */
const PUT_FILE_MS = 30_000;
const PUT_CLIP_MS = 45_000;

async function call<T>(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let data: (T & { error?: string; code?: string; message?: string }) | null;
  try {
    res = await fetch(`${DISH_URL}${path}`, { method: 'POST', ...init, signal: controller.signal });
    // The body is read under the same deadline: a response that starts and then stalls times out too.
    data = (await res.json().catch(() => null)) as typeof data;
  } catch {
    throw new DishError('network');
  } finally {
    clearTimeout(timer);
  }
  // Convex answers `{error: <sentence>, code}`. The new api's one shape is `{error: <code>, message: <sentence>}`.
  const said = process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links' ? data?.message : data?.error;
  const msg = typeof said === 'string' ? said : '';
  if (res.ok && data) return data;
  const code = process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links' ? data?.error : data?.code;
  if (res.status === 404) throw new DishError('not-found', msg);
  if (res.status === 429) throw new DishError(code === 'budget' ? 'budget' : 'rate', msg);
  if (res.status === 409) throw new DishError('closed', msg);
  if (res.status === 422) throw new DishError(code === 'words' ? 'words' : 'not-a-dish', msg);
  if (res.status >= 400 && res.status < 500) throw new DishError('bad', msg);
  throw new DishError(res.ok ? 'network' : 'busy', msg);
}

/**
 * JSON as text/plain: a CORS-simple request, so no preflight has to come back first, and `keepalive`
 * lets it finish when a share opens another app (the server reads JSON whatever the type).
 */
function post<T>(path: string, body: unknown, { timeoutMs = TIMEOUT_MS, keepalive = false } = {}): Promise<T> {
  return call<T>(path, { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), keepalive }, timeoutMs);
}

/** Kid and ask tokens are 22 base62 characters; anything else is a mistyped link (no request needed). */
export function isPlausibleToken(t: string | null | undefined): t is string {
  return !!t && /^[A-Za-z0-9]{22}$/.test(t);
}

// ── files ──────────────────────────────────────────────────────────────────────────────────────

type Upload = { fileId: string; uploadUrl: string; uploadHeaders: Record<string, string> };

/**
 * The bytes, straight to storage with the link the api gave. A failed PUT reads as 'busy', as a 502 does: it's safe to
 * try again, and that asks for a new link. PUT always needs a preflight, from storage's own CORS.
 */
async function put(link: Upload, blob: Blob, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(link.uploadUrl, { method: 'PUT', headers: link.uploadHeaders, body: blob, signal: controller.signal });
    await res.text(); // read to the end: a body nobody reads holds the connection, and shows as a cancelled request
    if (!res.ok) throw new DishError('busy');
  } catch (e) {
    throw e instanceof DishError ? e : new DishError('busy');
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadFile(kind: FileKind, blob: Blob, contentType: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links') {
    const link = await post<Upload>(`/dish/files?kind=${kind}`, { contentType, size: blob.size });
    await put(link, blob, PUT_FILE_MS);
    return (await post<{ fileId: string }>('/dish/files/confirm', { fileId: link.fileId })).fileId;
  }
  const out = await call<{ fileId: string }>(`/dish/files?kind=${kind}`, { headers: { 'Content-Type': contentType }, body: blob }, 30_000);
  return out.fileId;
}

// ── the kid's card ─────────────────────────────────────────────────────────────────────────────

export function createCard(input: {
  dish: string;
  /** Left out with a craving link: the server asks the parent who sent it. */
  relation?: Relation;
  kidName?: string | null;
  photos?: string[];
  voiceNote?: string;
  cravingToken?: string;
}): Promise<{ kidToken: string; card: Card }> {
  return post('/dish/cards', input, { timeoutMs: SLOW_MS });
}

// ── a parent's craving link (§8) ───────────────────────────────────────────────────────────────

export function peekCraving(cravingToken: string): Promise<CravingPeek> {
  return post('/dish/craving/peek', { cravingToken });
}

/** The link's own caps answer 429 `rate` like a per-IP limit does; only the words differ (§8, LINK_BUSY). */
export const isLinkBusy = (e: DishError) => e.kind === 'rate' && e.message.includes('a lot of requests');

export async function getCard(kidToken: string): Promise<Card> {
  return (await post<{ card: Card }>('/dish/cards/get', { kidToken })).card;
}

export async function updateCard(
  kidToken: string,
  patch: { relation?: Relation; kidName?: string | null; message?: string; voiceNote?: string | null; voiceNoteS?: number; edits?: Edit[] },
): Promise<Card> {
  return (await post<{ card: Card }>('/dish/cards/update', { kidToken, ...patch })).card;
}

export async function askQuestions(kidToken: string, questions: AskItem[]): Promise<Card> {
  return (await post<{ card: Card }>('/dish/cards/ask', { kidToken, questions }, { keepalive: true })).card;
}

/** Kept alive: it is sent in the share tap, which may leave the page. */
export async function markSent(kidToken: string, via: SendVia): Promise<Card> {
  return (await post<{ card: Card }>('/dish/cards/sent', { kidToken, via }, { keepalive: true })).card;
}

// ── Mom's page ─────────────────────────────────────────────────────────────────────────────────

/** `lang` (not 'en'): the guess, the questions and the message come back in that language too (`inLang`). */
export async function peekAsk(askToken: string, lang?: string): Promise<Ask> {
  return (await post<{ ask: Ask }>('/dish/ask/peek', lang && lang !== 'en' ? { askToken, lang } : { askToken }, { timeoutMs: 30_000 })).ask;
}

/** One answer, raw audio (with the switch: her clip goes to storage, then the api takes it); `lang` is the language she speaks (for Ink). */
export async function sendAnswer(askToken: string, q: QuestionId, lang: string, durationS: number, clip: Blob, contentType: string): Promise<Ask> {
  const qs = new URLSearchParams({ q, lang, durationS: String(Math.round(durationS * 10) / 10) });
  if (process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links') {
    const link = await post<Upload>(`/dish/ask/answer/upload?${qs}`, { askToken, contentType, size: clip.size });
    await put(link, clip, PUT_CLIP_MS);
    return (await post<{ ask: Ask }>(`/dish/ask/answer?${qs}`, { askToken, fileId: link.fileId })).ask;
  }
  return (
    await call<{ ask: Ask }>(
      `/dish/ask/answer?${qs}`,
      { headers: { 'Content-Type': contentType, 'X-Dish-Token': askToken }, body: clip },
      45_000,
    )
  ).ask;
}

export async function finishAsk(askToken: string): Promise<Ask> {
  return (await post<{ ask: Ask }>('/dish/ask/finish', { askToken })).ask;
}
