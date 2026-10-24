// The Sunday table on the server (docs/build/RETENTION-HANDOFF.md 3.2, PR 5): GET /table, and the
// Sunday 17:00 nudge as a job for the hourly cron. The rules themselves (lit faces, pair weeks,
// leftovers week, ember, milestones, who gets nudged & with which quote) are pure, in table.ts; this
// file loads what they need and hands it over.
//
// Wiring: retention.ts's makeRetention() builds this when PR 5 is on (deps.prs), with index.ts's one
// makeLibrary() (so both share its 10-minute cache), tags GET /table PR 5 and registers the
// `table_nudge` job on the hourly cron. This file imports plumbing.ts, table.ts, time.ts & a type from
// recap.ts, never retention.ts or index.ts (RETENTION-WIRING.md, "PR 5 wiring").
//
// History: one call to public.table_activity (supabase/migrations/20261018100300_retention_table.sql)
// returns the family's activity as a single jsonb array, so PostgREST's 1000-row cap never cuts a
// chatty year short. It loads 53 weeks; when a streak runs nearly that far back, it loads twice as
// much (up to ~5 years), so a long streak is never held at the window's length (table.ts header).
//
// Cache (brief PR 5 (d): "per family, 60 s"), per isolate: the rows older than ~8 days are kept for
// 60 s per family, and the window length a family needed is remembered, so a Home focus costs one
// small call for the last 8 days instead of a year (or two) of history. The recent rows are always
// read fresh, so a face lights the moment it's earned (a send, "I made it", a listen); only a delete
// of an older row can take up to 60 s to show. The cut sits on a 15-minute slot boundary, the same
// slots the SQL collapses repeats into, so the two parts join exactly as one call would return them.
//
// Guardrails (handoff section 5): the nudge goes only to kids, never about a memorial cook, quotes
// only a cook's verbatim step words from real (not sample) recordings THIS family published, and
// passes through notify() for caps, quiet hours & dedupe. Only pairs that include the caller are
// returned (guardrail 4).
//
// Whose dish is whose: library.json ties a dish to a cook by name alone (the app's cookProfile()
// rule), and it's one library for every family, so another family's real "Mom" recording matches
// this family's "Mom" by name. Anything that speaks in a cook's voice is therefore scoped to the
// family's own delivered recordings (public.pending_sends, delivered_at set): the nudge's quotes and
// the dish it opens. The name rule is used only where the row already belongs to this family (an
// older event without a cook_id, the dish a delivered recording became), and only against current
// cooks.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { type CronJob, dishesOf, type FamilyProfile, familyProfiles, type Library, type RecipeDetails } from "./plumbing.ts";
import type { RecipeInfo } from "./recap.ts";
import {
  type Activity,
  computeTable,
  familyPairs,
  nudgeCandidates,
  nudgePush,
  type PairStreak,
  pickNudgeQuote,
  type Table,
  weekStart,
} from "./table.ts";
import { DEFAULT_TZ, validTz, zoneOf } from "./time.ts";

const DAY_MS = 86_400_000;
/** First load: a year and a week. */
export const HISTORY_WEEKS = 53;
/** Never more than ~5 years, however long a streak runs. */
export const MAX_HISTORY_WEEKS = 265;
/** A quote isn't reused for the same kid within 15 days (handoff 3.2). */
export const QUOTE_ROTATION_DAYS = 15;
/** How long a family's older rows are reused (brief: 60 s). */
export const HISTORY_CACHE_MS = 60_000;
/** Rows newer than this are read on every call (well past any zone's current week). */
export const FRESH_TAIL_MS = 8 * DAY_MS;
/** table_activity collapses repeats into 15-minute slots of the epoch; the cache cuts on one. */
const SLOT_MS = 900_000;

// ---------------------------------------------------------------------------------------------
// The RPC's rows

