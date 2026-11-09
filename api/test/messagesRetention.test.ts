// The Sunday table and Month in the kitchen, on real Postgres: supabase/tests/tablePr_test.ts, recap_route_test.ts and the table and recap cases from api_test.ts. The pure
// rules behind them are retentionTable.test.ts and retentionRecap.test.ts. The history query replaces table_activity, so table_activity_sql_test.ts's cases run against it here.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import type { RecipeInfo } from "../src/modules/messages/recap.js";
import {
  activityRows,
  type ActivityRow,
  type FamilyProfile,
  FIRST_MONTH,
  getRecap,
  HISTORY_WEEKS,
  hourly,
  maybeLocalFirst,
  needsMoreHistory,
  nudgeFamily,
  previousMonth,
  QUOTE_ROTATION_DAYS,
  recapDue,
  recapFamily,
  recapPushFor,
  resolveMonth,
  signSlides,
  photoPaths,
  toActivity,
  viewerTz,
} from "../src/modules/messages/retention.js";
import { CHILI, circleOf, closeAll, DAL, drain, get, logOf, ok, pairOf, person, phone, post, pushes, RICE, refused, say, silent, skip, text, tokenFor, uploaded, type Who, type World, world } from "./messagesHelpers.js";

const LA = "America/Los_Angeles";
const IN = "Asia/Kolkata";

// --- toActivity, needsMoreHistory, viewerTz: pure

type NameProfile = Parameters<typeof toActivity>[1][number];
const named = (id: string, name: string, role: "cook" | "learner", removed_at: string | null = null): NameProfile => ({ id, name, role, removed_at });
const cooked = (at: string, actor: string, cook: string | null, library_id: string | null = null): ActivityRow => ({ at, actor_id: actor, kind: "cooked", target_cook_id: cook, library_id });
const msg = (at: string, actor: string, withWho: string | null): ActivityRow => ({ at, actor_id: actor, kind: "message", thread_with: withWho });
const [MOM, DAD, LEO, MAYA] = ["mom", "dad", "leo", "maya"];

