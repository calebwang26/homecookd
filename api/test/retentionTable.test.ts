// Carried over mechanically from supabase/tests/table_test.ts, which tests the same pure file: only the imports changed. Nothing here needs a database.
// Offline checks for the Sunday table's pure logic (supabase/functions/api/table.ts; handoff 3.2): who
// lights up each week, pair weeks, consecutive weeks, the leftovers week (one forgiven miss per calendar
// month), the ember (relight at old + 1 within 7 days, else a quiet restart at 0), milestones, week
// boundaries in the kid's time zone across the Nov 1 2026 DST change (the same for whoever looks, even
// for a kid with no tz), sample dishes (they count), week keys from the RPC, memorial profiles, the
// Sunday 17:00 nudge and its quote rotation, and an Invalid Date `now`. No database, no network, no clock.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/table_test.ts

import { Deno, assert, assertEquals, assertThrows } from "./denoAssert.js";
import {
  type Activity,
  computeTable,
  familyPairs,
  nudgeCandidates,
  nudgePush,
  type PairStreak,
  pairStreak,
  pickNudgeQuote,
  type Table,
  type TableProfile,
  weekStart,
} from "../src/modules/messages/table.js";

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const MOM = "mom";
const DAD = "dad";
const GRAN = "gran"; // memorial
const LEO = "leo"; // LA
const MAYA = "maya"; // New York

const PROFILES: TableProfile[] = [
  { id: MOM, role: "cook", tz: LA },
  { id: DAD, role: "cook", tz: LA },
  { id: GRAN, role: "cook", memorial: true },
  { id: LEO, role: "learner", tz: LA },
  { id: MAYA, role: "learner", tz: NY },
];

const DAY = 86_400_000;
const add = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Wednesday 20:00 UTC of the week starting `monday`: midday in LA and New York, whatever the DST. */
const wed = (monday: string) => `${add(monday, 2)}T20:00:00Z`;
/** Saturday 20:00 UTC of that week: a "now" inside it. */
const sat = (monday: string) => new Date(`${add(monday, 5)}T20:00:00Z`);

const msg = (from: string, to: string | null, at: string): Activity => ({ at, actor_id: from, kind: "message", thread_with: to });
const cooked = (kid: string, cook: string, at: string): Activity => ({ at, actor_id: kid, kind: "cooked", target_cook_id: cook });
const heard = (kid: string, cook: string, at: string, duration_s?: number): Activity => ({
  at, actor_id: kid, kind: "heard", target_cook_id: cook, duration_s,
});
const pairWeek = (kid: string, cook: string, monday: string): Activity[] => [msg(kid, cook, wed(monday)), msg(cook, kid, wed(monday))];
const pairWeeks = (kid: string, cook: string, mondays: string[]) => mondays.flatMap((m) => pairWeek(kid, cook, m));
/** `n` Mondays in a row ending with `last`. */
const run = (last: string, n: number) => Array.from({ length: n }, (_, i) => add(last, -7 * (n - 1 - i)));

const table = (now: Date, activity: Activity[], me: string | null = LEO, profiles = PROFILES): Table =>
  computeTable({ now, kidTz: LA, profiles, activity, me });
const pairOf = (t: Table, kid: string, cook: string) => t.pairs.find((p) => p.kid_id === kid && p.cook_id === cook);
const litOf = (t: Table, id: string) => t.people.find((p) => p.profile_id === id)?.lit;
const streak = (now: Date, activity: Activity[], kid = LEO, cook = DAD): PairStreak =>
  familyPairs({ now, profiles: PROFILES, activity }).find((p) => p.kid_id === kid && p.cook_id === cook)!;

const NOW = sat("2026-11-02"); // Saturday Nov 7, 12:00 in LA; this week = Nov 2 - Nov 8
const SUN_1730_LA = new Date("2026-11-09T01:30:00Z"); // Sunday Nov 8 17:30 PST (20:30 in New York)
const threeWeeks = pairWeeks(LEO, DAD, ["2026-10-12", "2026-10-19", "2026-10-26"]);

// --- lit, per person ------------------------------------------------------------------------

Deno.test("acceptance: kid cooks Dad's dish & Dad replies the same week -> weeks 1, both faces lit", () => {
  const t = table(NOW, [cooked(LEO, DAD, wed("2026-11-02")), msg(DAD, LEO, wed("2026-11-02"))]);
  assertEquals(t.week_start, "2026-11-02");
  assertEquals(pairOf(t, LEO, DAD), { kid_id: LEO, cook_id: DAD, weeks: 1, ember_until: null, lit_this_week: true });
  assertEquals(litOf(t, LEO), true);
  assertEquals(litOf(t, DAD), true);
  assertEquals(litOf(t, MOM), false);
  assertEquals(pairOf(t, LEO, MOM)?.weeks, 0);
});

