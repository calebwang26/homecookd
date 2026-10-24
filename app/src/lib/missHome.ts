// "I miss home" (RETENTION-HANDOFF 3.3): a random clip of a family cook's own voice, a story or a step
// quote, from the recipes. This file is the clip pool and the pick. Its kid Home pill and sheet were cut
// in round 2 (Oct 22, a portal Home); the Recap (components/recap) still plays clips from the pool.
//
//   const own = familyRecordings(table);                                          // GET /table
//   const ids = missHomeEntries(entries, profiles, me.id, own).map((e) => e.id);  // then useRecipes(ids)
//   const pool = clipPool(Object.values(recipes), profiles, me.id, own);          // [] -> hide the pill
//   const clip = pickClip(pool, await loadRecentKeys(me.id), Math.random, current?.key);
//   await rememberPlayed(me.id, clip.key);
//   const next = await nextClip(pool, me.id, { current: clip.key });         // the two above in one
//
// Only a family cook's real recordings: not samples (their words are synthetic, never the cook's),
// not YouTube (a stranger's voice), not my own, and only recipes with audio. Stories come first, then
// steps that carry a quote; the words shown are exactly what the cook said (story.text, step.quote).
// A clip is that moment's own start_s..end_s, at most 60 s. No clip repeats within 7 days while
// another one is fresh (remembered per profile on this phone). A memorial cook's clips stay: the kid
// chose to listen. A cook is matched by name like cookProfile() in lib/recipes.ts (repeated here so
// the pure part runs under Node: scripts/test-retention.mjs).
// THIS family's recordings only: library.json is one library for every family and ties a dish to a
// cook by name alone, so another family's real recording whose cook is also called "Mom" would match
// this family's Mom. `recordings` (GET /table, lib/sundayTable familyRecordings) lists the dishes
// this family's own recordings became (delivered sends), the same scope the Sunday nudge uses; a
// dish not on it never plays, and no list (an older server, offline before the first answer) means
// no clips, so the pill stays hidden rather than play a stranger's voice (guardrail 1).
import type { Profile } from './api';
import { kvGetJson, kvSetJson } from './storage';
import type { LibraryEntry, Recipe } from './types';

export const CLIP_MAX_S = 60;
export const NO_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_MAX = 200;

type Person = Pick<Profile, 'id' | 'name'>;

export type MissHomeClip = {
  /** Stable across loads: '<recipe>#story-<id>' or '<recipe>#step-<order>'. */
  key: string;
  kind: 'story' | 'step';
  recipeId: string;
  recipeTitle: string;
  cookId: string;
  cookName: string;
  /** recipe.media.audio_url */
  url: string;
  start_s: number;
  end_s: number;
  /** The cook's own words for this moment, verbatim. */
  words: string;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const isYouTube = (relation: string | null | undefined, source?: string | null) => /youtube/i.test(`${relation ?? ''} ${source ?? ''}`);

function familyCook(name: string | null | undefined, profiles: Person[], meId: string | null | undefined): Person | null {
  const n = norm(name);
  const cook = (n && profiles.find((p) => norm(p.name) === n)) || null;
  return cook && cook.id !== meId ? cook : null;
}

/** The dishes a clip may come from, as a set (null/undefined: none). */
const asSet = (ids: Iterable<string> | null | undefined): Set<string> => (ids instanceof Set ? ids : new Set(ids ?? []));

/**
 * Library entries that may hold clips: one of THIS family's recordings (`recordings`, see the header),
 * by a family cook (not mine), not samples, not YouTube.
 */
export function missHomeEntries(
  entries: LibraryEntry[],
  profiles: Person[],
  meId: string | null | undefined,
  recordings: Iterable<string> | null | undefined,
): LibraryEntry[] {
  const own = asSet(recordings);
  if (!own.size) return [];
  return entries.filter((e) => own.has(e.id) && !e.sample && !isYouTube(e.relation) && !!familyCook(e.cook_name, profiles, meId));
}

/** start..end clamped to the recording and to CLIP_MAX_S, or null when there is no real range. */
function range(start: number, end: number | null | undefined, durationS: number): { start_s: number; end_s: number } | null {
  const s = Math.max(0, Math.floor(Number(start) || 0));
  let e = Number(end);
  if (!Number.isFinite(e) || e <= s) return null;
  e = Math.min(e, s + CLIP_MAX_S);
  if (durationS > 0) e = Math.min(e, durationS);
  return e > s ? { start_s: s, end_s: e } : null;
}

/**
 * Every clip in these recipes: per recipe its stories, then its steps with a quote. `recordings`
 * (the kid Home passes it): only those dishes, as in missHomeEntries; left out, the recipes are taken
 * as already chosen (the recap looks up a clip the server named).
 */
export function clipPool(
  recipes: Recipe[],
  profiles: Person[],
  meId: string | null | undefined,
  recordings?: Iterable<string> | null,
): MissHomeClip[] {
  const stories: MissHomeClip[] = [];
  const steps: MissHomeClip[] = [];
  const seen = new Set<string>();
  const own = recordings === undefined ? null : asSet(recordings);
  for (const r of recipes) {
    const url = r?.media?.audio_url;
    if (!r || r.sample || !url || isYouTube(r.cook?.relation, r.source)) continue;
    if (own && !own.has(r.id)) continue;
    const cook = familyCook(r.cook?.name, profiles, meId);
    if (!cook || seen.has(r.id)) continue;
    seen.add(r.id);
    const base = { recipeId: r.id, recipeTitle: r.title, cookId: cook.id, cookName: cook.name, url };
    const dur = Number(r.media.duration_s) || 0;
    for (const st of r.stories ?? []) {
      const words = (st.text ?? '').trim();
      const at = range(st.start_s, st.end_s, dur);
      if (words && at) stories.push({ ...base, ...at, key: `${r.id}#story-${st.id}`, kind: 'story', words });
    }
    for (const st of r.steps ?? []) {
      const words = (st.quote ?? '').trim();
      const at = range(st.start_s, st.end_s, dur);
      if (words && at) steps.push({ ...base, ...at, key: `${r.id}#step-${st.order}`, kind: 'step', words });
    }
  }
  return [...stories, ...steps];
}

/**
 * The next clip. `recent` = keys played in the last 7 days, oldest first (loadRecentKeys).
 * Fresh clips first, stories before steps, at random among them (`rand` returns [0, 1)). When every
 * clip was played this week, the one heard longest ago, never `current` while another exists.
 */
export function pickClip(pool: MissHomeClip[], recent: readonly string[], rand: () => number = Math.random, current?: string | null): MissHomeClip | null {
  if (!pool.length) return null;
  const played = new Set(recent);
  const fresh = pool.filter((c) => !played.has(c.key) && c.key !== current);
  const freshStories = fresh.filter((c) => c.kind === 'story');
  const from = freshStories.length ? freshStories : fresh;
  if (from.length) {
    const x = rand();
    const r = Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0; // a bad rand() still picks a clip
    return from[Math.min(from.length - 1, Math.floor(r * from.length))];
  }
  // Everything was heard this week: the oldest listen, so the newest ones wait longest.
  const byKey = new Map(pool.map((c) => [c.key, c]));
  for (const k of recent) {
    const c = byKey.get(k);
    if (c && c.key !== current) return c;
  }
  return pool.find((c) => c.key !== current) ?? pool[0];
}

// ---------------------------------------------------------------------------------------------
// What this profile heard lately (this phone only; it's a "don't repeat", not a record).

export type PlayLog = { key: string; at: number }[];
const logKey = (profileId: string) => `missHome.played.${profileId}`;

/** The log without listens older than 7 days, one entry per clip (its latest), oldest first. */
export function prunePlayLog(log: PlayLog, now = Date.now()): PlayLog {
  const latest = new Map<string, number>();
  for (const p of Array.isArray(log) ? log : []) {
    if (!p || typeof p.key !== 'string' || typeof p.at !== 'number') continue;
    if (now - p.at >= NO_REPEAT_MS || p.at > now + 60_000) continue;
    latest.set(p.key, Math.max(latest.get(p.key) ?? 0, p.at));
  }
  return [...latest]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => a.at - b.at)
    .slice(-LOG_MAX);
}