test("toActivity finds an older event's cook by the dish's cook name, and leaves the rest alone", () => {
  const profiles = [named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner")];
  const index = new Map<string, RecipeInfo>([
    ["old-dal", { title: "Dal", cook_name: " mom", sample: false }],
    ["gordon-eggs", { title: "Eggs", cook_name: "Gordon", sample: true }],
  ]);
  const rows = [
    cooked("2026-10-13T10:00:00Z", LEO, null, "old-dal"),
    cooked("2026-10-13T10:00:00Z", LEO, null, "gordon-eggs"), // not a family cook
    cooked("2026-10-13T10:00:00Z", LEO, null, "gone"), // not in the library
    cooked("2026-10-13T10:00:00Z", LEO, DAD), // already known
    msg("2026-10-13T10:00:00Z", LEO, MOM),
  ];
  const out = toActivity(rows, profiles, index);
  assert.deepEqual(out.map((a) => a.target_cook_id), [MOM, null, null, DAD, null]);
  assert.deepEqual(out[4], { at: "2026-10-13T10:00:00Z", actor_id: LEO, kind: "message", target_cook_id: null, target_kid_id: null, thread_with: MOM, duration_s: null });
  assert.equal(toActivity(rows, profiles, null)[0].target_cook_id, null); // no library: counts toward nobody
});

test("toActivity matches current cooks only: never a removed same-named profile, never a kid", () => {
  const index = new Map<string, RecipeInfo>([
    ["old-dal", { title: "Dal", cook_name: "Mom", sample: false }],
    ["leo-toast", { title: "Toast", cook_name: "Leo", sample: false }],
  ]);
  const profiles = [named("old-mom", "Mom", "cook", "2026-06-01T00:00:00Z"), named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner")];
  const rows = [cooked("2026-10-13T10:00:00Z", MAYA, null, "old-dal"), cooked("2026-10-13T10:00:00Z", MAYA, null, "leo-toast")];
  assert.deepEqual(toActivity(rows, profiles, index).map((a) => a.target_cook_id), [MOM, null]);
  assert.equal(toActivity(rows, [profiles[0]], index)[0].target_cook_id, null);
});

test("toActivity credits a delivered recording to the dish's cook, even when a kid registered the send", () => {
  const index = new Map<string, RecipeInfo>([["mom-dal", { title: "Dal", cook_name: "Mom", sample: false }]]);
  const profiles = [named(MOM, "Mom", "cook"), named(LEO, "Leo", "learner"), named(DAD, "Dad", "cook")];
  const pub = (actor: string, dish: string | null): ActivityRow => ({ at: "2026-10-13T10:00:00Z", actor_id: actor, kind: "published", target_kid_id: MAYA, library_id: dish });
  const out = toActivity([pub(LEO, "mom-dal"), pub(DAD, "mom-dal"), pub(LEO, "gone"), pub(DAD, null)], profiles, index);
  assert.deepEqual(out.map((a) => a.actor_id), [MOM, MOM, LEO, DAD]); // unknown dish: the sender stays
  assert.equal(out[0].target_kid_id, MAYA);
  assert.equal(toActivity([pub(LEO, "mom-dal")], profiles, null)[0].actor_id, LEO); // no library: the sender
});

test("needsMoreHistory: only a streak near the window's length asks for more", () => {
  assert.equal(needsMoreHistory([], HISTORY_WEEKS), false);
  assert.equal(needsMoreHistory([{ kept: 0 }, { kept: 30 }], HISTORY_WEEKS), false);
  assert.equal(needsMoreHistory([{ kept: 36 }], HISTORY_WEEKS), false); // 36 + 16 < 53
  assert.equal(needsMoreHistory([{ kept: 37 }], HISTORY_WEEKS), true);
  assert.equal(needsMoreHistory([{ kept: 53 }], HISTORY_WEEKS), true);
});

test("viewerTz: a kid's own zone; a cook lines up with an only kid; else their own; nobody: x-tz", () => {
  const p = (id: string, role: "cook" | "learner", tz: string | null, extra: Partial<FamilyProfile> = {}): FamilyProfile => ({ id, family_id: "f", name: id, role, tz, memorial: false, removed_at: null, ...extra });
  const mom = p(MOM, "cook", "America/New_York");
  const leo = p(LEO, "learner", IN);
  const maya = p(MAYA, "learner", "Europe/London");
  assert.equal(viewerTz(leo, [mom, leo, maya], null), IN);
  assert.equal(viewerTz(mom, [mom, leo], null), IN); // one kid: the kid's week
  assert.equal(viewerTz(mom, [mom, leo, { ...maya, removed_at: "2026-01-01T00:00:00Z" }], null), IN);
  assert.equal(viewerTz(mom, [mom, leo, maya], null), "America/New_York"); // two kids: their own
  assert.equal(viewerTz(p(DAD, "cook", null), [mom, leo, maya], null), LA);
  assert.equal(viewerTz(p(LEO, "learner", "Mars/Base"), [], null), LA);
  assert.equal(viewerTz(null, [mom, leo], "Europe/London"), "Europe/London");
  assert.equal(viewerTz(null, [mom, leo], null), LA);
});

// --- the history query: table_activity's cases

const event = (w: World, who: Who, dish: string, kind: string, o: { cook?: Who; duration?: number; at?: string } = {}) =>
  db().query(`insert into recipe_events (family_id, person_id, library_id, kind, cook_id, duration_s, created_at) values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`, [
    w.family,
    who.id,
    dish,
    kind,
    o.cook?.id ?? null,
    o.duration ?? null,
    o.at ?? null,
  ]);
const backdate = (where: string, at: string, params: unknown[] = []) => db().query(`update messages set created_at = $${params.length + 1}::timestamptz where ${where}`, [...params, at]);

test("the history: cooked and heard of 3 s or more, messages except system notes with the other person, delivered recordings per recipient, repeats collapsed to 15-minute slots", { skip }, async () => {
  const w = await world();
  const since = new Date(Date.now() - 3600_000);
  await event(w, w.leo, DAL, "cooked", { cook: w.mom });
  await event(w, w.leo, DAL, "cooked"); // no cook: the library's name finds it later
  await event(w, w.leo, DAL, "heard", { cook: w.mom, duration: 2 }); // too short to leave the database
  await event(w, w.leo, DAL, "heard", { cook: w.mom, duration: 9 });
  await event(w, w.leo, DAL, "viewed");
  const pair = await pairOf(w, w.leo, w.mom);
  await text(w, w.leo, pair, "One");
  await text(w, w.leo, pair, "Two"); // the same slot: one row
  await text(w, w.mom, await circleOf(w), "To all");
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id, delivered_at) values ('u1', $1, $2, $3, $4, now())`, [w.family, w.dad.id, [w.leo.id, w.nia.id], CHILI]);
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids) values ('u2', $1, $2, $3)`, [w.family, w.dad.id, [w.leo.id]]);
  const { postSystemNote } = await import("../src/modules/messages/service.js");
  const { tx } = await import("../src/db.js");
  await tx((c) => postSystemNote(c, w.family, w.leo.id, "Leo joined."));

  const rows = await activityRows(db(), w.family, since);
  const short = rows.map((r) => [r.kind, r.actor_id, r.target_cook_id ?? null, r.thread_with ?? null, r.target_kid_id ?? null, r.library_id ?? null]);
  const expected = [
    ["cooked", w.leo.id, w.mom.id, null, null, null],
    ["cooked", w.leo.id, null, null, null, DAL],
    ["heard", w.leo.id, w.mom.id, null, null, null],
    ["message", w.leo.id, null, w.mom.id, null, null],
    ["message", w.mom.id, null, null, null, null],
    ["published", w.dad.id, null, null, w.leo.id, CHILI],
    ["published", w.dad.id, null, null, w.nia.id, CHILI],
  ];
  const key = (r: unknown[]) => JSON.stringify(r);
  assert.deepEqual(short.map(key).sort(), expected.map(key).sort());
  assert.equal(rows.find((r) => r.kind === "heard")!.duration_s, 9);
  // Another family's rows and anything before `since` never come back.
  assert.deepEqual(await activityRows(db(), w.otherFamily, since), []);
  assert.deepEqual(await activityRows(db(), w.family, new Date(Date.now() + 3600_000)), []);
});

// --- GET /table