Deno.test("kid lights by cooking a family cook's dish, hearing >= 3 s of a clip, or writing to a cook", () => {
  const at = wed("2026-11-02");
  assertEquals(litOf(table(NOW, [cooked(LEO, MOM, at)]), LEO), true);
  assertEquals(litOf(table(NOW, [heard(LEO, MOM, at, 3)]), LEO), true);
  assertEquals(litOf(table(NOW, [heard(LEO, MOM, at, 2.9)]), LEO), false, "under 3 s never counts");
  assertEquals(litOf(table(NOW, [heard(LEO, MOM, at)]), LEO), false, "a missing duration never counts (recap.ts agrees)");
  assertEquals(litOf(table(NOW, [{ ...heard(LEO, MOM, at), duration_s: null }]), LEO), false);
  assertEquals(litOf(table(NOW, [{ ...heard(LEO, MOM, at), duration_s: "4" }]), LEO), true, "numeric strings count");
  assertEquals(litOf(table(NOW, [msg(LEO, MOM, at)]), LEO), true);
  assertEquals(litOf(table(NOW, [msg(LEO, null, at)]), LEO), true, "the circle reaches every cook");
});

Deno.test("kid doesn't light from another kid, their own dish, sending recipes or last week", () => {
  const at = wed("2026-11-02");
  assertEquals(litOf(table(NOW, [msg(LEO, MAYA, at)]), LEO), false);
  assertEquals(litOf(table(NOW, [cooked(LEO, MAYA, at)]), LEO), false);
  assertEquals(litOf(table(NOW, [cooked(LEO, LEO, at)]), LEO), false);
  assertEquals(litOf(table(NOW, [{ at, actor_id: LEO, kind: "recipe_sent", target_kid_id: MAYA }]), LEO), false);
  assertEquals(litOf(table(NOW, [{ at, actor_id: LEO, kind: "published" }]), LEO), false);
  assertEquals(litOf(table(NOW, [cooked(LEO, MOM, wed("2026-10-26"))]), LEO), false);
  assertEquals(litOf(table(NOW, [cooked(LEO, MOM, wed("2026-11-09"))]), LEO), false, "the future isn't this week");
});

Deno.test("a sample dish under a family cook's name counts like any of theirs (3.2 has no sample rule)", () => {
  // The PR5 live check: every family dish in the test library is a sample, and POST /events cooked with
  // Dad's cook_id + Dad's reply must give weeks 1. Rows from the RPC may carry the library's flag; it's
  // ignored here (only the nudge's quotes skip samples).
  const at = wed("2026-11-02");
  const sampleCooked = { ...cooked(LEO, DAD, at), sample: true } as Activity;
  const sampleHeard = { ...heard(LEO, DAD, at, 60), sample: true } as Activity;
  assertEquals(litOf(table(NOW, [sampleCooked]), LEO), true);
  assertEquals(litOf(table(NOW, [sampleHeard]), LEO), true);
  const t = table(NOW, [sampleCooked, msg(DAD, LEO, at)]);
  assertEquals(pairOf(t, LEO, DAD), { kid_id: LEO, cook_id: DAD, weeks: 1, ember_until: null, lit_this_week: true });
  assertEquals([litOf(t, LEO), litOf(t, DAD)], [true, true]);
  // A month of samples with Dad replying each week builds a streak.
  const month = run("2026-11-02", 4).flatMap((m) => [{ ...sampleCooked, at: wed(m) }, msg(DAD, LEO, wed(m))]);
  assertEquals(pairOf(table(NOW, month), LEO, DAD)?.weeks, 4);
});

Deno.test("a cooked or heard record with no target_cook_id counts toward no cook (index.ts maps it first)", () => {
  const at = wed("2026-11-02");
  const unmapped: Activity = { at, actor_id: LEO, kind: "cooked", target_cook_id: null };
  assertEquals(litOf(table(NOW, [unmapped]), LEO), false);
  assertEquals(pairOf(table(NOW, [unmapped, msg(DAD, LEO, at)]), LEO, DAD)?.lit_this_week, false);
});

Deno.test("a circle message lights a kid only while the family has a living cook", () => {
  const onlyGran: TableProfile[] = [{ id: GRAN, role: "cook", memorial: true }, { id: LEO, role: "learner", tz: LA }];
  assertEquals(litOf(table(NOW, [msg(LEO, null, wed("2026-11-02"))], LEO, onlyGran), LEO), false);
});