/** Keys heard in the last 7 days, oldest first: pickClip's `recent`. */
export function recentKeys(log: PlayLog, now = Date.now()): string[] {
  return prunePlayLog(log, now).map((p) => p.key);
}

export async function loadPlayLog(profileId: string, now = Date.now()): Promise<PlayLog> {
  return prunePlayLog((await kvGetJson<PlayLog>(logKey(profileId))) ?? [], now);
}

export async function loadRecentKeys(profileId: string, now = Date.now()): Promise<string[]> {
  return (await loadPlayLog(profileId, now)).map((p) => p.key);
}

/** Notes that this profile just heard a clip. Returns the updated log. */
export async function rememberPlayed(profileId: string, key: string, now = Date.now()): Promise<PlayLog> {
  const log = prunePlayLog([...(await loadPlayLog(profileId, now)), { key, at: now }], now);
  await kvSetJson(logKey(profileId), log);
  return log;
}

// ---------------------------------------------------------------------------------------------
// Picking the next clip (the old kid Home sheet's "Another"; kept with the pool for the Recap).

/**
 * The clip to play now: a fresh one by pickClip's rules (never `current` while another exists),
 * remembered as heard for this profile so it won't come back for 7 days. Null for an empty pool.
 */
export async function nextClip(
  pool: MissHomeClip[],
  profileId: string,
  opts: { current?: string | null; rand?: () => number; now?: number } = {},
): Promise<MissHomeClip | null> {
  const now = opts.now ?? Date.now();
  const clip = pickClip(pool, await loadRecentKeys(profileId, now), opts.rand ?? Math.random, opts.current ?? null);
  if (clip) await rememberPlayed(profileId, clip.key, now);
  return clip;
}

/**
 * The clip as lib/media's useClipAudio takes it, tagged `heard` (RETENTION-WIRING 4.3) so a listen of
 * 3 s or more logs a 'heard' event with the cook, which also lights the kid's Sunday table.
 */
export function missHomeAudioClip(clip: MissHomeClip | null | undefined): {
  url: string;
  start_s: number;
  end_s: number;
  key: string;
  heard: { recipe_id: string; cook_id: string | null };
} | null {
  if (!clip) return null;
  return {
    url: clip.url,
    start_s: clip.start_s,
    end_s: clip.end_s,
    key: `missHome:${clip.key}`,
    heard: { recipe_id: clip.recipeId, cook_id: clip.cookId },
  };
}