test("PR 5: GET /table: Nia cooks Mom's dish & Mom answers -> 1 week, both lit; only Nia's own pairs", { skip }, async () => {
  const w = await world();
  await event(w, w.nia, DAL, "cooked", { cook: w.mom });
  await text(w, w.mom, await pairOf(w, w.mom, w.nia), "Good job");
  const r = ok(await get(w.app, w.nia, "/v1/table"));
  assert.deepEqual(r.people.filter((p: any) => p.lit).map((p: any) => p.profile_id).sort(), [w.mom.id, w.nia.id].sort());
  const pairs = r.pairs.map((p: any) => [p.kid_id, p.cook_id, p.weeks, p.lit_this_week]);
  assert.deepEqual(pairs.sort(), [[w.nia.id, w.mom.id, 1, true], [w.nia.id, w.dad.id, 0, false]].sort());
  // A cook sees only the pairs they're in.
  assert.deepEqual(ok(await get(w.app, w.mom, "/v1/table")).pairs.map((p: any) => p.kid_id).sort(), [w.leo.id, w.nia.id].sort());
  // Removed people aren't at the table.
  await db().query(`update people set removed_at = now() where id = $1`, [w.leo.id]);
  assert.equal(ok(await get(w.app, w.mom, "/v1/table")).people.some((p: any) => p.profile_id === w.leo.id), false);
});

test("PR 5: GET /table lists the dishes this family's own recordings became (the I miss home pool)", { skip }, async () => {
  const w = await world();
  await db().query(
    `insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id, delivered_at) values
       ('job-dal', $1, $2, '{}', $3, now() - interval '2 days'), ('job-wait', $1, $4, $5, null, null), ('job-other', $6, $7, '{}', $8, now())`,
    [w.family, w.nia.id, DAL, w.mom.id, [w.nia.id], w.otherFamily, w.stranger.id, RICE],
  );
  assert.deepEqual(ok(await get(w.app, w.nia, "/v1/table")).recordings, [DAL]);
});

test("PR 5: a memorial cook keeps a face, never lit, and has no pair", { skip }, async () => {
  const w = await world();
  const gran = await person(w.family, "Gran", "cook", { memorial: true });
  await event(w, w.nia, DAL, "heard", { cook: gran, duration: 12 });
  const r = ok(await get(w.app, w.nia, "/v1/table"));
  assert.equal(r.people.find((p: any) => p.profile_id === gran.id)?.lit, false);
  assert.equal(r.pairs.some((p: any) => p.cook_id === gran.id), false);
});

test("GET /table: this request's x-tz frames the caller's week before it's stored", { skip }, async () => {
  const w = await world();
  const a = ok(await get(w.app, w.leo, "/v1/table", { headers: { "x-tz": "Pacific/Kiritimati" } }));
  const b = ok(await get(w.app, w.leo, "/v1/table", { headers: { "x-tz": "Pacific/Pago_Pago" } }));
  assert.equal(typeof a.week_start, "string");
  // 25 hours apart: on most days the same week, so only the shape is checked, and junk is ignored.
  assert.equal(typeof b.week_start, "string");
  assert.equal(ok(await get(w.app, w.leo, "/v1/table", { headers: { "x-tz": "+05:30" } })).people.length, 4);
});

test("GET /table: an older event without a cook is matched through the library; a recording Leo filmed & sent lights Mom", { skip }, async () => {
  const w = await world();
  await event(w, w.nia, DAL, "cooked"); // no cook_id
  await text(w, w.mom, await pairOf(w, w.mom, w.nia), "Good");
  const r = ok(await get(w.app, w.nia, "/v1/table"));
  assert.equal(r.pairs.find((p: any) => p.cook_id === w.mom.id).lit_this_week, true);

  const other = await world();
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id, delivered_at) values ('u', $1, $2, $3, $4, now())`, [other.family, other.leo.id, [other.nia.id], DAL]);
  const faces = ok(await get(other.app, other.nia, "/v1/table")).people;
  assert.deepEqual(faces.filter((p: any) => p.lit).map((p: any) => p.profile_id), [other.mom.id]);
});

test("GET /table: a streak longer than the first window loads further back and counts in full", { skip }, async () => {
  const w = await world();
  // 60 weeks in a row, each with both sides, up to last week.
  for (let i = 1; i <= 60; i += 1) {
    const at = new Date(Date.now() - i * 7 * 86_400_000).toISOString();
    await event(w, w.nia, DAL, "cooked", { cook: w.mom, at });
    await db().query(`insert into recipe_events (family_id, person_id, library_id, kind, cook_id, created_at) values ($1, $2, $3, 'cooked', $4, $5)`, [w.family, w.nia.id, DAL, w.mom.id, at]);
  }
  const pair = await pairOf(w, w.mom, w.nia);
  await db().query(
    `insert into messages (family_id, thread_id, sender_id, kind, body, created_at)
     select $1, $2, $3, 'text', 'hi', now() - make_interval(days => g * 7) from generate_series(1, 60) g`,
    [w.family, pair, w.mom.id],
  );
  const r = ok(await get(w.app, w.nia, "/v1/table"));
  const streak = r.pairs.find((p: any) => p.cook_id === w.mom.id);
  assert.ok(streak.weeks >= 58, `weeks: ${streak.weeks}`);
});

// --- the Sunday nudge

// Sunday Oct 18, 2026, 17:10 in LA: Leo's nudge hour. Leo & Mom met the two weeks before, not this one.
const SUN = new Date("2026-10-18T17:10:00-07:00");

async function twoWeeks(w: World, kid: Who, cook: Who) {
  const pair = await pairOf(w, kid, cook);
  await event(w, kid, DAL, "cooked", { cook, at: "2026-10-01T18:00:00-07:00" });
  for (const [who, at] of [[cook, "2026-10-02T09:00:00-07:00"], [kid, "2026-10-06T18:00:00-07:00"], [cook, "2026-10-07T09:00:00-07:00"]] as const) {
    const m = await text(w, who, pair, "hi");
    await backdate("id = $1", at, [m.id]);
  }
  await db().query(`delete from outbox`);
}

const deliveredDal = (w: World) =>
  db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id, delivered_at) values ('job-dal', $1, $2, '{}', $3, '2026-09-01T10:00:00Z')`, [w.family, w.mom.id, DAL]);