Deno.test("cook lights by any message (circle, reaction, recipe) or a published recording", () => {
  const at = wed("2026-11-02");
  assertEquals(litOf(table(NOW, [msg(MOM, null, at)]), MOM), true);
  assertEquals(litOf(table(NOW, [msg(MOM, MAYA, at)]), MOM), true);
  assertEquals(litOf(table(NOW, [{ at, actor_id: MOM, kind: "published" }]), MOM), true);
  assertEquals(litOf(table(NOW, [{ at, actor_id: MOM, kind: "recipe_sent", target_kid_id: LEO }]), MOM), true);
  assertEquals(litOf(table(NOW, [cooked(MOM, DAD, at)]), MOM), false, "cooking isn't a cook's part");
  assertEquals(litOf(table(NOW, [heard(MOM, DAD, at, 30)]), MOM), false);
});

// --- pair weeks -----------------------------------------------------------------------------

Deno.test("pair week needs the kid toward that cook AND that cook toward the kid, the same week", () => {
  const w = "2026-11-02";
  const at = wed(w);
  const lit = (activity: Activity[]) => pairOf(table(NOW, activity), LEO, DAD)!.lit_this_week;
  assertEquals(lit([msg(LEO, DAD, at)]), false, "only the kid");
  assertEquals(lit([msg(DAD, LEO, at)]), false, "only the cook");
  assertEquals(lit([msg(LEO, DAD, at), msg(DAD, null, at)]), false, "the circle isn't their thread");
  assertEquals(lit([msg(LEO, DAD, at), msg(DAD, MAYA, at)]), false, "Dad wrote to someone else");
  assertEquals(lit([msg(LEO, MOM, at), msg(DAD, LEO, at)]), false, "Leo wrote to Mom, not Dad");
  assertEquals(lit([cooked(LEO, MOM, at), msg(DAD, LEO, at)]), false, "Mom's dish, not Dad's");
  assertEquals(lit([msg(LEO, DAD, wed("2026-10-26")), msg(DAD, LEO, at)]), false, "different weeks");
  assertEquals(lit([heard(LEO, DAD, at, 12), msg(DAD, LEO, at)]), true, "heard his clip + his reply");
  assertEquals(lit([heard(LEO, DAD, at, 2), msg(DAD, LEO, at)]), false, "a 2 s listen isn't hearing");
  assertEquals(lit([heard(LEO, DAD, at), msg(DAD, LEO, at)]), false, "nor one with no duration");
  assertEquals(lit([msg(LEO, DAD, at), { at, actor_id: DAD, kind: "recipe_sent", target_kid_id: LEO }]), true);
  assertEquals(lit([msg(LEO, DAD, at), { at, actor_id: DAD, kind: "published", target_kid_id: LEO }]), true);
  assertEquals(lit([msg(LEO, DAD, at), { at, actor_id: DAD, kind: "recipe_sent", target_kid_id: MAYA }]), false);
});

// --- consecutive weeks, leftovers, ember ----------------------------------------------------

Deno.test("weeks counts consecutive pair weeks up to the last closed week, plus this week once lit", () => {
  const closed = pairWeeks(LEO, DAD, ["2026-10-12", "2026-10-19", "2026-10-26"]);
  assertEquals(pairOf(table(NOW, closed), LEO, DAD), { kid_id: LEO, cook_id: DAD, weeks: 3, ember_until: null, lit_this_week: false });
  const withNow = [...closed, ...pairWeek(LEO, DAD, "2026-11-02")];
  assertEquals(pairOf(table(NOW, withNow), LEO, DAD)?.weeks, 4);
  assertEquals(pairOf(table(NOW, withNow), LEO, DAD)?.lit_this_week, true);
});

Deno.test("leftovers week: one missed week in a calendar month keeps the count", () => {
  const a = pairWeeks(LEO, DAD, ["2026-10-05", "2026-10-12", "2026-10-26"]); // Oct 19 missed
  assertEquals(pairOf(table(NOW, a), LEO, DAD)?.weeks, 3);
  assertEquals(pairOf(table(NOW, a), LEO, DAD)?.ember_until, null);
  assertEquals(pairOf(table(NOW, [...a, ...pairWeek(LEO, DAD, "2026-11-02")]), LEO, DAD)?.weeks, 4);
});

Deno.test("a second miss in the same month is not forgiven: ember, count hidden but kept", () => {
  // Oct 12 missed (forgiven), Oct 26 missed too (October's leftovers week is used) -> ember this week.
  const a = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19"]);
  const p = pairOf(table(NOW, a), LEO, DAD)!;
  assertEquals(p.weeks, null);
  assertEquals(p.ember_until, "2026-11-09T08:00:00.000Z"); // next Monday 00:00 PST
  assertEquals(p.lit_this_week, false);
  assertEquals(streak(NOW, a).kept, 3);
});

