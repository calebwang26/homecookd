// Hearts & kitchen (docs/build/RETENTION-HANDOFF.md 3.5 + 3.6, PR 4): the two read routes behind the
// cook's "♥ 4 · cooked 3 times" lines, her faces row, "Leo can cook 4 of your 7" and the "Leo hearted
// your Sunday Chili" rows in her updates card.
//
//   GET /dish-stats?ids=a,b      -> DishStats     per dish of mine: hearts & cooks from my family, me excluded
//   GET /hearts/recent?since=iso -> HeartRecent[] new hearts on my dishes, newest first
//
// Same deps-injection style as makePlumbing() (plumbing.ts): this file imports plumbing.ts only, never
// retention.ts or index.ts. retention.ts's makeRetention() builds it when PR 4 is on (deps.prs) and
// tags its routes PR 4; index.ts registers them with the rest (RETENTION-WIRING.md, "PR 4 wiring").
//
// Rules that hold here (handoff section 5):
// - Counts go only to the dish's cook (guardrail 4, TODO(caleb) #6). A dish is mine when its
//   library.json cook_name is my name, case-insensitively: the app's cookProfile() rule, through
//   dishesOf(). Ids that aren't mine are left out of the answer, so Mom never sees Dad's counts.
// - Only people in my family right now, never me: favorites has no family_id, so both queries filter
//   by my family's current profile ids (removed people's hearts and cooks drop out too).
// - "Cooked" is recipe_events kind 'cooked' only. Since PR 1 the table also holds 'viewed', 'started'
//   and 'heard'; every query here names its kind (RETENTION-WIRING.md 3.7 and "PR 4 wiring" P3).
// - Never a ranking: nothing here compares cooks or kids.
// - No push for hearts (handoff 2.5): these are reads.
// - Samples count here: a heart on a cook's sample dish is a real heart from a real person, and every
//   family dish in the live library is a sample today. kitchenCounts.ts (the "4 of 7" counts) drops
//   samples itself. TODO(caleb): hide hearts on samples too once real recordings exist?

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  buildDishStats,
  dishesOf,
  type DishStats,
  type HeartRecent,
  type HttpErrorCtor,
  type Library,
  type RetentionCtx,
} from "./plumbing.ts";

/** The handoff's limit per call (2.2). The app splits longer lists. */
export const DISH_STATS_MAX_IDS = 50;
/** GET /hearts/recent without `since`: the last two weeks. */
export const HEARTS_RECENT_DEFAULT_DAYS = 14;
/** The furthest back `since` may reach. Older hearts still count in /dish-stats. */
export const HEARTS_RECENT_MAX_DAYS = 30;
/** The updates card shows the newest 3; 20 leaves room for dismissed rows. */
export const HEARTS_RECENT_LIMIT = 20;
/**
 * TODO: PostgREST's max_rows is 1000. 50 dishes x a family's hearts (one per person per dish) stays
 * far below it, and so do their 'cooked' events (one per person per minute at most); move the counts
 * into SQL before families get big.
 */
const ROW_CAP = 1000;
/** Same pattern as index.ts's RECIPE_ID. */
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Query parsing (pure)

/** `?ids=a,b,a` -> ['a', 'b'], or the 400 to send back. Spaces and empty items are ignored. */
export function parseDishIds(raw: string | null | undefined): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "ids is required" };
  if (ids.some((id) => !RECIPE_ID.test(id))) return { ok: false, error: "ids must be recipe ids separated by commas" };
  if (ids.length > DISH_STATS_MAX_IDS) return { ok: false, error: `ids: at most ${DISH_STATS_MAX_IDS}` };
  return { ok: true, ids };
}

/**
 * `?since=<iso>` -> the instant to read hearts after, or the 400. Missing: 14 days ago. Clamped to
 * 30 days back at most, and to now at most (a phone with a fast clock gets [] rather than an error).
 */
export function parseSince(raw: string | null | undefined, now: Date): { ok: true; since: Date } | { ok: false; error: string } {
  const floor = now.getTime() - HEARTS_RECENT_MAX_DAYS * DAY_MS;
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, since: new Date(now.getTime() - HEARTS_RECENT_DEFAULT_DAYS * DAY_MS) };
  const t = s.length <= 40 ? Date.parse(s) : NaN;
  if (!Number.isFinite(t)) return { ok: false, error: "since must be an ISO time" };
  return { ok: true, since: new Date(Math.min(Math.max(t, floor), now.getTime())) };
}