const momsDal = (w: World) =>
  w.lib.recipes.set(DAL, {
    title: "Mom's Dal",
    cook_name: "Mom",
    sample: false,
    steps: [
      { order: 1, quote: null },
      { order: 2, quote: "A pinch, then taste." },
      { order: 3, quote: "x".repeat(91) },
    ],
  });
const lastLog = async (who: Who) => (await logOf(who.id)).at(-1);

test("nudge: one push to the kid, in the cook's own words from a real recording", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.leo, w.mom);
  await deliveredDal(w);
  momsDal(w);
  await phone(w, w.leo, "leo");
  assert.equal(await nudgeFamily(w.family, SUN), 1);
  const log = await lastLog(w.leo);
  assert.deepEqual(
    [log.kind, log.title, log.body, log.url, log.app_initiated, log.dedupe_key, log.quote_key],
    ["table_nudge", "Mom", "“A pinch, then taste.” · Your week at the table is still open.", `/recipe/${DAL}`, true, `table_nudge:${w.leo.id}:2026-10-12`, `${DAL}#step-2`],
  );
  // A re-run is a dedupe no-op.
  assert.equal(await nudgeFamily(w.family, SUN), 0);
  assert.equal((await logOf(w.leo.id)).length, 1);
  await drain();
  assert.equal(w.expo.sent.flat().length, 1);
});

test("nudge: a quote used in the last 15 days isn't repeated; with none left, the plain line", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.leo, w.mom);
  await deliveredDal(w);
  momsDal(w);
  await phone(w, w.leo, "leo");
  assert.equal(QUOTE_ROTATION_DAYS, 15);
  await db().query(`insert into push_log (person_id, kind, app_initiated, quote_key, status, created_at) values ($1, 'table_nudge', true, $2, 'sent', '2026-10-11T17:05:00-07:00')`, [w.leo.id, `${DAL}#step-2`]);
  await nudgeFamily(w.family, SUN);
  let log = await lastLog(w.leo);
  assert.deepEqual([log.body, log.quote_key, log.url], ["Your week at the table with Mom is still open.", null, `/recipe/${DAL}`]);

  // Older than 15 days, or a skipped push (never seen), and the quote is back.
  await db().query(`delete from push_log where dedupe_key is not null`);
  await db().query(`update push_log set created_at = '2026-10-02T17:05:00-07:00'`);
  await db().query(`insert into push_log (person_id, kind, app_initiated, quote_key, status, skipped_reason, created_at) values ($1, 'table_nudge', true, $2, 'skipped', 'quiet', '2026-10-17T22:00:00-07:00')`, [w.leo.id, `${DAL}#step-2`]);
  await nudgeFamily(w.family, SUN);
  log = (await logOf(w.leo.id)).find((r) => r.dedupe_key);
  assert.equal(log.quote_key, `${DAL}#step-2`);
});

test("nudge: a same-named cook's real recording from another family is never quoted or opened", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.leo, w.mom);
  momsDal(w);
  w.lib.index.set("mom-sample", { title: "Sample Soup", cook_name: "Mom", sample: true });
  await phone(w, w.leo, "leo");
  // mom-dal was recorded & delivered by another family whose cook is also called "Mom".
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id, delivered_at) values ('job-dal', $1, $2, '{}', $3, '2026-09-01T10:00:00Z')`, [w.otherFamily, w.stranger.id, DAL]);
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, library_id) values ('job-new', $1, $2, $3, $4)`, [w.family, w.mom.id, [w.leo.id], DAL]); // never went out here
  assert.equal(await nudgeFamily(w.family, SUN), 1);
  const log = await lastLog(w.leo);
  assert.deepEqual([log.title, log.body, log.quote_key, log.url], ["Mom", "Your week at the table with Mom is still open.", null, "/recipe/mom-sample"]);
});

test("nudge: only sample dishes or no library -> the plain line, opening a dish or the kid's Home", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.leo, w.mom);
  await phone(w, w.leo, "leo");
  w.lib.down = true;
  await nudgeFamily(w.family, SUN);
  const log = await lastLog(w.leo);
  assert.deepEqual([log.body, log.url], ["Your week at the table with Mom is still open.", "/kid/home"]);
});