Deno.test("ember: a pair week inside the 7 days relights at old count + 1", () => {
  const a = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19", "2026-11-02"]);
  assertEquals(pairOf(table(NOW, a), LEO, DAD), {
    kid_id: LEO, cook_id: DAD, weeks: 4, ember_until: null, lit_this_week: true, milestone: 4,
  });
  // The last minute of the window still counts: Sunday Nov 8 23:30 PST = Nov 9 07:30 UTC.
  const late = [
    ...pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19"]),
    msg(LEO, DAD, "2026-11-09T07:00:00Z"),
    msg(DAD, LEO, "2026-11-09T07:30:00Z"),
  ];
  assertEquals(pairOf(table(new Date("2026-11-09T07:45:00Z"), late), LEO, DAD)?.weeks, 4);
  // Once that week is closed the relit count carries on as a normal streak.
  assertEquals(pairOf(table(sat("2026-11-09"), late), LEO, DAD)?.weeks, 4);
});

Deno.test("ember: after the 7 days it starts again at 0, quietly", () => {
  const a = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19"]); // ember in the week of Nov 2
  const after = sat("2026-11-09");
  assertEquals(pairOf(table(after, a), LEO, DAD), { kid_id: LEO, cook_id: DAD, weeks: 0, ember_until: null, lit_this_week: false });
  assertEquals(streak(after, a).kept, 0);
  assertEquals(pairOf(table(after, [...a, ...pairWeek(LEO, DAD, "2026-11-09")]), LEO, DAD)?.weeks, 1, "no old count back");
});

Deno.test("leftovers is per calendar month: misses in late Oct & early Nov are both forgiven", () => {
  // Weeks of Oct 26 (an October Monday) & Nov 2 (a November Monday): one leftovers week each. The literal
  // 3.2 rule; TODO(caleb) in pairStreak asks whether two misses in a row should ember instead.
  const a = pairWeeks(LEO, DAD, ["2026-10-12", "2026-10-19"]);
  const p = pairOf(table(sat("2026-11-09"), a), LEO, DAD)!;
  assertEquals(p.weeks, 2);
  assertEquals(p.ember_until, null);
});

Deno.test("a restart week & weeks at 0 don't use up the month's leftovers week", () => {
  // Oct 12 lit; Oct 19 forgiven; Oct 26 ember; Nov 2 restart at 0; Nov 9 at 0; Nov 16 lit; Nov 23 missed
  // -> November's leftovers week is still unused, so it's forgiven and the count stays 1.
  const a = pairWeeks(LEO, DAD, ["2026-10-12", "2026-11-16"]);
  const p = pairOf(table(sat("2026-11-30"), a), LEO, DAD)!;
  assertEquals(p.weeks, 1);
  assertEquals(p.ember_until, null);
});

Deno.test("pairStreak works straight from week keys (the unit index.ts can reuse)", () => {
  assertEquals(pairStreak(new Set(), "2026-11-02", LA), { weeks: 0, kept: 0, ember_until: null, lit_this_week: false });
  assertEquals(pairStreak(new Set(["2026-11-02"]), "2026-11-02", LA).weeks, 1);
  assertEquals(pairStreak(new Set(["2026-11-09"]), "2026-11-02", LA).weeks, 0, "future weeks are ignored");
});

Deno.test("pairStreak takes RPC week keys as they come: timestamps & mid-week days snap to Monday, junk is skipped", () => {
  // A date cast to text, a Wednesday (snaps to Oct 19), and keys that aren't real dates (never a throw).
  const keys = new Set(["2026-10-26T00:00:00", "2026-10-21", "not a week", "2026-13-45", "2026-02-30", ""]);
  assertEquals(pairStreak(keys, "2026-11-02", LA), { weeks: 2, kept: 2, ember_until: null, lit_this_week: false });
  // The current week may come as a timestamp or any day of it too.
  assertEquals(pairStreak(new Set(["2026-11-04"]), "2026-11-02T00:00:00+00:00", LA).weeks, 1);
  assertEquals(pairStreak(new Set(["2026-11-02"]), "2026-11-05", LA).lit_this_week, true);
  // A malformed current week is a caller bug: a clear error, not a RangeError from deep inside.
  assertThrows(() => pairStreak(new Set(), "this week", LA), Error, "pairStreak: current must be");
});

// --- milestones -----------------------------------------------------------------------------

