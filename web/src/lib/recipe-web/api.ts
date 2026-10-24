// Network for the web pages people open from a family link: the public share lookup, the recipe JSON
// in the bucket and the invite preview for /i. Read-only: no family code or device key is ever sent
// from here, and joining only ever happens in the app.
import { API_URL } from './config';
import type { InvitePeek, InviteStatus, Recipe, Share } from './types';

export type LoadErrorKind = 'missing' | 'not-found' | 'network';

export class LoadError extends Error {
  constructor(public kind: LoadErrorKind, message?: string) {
    super(message ?? kind);
  }
}

const TIMEOUT_MS = 10_000;

async function request(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A query param that changes once a minute, so caches never hide a re-published recipe for long. */
function fresh(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 60_000)}`;
}

/** Share tokens are 10 base62 chars; anything else is a mistyped link (no request needed). */
export function isPlausibleToken(token: string | null): token is string {
  return !!token && /^[A-Za-z0-9_-]{4,64}$/.test(token);
}

export async function getShare(token: string): Promise<Share> {
  let res: Response;
  try {
    res = await request(`${API_URL}/shares/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new LoadError('network');
  }
  if (res.status === 404 || res.status === 400 || res.status === 410) throw new LoadError('not-found');
  if (!res.ok) throw new LoadError('network');
  const data = (await res.json().catch(() => null)) as Share | null;
  if (!data || typeof data.recipe_url !== 'string') throw new LoadError('not-found');
  return data;
}

export async function getRecipe(url: string): Promise<Recipe> {
  let res: Response;
  try {
    res = await request(fresh(url), { headers: { Accept: 'application/json' } });
  } catch {
    throw new LoadError('network');
  }
  if (res.status === 404 || res.status === 403) throw new LoadError('not-found');
  if (!res.ok) throw new LoadError('network');
  const data = (await res.json().catch(() => null)) as Recipe | null;
  if (!data || !Array.isArray(data.steps)) throw new LoadError('not-found');
  return normalizeRecipe(data);
}

/** Invite tokens are 16 base62 chars; anything else is a mistyped link (no request needed). */
export function isPlausibleInviteToken(t: string | null): t is string {
  return !!t && /^[A-Za-z0-9]{8,64}$/.test(t);
}

/** A 6-letter invite code from the API's CODE_ALPHABET (no 0/O/1/I), upper-cased; null otherwise. */
export function cleanInviteCode(c: string | null | undefined): string | null {
  const v = (c ?? '').trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(v) ? v : null;
}

/**
 * not-found = 404/400, gone = 410 (used / expired / turned off, with `status`), rate = 429,
 * network = no answer or a broken one. The API's own sentence comes along as the message.
 */
export type InviteErrorKind = 'not-found' | 'gone' | 'rate' | 'network';

export class InviteError extends Error {
  constructor(
    public kind: InviteErrorKind,
    message = '',
    public status: InviteStatus | null = null,
  ) {
    super(message);
  }
}

const STATUSES: InviteStatus[] = ['pending', 'used', 'expired', 'revoked'];

/**
 * POST /invites/peek: who sent the invite and who it is for. No side effects on the server, so a
 * link preview or a reload never uses the invite up.
 */
export async function peekInvite(by: { token: string } | { code: string }): Promise<InvitePeek> {
  let res: Response;
  try {
    res = await request(`${API_URL}/invites/peek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(by),
    });
  } catch {
    throw new InviteError('network');
  }
  const data = (await res.json().catch(() => null)) as (Partial<InvitePeek> & { error?: string }) | null;
  const msg = typeof data?.error === 'string' ? data.error : '';
  if (res.status === 404 || res.status === 400) throw new InviteError('not-found', msg);
  if (res.status === 429) throw new InviteError('rate', msg);
  const status = STATUSES.includes(data?.status as InviteStatus) ? (data!.status as InviteStatus) : null;
  // peek answers used / expired invites with 200 + status; a 410 (accept's answer) is read the same way
  if (res.status === 410) throw new InviteError('gone', msg, status ?? 'used');
  if (!res.ok || !data || !status) throw new InviteError('network', msg);
  // A family invite says `invitee: null` (whoever opens it picks their own name in the app). A named
  // invite without a name is a broken answer.
  const invitee = data.invitee ?? null;
  if (invitee && (typeof invitee.name !== 'string' || !invitee.name.trim())) throw new InviteError('network', msg);
  const inviter = data.inviter && typeof data.inviter.name === 'string' && data.inviter.name.trim() ? data.inviter : null;
  return {
    status,
    family_name: data.family_name?.trim() || null,
    inviter: inviter ? { name: inviter.name.trim(), relation: inviter.relation ?? null, avatar_key: inviter.avatar_key ?? null } : null,
    invitee: invitee
      ? { name: invitee.name.trim(), role: invitee.role === 'cook' ? 'cook' : 'learner', avatar_key: invitee.avatar_key ?? null }
      : null,
    expires_at: data.expires_at ?? null,
    code: cleanInviteCode(data.code),
  };
}

/** Defensive defaults so a slightly-off recipe.json never crashes the page. */
function normalizeRecipe(r: Recipe): Recipe {
  return {
    ...r,
    title: typeof r.title === 'string' && r.title.trim() ? r.title : 'A family recipe',
    cook: { name: r.cook?.name?.trim() || 'Family', relation: r.cook?.relation || '' },
    intro: r.intro ?? '',
    servings: r.servings ?? null,
    total_time: r.total_time ?? null,
    sample: !!r.sample,
    source: r.source ?? null,
    tags: r.tags ?? [],
    media: {
      video_url: r.media?.video_url || null,
      audio_url: r.media?.audio_url || null,
      poster_url: r.media?.poster_url || null,
      duration_s: r.media?.duration_s ?? 0,
      width: r.media?.width ?? null,
      height: r.media?.height ?? null,
    },
    ingredients: (r.ingredients ?? []).filter((i) => i && (i.name || i.feel)),
    steps: [...(r.steps ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, story_ids: s.story_ids ?? [], special_ids: s.special_ids ?? [] })),
    stories: r.stories ?? [],
    special: r.special ?? [],
  };
}