test("nudge: never when lit, never to cooks or kids not due, never about a memorial cook", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.nia, w.mom);
  await phone(w, w.nia, "nia");
  await phone(w, w.mom, "mom");
  // This week Nia & Mom already met: nothing to say.
  const pair = await pairOf(w, w.nia, w.mom);
  const a = await text(w, w.nia, pair, "hi");
  const b = await text(w, w.mom, pair, "hi");
  await backdate("id = $1", "2026-10-13T18:00:00-07:00", [a.id]);
  await backdate("id = $1", "2026-10-14T09:00:00-07:00", [b.id]);
  await db().query(`delete from outbox`);
  assert.equal(await nudgeFamily(w.family, SUN), 0);

  // A memorial cook is in no pair.
  const other = await world();
  const gran = await person(other.family, "Gran", "cook", { memorial: true });
  await twoWeeks(other, other.nia, gran);
  await phone(other, other.nia, "nia");
  assert.equal(await nudgeFamily(other.family, SUN), 0);

  // Not Sunday evening in the kid's zone: nothing.
  const third = await world();
  await twoWeeks(third, third.leo, third.mom);
  await phone(third, third.leo, "leo");
  assert.equal(await nudgeFamily(third.family, new Date("2026-10-18T12:00:00-07:00")), 0);
  // A kid with no phone isn't due.
  const fourth = await world();
  await twoWeeks(fourth, fourth.leo, fourth.mom);
  assert.equal(await nudgeFamily(fourth.family, SUN), 0);
});

test("the hourly job queues one message per family with someone due; a failed family is retried alone", { skip }, async () => {
  const w = await world();
  await twoWeeks(w, w.leo, w.mom);
  await phone(w, w.leo, "leo");
  await twoWeeksStranger(w);
  await phone(w, w.strangerKid, "serene");
  await hourly(SUN, { log: silent });
  const queued = (await db().query(`select payload from outbox where sent_at is null order by id`)).rows.map((r) => r.payload);
  assert.deepEqual(queued.map((p) => p.task), ["messages.nudge_family", "messages.nudge_family"]);
  assert.deepEqual(queued.map((p) => p.familyId).sort(), [w.family, w.otherFamily].sort());
  assert.equal(queued[0].nowMs, SUN.getTime());
  // A family failing doesn't stop the other: each has its own message, and the queue retries it.
  await drain();
  assert.deepEqual(pushes(w.expo).map((p) => p[0]).sort(), [tokenFor("leo"), tokenFor("serene")].sort());
  // A replayed hour: nothing more.
  await hourly(SUN, { log: silent });
  await drain();
  assert.equal(w.expo.sent.flat().length, 2);
  // Nobody due: nothing queued.
  await hourly(new Date("2026-10-14T12:00:00Z"), { log: silent });
  assert.equal((await db().query(`select count(*)::int as n from outbox where sent_at is null and payload->>'task' like 'messages.%'`)).rows[0].n, 0);
});

async function twoWeeksStranger(w: World) {
  const pair = await pairOf(w, w.strangerKid, w.stranger);
  await db().query(`insert into recipe_events (family_id, person_id, library_id, kind, cook_id, created_at) values ($1, $2, $3, 'cooked', $4, '2026-10-01T18:00:00-07:00')`, [w.otherFamily, w.strangerKid.id, DAL, w.stranger.id]);
  for (const [who, at] of [[w.stranger, "2026-10-02T09:00:00-07:00"], [w.strangerKid, "2026-10-06T18:00:00-07:00"], [w.stranger, "2026-10-07T09:00:00-07:00"]] as const) {
    const m = await text(w, who, pair, "hi");
    await backdate("id = $1", at, [m.id]);
  }
  await db().query(`delete from outbox`);
}

// --- months

test("previousMonth is the month before on the person's own clock, across the year end", () => {
  assert.equal(previousMonth(new Date("2026-11-01T10:10:00-08:00"), LA), "2026-10");
  // Nov 1 02:00 UTC is still Oct 31 in LA but already Nov 1 in Kolkata.
  assert.equal(previousMonth(new Date("2026-11-01T02:00:00Z"), LA), "2026-09");
  assert.equal(previousMonth(new Date("2026-11-01T02:00:00Z"), IN), "2026-10");
  assert.equal(previousMonth(new Date("2027-01-01T18:00:00Z"), LA), "2026-12");
  assert.equal(previousMonth(new Date("2026-11-01T18:00:00Z"), "Not/AZone"), "2026-10"); // the default zone
});

test("a month before the first edition or after this one is empty", () => {
  assert.equal(FIRST_MONTH, "2026-11");
  const now = new Date("2026-11-03T18:00:00Z");
  assert.deepEqual(resolveMonth(null, now, LA), { month: "2026-10", live: false });
  assert.deepEqual(resolveMonth("2026-11", now, LA), { month: "2026-11", live: true }); // so far this month
  assert.deepEqual(resolveMonth("2026-12", now, LA), { month: "2026-12", live: false });
  assert.deepEqual(resolveMonth(null, new Date("2026-12-01T18:00:00Z"), LA), { month: "2026-11", live: true });
  assert.deepEqual(resolveMonth(null, now, LA, "2026-10"), { month: "2026-10", live: true });
  assert.deepEqual(resolveMonth("2026-09", now, LA, "2026-10"), { month: "2026-09", live: false });
});