Deno.test("milestones at 4, 12, 26 & 52 are reported the week they're reached", () => {
  for (const n of [4, 12, 26, 52]) {
    const a = pairWeeks(LEO, DAD, run("2026-11-02", n)); // this week is the n-th
    const p = pairOf(table(NOW, a), LEO, DAD)!;
    assertEquals([p.weeks, p.milestone], [n, n], `milestone ${n}`);
  }
  // Neither a milestone nor one week past one (6 = 4 two weeks ago, 14 = 12 two weeks ago, ...).
  for (const n of [1, 2, 3, 6, 11, 14, 25, 28, 51, 54]) {
    const p = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-11-02", n))), LEO, DAD)!;
    assertEquals([p.weeks, p.milestone], [n, undefined], `no milestone at ${n}`);
    assert(!("milestone" in p), "no milestone key in the JSON");
  }
});

Deno.test("a milestone reached last week still shows while this week is unlit (the other one may open the chat later)", () => {
  const p = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-10-26", 12))), LEO, DAD)!;
  assertEquals([p.weeks, p.lit_this_week, p.milestone], [12, false, 12]);
  // 4 lands in the week of Oct 26 & both act again this week: weeks moves on to 5, and the burst for 4
  // never sits beside the newer count.
  for (const n of [5, 13, 27, 53]) {
    const next = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-11-02", n))), LEO, DAD)!;
    assertEquals([next.weeks, next.lit_this_week, next.milestone], [n, true, undefined], `${n - 1} then ${n}`);
  }
  // Reached two weeks ago with a leftovers week since: it's old news.
  const old = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-10-19", 12))), LEO, DAD)!;
  assertEquals([old.weeks, old.milestone], [12, undefined]);
  // Reached two weeks ago & lit every week since: old news too.
  const later = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-11-02", 14))), LEO, DAD)!;
  assertEquals([later.weeks, later.milestone], [14, undefined]);
});

Deno.test("a milestone, when present, always equals weeks", () => {
  for (let n = 1; n <= 56; n++) {
    for (const last of ["2026-11-02", "2026-10-26", "2026-10-19"]) {
      const p = pairOf(table(NOW, pairWeeks(LEO, DAD, run(last, n))), LEO, DAD)!;
      if (p.milestone !== undefined) assertEquals(p.milestone, p.weeks, `${n} weeks to ${last}`);
    }
  }
});

Deno.test("relighting an ember onto a milestone reports it; an ember never does", () => {
  // 11 weeks in a row to Oct 12, Oct 19 forgiven, Oct 26 missed -> an ember this week (Nov 2).
  const base = pairWeeks(LEO, DAD, run("2026-10-12", 11));
  const ember = pairOf(table(NOW, base), LEO, DAD)!;
  assertEquals([ember.weeks, ember.milestone], [null, undefined]);
  const relit = pairOf(table(NOW, [...base, ...pairWeek(LEO, DAD, "2026-11-02")]), LEO, DAD)!;
  assertEquals([relit.weeks, relit.milestone], [12, 12]);
  // 12 reached in the week of Oct 12, then the leftovers week & a miss: the ember shows no milestone.
  const past = pairOf(table(NOW, pairWeeks(LEO, DAD, run("2026-10-12", 12))), LEO, DAD)!;
  assertEquals([past.weeks, past.milestone], [null, undefined]);
});

// --- week boundaries in the kid's time zone, across DST -------------------------------------

Deno.test("weekStart: Monday 00:00 in the kid's zone, on both sides of the Nov 1 2026 DST change", () => {
  assertEquals(weekStart(new Date("2026-10-26T06:59:00Z"), LA), "2026-10-19"); // Sun Oct 25 23:59 PDT
  assertEquals(weekStart(new Date("2026-10-26T07:00:00Z"), LA), "2026-10-26"); // Mon Oct 26 00:00 PDT
  assertEquals(weekStart(new Date("2026-11-02T07:59:00Z"), LA), "2026-10-26"); // Sun Nov 1 23:59 PST
  assertEquals(weekStart(new Date("2026-11-02T08:00:00Z"), LA), "2026-11-02"); // Mon Nov 2 00:00 PST
  assertEquals(weekStart(new Date("2026-11-02T05:00:00Z"), NY), "2026-11-02"); // Mon Nov 2 00:00 EST
  assertEquals(weekStart(new Date("2026-11-02T05:00:00Z"), "Not/AZone"), "2026-10-26", "a bad zone falls back to LA");
});

