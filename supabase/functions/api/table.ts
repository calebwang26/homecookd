// The Sunday table (docs/build/RETENTION-HANDOFF.md 3.2): whose face lights up this week, and how many
// weeks in a row each kid & cook have both shown up. Pure: no database, no network, no clock (`now` is
// always passed in). index.ts (PR5) loads the family's profiles & activity, turns it into Activity
// records and calls computeTable() for GET /table; the hourly cron calls familyPairs(),
// nudgeCandidates(), pickNudgeQuote() & nudgePush() for the Sunday 17:00 nudge.
// The activity must reach back past the start of every current streak: a count can't be older than
// the oldest week it's given, so a fixed 365-day window would hold a long pair at ~53 for good. Load
// a year, and while a pair's earliest loaded week is still a pair week, page further back (p_since)
// until there's a gap. TODO(PR5): that paging, or accept the cap until a streak gets near a year.
// `now` comes from the server clock, or the cron's override, which index.ts checks first (400 for a
// malformed one). Given an Invalid Date anyway, computeTable(), familyPairs() & nudgeCandidates() don't
// throw: they give an empty table, no pairs & no nudges.
//
// Weeks run Monday 00:00 -> Sunday 23:59 in the kid's local time. A kid's face, every pair & the nudge
// hour use that kid's own zone: profile.tz, else Los Angeles (time.ts DEFAULT_TZ, as the SQL coalesces).
// Never the viewer's, so the two people in a pair always see the same count (guardrail 4). Cooks don't
// own a week: only their faces & week_start use `kidTz`, which the caller sets to the viewer's zone (a
// kid's own tz; for a cook, their tz or DEFAULT_TZ). So for a cook the table's week_start can turn
// before or after a pair's week does: a cook in New York sees a new week_start at Sunday 21:00 PT,
// while `lit_this_week` on the pair with an LA kid still means the LA week, 3 hours from closing. The
// pairs are right (each is its kid's week); only the label differs. A cook with exactly one kid can be
// given that kid's zone as `kidTz` to line them up. TODO(caleb): say if index.ts should do that.
//
// Lit, per person per week:
// - kid: cooked or heard (>= 3 s) a family cook's dish, or sent any message to a family cook (their 1:1
//   thread, or the family circle, which every cook reads);
// - cook: sent any message (answer, voice note, reaction, recipe) or had a recording published.
// Pair week (kid K, cook C): K did something with C (cooked or heard C's dish, a message in the K-C
// thread) AND C did something toward K (a message in the K-C thread, or a recipe sent or published to K).
// A family cook's dish is a library dish whose cook is another family profile with role cook, sample or
// not: 3.2 counts what the kid did, and a kid who cooked or heard a sample really did. Samples stay out
// only where her words are quoted (the nudge's quote below, the I-miss-home pool; D7). recap.ts counts
// "family dishes" by the same rule, so a flame & the month's recap agree.
// TODO(caleb): 3.6's kitchen counts skip samples. If flames & pair weeks should too, index.ts can drop
// sample dishes' cooked & heard records before calling in (every family dish in the live & test
// libraries is a sample today, so that would leave only messages to light a face).
//
// Streaks (keep these exact; guardrail 4): `weeks` counts pair weeks in a row up to the last closed
// week, plus this week once it's lit. One missed week per calendar month (the month of its Monday) is
// forgiven on its own: the leftovers week. Any other miss starts an ember: for the 7 days after the
// missed week closes (that is, this week) there's no count but the old one is kept; a pair week inside
// those 7 days relights it at old + 1, otherwise it quietly starts again at 0. Misses while the count
// is 0 change nothing (and use up no leftovers week). Milestones at 4, 12, 26 & 52: reported while
// `weeks` is the milestone, from the week it's reached until a new pair week moves the count on (see
// pairStreak), so `milestone`, when present, always equals `weeks`.
//
// Memorial (guardrail 2): a memorial profile is in no pair, never lights and is never nudged about.
// Unlit is only ever `lit: false`; no copy here says what didn't happen (guardrail 7).

import { localDateKey, localParts, NUDGE_AT, zonedMidnight, zoneOf } from "./time.ts";

const DAY_MS = 86_400_000;
export const MILESTONES = [4, 12, 26, 52];
export const MAX_QUOTE = 90;

export type TableProfile = {
  id: string;
  role: "cook" | "learner";
  memorial?: boolean | null;
  tz?: string | null; // IANA name from the app's x-tz header; null = Los Angeles (DEFAULT_TZ)
  removed_at?: string | null;
};

export type ActivityKind = "cooked" | "heard" | "message" | "published" | "recipe_sent";