test("maybeLocalFirst: true only while it's the 1st somewhere between UTC-12 and UTC+14", () => {
  assert.equal(maybeLocalFirst(new Date("2026-10-31T09:59:00Z")), false); // Kiritimati: Oct 31 23:59
  assert.equal(maybeLocalFirst(new Date("2026-10-31T10:00:00Z")), true); // Kiritimati: Nov 1 00:00
  assert.equal(maybeLocalFirst(new Date("2026-11-01T12:00:00Z")), true);
  assert.equal(maybeLocalFirst(new Date("2026-11-02T11:59:00Z")), true); // UTC-12: Nov 1 23:59
  assert.equal(maybeLocalFirst(new Date("2026-11-02T12:00:00Z")), false);
  assert.equal(maybeLocalFirst(new Date("2026-11-15T12:00:00Z")), false);
});

test("recapDue: the local 1st from 10:00 until quiet hours, any offset; never memorial or removed", () => {
  const who = (tz: string, extra: Partial<FamilyProfile> = {}) => ({ tz, memorial: false, removed_at: null, ...extra });
  const due = (iso: string, p: ReturnType<typeof who>) => recapDue([p], new Date(iso)).length === 1;
  assert.ok(due("2026-11-01T10:00:00+05:30", who(IN)));
  assert.ok(!due("2026-11-01T09:59:00+05:30", who(IN)));
  assert.ok(due("2026-11-01T20:59:00+05:30", who(IN)));
  assert.ok(!due("2026-11-01T21:00:00+05:30", who(IN))); // quiet hours
  assert.ok(due("2026-11-01T10:00:00+14:00", who("Pacific/Kiritimati")));
  assert.ok(due("2026-11-01T10:30:00-11:00", who("Pacific/Pago_Pago")));
  assert.ok(!due("2026-11-02T10:30:00-08:00", who(LA)));
  assert.ok(!due("2026-11-01T10:30:00-08:00", who(LA, { memorial: true })));
  assert.ok(!due("2026-11-01T10:30:00-08:00", who(LA, { removed_at: "2026-10-01T00:00:00Z" })));
  assert.ok(due("2026-11-01T10:30:00-08:00", who("")), "no zone yet: the default");
});

const photo = (n: number) => ({ message_id: `m${n}`, photo_path: `p${n}.jpg`, recipe_id: CHILI, at: `2026-11-0${n}T10:00:00Z` });
const thenNow = {
  month: "2026-11",
  role: "learner" as const,
  slides: [
    { type: "cover" as const, title: "Your November in the kitchen" },
    { type: "then_now" as const, title: "Then & now", photos: [photo(1), photo(2)] as [ReturnType<typeof photo>, ReturnType<typeof photo>] },
    { type: "close" as const, title: "See you at the table in December." },
  ],
};

test("signSlides: a month whose only slide was Then & now is empty without its photos", () => {
  assert.deepEqual(signSlides(thenNow, new Map([["p1.jpg", "u1"]])), { empty: true });
  assert.deepEqual(signSlides({ empty: true }, new Map()), { empty: true });
  const full = signSlides(thenNow, new Map([["p1.jpg", "u1"], ["p2.jpg", "u2"]])) as { slides: unknown[] };
  assert.deepEqual(full.slides[1], {
    type: "then_now",
    title: "Then & now",
    photos: [
      { message_id: "m1", photo_url: "u1", recipe_id: CHILI, at: photo(1).at },
      { message_id: "m2", photo_url: "u2", recipe_id: CHILI, at: photo(2).at },
    ],
  });
  assert.deepEqual(photoPaths(thenNow), ["p1.jpg", "p2.jpg"]);
});

test("recapPushFor: a real line from the slides, and nothing for an empty month", () => {
  assert.deepEqual(recapPushFor(thenNow), { title: "Your November in the kitchen", body: "Your first postcard beside your latest." });
  assert.equal(recapPushFor({ empty: true }), null);
});

// --- GET /recap

const signedAs = (who: Who, familyId: string) => ({ sessionId: "s", personId: who.id, familyId, role: "cook" as const });
const DEC1 = new Date("2026-12-01T18:15:00Z"); // 10:15 on the default clock: last month is November

async function backdateEverything(at: string) {
  await db().query(`update messages set created_at = $1`, [at]);
  await db().query(`update recipe_events set created_at = $1`, [at]);
  await db().query(`update favorites set created_at = $1`, [at]);
  await db().query(`update threads set last_message_at = $1 where last_message_at is not null`, [at]);
}

test("PR 6: GET /recap is registered: a well-formed month; a month that can't hold anything is empty", { skip }, async () => {
  const w = await world();
  refused(await get(w.app, w.mom, "/v1/recap?month=2026-13"), 400, "invalid", "month");
  assert.deepEqual(ok(await get(w.app, w.mom, "/v1/recap?month=2099-01")), { empty: true });
  // October 2026 comes before the first edition: empty, whatever happened in it.
  assert.deepEqual(ok(await get(w.app, w.mom, "/v1/recap?month=2026-10")), { empty: true });
});