Deno.test("Sunday 23:30 PST and Monday 00:15 PST are different weeks for an LA kid, the same week in New York", () => {
  const sunday = "2026-11-02T07:30:00Z"; // Sun Nov 1 23:30 PST, Mon Nov 2 02:30 EST
  const monday = "2026-11-02T08:15:00Z"; // Mon Nov 2 00:15 PST, Mon Nov 2 03:15 EST
  const now = new Date("2026-11-03T20:00:00Z");
  const split = [msg(LEO, DAD, sunday), msg(DAD, LEO, monday), msg(MAYA, DAD, sunday), msg(DAD, MAYA, monday)];
  const t = table(now, split, DAD);
  assertEquals(pairOf(t, LEO, DAD)?.weeks, 0, "LA: Leo's part was last week");
  assertEquals(pairOf(t, MAYA, DAD)?.weeks, 1, "New York: both on Monday");
  assertEquals(litOf(t, LEO), false);
  assertEquals(litOf(t, MAYA), true);
  // Both sides before LA midnight: last week was a pair week, so the count shows 1 (not lit this week).
  const before = table(now, [msg(LEO, DAD, sunday), msg(DAD, LEO, "2026-11-02T07:45:00Z")]);
  assertEquals(pairOf(before, LEO, DAD), { kid_id: LEO, cook_id: DAD, weeks: 1, ember_until: null, lit_this_week: false });
});

Deno.test("ember_until is next Monday 00:00 in the kid's zone, right across DST and in a zone without it", () => {
  // Ember in the week of Oct 26 (which holds the change): ends Mon Nov 2 00:00 PST = 08:00 UTC.
  const a = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05"]); // Oct 12 forgiven, Oct 19 missed
  assertEquals(pairOf(table(sat("2026-10-26"), a), LEO, DAD)?.ember_until, "2026-11-02T08:00:00.000Z");
  // The week before the change: ends Mon Oct 26 00:00 PDT = 07:00 UTC.
  const b = pairWeeks(LEO, DAD, ["2026-09-21", "2026-09-28"]); // Oct 5 forgiven, Oct 12 missed
  assertEquals(pairOf(table(sat("2026-10-19"), b), LEO, DAD)?.ember_until, "2026-10-26T07:00:00.000Z");
  // Tokyo: next Monday 00:00 JST = Sunday 15:00 UTC.
  const tokyo: TableProfile[] = [{ id: DAD, role: "cook" }, { id: LEO, role: "learner", tz: "Asia/Tokyo" }];
  const p = computeTable({ now: sat("2026-10-26"), kidTz: LA, profiles: tokyo, activity: a, me: LEO }).pairs[0];
  assertEquals(p.ember_until, "2026-11-01T15:00:00.000Z");
});

Deno.test("a kid with no tz is on Los Angeles time whoever looks: Dad in New York & Leo see the same pair", () => {
  const noTz: TableProfile[] = [{ id: DAD, role: "cook", tz: NY }, { id: LEO, role: "learner" }];
  // Sun Nov 1 23:30 & 23:40 PST: still last week in LA, though already Monday in New York.
  const activity = [msg(LEO, DAD, "2026-11-02T07:30:00Z"), msg(DAD, LEO, "2026-11-02T07:40:00Z")];
  const now = new Date("2026-11-03T20:00:00Z");
  const asDad = computeTable({ now, kidTz: NY, profiles: noTz, activity, me: DAD });
  const asLeo = computeTable({ now, kidTz: LA, profiles: noTz, activity, me: LEO });
  assertEquals(asDad.pairs, [{ kid_id: LEO, cook_id: DAD, weeks: 1, ember_until: null, lit_this_week: false }]);
  assertEquals(asLeo.pairs, asDad.pairs);
  assertEquals([litOf(asDad, LEO), litOf(asLeo, LEO)], [false, false], "the kid's face is on his own week too");
  assertEquals(litOf(asDad, DAD), true, "a cook's face is on the viewer's week: Monday in New York");
  // The ember ends at the kid's next Monday 00:00 PST, not New York's midnight.
  const ember = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19"]);
  for (const kidTz of [NY, LA, "Asia/Tokyo"]) {
    const p = computeTable({ now: NOW, kidTz, profiles: noTz, activity: ember, me: DAD }).pairs[0];
    assertEquals(p.ember_until, "2026-11-09T08:00:00.000Z", kidTz);
  }
  // And the nudge goes out at 17:xx Los Angeles time, never New York's.
  const pairs = (now: Date) => familyPairs({ now, profiles: noTz, activity: threeWeeks });
  const nudge = (now: Date) => nudgeCandidates({ now, profiles: noTz, pairs: pairs(now) });
  assertEquals(nudge(SUN_1730_LA), [{ kid_id: LEO, cook_id: DAD, weeks: 3 }]);
  assertEquals(nudge(new Date("2026-11-08T22:30:00Z")), [], "Sunday 17:30 EST is 14:30 in LA");
});

// --- memorial, me, removed ------------------------------------------------------------------