/** Rows of favorites as HeartRecent, newest first (ties by person, then dish, so it's stable), at most `limit`. */
export function newestHearts(
  rows: { profile_id: string; recipe_id: string; created_at: string }[],
  limit = HEARTS_RECENT_LIMIT,
): HeartRecent[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows]
    .sort((a, b) =>
      (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || cmp(a.profile_id, b.profile_id) || cmp(a.recipe_id, b.recipe_id)
    )
    .slice(0, limit)
    .map((r) => ({ profile_id: r.profile_id, recipe_id: r.recipe_id, at: r.created_at }));
}

// ---------------------------------------------------------------------------------------------
// Routes (registered by index.ts)

type DbError = { code?: string; message?: string } | null;
type FavoriteRow = { profile_id: string; recipe_id: string; created_at: string };

export type HeartsDeps<C extends RetentionCtx> = {
  db: SupabaseClient;
  HttpError: HttpErrorCtor;
  /** index.ts's requireMe: the acting person (400 without x-profile-id). */
  requireMe: (ctx: C) => { id: string; name: string };
  dbFail: (context: string, error: DbError) => never;
  /** plumbing.ts's makeLibrary(): library.json (dish -> cook_name), cached 10 min. */
  library: Pick<Library, "libraryIndex">;
  /** Override the clock (tests). */
  now?: () => Date;
};
/** The parts of index.ts's route Args these handlers read. */
export type HeartsArgs<C> = { ctx: C; url: URL };

export function makeHearts<C extends RetentionCtx>(deps: HeartsDeps<C>) {
  const { db, HttpError, requireMe, dbFail, library } = deps;
  const now = deps.now ?? (() => new Date());

  /** Everyone in my family right now except me. */
  const othersOf = (ctx: C, meId: string) => ctx.profiles.filter((p) => p.id !== meId && !p.removed_at).map((p) => p.id);

  /** My dishes (library cook_name = my name). Empty when the bucket can't be reached: nothing shows. */
  const myDishes = async (name: string) => new Set(dishesOf(await library.libraryIndex(), name));

  // GET /dish-stats?ids=a,b -> {[id]: {hearts: {count, by}, cooked: {count, by}}}, for the ids that
  // are my dishes (others are left out), each with zeros when nothing happened yet.
  async function dishStats({ ctx, url }: HeartsArgs<C>): Promise<DishStats> {
    const me = requireMe(ctx);
    const parsed = parseDishIds(url.searchParams.get("ids"));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const mine = await myDishes(me.name);
    const ids = parsed.ids.filter((id) => mine.has(id));
    if (!ids.length) return {};
    const others = othersOf(ctx, me.id);
    if (!others.length) return buildDishStats(ids, [], []);
    const [favs, cooked] = await Promise.all([
      db.from("favorites").select("profile_id, recipe_id, created_at")
        .in("recipe_id", ids).in("profile_id", others)
        .order("created_at", { ascending: false }).limit(ROW_CAP),
      db.from("recipe_events").select("profile_id, recipe_id, created_at")
        .eq("family_id", ctx.family.id).eq("kind", "cooked").in("recipe_id", ids).in("profile_id", others)
        .order("created_at", { ascending: false }).limit(ROW_CAP),
    ]);
    if (favs.error) dbFail("dish stats hearts", favs.error);
    if (cooked.error) dbFail("dish stats cooked", cooked.error);
    return buildDishStats(ids, (favs.data ?? []) as FavoriteRow[], (cooked.data ?? []) as FavoriteRow[]);
  }

  // GET /hearts/recent?since=<iso> -> [{profile_id, recipe_id, at}]: hearts on my dishes from my
  // family since then (default 14 days, at most 30), newest first, at most 20. An un-heart deletes
  // the favorites row, so it disappears here too.
  async function heartsRecent({ ctx, url }: HeartsArgs<C>): Promise<HeartRecent[]> {
    const me = requireMe(ctx);
    const parsed = parseSince(url.searchParams.get("since"), now());
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const mine = [...(await myDishes(me.name))];
    const others = othersOf(ctx, me.id);
    if (!mine.length || !others.length) return [];
    const rows: FavoriteRow[] = [];
    // A cook with more than 100 dishes: one query per 100, like index.ts's inChunks().
    for (let i = 0; i < mine.length; i += 100) {
      const { data, error } = await db.from("favorites").select("profile_id, recipe_id, created_at")
        .in("recipe_id", mine.slice(i, i + 100)).in("profile_id", others)
        .gt("created_at", parsed.since.toISOString())
        .order("created_at", { ascending: false }).limit(HEARTS_RECENT_LIMIT);
      if (error) dbFail("hearts recent", error);
      rows.push(...((data ?? []) as FavoriteRow[]));
    }
    return newestHearts(rows);
  }

  return {
    dishStats,
    heartsRecent,
    routes: [
      { method: "GET", path: "/dish-stats", handler: dishStats, auth: {} },
      { method: "GET", path: "/hearts/recent", handler: heartsRecent, auth: {} },
    ],
  };
}