test("PR 6: the first edition: on Dec 1, Dad's November names Leo, signs the postcard & counts his answer", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.leo, w.dad);
  await event(w, w.leo, RICE, "cooked", { at: "2026-11-20T19:00:00Z" });
  ok(await say(w, w.leo, pair, { kind: "cooked", libraryId: RICE, photoKey: await uploaded(w, w.leo, "photo") }));
  const q = ok(await say(w, w.leo, pair, { kind: "question", body: "Day-old rice?", libraryId: RICE }));
  ok(await say(w, w.dad, pair, { kind: "text", body: "Always.", replyTo: q.id }));
  await backdateEverything("2026-11-20T19:00:00Z");

  const r = (await getRecap(signedAs(w.dad, w.family), {}, DEC1)) as any;
  assert.deepEqual([r.role, r.month], ["cook", "2026-11"]);
  assert.equal(r.slides[0].title, "Your November in the kitchen");
  const slide = (type: string) => r.slides.find((s: any) => s.type === type);
  assert.deepEqual(slide("dishes_cooked").faces, [{ profile_id: w.leo.id }]);
  // The postcard comes back as a read link, never its key.
  const photos = slide("postcards").photos;
  assert.equal(photos.length, 1);
  assert.match(photos[0].photo_url, /fake-s3/);
  assert.equal("photo_path" in photos[0], false);
  // The whole family's answers: Dad's reply answers Leo's question.
  assert.deepEqual([slide("answered").value, slide("answered").title], [1, "Questions you answered: 1"]);
  assert.deepEqual([r.slides[0].type, r.slides.at(-1).type], ["cover", "close"]);
});

test("GET /recap: a kid's November, numbers from that month only; a memorial or removed person, or an empty month, is empty", { skip }, async () => {
  const w = await world();
  await event(w, w.leo, CHILI, "cooked", { at: "2026-11-05T19:00:00Z" });
  await event(w, w.leo, CHILI, "cooked", { at: "2026-11-10T19:00:00Z" });
  await event(w, w.leo, RICE, "heard", { duration: 90, at: "2026-11-11T19:00:00Z" });
  await event(w, w.leo, CHILI, "cooked", { at: "2026-10-29T19:00:00Z" }); // October
  await event(w, w.nia, CHILI, "cooked", { at: "2026-11-05T19:00:00Z" }); // someone else's
  await db().query(`insert into favorites (person_id, library_id, created_at) values ($1, $2, '2026-11-12T19:00:00Z')`, [w.leo.id, DAL]);
  const r = (await getRecap(signedAs(w.leo, w.family), { month: "2026-11" }, DEC1)) as any;
  assert.deepEqual(r.slides.map((s: any) => s.title), [
    "Your November in the kitchen",
    "You cooked 2 family dishes",
    "Most made: Dad's Sunday Chili, twice",
    "1 minute of family voices",
    "Hearts you left: 1",
    "See you at the table in December.",
  ]);
  assert.deepEqual(await getRecap(signedAs(w.stranger, w.otherFamily), { month: "2026-11" }, DEC1), { empty: true });
  await db().query(`update people set memorial = true where id = $1`, [w.leo.id]);
  assert.deepEqual(await getRecap(signedAs(w.leo, w.family), { month: "2026-11" }, DEC1), { empty: true });
});

test("GET /recap with the library unreachable is a 503, never a smaller month", { skip }, async () => {
  const w = await world();
  w.lib.down = true;
  await assert.rejects(getRecap(signedAs(w.leo, w.family), { month: "2026-11" }, DEC1), (e: Error & { statusCode?: number; code?: string }) => e.statusCode === 503 && e.code === "provider_down");
});

test("GET /recap with a library that lists nothing (Caleb, Nov 9: no samples) answers the month the database has, no 503", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  w.lib.index = new Map();
  const r = (await getRecap(signedAs(w.leo, w.family), { month: "2026-11" }, DEC1)) as any;
  assert.equal(r.slides.find((s: any) => s.type === "cooked").value, 2); // both rows carry cook_id: no library needed
});

test("GET /recap: past Supabase's 1000-row cap, 1300 clips all count", { skip }, async () => {
  const w = await world();
  await db().query(
    `insert into recipe_events (family_id, person_id, library_id, kind, duration_s, created_at)
     select $1, $2, $3, 'heard', 60, timestamptz '2026-11-05T19:00:00Z' + make_interval(secs => g) from generate_series(1, 1300) g`,
    [w.family, w.leo.id, RICE],
  );
  const r = (await getRecap(signedAs(w.leo, w.family), { month: "2026-11" }, DEC1)) as any;
  assert.equal(r.slides.find((s: any) => s.type === "voices").value, 1300);
});

test("GET /recap: a cook's hearts are only on her dishes, and a photo that can't be signed is left out", { skip }, async () => {
  const w = await world();
  await db().query(`insert into favorites (person_id, library_id, created_at) values ($1, $2, '2026-11-12T19:00:00Z'), ($1, $3, '2026-11-12T19:00:00Z')`, [w.leo.id, CHILI, DAL]);
  const dad = (await getRecap(signedAs(w.dad, w.family), { month: "2026-11" }, DEC1)) as any;
  assert.equal(dad.slides.find((s: any) => s.type === "most_loved").recipe_id, CHILI);
  const pair = await pairOf(w, w.leo, w.dad);
  ok(await say(w, w.leo, pair, { kind: "cooked", libraryId: RICE, photoKey: await uploaded(w, w.leo, "photo") }));
  await backdateEverything("2026-11-20T19:00:00Z");
  w.store.failGets = true;
  const again = (await getRecap(signedAs(w.dad, w.family), { month: "2026-11" }, DEC1)) as any;
  assert.deepEqual(again.slides.find((s: any) => s.type === "postcards").photos, []);
});