/**
 * One thing someone did. index.ts (PR5) normalizes the rows before calling in; this module trusts them:
 * - cooked / heard: recipe_events rows. `target_cook_id` is recipe_events.cook_id, or, when that's null
 *   (older events), the library's cook_name matched case-insensitively to a family profile name, the
 *   rule recap.ts applies itself. Left null, the record counts toward no cook. Sample dishes count like
 *   any other (see the header). A heard record needs `duration_s` >= 3; a missing one never counts.
 * - message: every messages row except system notes (kind 'system' is nobody's part of the week).
 * - published: a recording of theirs going out (pending_sends.delivered_at), `target_kid_id` when it
 *   went to one kid; recipe_sent: a recipe sent to `target_kid_id`.
 */
export type Activity = {
  at: string | Date;
  actor_id: string;
  kind: ActivityKind;
  target_cook_id?: string | null; // cooked / heard: whose dish it was (see above)
  target_kid_id?: string | null; // recipe_sent / published: who it went to
  thread_with?: string | null; // message: the other person in a 1:1 thread; null = the family circle
  duration_s?: number | string | null; // heard: seconds played (under 3 s, or missing, never counts)
};

export type TablePair = {
  kid_id: string;
  cook_id: string;
  weeks: number | null; // null while an ember shows
  ember_until: string | null; // ISO instant the ember ends (next Monday 00:00, kid's time)
  lit_this_week: boolean;
  milestone?: number;
};

/** A pair plus the count an ember keeps hidden (equal to `weeks` when there's no ember). Server only. */
export type PairStreak = TablePair & { kept: number };

export type Table = {
  week_start: string; // Monday 'YYYY-MM-DD' in kidTz ('' only when `now` is an Invalid Date)
  people: { profile_id: string; lit: boolean }[];
  pairs: TablePair[];
};

export type PairsInput = { now: Date; profiles: TableProfile[]; activity: Activity[] };
export type TableInput = PairsInput & { kidTz: string };

// --- local calendar (zones & wall clocks from time.ts; day strings are plain UTC date math) ------

const dayMs = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (day: string, n: number) => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(dayMs(day)).getUTCDay(); // 0 = Sunday
const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

/** The instant `day` starts (local midnight) in `tz`, right across DST changes (time.ts). */
function zonedStart(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return zonedMidnight(y, m, d, tz);
}

/** Monday 'YYYY-MM-DD' of the week `now` falls in, in `tz` (also the nudge's dedupe week). Throws on an
 * Invalid Date: callers check `now` first (see the header). */
export function weekStart(now: Date, tz: string): string {
  return mondayOf(localDateKey(now, zoneOf(tz)));
}

/** A real instant (an Invalid Date `now` gives empty results instead of a RangeError; see the header). */
const usable = (now: Date) => now instanceof Date && Number.isFinite(now.getTime());

function instant(at: string | Date): Date | null {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- rules ------------------------------------------------------------------------------------

/** A cooked record, or a heard one of 3 s or more (a missing duration never counts, as in recap.ts). */
const dishCounts = (a: Activity) => a.kind !== "heard" || Number(a.duration_s ?? 0) >= 3;

/** Kid K did something with cook C (cooked or heard C's dish, or wrote in their thread). */
function kidToward(a: Activity, kid: string, cook: string): boolean {
  if (a.actor_id !== kid) return false;
  if (a.kind === "cooked" || a.kind === "heard") return a.target_cook_id === cook && dishCounts(a);
  return a.kind === "message" && a.thread_with === cook;
}

/** Cook C did something toward kid K (wrote in their thread, or sent or published a recipe to K). */
function cookToward(a: Activity, cook: string, kid: string): boolean {
  if (a.actor_id !== cook) return false;
  if (a.kind === "message") return a.thread_with === kid;
  return (a.kind === "recipe_sent" || a.kind === "published") && a.target_kid_id === kid;
}

/** Does this record light person `p`'s face (ignoring which week it's in)? */
function lights(a: Activity, p: TableProfile, family: Map<string, TableProfile>, livingCook: boolean): boolean {
  if (a.actor_id !== p.id || p.memorial) return false;
  if (p.role === "cook") return a.kind === "message" || a.kind === "published" || a.kind === "recipe_sent";
  // A memorial cook still counts as a family cook here: cooking or hearing her dish is the kid's part.
  const isCook = (id?: string | null) => !!id && id !== p.id && family.get(id)?.role === "cook";
  if (a.kind === "cooked" || a.kind === "heard") return isCook(a.target_cook_id) && dishCounts(a);
  if (a.kind === "message") return a.thread_with ? isCook(a.thread_with) : livingCook;
  return false;
}

// --- streaks ----------------------------------------------------------------------------------

/**
 * A week key as its Monday 'YYYY-MM-DD': takes the date part of a timestamp (a date cast to text) and
 * any day of the week; null for anything that isn't a real calendar date.
 */
function weekKey(key: string): string | null {
  const day = String(key).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addDays(day, 0) !== day) return null;
  return mondayOf(day);
}

