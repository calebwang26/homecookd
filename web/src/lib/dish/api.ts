// The kid's and Mom's pages talk to the Convex /dish/* routes (docs/build/DISH-ASK-SPEC.md §4). Every
// route is a POST with the token in the JSON body, or in the X-Dish-Token header for Mom's raw audio,
// so tokens never land in a URL the server logs. NEXT_PUBLIC_DISH_URL overrides the base (the local
// fake in scripts/qa/dish-fake-server.mjs).
import { CONVEX_SITE_URL } from '@/lib/recipe-web/config';
import type { Ask, AskItem, Card, Edit, FileKind, QuestionId, Relation, SendVia } from './types';

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

async function call<T>(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${DISH_URL}${path}`, { method: 'POST', ...init, signal: controller.signal });
  } catch {
    throw new DishError('network');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  const msg = typeof data?.error === 'string' ? data.error : '';
  if (res.ok && data) return data;
  const code = data?.code;
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

export async function uploadFile(kind: FileKind, blob: Blob, contentType: string): Promise<string> {
  const out = await call<{ fileId: string }>(`/dish/files?kind=${kind}`, { headers: { 'Content-Type': contentType }, body: blob }, 30_000);
  return out.fileId;
}

// ── the kid's card ─────────────────────────────────────────────────────────────────────────────

export function createCard(input: {
  dish: string;
  relation: Relation;
  kidName?: string | null;
  photos?: string[];
  voiceNote?: string;
}): Promise<{ kidToken: string; card: Card }> {
  return post('/dish/cards', input, { timeoutMs: SLOW_MS });
}

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

/** One answer, raw audio; `lang` is the language she speaks (for Ink). */
export async function sendAnswer(askToken: string, q: QuestionId, lang: string, durationS: number, clip: Blob, contentType: string): Promise<Ask> {
  const qs = new URLSearchParams({ q, lang, durationS: String(Math.round(durationS * 10) / 10) });
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