Deno.test("memorial cook: no pair, no flame, but the kid's own part with her dish still lights the kid", () => {
  const at = wed("2026-11-02");
  const activity = [
    ...pairWeeks(LEO, GRAN, run("2026-11-02", 6)),
    { at, actor_id: GRAN, kind: "published" as const },
    heard(LEO, GRAN, at, 40),
  ];
  const t = table(NOW, activity);
  assertEquals(pairOf(t, LEO, GRAN), undefined);
  assertEquals(litOf(t, GRAN), false);
  assertEquals(litOf(t, LEO), true);
  assert(familyPairs({ now: NOW, profiles: PROFILES, activity }).every((p) => p.cook_id !== GRAN));
});

Deno.test("memorial learner: in no pair and never lit", () => {
  const profiles: TableProfile[] = [...PROFILES, { id: "ana", role: "learner", memorial: true }];
  const t = table(NOW, pairWeeks("ana", DAD, ["2026-11-02"]), DAD, profiles);
  assertEquals(pairOf(t, "ana", DAD), undefined);
  assertEquals(litOf(t, "ana"), false);
});

Deno.test("only pairs that include me; none without a me; no hidden count in the JSON", () => {
  const activity = pairWeeks(LEO, DAD, ["2026-10-26"]);
  const asLeo = table(NOW, activity, LEO);
  assertEquals(asLeo.pairs.map((p) => p.cook_id).sort(), [DAD, MOM]);
  const asMom = table(NOW, activity, MOM);
  assertEquals(asMom.pairs.map((p) => p.kid_id).sort(), [LEO, MAYA]);
  assert(asMom.pairs.every((p) => p.cook_id === MOM));
  const nobody = table(NOW, activity, null);
  assertEquals(nobody.pairs, []);
  assertEquals(nobody.people.length, 5);
  assert(asLeo.pairs.every((p) => !("kept" in p)));
});

Deno.test("removed people leave the table", () => {
  const profiles: TableProfile[] = [...PROFILES, { id: "sam", role: "learner", tz: LA, removed_at: "2026-10-01T00:00:00Z" }];
  const t = table(NOW, pairWeeks("sam", DAD, ["2026-11-02"]), DAD, profiles);
  assertEquals(litOf(t, "sam"), undefined);
  assertEquals(pairOf(t, "sam", DAD), undefined);
});

Deno.test("bad timestamps are skipped, not fatal", () => {
  const t = table(NOW, [msg(LEO, DAD, "not a date"), ...pairWeek(LEO, DAD, "2026-11-02")]);
  assertEquals(pairOf(t, LEO, DAD)?.weeks, 1);
});

Deno.test("an Invalid Date now never throws: an empty table, no pairs, no nudges", () => {
  const bad = new Date("not a time");
  const activity = [...threeWeeks, ...pairWeek(LEO, DAD, "2026-11-02")];
  assertEquals(table(bad, activity), { week_start: "", people: [], pairs: [] });
  assertEquals(familyPairs({ now: bad, profiles: PROFILES, activity }), []);
  const pairs = familyPairs({ now: SUN_1730_LA, profiles: PROFILES, activity: threeWeeks });
  assertEquals(nudgeCandidates({ now: bad, profiles: PROFILES, pairs }).length, 0);
  assertEquals(nudgeCandidates({ now: SUN_1730_LA, profiles: PROFILES, pairs }).length, 1, "the same pairs, a real now");
  assertThrows(() => weekStart(bad, LA), RangeError); // documented: callers check now first
});

// --- the Sunday nudge -----------------------------------------------------------------------

const nudges = (now: Date, activity: Activity[], profiles = PROFILES) =>
  nudgeCandidates({ now, profiles, pairs: familyPairs({ now, profiles, activity }) });

Deno.test("nudge: Sunday 17:00-17:59 kid local, a pair with weeks >= 1 not lit yet this week", () => {
  assertEquals(nudges(SUN_1730_LA, threeWeeks), [{ kid_id: LEO, cook_id: DAD, weeks: 3 }]);
  assertEquals(nudges(new Date("2026-11-09T00:59:00Z"), threeWeeks), [], "16:59");
  assertEquals(nudges(new Date("2026-11-09T02:00:00Z"), threeWeeks), [], "18:00");
  assertEquals(nudges(new Date("2026-11-08T01:30:00Z"), threeWeeks), [], "Saturday 17:30");
});

Deno.test("nudge: the hour is the kid's own (New York kid at 17:30 EST, not the LA kid)", () => {
  const both = [...threeWeeks, ...pairWeeks(MAYA, MOM, ["2026-10-19", "2026-10-26"])];
  assertEquals(nudges(SUN_1730_LA, both), [{ kid_id: LEO, cook_id: DAD, weeks: 3 }]);
  assertEquals(nudges(new Date("2026-11-08T22:30:00Z"), both), [{ kid_id: MAYA, cook_id: MOM, weeks: 2 }]);
});