/**
 * One pair's streak from its pair weeks (kid's time) and the current week. index.ts may pass keys
 * straight from the table_activity RPC: each is snapped to its Monday & a malformed one is skipped.
 * A malformed `current` is a caller bug and throws.
 */
export function pairStreak(
  litKeys: ReadonlySet<string>,
  currentKey: string,
  tz: string,
): Omit<PairStreak, "kid_id" | "cook_id"> {
  const current = weekKey(currentKey);
  if (!current) throw new Error(`pairStreak: current must be a 'YYYY-MM-DD' week, got ${JSON.stringify(currentKey)}`);
  const lit = new Set<string>();
  for (const k of litKeys) {
    const w = weekKey(k);
    if (w) lit.add(w);
  }
  const closed = [...lit].filter((w) => w < current).sort();
  let count = 0;
  let ember = false;
  let reached: { milestone: number; week: string } | null = null; // the latest one & the week it landed
  const forgiven = new Set<string>(); // 'YYYY-MM' of each leftovers week's Monday
  for (let w = closed[0]; w !== undefined && w < current; w = addDays(w, 7)) {
    if (lit.has(w)) {
      count += 1;
      ember = false;
      if (MILESTONES.includes(count)) reached = { milestone: count, week: w };
    } else if (count === 0) {
      continue;
    } else if (ember) {
      count = 0; // the 7 days passed without a pair week: start again, quietly
      ember = false;
    } else if (!forgiven.has(w.slice(0, 7))) {
      // TODO(caleb): keyed by the missed week's calendar month, as 3.2 says, so two misses in a row that
      // straddle a month (Oct 26 & Nov 2) are both forgiven and never ember, though 3.2's acceptance reads
      // "skipping two shows the ember". Say if it should forgive at most one miss per gap instead.
      forgiven.add(w.slice(0, 7));
    } else {
      ember = true;
    }
  }
  const litNow = lit.has(current);
  if (litNow && MILESTONES.includes(count + 1)) reached = { milestone: count + 1, week: current };
  const weeks = litNow ? count + 1 : ember ? null : count;
  const out: Omit<PairStreak, "kid_id" | "cook_id"> = {
    weeks,
    kept: litNow ? count + 1 : count,
    ember_until: !litNow && ember ? zonedStart(addDays(current, 7), zoneOf(tz)).toISOString() : null,
    lit_this_week: litNow,
  };
  // The burst shows while `weeks` is the milestone: the week it's reached and, when that week closed on
  // it, the next one until a new pair week moves the count on. So a 4 that lands on a Sunday night still
  // reaches whoever opens the chat on Monday (the app's kv key keeps it one-time), and the burst never
  // sits beside a newer count. An ember never shows one: a miss came since.
  if (weeks !== null && reached?.milestone === weeks && reached.week >= addDays(current, -7)) {
    out.milestone = weeks;
  }
  return out;
}

/**
 * Every kid-cook pair in the family with its streak. Memorial & removed profiles are in no pair. Each
 * pair's weeks are in its kid's own zone (never a viewer's), so the same call serves GET /table & the cron.
 */
export function familyPairs({ now, profiles, activity }: PairsInput): PairStreak[] {
  if (!usable(now)) return [];
  const here = profiles.filter((p) => !p.removed_at && !p.memorial);
  const cooks = here.filter((p) => p.role === "cook");
  const pairs: PairStreak[] = [];
  for (const kid of here.filter((p) => p.role === "learner")) {
    const tz = zoneOf(kid.tz);
    const current = weekStart(now, tz);
    const theirs: { a: Activity; week: string }[] = [];
    for (const a of activity) {
      if (a.actor_id !== kid.id && a.thread_with !== kid.id && a.target_kid_id !== kid.id) continue;
      const at = instant(a.at);
      const week = at && mondayOf(localDateKey(at, tz));
      if (week && week <= current) theirs.push({ a, week });
    }
    for (const cook of cooks) {
      const kidSide = new Set<string>();
      const cookSide = new Set<string>();
      for (const { a, week } of theirs) {
        if (kidToward(a, kid.id, cook.id)) kidSide.add(week);
        else if (cookToward(a, cook.id, kid.id)) cookSide.add(week);
      }
      const lit = new Set([...kidSide].filter((w) => cookSide.has(w)));
      pairs.push({ kid_id: kid.id, cook_id: cook.id, ...pairStreak(lit, current, tz) });
    }
  }
  return pairs;
}