/** One object of the table_activity array (nulls are left out by the SQL). */
export type ActivityRow = {
  at: string;
  actor_id: string;
  kind: "cooked" | "heard" | "message" | "published";
  target_cook_id?: string | null;
  target_kid_id?: string | null;
  thread_with?: string | null;
  duration_s?: number | string | null;
  /**
   * cooked / heard rows whose event has no cook_id (older events), and published rows (the dish the
   * recording became): mapped to a family cook by the library.
   */
  recipe_id?: string | null;
};

const KINDS = new Set(["cooked", "heard", "message", "published"]);
const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The RPC's jsonb array, keeping only well-formed rows (anything else is skipped, never thrown). */
export function parseActivity(data: unknown): ActivityRow[] {
  if (!Array.isArray(data)) return [];
  const out: ActivityRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const at = text(r.at);
    const actor = text(r.actor_id);
    const kind = text(r.kind);
    if (!at || !actor || !kind || !KINDS.has(kind) || Number.isNaN(Date.parse(at))) continue;
    out.push({
      at,
      actor_id: actor,
      kind: kind as ActivityRow["kind"],
      target_cook_id: text(r.target_cook_id),
      target_kid_id: text(r.target_kid_id),
      thread_with: text(r.thread_with),
      duration_s: typeof r.duration_s === "number" || typeof r.duration_s === "string" ? r.duration_s : null,
      recipe_id: text(r.recipe_id),
    });
  }
  return out;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Rows -> table.ts's Activity, finding a dish's cook from the library: its cook_name matched
 * case-insensitively to a CURRENT family cook's name (the app's cookProfile() rule). A removed
 * "Mom" (profiles_family_name_key is unique only among current members) or a kid who shares the
 * name never takes the match. Every row here already belongs to this family, so the name rule can't
 * reach another family's cook.
 * - cooked / heard without a cook (older events): that cook, else null (it then counts toward nobody).
 * - published: credited to the dish's cook, so the cook whose recording went out lights even when a
 *   kid filmed it and registered the send (the row's actor). No match, or no library: the sender.
 */
export function toActivity(
  rows: ActivityRow[],
  profiles: Pick<FamilyProfile, "id" | "name" | "role" | "removed_at">[],
  index: ReadonlyMap<string, RecipeInfo> | null,
): Activity[] {
  const cookByName = new Map<string, string>();
  for (const p of profiles) {
    const n = norm(p.name);
    if (p.role === "cook" && !p.removed_at && n && !cookByName.has(n)) cookByName.set(n, p.id);
  }
  const cookOf = (recipeId: string | null | undefined) =>
    recipeId && index ? cookByName.get(norm(index.get(recipeId)?.cook_name)) ?? null : null;
  return rows.map((r) => {
    let cook = r.target_cook_id ?? null;
    if (!cook && (r.kind === "cooked" || r.kind === "heard")) cook = cookOf(r.recipe_id);
    return {
      at: r.at,
      actor_id: r.kind === "published" ? cookOf(r.recipe_id) ?? r.actor_id : r.actor_id,
      kind: r.kind,
      target_cook_id: cook,
      target_kid_id: r.target_kid_id ?? null,
      thread_with: r.thread_with ?? null,
      duration_s: r.duration_s ?? null,
    };
  });
}

/** Does this row need the library to find its cook (toActivity)? */
const needsLibrary = (r: ActivityRow) =>
  !!r.recipe_id && (r.kind === "published" || ((r.kind === "cooked" || r.kind === "heard") && !r.target_cook_id));

/**
 * Could a streak reach back past the start of the loaded window? A count spans its pair weeks plus at
 * most one leftovers week a month (and an ember's miss), so a kept count within that slack of the
 * window's length may be cut short: load more.
 */
export function needsMoreHistory(pairs: Pick<PairStreak, "kept">[], weeks: number): boolean {
  const slack = Math.ceil(weeks / 4) + 2;
  return pairs.some((p) => p.kept > 0 && p.kept + slack >= weeks);
}

// ---------------------------------------------------------------------------------------------
// Whose week the table is framed in

/**
 * The zone a viewer's table (their face & week_start) is framed in. A kid: their own. A cook with
 * exactly one kid in the family: that kid's, so the cook's week turns when their only pair's does
 * (table.ts header; TODO(caleb): confirm). Any other cook: their own. Nobody picked yet: the phone's
 * x-tz, else Los Angeles.
 */
export function viewerTz(me: FamilyProfile | null, profiles: FamilyProfile[], headerTz: string | null): string {
  if (!me) return headerTz ?? DEFAULT_TZ;
  if (me.role === "learner") return zoneOf(me.tz);
  const kids = profiles.filter((p) => p.role === "learner" && !p.removed_at && !p.memorial);
  return kids.length === 1 ? zoneOf(kids[0].tz) : zoneOf(me.tz);
}

// ---------------------------------------------------------------------------------------------
// Routes & the cron job

/** The parts of index.ts's Ctx this file reads. */
export type TableCtx = { family: { id: string }; me: { id: string } | null };

export type TableDeps = {
  db: SupabaseClient;
  dbFail: (context: string, error: { code?: string; message?: string } | null) => never;
  /** index.ts's makeLibrary() instance (dish -> cook for older events; the nudge's quotes). */
  library: Library;
  /**
   * Override the clock (tests). The cron passes its own `now` to the job; this clock still stands for
   * real time (the cache's cut never sits past it).
   */
  clock?: () => Date;
  /** How long older rows are reused per family (default HISTORY_CACHE_MS; 0 turns the cache off). */
  cacheMs?: number;
  /** The cache's own clock, in ms (tests); real time by default, whatever `clock` says. */
  cacheNow?: () => number;
};

/** GET /table's answer: the table, plus the dishes this family's own recordings became. */
export type TableWithRecordings = Table & { recordings: string[] };

/** A family's rows in [since, cutoff), read at `at` (cache clock), for a window of `weeks`. */
type History = { since: number; cutoff: number; at: number; rows: ActivityRow[] };

export function makeTable<C extends TableCtx>(deps: TableDeps) {
  const { db, dbFail, library } = deps;
  const clock = deps.clock ?? (() => new Date());
  const cacheMs = deps.cacheMs ?? HISTORY_CACHE_MS;
  const cacheNow = deps.cacheNow ?? (() => Date.now());
  const history = new Map<string, History>();
  /** Families whose streaks needed more than HISTORY_WEEKS last time: start there. */
  const windows = new Map<string, number>();

  /** One call to table_activity. */
  async function activityRows(familyId: string, since: Date): Promise<ActivityRow[]> {
    const { data, error } = await db.rpc("table_activity", { p_family: familyId, p_since: since.toISOString() });
    if (error) dbFail("table activity", error);
    return parseActivity(data);
  }

  /**
   * Every row since `since`: the cached older part plus a fresh read of the last ~8 days, or one
   * full read (which refills the cache) when there's no cached part reaching back that far.
   */
  async function rowsSince(familyId: string, now: Date, since: number): Promise<ActivityRow[]> {
    const t = cacheNow();
    if (cacheMs > 0) {
      for (const [id, h] of history) if (t - h.at >= cacheMs) history.delete(id);
    }
    const hit = cacheMs > 0 ? history.get(familyId) : undefined;
    if (hit && hit.since <= since) {
      const tail = await activityRows(familyId, new Date(hit.cutoff));
      return [...hit.rows.filter((r) => Date.parse(r.at) >= since), ...tail];
    }
    const rows = await activityRows(familyId, new Date(since));
    if (cacheMs > 0) {
      // From the earlier of `now` and the clock: a cron run with a `now` ahead of real time (a test
      // run) would otherwise cut in the future, and for 60 s real calls would read their fresh part
      // from there and miss brand-new rows. A cut in the past is only a longer fresh read.
      const real = Math.min(now.getTime(), clock().getTime());
      const cutoff = Math.floor((real - FRESH_TAIL_MS) / SLOT_MS) * SLOT_MS;
      history.set(familyId, { since, cutoff, at: t, rows: rows.filter((r) => Date.parse(r.at) < cutoff) });
    }
    return rows;
  }

  /**
   * The family's activity, far enough back for every current streak (see needsMoreHistory). The
   * library is read only when a row needs its cook found by name (an older event without a cook, a
   * delivered recording); pass it in to reuse one.
   */
  async function loadActivity(
    familyId: string,
    now: Date,
    profiles: FamilyProfile[],
    index?: ReadonlyMap<string, RecipeInfo> | null,
  ): Promise<Activity[]> {
    let lib = index ?? null;
    let weeks = windows.get(familyId) ?? HISTORY_WEEKS;
    for (;;) {
      // A week more than the window, so its first week is whole in every zone.
      const rows = await rowsSince(familyId, now, now.getTime() - (weeks + 1) * 7 * DAY_MS);
      if (!lib && rows.some(needsLibrary)) lib = await library.libraryIndex();
      const activity = toActivity(rows, profiles, lib);
      const pairs = familyPairs({ now, profiles, activity });
      if (weeks >= MAX_HISTORY_WEEKS || !needsMoreHistory(pairs, weeks)) {
        // Remember the shortest window in the doubling chain that holds every streak, so the next
        // call starts there; a streak that broke goes back to 53 weeks.
        let need = HISTORY_WEEKS;
        while (need < weeks && needsMoreHistory(pairs, need)) need = Math.min(need * 2, MAX_HISTORY_WEEKS);
        if (need > HISTORY_WEEKS) windows.set(familyId, need);
        else windows.delete(familyId);
        return activity;
      }
      weeks = Math.min(weeks * 2, MAX_HISTORY_WEEKS);
    }
  }

  /**
   * GET /table (auth { lenientMe: true }) -> {week_start, people: [{profile_id, lit}], pairs: [{kid_id,
   * cook_id, weeks, ember_until, lit_this_week, milestone?}], recordings: [recipe_id]}. Every current
   * family member's flame this week; only the pairs that include the caller (none without a picked
   * person: the Profiles screen). Computed on read: families are small, and a flame should show the
   * moment it's earned (only the rows older than ~8 days come from the 60 s cache; see the header).
   * `recordings` are the dishes this family's own recordings became (familyRecordings, sorted): the
   * app's "I miss home" pool plays only these, so a same-named cook's recording from another family
   * never plays as this family's (handoff 3.3, guardrail 1).
   */
  async function getTable({ req, ctx }: { req: Request; ctx: C }): Promise<TableWithRecordings> {
    const now = clock();
    const headerTz = validTz(req.headers.get("x-tz"));
    // The caller's zone from this request's x-tz wins over the stored one (syncTz stores it after the
    // response), so the very first call already counts the week in their own time.
    const profiles = (await familyProfiles(db, ctx.family.id)).map((p) =>
      headerTz && p.id === ctx.me?.id ? { ...p, tz: headerTz } : p
    );
    const me = profiles.find((p) => p.id === ctx.me?.id && !p.removed_at) ?? null;
    const [activity, own] = await Promise.all([loadActivity(ctx.family.id, now, profiles), familyRecordings(ctx.family.id)]);
    const table = computeTable({ now, kidTz: viewerTz(me, profiles, headerTz), profiles, activity, me: me?.id ?? null });
    return { ...table, recordings: [...own].sort() };
  }

  /** The quote keys this kid's nudges used in the last 15 days (skipped pushes weren't seen). */
  async function usedQuoteKeys(kidId: string, now: Date): Promise<string[]> {
    const { data, error } = await db.from("notification_log").select("quote_key, skipped_reason")
      .eq("profile_id", kidId).eq("kind", "table_nudge").is("skipped_reason", null)
      .gt("sent_at", new Date(now.getTime() - QUOTE_ROTATION_DAYS * DAY_MS).toISOString())
      .limit(200);
    if (error) dbFail("nudge quotes", error);
    return ((data ?? []) as { quote_key: string | null }[]).map((r) => r.quote_key).filter((k): k is string => !!k);
  }

  /**
   * The dishes this family's recordings became (pending_sends delivered with a recipe_id): the only
   * real recordings the nudge may quote or open (see the header: the library's cook names are shared
   * by every family). A family has a few dozen at most, well under PostgREST's cap.
   */
  async function familyRecordings(familyId: string): Promise<Set<string>> {
    const { data, error } = await db.from("pending_sends").select("recipe_id")
      .eq("family_id", familyId).not("delivered_at", "is", null).not("recipe_id", "is", null)
      .limit(1000);
    if (error) dbFail("family recordings", error);
    return new Set(((data ?? []) as { recipe_id: string | null }[]).map((r) => r.recipe_id).filter((id): id is string => !!id));
  }

  /**
   * A cook's real recordings that this family published, read for their step quotes. Samples are
   * skipped (not her words), and so is a same-named cook's recording from another family.
   */
  async function realRecipes(index: ReadonlyMap<string, RecipeInfo>, cookName: string, mine: ReadonlySet<string>): Promise<RecipeDetails[]> {
    const ids = dishesOf(index, cookName).filter((id) => mine.has(id) && index.get(id)?.sample === false);
    const got = await Promise.all(ids.map((id) => library.recipeInfo(id)));
    return got.filter((r): r is RecipeDetails => r !== null);
  }

  /**
   * The Sunday nudge (handoff 3.2 & 2.5), for kids the cron finds in their local Sunday 17:xx with push
   * on (`due.nudge`): the one pair worth a note (nudgeCandidates: the longest streak not lit yet), in
   * the cook's own words when a quote is left (only from recordings this family published), else the
   * plain line. Opens the quoted dish, else the cook's first recording this family published, else a
   * sample dish under the cook's name (as the app shows it), else the kid's Home; never another
   * family's real recording. TODO(caleb): the handoff says "that cook's newest recipe", but
   * library.json has no dates. One family failing never stops the others. Returns pushes sent.
   */
  const cronJob: CronJob = {
    name: "table_nudge",
    async run({ now, due, notify }) {
      const kids = due.nudge.filter((p) => p.role === "learner" && !p.removed_at && !p.memorial);
      if (!kids.length) return 0;
      const families = new Map<string, Set<string>>();
      for (const k of kids) families.set(k.family_id, (families.get(k.family_id) ?? new Set()).add(k.id));
      const index = await library.libraryIndex();
      let sent = 0;
      for (const [familyId, wanted] of families) {
        try {
          const profiles = await familyProfiles(db, familyId);
          const activity = await loadActivity(familyId, now, profiles, index);
          const pairs = familyPairs({ now, profiles, activity });
          let mine: Set<string> | null = null; // read once, at the first nudge
          for (const n of nudgeCandidates({ now, profiles, pairs })) {
            if (!wanted.has(n.kid_id)) continue;
            const kid = profiles.find((p) => p.id === n.kid_id);
            const cook = profiles.find((p) => p.id === n.cook_id);
            if (!kid || !cook) continue;
            const week = weekStart(now, zoneOf(kid.tz));
            const own: Set<string> = (mine ??= await familyRecordings(familyId));
            const quote = pickNudgeQuote({
              cookRecipes: await realRecipes(index, cook.name, own),
              usedQuoteKeys: await usedQuoteKeys(kid.id, now),
              seed: Number(week.replaceAll("-", "")),
            });
            const { title, body } = nudgePush(cook.name, quote);
            const dishes = dishesOf(index, cook.name);
            const first = dishes.find((id) => own.has(id)) ?? dishes.find((id) => index.get(id)?.sample === true);
            const result = await notify(kid.id, {
              kind: "table_nudge",
              title,
              body,
              url: quote ? `/recipe/${quote.quoteKey.split("#")[0]}` : first ? `/recipe/${first}` : "/kid/home",
              appInitiated: true,
              dedupeKey: `table_nudge:${kid.id}:${week}`,
              quoteKey: quote?.quoteKey ?? null,
            });
            if (result === "sent") sent += 1;
          }
        } catch (e) {
          console.error("table nudge (family skipped):", String(e));
        }
      }
      return sent;
    },
  };

  return {
    getTable,
    loadActivity,
    cronJob,
    routes: [{ method: "GET", path: "/table", handler: getTable, auth: { lenientMe: true } }],
  };
}