Deno.test("nudge: not when lit this week, not at weeks 0, yes during an ember (kept count)", () => {
  assertEquals(nudges(SUN_1730_LA, [...threeWeeks, ...pairWeek(LEO, DAD, "2026-11-02")]), []);
  assertEquals(nudges(SUN_1730_LA, [cooked(LEO, DAD, wed("2026-11-02"))]), []);
  const ember = pairWeeks(LEO, DAD, ["2026-09-28", "2026-10-05", "2026-10-19"]);
  assertEquals(nudges(SUN_1730_LA, ember), [{ kid_id: LEO, cook_id: DAD, weeks: 3 }]);
});

Deno.test("nudge: one per kid, about the longest streak", () => {
  const activity = [...threeWeeks, ...pairWeeks(LEO, MOM, run("2026-10-26", 5))];
  assertEquals(nudges(SUN_1730_LA, activity), [{ kid_id: LEO, cook_id: MOM, weeks: 5 }]);
});

Deno.test("nudge: never to a cook, never about a memorial cook", () => {
  const base = { weeks: 4, kept: 4, ember_until: null, lit_this_week: false };
  const pairs: PairStreak[] = [
    { kid_id: MOM, cook_id: DAD, ...base }, // a cook as the "kid"
    { kid_id: LEO, cook_id: GRAN, ...base }, // memorial cook
  ];
  assertEquals(nudgeCandidates({ now: SUN_1730_LA, profiles: PROFILES, pairs }), []);
});

const RECIPES = [
  {
    id: "mom-dumplings",
    sample: false,
    steps: [
      { order: 3, quote: null },
      { order: 2, quote: "Pinch it like you mean it, “not too tight.”" },
      { order: 1, quote: "x".repeat(91) },
      { order: 4, quote: "   " },
      { order: 5, quote: `  ${"y".repeat(90)}  ` },
    ],
  },
  { id: "mom-sample-stew", sample: true, steps: [{ order: 1, quote: "Synthetic words." }] },
  { id: "mom-unknown", steps: [{ order: 1, quote: "No sample flag." }] },
];

Deno.test("quote: verbatim step quotes <= 90 chars from sample:false recipes only", () => {
  assertEquals(pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [] }), {
    text: "Pinch it like you mean it, “not too tight.”",
    quoteKey: "mom-dumplings#step-2",
  });
  assertEquals(pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [], seed: 1 }), {
    text: "y".repeat(90),
    quoteKey: "mom-dumplings#step-5",
  }, "exactly 90 characters is allowed; only the outer spaces are trimmed");
});

Deno.test("quote: never one used for this kid in the last 15 days; null when none is left", () => {
  const used = ["mom-dumplings#step-2"];
  assertEquals(pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: used })?.quoteKey, "mom-dumplings#step-5");
  assertEquals(pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [...used, "mom-dumplings#step-5"] }), null);
  assertEquals(pickNudgeQuote({ cookRecipes: [], usedQuoteKeys: [] }), null);
});

Deno.test("quote: the seed turns the rotation, wrapping both ways", () => {
  const keys = [0, 1, 2, -1].map((seed) => pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [], seed })?.quoteKey);
  assertEquals(keys, ["mom-dumplings#step-2", "mom-dumplings#step-5", "mom-dumplings#step-2", "mom-dumplings#step-5"]);
});

Deno.test("quote: a non-finite seed counts as 0, so the result is a quote or null, never undefined", () => {
  for (const seed of [NaN, Infinity, -Infinity]) {
    const q = pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [], seed });
    assertEquals(q?.quoteKey, "mom-dumplings#step-2", String(seed));
    assertEquals(pickNudgeQuote({ cookRecipes: [], usedQuoteKeys: [], seed }), null, String(seed));
  }
  assertEquals(pickNudgeQuote({ cookRecipes: RECIPES, usedQuoteKeys: [], seed: 1.9 })?.quoteKey, "mom-dumplings#step-5");
});

Deno.test("nudge copy: her name & her words, or the plain line; no guilt words", () => {
  const quoted = nudgePush("Mom", { text: "Pinch it like you mean it." });
  assertEquals(quoted, { title: "Mom", body: "“Pinch it like you mean it.” · Your week at the table is still open." });
  const plain = nudgePush("Mom", null);
  assertEquals(plain, { title: "Mom", body: "Your week at the table with Mom is still open." });
  for (const s of [quoted.body, plain.body]) assert(!/\b(lost|expired|broken|missed)\b/i.test(s), s);
});