// --- the recap push

const NOV1 = new Date("2026-12-01T10:10:00-08:00");

async function quietNovember(w: World) {
  await event(w, w.leo, CHILI, "cooked", { cook: w.dad, at: "2026-11-03T19:00:00Z" });
  await event(w, w.leo, CHILI, "cooked", { cook: w.dad, at: "2026-11-17T19:00:00Z" });
  for (const who of [w.leo, w.nia, w.mom, w.dad]) await phone(w, who, who.name.toLowerCase());
}

test("cron: on the 1st at 10:xx local, one recap push per non-empty month, in the slides' own words", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  assert.equal(await recapFamily(w.family, NOV1), 2);
  await drain();
  assert.deepEqual(pushes(w.expo).sort(), [
    [tokenFor("dad"), "Your November in the kitchen", "Your dishes were cooked twice.", "/recap?month=2026-11"],
    [tokenFor("leo"), "Your November in the kitchen", "2 dishes.", "/recap?month=2026-11"],
  ]);
  // Logged as app-initiated with the month's key. Nia and Mom's months are empty: not even a log row.
  assert.deepEqual((await logOf(w.leo.id)).map((r) => [r.kind, r.app_initiated, r.dedupe_key]), [["recap", true, "recap:2026-11"]]);
  assert.equal((await logOf(w.nia.id)).length, 0);
  // The next hour, and a replayed run: nothing more.
  assert.equal(await recapFamily(w.family, new Date("2026-12-01T11:10:00-08:00")), 0);
  assert.equal(await recapFamily(w.family, NOV1), 0);
});

test("cron with the real FIRST_MONTH: nothing on Nov 1 (October isn't an edition)", { skip }, async () => {
  const w = await world();
  await event(w, w.leo, CHILI, "cooked", { cook: w.dad, at: "2026-10-03T19:00:00Z" });
  await phone(w, w.leo, "leo");
  assert.equal(await recapFamily(w.family, new Date("2026-11-01T10:10:00-08:00")), 0);
  assert.equal((await logOf(w.leo.id)).length, 0);
});

test("cron: tokens on signed-out phones don't count, so nothing is built or logged for them", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  const { rows } = await db().query(`insert into devices (family_id, key_hash, via, revoked_at) values ($1, repeat('b', 64), 'apple', now()) returning id`, [w.family]);
  await db().query(`update push_tokens set device_id = $1`, [rows[0].id]);
  await hourly(NOV1, { log: silent });
  assert.equal((await db().query(`select count(*)::int as n from outbox where sent_at is null and payload->>'task' = 'messages.recap_family'`)).rows[0].n, 0);
  assert.equal(await recapFamily(w.family, NOV1), 0);
  assert.equal((await logOf(w.leo.id)).length, 0);
});

test("cron: nothing before 10:00, from quiet hours on, or on any other day", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  for (const now of ["2026-12-01T09:50:00-08:00", "2026-12-01T21:10:00-08:00", "2026-12-02T10:10:00-08:00"]) {
    assert.equal(await recapFamily(w.family, new Date(now)), 0, now);
  }
});

test("cron: with the library unreachable nothing is sent or logged, the task fails so the queue tries again, and a later hour still sends", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  w.lib.down = true;
  await assert.rejects(recapFamily(w.family, NOV1));
  assert.equal((await logOf(w.leo.id)).length, 0);
  w.lib.down = false;
  assert.equal(await recapFamily(w.family, new Date("2026-12-01T11:10:00-08:00")), 2);
});

test("cron: a library that lists nothing still sends the month the database has, never the outage's throw", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  w.lib.index = new Map();
  assert.equal(await recapFamily(w.family, NOV1), 2);
});

test("cron: a kid already sent an app-initiated push today is capped (logged as skipped), never a second try", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  await db().query(`insert into push_log (person_id, kind, app_initiated, dedupe_key, status, created_at) values ($1, 'table_nudge', true, 'table_nudge:x', 'sent', '2026-12-01T17:30:00Z')`, [w.leo.id]);
  assert.equal(await recapFamily(w.family, NOV1), 1); // Dad's
  const leo = (await logOf(w.leo.id)).find((r) => r.kind === "recap");
  assert.deepEqual([leo.status, leo.skipped_reason, leo.dedupe_key], ["skipped", "daily", "recap:2026-11"]);
  assert.equal(await recapFamily(w.family, new Date("2026-12-01T11:10:00-08:00")), 0);
});

test("the hourly job looks at nobody on an ordinary day, and queues recaps on the 1st", { skip }, async () => {
  const w = await world();
  await quietNovember(w);
  await hourly(new Date("2026-11-15T18:10:00Z"), { log: silent });
  assert.equal((await db().query(`select count(*)::int as n from outbox where sent_at is null and payload->>'task' like 'messages.%'`)).rows[0].n, 0);
  await hourly(NOV1, { log: silent });
  const queued = (await db().query(`select payload from outbox where sent_at is null and payload->>'task' = 'messages.recap_family'`)).rows;
  assert.deepEqual(queued.map((r) => r.payload.familyId), [w.family]);
});

after(closeAll);