/** GET /table: every face's flame this week, and the pairs that include `me` (none without a me). */
export function computeTable(input: TableInput & { me: string | null }): Table {
  const { now, kidTz, profiles, activity, me } = input;
  if (!usable(now)) return { week_start: "", people: [], pairs: [] };
  const here = profiles.filter((p) => !p.removed_at);
  const family = new Map(here.map((p) => [p.id, p]));
  const livingCook = here.some((p) => p.role === "cook" && !p.memorial);
  const frame = zoneOf(kidTz);
  const people = here.map((p) => {
    const tz = p.role === "learner" ? zoneOf(p.tz) : frame;
    const week = weekStart(now, tz);
    const lit = activity.some((a) => {
      if (!lights(a, p, family, livingCook)) return false;
      const at = instant(a.at);
      return !!at && mondayOf(localDateKey(at, tz)) === week;
    });
    return { profile_id: p.id, lit };
  });
  const pairs = me
    ? familyPairs(input)
      .filter((p) => p.kid_id === me || p.cook_id === me)
      .map(({ kept: _kept, ...p }) => p)
    : [];
  return { week_start: weekStart(now, frame), people, pairs };
}

// --- the Sunday nudge -------------------------------------------------------------------------

export type Nudge = { kid_id: string; cook_id: string; weeks: number };

/** True when it's Sunday 17:00-17:59 in `tz` (time.ts NUDGE_AT, the same hour the cron picks). */
function sundayEvening(now: Date, tz: string): boolean {
  const p = localParts(now, tz);
  return p.weekday === NUDGE_AT.weekday && p.hour === NUDGE_AT.hour;
}

/**
 * Who gets the Sunday nudge right now: learners whose local time (profile.tz, else Los Angeles, as in
 * familyPairs) is Sunday 17:00-17:59, each with the one pair worth a note, the longest streak (an
 * ember's kept count included) not lit yet this week. Never to cooks, never about a memorial cook.
 * Caps, quiet hours & dedupe stay in notify().
 */
export function nudgeCandidates(
  { now, profiles, pairs }: { now: Date; profiles: TableProfile[]; pairs: PairStreak[] },
): Nudge[] {
  if (!usable(now)) return [];
  const family = new Map(profiles.filter((p) => !p.removed_at).map((p) => [p.id, p]));
  const best = new Map<string, Nudge>();
  for (const p of pairs) {
    const kid = family.get(p.kid_id);
    const cook = family.get(p.cook_id);
    if (!kid || kid.role !== "learner" || kid.memorial) continue;
    if (!cook || cook.role !== "cook" || cook.memorial) continue;
    if (p.lit_this_week || p.kept < 1) continue;
    if (!sundayEvening(now, zoneOf(kid.tz))) continue;
    const prev = best.get(kid.id);
    if (!prev || p.kept > prev.weeks) best.set(kid.id, { kid_id: kid.id, cook_id: cook.id, weeks: p.kept });
  }
  return [...best.values()];
}

export type NudgeRecipe = {
  id: string;
  sample?: boolean | null;
  steps?: { order: number; quote?: string | null }[] | null;
};

/**
 * A line in the cook's own words for the nudge (guardrail 1): a step quote, verbatim, of at most 90
 * characters, from her recipes marked `sample: false` only (sample quotes are synthetic, not hers), and
 * not used for this kid in the last 15 days (`usedQuoteKeys`, from notification_log.quote_key). `seed`
 * turns the rotation (the cron passes e.g. the week number; a non-finite seed counts as 0); null when
 * nothing is left.
 */
export function pickNudgeQuote({ cookRecipes, usedQuoteKeys, seed = 0 }: {
  cookRecipes: NudgeRecipe[];
  usedQuoteKeys: Iterable<string>;
  seed?: number;
}): { text: string; quoteKey: string } | null {
  const used = new Set(usedQuoteKeys);
  const pool: { text: string; quoteKey: string }[] = [];
  for (const r of cookRecipes) {
    if (r.sample !== false) continue;
    for (const s of [...(r.steps ?? [])].sort((a, b) => a.order - b.order)) {
      const text = typeof s.quote === "string" ? s.quote.trim() : "";
      const quoteKey = `${r.id}#step-${s.order}`;
      if (text && [...text].length <= MAX_QUOTE && !used.has(quoteKey)) pool.push({ text, quoteKey });
    }
  }
  if (!pool.length) return null;
  const i = (Number.isFinite(seed) ? Math.trunc(seed) : 0) % pool.length;
  return pool[i < 0 ? i + pool.length : i];
}

/** The nudge's push copy (2.5): her name, then her words, or the plain line when there's no quote. */
export function nudgePush(cookName: string, quote: { text: string } | null): { title: string; body: string } {
  return {
    title: cookName,
    body: quote
      ? `“${quote.text}” · Your week at the table is still open.`
      : `Your week at the table with ${cookName} is still open.`,
  };
}
