// Hearts & kitchen on the cook's side (RETENTION-HANDOFF 3.5 + 3.6, PR 4): the two read calls.
//
//   fetchDishStats(myIds)      GET /dish-stats?ids=a,b   per dish of mine: hearts & cooks from the family
//   fetchHeartsRecent(since?)  GET /hearts/recent        new hearts on my dishes, newest first
//
// The server answers only for dishes whose cook is the acting person (counts go only to the dish's
// cook), so pass my own recipe ids (recipesByCook(entries, me)); anything else just comes back
// missing. Every dish of mine that was asked for comes back, zeros included; the UI hides zero parts.
//
// The calls go through their own small fetch so lib/api.ts stays as it is (the same pattern as
// lib/moveRequests.ts); the headers are the ones the api client sends (getApiAuth). Plain TS with no
// React Native imports, so scripts/test-hearts.mjs runs it under Node. The hooks that keep the
// answers fresh are in components/hearts/useDishStats.ts.
// TODO(wiring): fold these into lib/api.ts as api.dishStats / api.heartsRecent with DishStats and
// HeartRecent next to them (RETENTION-WIRING.md, "PR 4 wiring" A1), then make this file re-export them.
import { API_URL, getApiAuth } from './api';
import { AWS_ON } from './aws/config';
import { messages as awsMessages } from './aws/messages';
import type { DishStats } from './kitchenCounts';

export type { DishStat, DishStats } from './kitchenCounts';
/** GET /hearts/recent: someone in the family hearted one of my dishes. */
export type HeartRecent = { profile_id: string; recipe_id: string; at: string };

/** The server's limit per call; longer lists are split. */
export const DISH_STATS_BATCH = 50;
const TIMEOUT_MS = 10_000;
/** Same pattern as the server's recipe ids: anything else would only earn a 400. */
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

// No parameter properties: Node's type stripping (scripts/test-hearts.mjs) can't run them.
export class DishStatsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type CallOpts = {
  /** Who is asking (x-profile-id); defaults to the current person. Pass it so a person switch mid-call can't mix answers. */
  profileId?: string | null;
  /** Tests. */
  fetch?: typeof fetch;
};

/**
 * One GET as the acting person. null = the server doesn't have the route yet (404 before the PR 4
 * deploy): nothing to show, never an error on screen. Throws DishStatsError otherwise.
 */
async function get<T>(path: string, o: CallOpts): Promise<T | null> {
  const auth = getApiAuth();
  const profileId = o.profileId ?? auth.profileId;
  if (!profileId || !(auth.key || auth.code)) throw new DishStatsError(0, 'Not signed in');
  const headers: Record<string, string> = { accept: 'application/json', 'x-profile-id': profileId };
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(`${API_URL}${path}`, { method: 'GET', headers, signal: ctrl.signal });
  } catch {
    throw new DishStatsError(0, 'Can’t reach your family right now.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new DishStatsError(res.status, data?.error || 'Something went wrong. Try again.');
  return data as T;
}

/** The ids worth asking about: valid, each once, in the order given. */
export function cleanIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => RECIPE_ID.test(s)))];
}

/** Splits ids into the server's batches of 50. */
export function batches(ids: readonly string[], size = DISH_STATS_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** GET /dish-stats for any number of my dishes (50 per call, in parallel). {} for none. */
export async function fetchDishStats(ids: readonly string[], o: CallOpts = {}): Promise<DishStats> {
  const parts = batches(cleanIds(ids));
  if (AWS_ON) return awsDishStats(parts, o);
  const answers = await Promise.all(parts.map((b) => get<DishStats>(`/dish-stats?ids=${b.map(encodeURIComponent).join(',')}`, o)));
  const out: DishStats = {};
  for (const a of answers) if (a && typeof a === 'object' && !Array.isArray(a)) Object.assign(out, a);
  return out;
}

/** GET /hearts/recent: hearts on my dishes since `since` (the server's default: 14 days; 30 at most). */
export async function fetchHeartsRecent(since?: Date | string | null, o: CallOpts = {}): Promise<HeartRecent[]> {
  const d = since ? (since instanceof Date ? since : new Date(since)) : null;
  const iso = d && Number.isFinite(d.getTime()) ? d.toISOString() : null; // a bad date: the server's default
  if (AWS_ON) {
    const rows = await awsMessages.heartsRecent(iso, o.profileId ?? null).catch(() => []);
    return rows.map((r) => ({ profile_id: r.personId, recipe_id: r.libraryId, at: r.at }));
  }
  const rows = await get<HeartRecent[]>(iso ? `/hearts/recent?since=${encodeURIComponent(iso)}` : '/hearts/recent', o);
  return Array.isArray(rows) ? rows : [];
}

type AwsDishStat = { hearts: { count: number; by: { personId: string; at: string }[] }; cooked: { count: number; by: { personId: string; count: number; lastAt: string }[] } };

/** 1.1: GET /v1/dish-stats, in the screens' words. A failed batch shows nothing for those dishes, never an error. */
async function awsDishStats(parts: string[][], o: CallOpts): Promise<DishStats> {
  const out: DishStats = {};
  const answers = await Promise.all(parts.map((b) => awsMessages.dishStats(b, o.profileId ?? null).catch(() => ({}))));
  for (const a of answers)
    for (const [id, st] of Object.entries(a as Record<string, AwsDishStat>))
      out[id] = {
        hearts: { count: st.hearts.count, by: st.hearts.by.map((h) => ({ profile_id: h.personId, at: h.at })) },
        cooked: { count: st.cooked.count, by: st.cooked.by.map((c) => ({ profile_id: c.personId, count: c.count, last_at: c.lastAt })) },
      };
  return out;
}
