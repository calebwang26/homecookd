// Offline checks for supabase/functions/api/plumbing.ts (imported through retention.ts, which re-exports
// it): time zones (DST in the US, Europe, Australia & Chile, a half-hour zone), the push caps & quiet
// hours, push copy, the Expo sender's batching & dead-token pruning, push-token validation, who the
// hourly cron finds, notify() and the push-token & cron routes. No database and no network: notify()
// and the routes get a tiny in-memory stand-in for the Supabase client, and Expo is a fake fetch.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/retention_test.ts

import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1.0.13";
import * as R from "../functions/api/retention.ts";

const LA = "America/Los_Angeles";
const IN = "Asia/Kolkata"; // +05:30, no DST
const LON = "Europe/London";
const SYD = "Australia/Sydney";
const SCL = "America/Santiago"; // DST starts by skipping midnight

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();
const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// --- time zones ------------------------------------------------------------------------------

t("validTz takes IANA names and refuses offsets, junk and long strings", () => {
  assertEquals(R.validTz("America/Los_Angeles"), LA);
  assertEquals(R.validTz(" Asia/Kolkata "), IN);
  assertEquals(R.validTz("Europe/London"), LON);
  assertEquals(R.validTz("UTC"), "UTC");
  assertEquals(R.validTz("america/los_angeles"), "america/los_angeles"); // kept as sent; Postgres ignores case
  assertEquals(R.validTz("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos_Aires");
  for (const bad of ["", "  ", "Not/AZone", "+05:30", "-08:00", "America/Los_Angeles; drop table", "../etc", "a".repeat(65)]) {
    assertEquals(R.validTz(bad), null, bad);
  }
  for (const bad of [null, undefined, 42, {}, ["UTC"]]) assertEquals(R.validTz(bad), null);
  assertEquals(R.zoneOf("Mars/Base"), R.DEFAULT_TZ);
  assertEquals(R.zoneOf(null), "America/Los_Angeles");
});

t("localParts reads the wall clock with an ISO weekday", () => {
  // Sunday 2026-10-18 00:30 UTC = Saturday 17:30 in LA = Sunday 06:00 in Kolkata.
  const d = at("2026-10-18T00:30:00Z");
  assertEquals(R.localParts(d, LA), { year: 2026, month: 10, day: 17, hour: 17, minute: 30, weekday: 6 });
  assertEquals(R.localParts(d, IN), { year: 2026, month: 10, day: 18, hour: 6, minute: 0, weekday: 7 });
  assertEquals(R.localParts(at("2026-10-19T07:00:00Z"), LA).weekday, 1); // Monday 00:00
  assertEquals(R.localParts(at("2026-10-19T06:59:00Z"), LA), { year: 2026, month: 10, day: 18, hour: 23, minute: 59, weekday: 7 });
  // An unknown zone reads as the default.
  assertEquals(R.localParts(d, "Mars/Base"), R.localParts(d, LA));
});

t("localDateKey follows the local calendar day", () => {
  const d = at("2026-10-18T06:30:00Z");
  assertEquals(R.localDateKey(d, LA), "2026-10-17");
  assertEquals(R.localDateKey(d, IN), "2026-10-18");
  assertEquals(R.localDateKey(at("2026-01-05T08:00:00Z"), LA), "2026-01-05");
});

t("zonedMidnight is right across DST changes, including a skipped midnight", () => {
  const mid = (y: number, m: number, d: number, tz: string) => iso(R.zonedMidnight(y, m, d, tz));
  assertEquals(mid(2026, 11, 1, LA), "2026-11-01T07:00:00.000Z"); // fall back later that night: still PDT
  assertEquals(mid(2026, 11, 2, LA), "2026-11-02T08:00:00.000Z"); // PST
  assertEquals(mid(2026, 3, 8, LA), "2026-03-08T08:00:00.000Z"); // spring forward later that night: PST
  assertEquals(mid(2026, 3, 9, LA), "2026-03-09T07:00:00.000Z"); // PDT
  assertEquals(mid(2026, 10, 25, LON), "2026-10-24T23:00:00.000Z"); // BST
  assertEquals(mid(2026, 10, 26, LON), "2026-10-26T00:00:00.000Z"); // GMT
  assertEquals(mid(2026, 10, 19, IN), "2026-10-18T18:30:00.000Z");
  assertEquals(mid(2026, 10, 5, SYD), "2026-10-04T13:00:00.000Z"); // AEDT (+11)
  // Santiago jumps 00:00 -> 01:00 on 2026-09-06: the day starts at 01:00 -03.
  assertEquals(mid(2026, 9, 5, SCL), "2026-09-05T04:00:00.000Z");
  assertEquals(mid(2026, 9, 6, SCL), "2026-09-06T04:00:00.000Z");
  assertEquals(R.localParts(R.zonedMidnight(2026, 9, 6, SCL), SCL).hour, 1);
  // Days roll over like Date.UTC.
  assertEquals(mid(2026, 10, 32, LA), "2026-11-01T07:00:00.000Z");
  assertEquals(mid(2026, 11, 0, LA), "2026-10-31T07:00:00.000Z");
});

t("weekStartUtc is local Monday 00:00, across DST weeks and zones", () => {
  const ws = (d: string, tz: string) => iso(R.weekStartUtc(at(d), tz));
  assertEquals(ws("2026-10-21T12:00:00-07:00", LA), "2026-10-19T07:00:00.000Z");
  // The week LA falls back (Sunday 2026-11-01) began on a PDT Monday.
  assertEquals(ws("2026-11-01T12:00:00-08:00", LA), "2026-10-26T07:00:00.000Z");
  assertEquals(ws("2026-11-01T23:59:59-08:00", LA), "2026-10-26T07:00:00.000Z");
  assertEquals(ws("2026-11-02T00:00:00-08:00", LA), "2026-11-02T08:00:00.000Z");
  // The week LA springs forward (Sunday 2026-03-08) began on a PST Monday.
  assertEquals(ws("2026-03-08T15:00:00-07:00", LA), "2026-03-02T08:00:00.000Z");
  assertEquals(ws("2026-03-09T10:00:00-07:00", LA), "2026-03-09T07:00:00.000Z");
  // London leaves BST on Sunday 2026-10-25.
  assertEquals(ws("2026-10-25T12:00:00Z", LON), "2026-10-18T23:00:00.000Z");
  assertEquals(ws("2026-10-28T12:00:00Z", LON), "2026-10-26T00:00:00.000Z");
  // Kolkata: Sunday 23:59 is last week, Monday 00:30 is this week.
  assertEquals(ws("2026-10-18T18:29:00Z", IN), "2026-10-11T18:30:00.000Z");
  assertEquals(ws("2026-10-18T19:00:00Z", IN), "2026-10-18T18:30:00.000Z");
  // Sydney enters AEDT on Sunday 2026-10-04: that week began on an AEST (+10) Monday.
  assertEquals(ws("2026-10-04T12:00:00+11:00", SYD), "2026-09-27T14:00:00.000Z");
  assertEquals(ws("2026-10-07T12:00:00+11:00", SYD), "2026-10-04T13:00:00.000Z");
});

t("monthStartUtc is the local 1st at 00:00", () => {
  assertEquals(iso(R.monthStartUtc(at("2026-11-01T01:30:00-08:00"), LA)), "2026-11-01T07:00:00.000Z");
  assertEquals(iso(R.monthStartUtc(at("2026-10-31T23:30:00-07:00"), LA)), "2026-10-01T07:00:00.000Z");
  assertEquals(iso(R.monthStartUtc(at("2026-10-31T19:00:00Z"), IN)), "2026-10-31T18:30:00.000Z"); // Nov 1 00:30 IST
});

t("monthBounds gives a local month as [start, end), across DST and the year end", () => {
  const b = (m: string, tz: string) => {
    const r = R.monthBounds(m, tz);
    return r && [iso(r.start), iso(r.end)];
  };
  assertEquals(b("2026-11", LA), ["2026-11-01T07:00:00.000Z", "2026-12-01T08:00:00.000Z"]);
  assertEquals(b("2026-12", IN), ["2026-11-30T18:30:00.000Z", "2026-12-31T18:30:00.000Z"]);
  assertEquals(b("2026-10", LON), ["2026-09-30T23:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  for (const bad of ["2026-13", "2026-1", "26-10", "2026-10-01", ""]) assertEquals(R.monthBounds(bad, LA), null, bad);
});

t("inQuietHours is 21:00-08:00 local, boundaries included and excluded right", () => {
  assertFalse(R.inQuietHours(at("2026-10-18T20:59:00-07:00"), LA));
  assert(R.inQuietHours(at("2026-10-18T21:00:00-07:00"), LA));
  assert(R.inQuietHours(at("2026-10-19T00:00:00-07:00"), LA));
  assert(R.inQuietHours(at("2026-10-19T07:59:00-07:00"), LA));
  assertFalse(R.inQuietHours(at("2026-10-19T08:00:00-07:00"), LA));
  assertFalse(R.inQuietHours(at("2026-10-18T12:00:00-07:00"), LA));
  // The same instant is quiet in one zone and not in another.
  assert(R.inQuietHours(at("2026-10-18T15:30:00Z"), IN)); // 21:00 IST
  assertFalse(R.inQuietHours(at("2026-10-18T15:29:00Z"), IN)); // 20:59 IST
  assertFalse(R.inQuietHours(at("2026-10-18T15:30:00Z"), LA)); // 08:30 PDT
});

// --- caps ------------------------------------------------------------------------------------

const sent = (when: string, app = true) => ({ sent_at: iso(at(when)), app_initiated: app });
const cap = (role: R.CapRole, now: string, recent: { sent_at: string; app_initiated: boolean }[] = [], tz = LA, appInitiated = true) =>
  R.capCheck({ role, appInitiated, now: at(now), tz, recent });

t("capCheck: person-to-person pushes are never capped, even at night", () => {
  const lots = Array.from({ length: 10 }, () => sent("2026-10-18T09:00:00-07:00"));
  assertEquals(cap("learner", "2026-10-18T23:00:00-07:00", lots, LA, false), { ok: true });
  assertEquals(cap("cook", "2026-10-18T03:00:00-07:00", lots, LA, false), { ok: true });
});

t("capCheck: quiet hours skip app-initiated pushes at 21:00 and 07:59, not 20:59 or 08:00", () => {
  for (const role of ["learner", "cook"] as const) {
    assertEquals(cap(role, "2026-10-18T20:59:00-07:00"), { ok: true });
    assertEquals(cap(role, "2026-10-18T21:00:00-07:00"), { ok: false, reason: "quiet" });
    assertEquals(cap(role, "2026-10-19T07:59:00-07:00"), { ok: false, reason: "quiet" });
    assertEquals(cap(role, "2026-10-19T08:00:00-07:00"), { ok: true });
  }
  // In the person's zone, not UTC's or LA's.
  assertEquals(cap("learner", "2026-10-18T15:30:00Z", [], IN), { ok: false, reason: "quiet" });
  // A bad stored zone reads as LA.
  assertEquals(cap("learner", "2026-10-18T21:00:00-07:00", [], "Mars/Base"), { ok: false, reason: "quiet" });
});

t("capCheck: a kid gets 1 app-initiated push per local day", () => {
  const now = "2026-10-18T10:00:00-07:00"; // Sunday
  assertEquals(cap("learner", now, [sent("2026-10-18T08:30:00-07:00")]), { ok: false, reason: "daily" });
  // Pushes a person caused don't count.
  assertEquals(cap("learner", now, [sent("2026-10-18T08:30:00-07:00", false)]), { ok: true });
  // Yesterday evening is within 24 hours but another local day.
  assertEquals(cap("learner", now, [sent("2026-10-17T20:30:00-07:00")]), { ok: true });
  // Kolkata: 00:30 and 10:00 IST on the 18th are the same local day (different UTC days).
  assertEquals(cap("learner", "2026-10-18T04:30:00Z", [sent("2026-10-17T19:00:00Z")], IN), { ok: false, reason: "daily" });
  // Unreadable rows are ignored.
  assertEquals(cap("learner", now, [{ sent_at: "not a time", app_initiated: true }]), { ok: true });
});

t("capCheck: a kid gets 3 app-initiated pushes per local Monday-Sunday week", () => {
  const now = "2026-10-24T10:00:00-07:00"; // Saturday
  const three = [sent("2026-10-19T10:00:00-07:00"), sent("2026-10-21T10:00:00-07:00"), sent("2026-10-22T10:00:00-07:00")];
  assertEquals(cap("learner", now, three), { ok: false, reason: "weekly" });
  assertEquals(cap("learner", now, three.slice(0, 2)), { ok: true });
  // Last Sunday belongs to last week.
  assertEquals(cap("learner", now, [sent("2026-10-18T10:00:00-07:00"), ...three.slice(0, 2)]), { ok: true });
  // A new week starts Monday 00:00 local.
  const lastWeek = [sent("2026-10-22T10:00:00-07:00"), sent("2026-10-23T10:00:00-07:00"), sent("2026-10-25T10:00:00-07:00")];
  assertEquals(cap("learner", "2026-10-25T18:00:00-07:00", lastWeek.slice(0, 2)), { ok: true });
  assertEquals(cap("learner", "2026-10-26T09:00:00-07:00", lastWeek), { ok: true });
  // The day cap is checked first.
  assertEquals(cap("learner", "2026-10-22T18:00:00-07:00", three), { ok: false, reason: "daily" });
});

t("capCheck: a cook gets 1 app-initiated push per local month", () => {
  const now = "2026-11-01T10:00:00-08:00"; // the recap hour, after LA fell back
  // Oct 31 22:00 PDT is already Nov 1 in UTC, but October locally.
  assertEquals(cap("cook", now, [sent("2026-10-31T22:00:00-07:00")]), { ok: true });
  assertEquals(cap("cook", now, [sent("2026-11-01T01:30:00-07:00")]), { ok: false, reason: "monthly" }); // the first 1:30
  assertEquals(cap("cook", "2026-11-30T12:00:00-08:00", [sent("2026-11-01T10:05:00-08:00")]), { ok: false, reason: "monthly" });
  assertEquals(cap("cook", "2026-12-01T10:00:00-08:00", [sent("2026-11-30T12:00:00-08:00")]), { ok: true });
  // No day or week caps for cooks beyond the month.
  assertEquals(cap("cook", now, [sent("2026-10-31T09:00:00-07:00", false), sent("2026-10-30T09:00:00-07:00")]), { ok: true });
});

// --- push copy -------------------------------------------------------------------------------

const T = "8b1c0d6e-0000-4000-8000-000000000001";
const msg = (m: Partial<R.MessageLike>): R.MessageLike => ({ kind: "text", thread_id: T, ...m });

t("truncate keeps 90 characters, one line, and never splits an emoji", () => {
  assertEquals(R.truncate("a".repeat(90)), "a".repeat(90));
  const cut = R.truncate("a".repeat(120));
  assertEquals(Array.from(cut).length, 90);
  assert(cut.endsWith("…"));
  assertEquals(R.truncate("  Did you\n\nadd  salt?  "), "Did you add salt?");
  const emoji = R.truncate("a".repeat(88) + "😀" + "bb");
  assertEquals(Array.from(emoji).length, 90);
  assert(emoji.endsWith("😀…"));
  assertEquals(R.truncate("word ".repeat(30)).endsWith(" …"), false); // no space before the ellipsis
});

t("mmss formats voice lengths", () => {
  assertEquals(R.mmss(38), "0:38");
  assertEquals(R.mmss(37.6), "0:38");
  assertEquals(R.mmss(125), "2:05");
  assertEquals(R.mmss("9"), "0:09");
  assertEquals(R.mmss(null), "0:00");
});

t("text & request pushes: the sender's name, then their words (<= 90 chars), opening the chat", () => {
  const long = "Can you call me tonight? I tried the chili and I think I burned the onions, what heat do you use for them";
  const p = R.messagePush(msg({ kind: "text", body: long }), "Leo", "Sunday Chili")!;
  assertEquals(p.kind, "message");
  assertEquals(p.title, "Leo");
  assert(Array.from(p.body).length <= 90);
  assert(p.body.startsWith("Can you call me tonight?") && p.body.endsWith("…"));
  assertFalse(p.body.endsWith(" …"));
  assertEquals(p.url, `/chat/${T}`);
  assertEquals(R.messagePush(msg({ kind: "request", body: "Will you teach me your dumplings?" }), "Maya", null), {
    kind: "message", title: "Maya", body: "Will you teach me your dumplings?", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "text", body: "  " }), "Leo", null), null);
});

t("voice pushes: 'Sent a voice note · 0:38'; a recipe clip names the dish", () => {
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 38, audio_path: "f/a.m4a" }), "Mom", null), {
    kind: "message", title: "Mom", body: "Sent a voice note · 0:38", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 12, audio_url: "https://b/x/voice.m4a" }), "Leo", "Sunday Chili")!.body,
    "Sent a clip from Sunday Chili · 0:12");
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 12, audio_url: "https://b/x/voice.m4a" }), "Leo", null)!.body,
    "Sent a clip · 0:12");
});

t("question pushes: 'Leo asked about Sunday Chili' / 'Leo asked you', body the question", () => {
  assertEquals(R.messagePush(msg({ kind: "question", body: "How much bean paste?", recipe_id: "dad-sunday-chili" }), "Leo", "Sunday Chili"), {
    kind: "question", title: "Leo asked about Sunday Chili", body: "How much bean paste?", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "question", body: "When are you free?" }), "Leo", null)!.title, "Leo asked you");
  assertEquals(R.messagePush(msg({ kind: "question", audio_path: "f/q.m4a", duration_s: 12 }), "Leo", "Sunday Chili")!.body,
    "Sent a voice question · 0:12");
  // A learner's step message with words is a step question.
  assertEquals(R.messagePush(msg({ kind: "step", body: "Is this thick enough?", recipe_id: "r", step_order: 3 }), "Leo", "Sunday Chili"), {
    kind: "question", title: "Leo asked about Sunday Chili", body: "Is this thick enough?", url: `/chat/${T}`,
  });
  // Without words it just shares the step.
  assertEquals(R.messagePush(msg({ kind: "step", recipe_id: "r", step_order: 3 }), "Leo", "Sunday Chili"), {
    kind: "message", title: "Leo", body: "Sent step 3 of Sunday Chili", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "step", recipe_id: "r", step_order: 3 }), "Leo", null)!.body, "Sent step 3");
});

t("recipe pushes: 'Just in from Dad', the dish, opening the recipe", () => {
  assertEquals(R.messagePush(msg({ kind: "recipe", recipe_id: "dad-sunday-chili", body: "For Sunday" }), "Dad", "Sunday Chili"), {
    kind: "recipe", title: "Just in from Dad", body: "Sunday Chili", url: "/recipe/dad-sunday-chili",
  });
  assertEquals(R.recipePush(msg({ kind: "recipe", recipe_id: "x" }), "Dad", null).body, "A new recipe");
});

t("no push for a dish someone made, system notes or hearts; 'Just like mine' gets one", () => {
  assertEquals(R.messagePush(msg({ kind: "cooked", recipe_id: "r" }), "Leo", "Sunday Chili"), null);
  assertEquals(R.messagePush(msg({ kind: "system", body: "Dad joined" }), "Dad", null), null);
  assertEquals(R.messagePush(msg({ kind: "reaction", body: "heart" }), "Mom", "Sunday Chili"), null);
  assertEquals(R.messagePush(msg({ kind: "mystery", body: "x" }), "Mom", null), null);
  assertEquals(R.messagePush(msg({ kind: "reaction", body: "just_like_mine" }), "Mom", "Sunday Chili"), {
    kind: "reaction", title: "Mom", body: "“Just like mine.” on your Sunday Chili", url: `/chat/${T}`,
  });
});

t("push copy never assumes a gender and has no guilt words", () => {
  const all = [
    R.messagePush(msg({ kind: "text", body: "hi" }), "Leo", null),
    R.messagePush(msg({ kind: "voice", duration_s: 5, audio_path: "p" }), "Mom", null),
    R.messagePush(msg({ kind: "voice", duration_s: 5, audio_url: "u" }), "Mom", "Chili"),
    R.messagePush(msg({ kind: "question", audio_path: "p", duration_s: 5 }), "Leo", "Chili"),
    R.messagePush(msg({ kind: "question", body: "?" }), "Leo", null),
    R.messagePush(msg({ kind: "step", step_order: 2 }), "Leo", "Chili"),
    R.messagePush(msg({ kind: "recipe", recipe_id: "r" }), "Dad", null),
    R.messagePush(msg({ kind: "reaction", body: "just_like_mine" }), "Mom", null),
  ];
  for (const p of all) {
    assert(p);
    const words = `${p.title} ${p.body}`;
    assertFalse(/\b(he|she|his|her|hers|him)\b/i.test(words), words);
    assertFalse(/\b(lost|expired|broken|missed)\b/i.test(words), words);
  }
});

// --- Expo sender -----------------------------------------------------------------------------

type ExpoCall = { url: string; headers: Record<string, string>; body: R.ExpoMessage[] };

/** A fake Expo push API: `decide` answers each message, `status` the whole batch. */
function fakeExpo(
  decide: (m: R.ExpoMessage) => R.ExpoTicket = () => ({ status: "ok", id: crypto.randomUUID() }),
  status: (call: number) => number = () => 200,
) {
  const calls: ExpoCall[] = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as R.ExpoMessage[];
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    const code = status(calls.length);
    const out = code === 200 ? { data: body.map(decide) } : { errors: [{ code: "INTERNAL_SERVER_ERROR", message: "boom" }] };
    return Promise.resolve(new Response(JSON.stringify(out), { status: code, headers: { "content-type": "application/json" } }));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const tok = (i: number) => `ExponentPushToken[tok${String(i).padStart(4, "0")}]`;
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ to: tok(i), title: "Leo", body: "hi" }));

t("sendExpoPush batches by 100 and returns a ticket per message, in order", async () => {
  const dead = new Set([tok(5), tok(215)]);
  const expo = fakeExpo((m) =>
    dead.has(m.to)
      ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
      : { status: "ok", id: `id-${m.to}` }
  );
  const out = await R.sendExpoPush(msgs(230), { fetch: expo.fetch, timeoutMs: 0 });
  assertEquals(expo.calls.map((c) => c.body.length), [100, 100, 30]);
  assertEquals(expo.calls[0].url, "https://exp.host/--/api/v2/push/send");
  assertEquals(expo.calls[2].body[0].to, tok(200));
  assertEquals(out.tickets.length, 230);
  assertEquals(out.tickets[7], { status: "ok", id: `id-${tok(7)}` });
  assertEquals(out.deadTokens.sort(), [tok(215), tok(5)].sort());
  assertEquals(expo.calls[0].headers.authorization, undefined);
});

t("sendExpoPush sends the access token only when there is one", async () => {
  const expo = fakeExpo();
  await R.sendExpoPush(msgs(1), { fetch: expo.fetch, accessToken: "secret-x", timeoutMs: 0 });
  assertEquals(expo.calls[0].headers.authorization, "Bearer secret-x");
  // The default timeout path works too.
  const out = await R.sendExpoPush(msgs(1), { fetch: fakeExpo().fetch });
  assertEquals(out.tickets[0].status, "ok");
  assertEquals(await R.sendExpoPush([], { fetch: expo.fetch }), { tickets: [], deadTokens: [] });
});

t("sendExpoPush never throws: a failed batch becomes error tickets, the rest still go", async () => {
  const expo = fakeExpo(undefined, (n) => (n === 2 ? 500 : 200));
  const out = await R.sendExpoPush(msgs(250), { fetch: expo.fetch, timeoutMs: 0 });
  assertEquals(expo.calls.length, 3);
  assertEquals(out.tickets.length, 250);
  assertEquals(out.tickets.slice(0, 100).every((x) => x.status === "ok"), true);
  assertEquals(out.tickets.slice(100, 200).every((x) => x.status === "error"), true);
  assertEquals(out.tickets.slice(200).every((x) => x.status === "ok"), true);

  const offline = (() => Promise.reject(new TypeError("network is off"))) as typeof fetch;
  const down = await R.sendExpoPush(msgs(3), { fetch: offline, timeoutMs: 0 });
  assertEquals(down.tickets.map((x) => x.status), ["error", "error", "error"]);
  assertEquals(down.deadTokens, []);

  const garbage = (() => Promise.resolve(new Response("<html>", { status: 200 }))) as typeof fetch;
  assertEquals((await R.sendExpoPush(msgs(2), { fetch: garbage, timeoutMs: 0 })).tickets.map((x) => x.status), ["error", "error"]);
});

// --- push tokens -----------------------------------------------------------------------------

t("validPushToken takes Expo tokens only", () => {
  for (const ok of ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "ExpoPushToken[abc-123_XYZ]", `ExponentPushToken[${"a".repeat(200)}]`]) {
    assert(R.validPushToken(ok), ok);
  }
  for (const bad of [
    "ExponentPushToken[]", "ExponentPushToken[a b]", "ExponentPushToken[abc", "ExponentPushToken[abc]]",
    "FooPushToken[abc]", "exponentpushtoken[abc]", " ExponentPushToken[abc]", `ExponentPushToken[${"a".repeat(201)}]`,
    "abc", "",
  ]) {
    assertFalse(R.validPushToken(bad), bad);
  }
  for (const bad of [null, undefined, 42, {}]) assertFalse(R.validPushToken(bad));
});

t("parsePushToken checks the token and the platform", () => {
  assertEquals(R.parsePushToken({ token: " ExpoPushToken[abc] ", platform: "ios" }), { ok: true, token: "ExpoPushToken[abc]", platform: "ios" });
  assertEquals(R.parsePushToken({ token: "ExpoPushToken[abc]", platform: "android" }).ok, true);
  assertEquals(R.parsePushToken({ token: "nope", platform: "ios" }), { ok: false, error: "token must be an Expo push token" });
  assertEquals(R.parsePushToken({ token: "ExpoPushToken[abc]" }), { ok: false, error: "platform must be ios or android" });
  assertEquals(R.parsePushToken({ token: "ExpoPushToken[abc]", platform: "web" }).ok, false);
});

// --- the hourly cron's targets ---------------------------------------------------------------

const person = (id: string, role: R.CronProfile["role"], tz: string | null, extra: Partial<R.CronProfile> = {}): R.CronProfile => ({
  id, family_id: "fam", name: id, role, tz, memorial: false, removed_at: null, ...extra,
});

t("dueProfiles: kids in their local Sunday 17:xx get the nudge, anyone on the 1st at 10:xx the recap", () => {
  const people = [
    person("kid-la", "learner", LA),
    person("cook-la", "cook", LA),
    person("kid-in", "learner", IN),
    person("kid-none", "learner", null), // reads as LA
    person("kid-bad", "learner", "Mars/Base"), // reads as LA
    person("kid-gone", "learner", LA, { removed_at: "2026-10-01T00:00:00Z" }),
    person("kid-memorial", "learner", LA, { memorial: true }),
  ];
  const ids = (d: R.Due) => ({ nudge: d.nudge.map((p) => p.id), recap: d.recap.map((p) => p.id) });
  // Cron runs at minute 5 UTC; Sunday 17:05 PDT.
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T17:05:00-07:00"))), { nudge: ["kid-la", "kid-none", "kid-bad"], recap: [] });
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T18:05:00-07:00"))), { nudge: [], recap: [] });
  // Half-hour zone: 12:05 UTC is 17:35 IST, still the 17:00 hour.
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T12:05:00Z"))).nudge, ["kid-in"]);
  // The 1st at 10:05 local, after LA fell back.
  assertEquals(ids(R.dueProfiles(people, at("2026-11-01T10:05:00-08:00"))), { nudge: [], recap: ["kid-la", "cook-la", "kid-none", "kid-bad"] });
  assertEquals(ids(R.dueProfiles(people, at("2026-11-01T04:35:00Z"))).recap, ["kid-in"]); // 10:05 IST
});

// --- background ------------------------------------------------------------------------------

t("runInBackground never fails the caller and can be awaited in tests", async () => {
  let done = false;
  R.runInBackground(new Promise((ok) => setTimeout(() => ok((done = true)), 5)));
  R.runInBackground(Promise.reject(new Error("expo down"))); // logged, never thrown
  assertFalse(done);
  await R.backgroundIdle();
  assert(done);
});

t("runInBackground hands the task to EdgeRuntime.waitUntil when it exists", async () => {
  const given: Promise<unknown>[] = [];
  const g = globalThis as { EdgeRuntime?: unknown };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => given.push(p) };
  try {
    R.runInBackground(Promise.reject(new Error("boom")));
    assertEquals(given.length, 1);
    await given[0]; // already caught: resolves
  } finally {
    delete g.EdgeRuntime;
  }
});

// --- an in-memory stand-in for the Supabase client ---------------------------------------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
const UNIQUE: Record<string, string[][]> = { push_tokens: [["token"]], notification_log: [["profile_id", "dedupe_key"]] };

/** Understands just what plumbing.ts calls: select/insert/update/delete, eq/in/is/gt, limit, maybeSingle, rpc. */
function fakeDb(tables: Tables, opts: { rpc?: (fn: string, args: Row) => unknown; beforeInsert?: (table: string) => void } = {}) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: ((r: Row) => boolean)[] = [];
    private max = Infinity;
    private single = false;
    constructor(private table: string) {}
    select(_cols?: string) { return this; }
    insert(row: Row) { this.op = "insert"; this.payload = row; return this; }
    update(row: Row) { this.op = "update"; this.payload = row; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    gt(c: string, v: string) { this.filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private run() {
      const rows = tables[this.table];
      if (!rows) throw new Error(`fake db: no table ${this.table}`);
      const hit = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        opts.beforeInsert?.(this.table);
        const row = { ...this.payload };
        for (const cols of UNIQUE[this.table] ?? []) {
          if (cols.some((c) => row[c] === null || row[c] === undefined)) continue; // NULLs are distinct
          if (tables[this.table].some((r) => cols.every((c) => r[c] === row[c]))) {
            return { data: null, error: { code: "23505", message: "duplicate key value" } };
          }
        }
        tables[this.table].push(row);
        return { data: null, error: null };
      }
      if (this.op === "update") {
        rows.filter(hit).forEach((r) => Object.assign(r, this.payload));
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = rows.filter((r) => !hit(r));
        return { data: null, error: null };
      }
      const found = rows.filter(hit).slice(0, this.max);
      return { data: this.single ? found[0] ?? null : found, error: null };
    }
  }
  const db = {
    from: (table: string) => new Query(table),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: opts.rpc ? opts.rpc(fn, args) : null, error: null });
    },
  };
  return { db: db as unknown as R.NotifyDeps["db"], rpcCalls };
}

const FAM = "11111111-1111-4111-8111-111111111111";
const OTHER_FAM = "99999999-9999-4999-8999-999999999999";
const MOM = "22222222-2222-4222-8222-222222222222"; // cook
const LEO = "33333333-3333-4333-8333-333333333333"; // learner
const GRAN = "44444444-4444-4444-8444-444444444444"; // cook, memorial
const SAM = "55555555-5555-4555-8555-555555555555"; // removed
const PHONE = "66666666-6666-4666-8666-666666666666"; // Leo's phone
const OLD_PHONE = "77777777-7777-4777-8777-777777777777"; // Leo's old phone, signed out
const MOM_PHONE = "88888888-8888-4888-8888-888888888888";

function family(): Tables {
  const profile = (id: string, name: string, role: string, extra: Row = {}) =>
    ({ id, family_id: FAM, name, role, tz: LA, memorial: false, removed_at: null, ...extra });
  return {
    profiles: [
      profile(MOM, "Mom", "cook"),
      profile(LEO, "Leo", "learner"),
      profile(GRAN, "Grandma", "cook", { memorial: true }),
      profile(SAM, "Sam", "learner", { removed_at: "2026-10-01T00:00:00Z" }),
    ],
    devices: [
      { id: PHONE, family_id: FAM, profile_id: LEO, revoked_at: null },
      { id: OLD_PHONE, family_id: FAM, profile_id: LEO, revoked_at: "2026-10-10T00:00:00Z" },
      { id: MOM_PHONE, family_id: FAM, profile_id: MOM, revoked_at: null },
    ],
    push_tokens: [
      { token: tok(1), family_id: FAM, profile_id: LEO, device_id: PHONE, platform: "ios" },
      { token: tok(2), family_id: FAM, profile_id: LEO, device_id: OLD_PHONE, platform: "ios" },
      { token: tok(3), family_id: FAM, profile_id: LEO, device_id: null, platform: "ios" }, // family-code phone
      { token: tok(4), family_id: FAM, profile_id: GRAN, device_id: null, platform: "ios" },
      { token: tok(5), family_id: FAM, profile_id: SAM, device_id: null, platform: "ios" },
    ],
    notification_log: [],
  };
}

const textPush: R.PushInput = { kind: "message", title: "Mom", body: "Dinner?", url: `/chat/${T}`, appInitiated: false };
const nudge = (key: string): R.PushInput => ({
  kind: "table_nudge", title: "Mom", body: "“A pinch, then taste.” · Your week at the table is still open.",
  url: "/recipe/mom-dal", appInitiated: true, dedupeKey: key, quoteKey: "mom-dal#step-2",
});

// --- notify() ----------------------------------------------------------------------------------

t("notify sends to live phones only, logs it, and prunes dead & signed-out tokens", async () => {
  const tables = family();
  const { db } = fakeDb(tables);
  const expo = fakeExpo((m) =>
    m.to === tok(3) ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" }
  );
  const out = await R.notify({ db, fetch: expo.fetch }, LEO, { ...textPush, dedupeKey: "message:m1" });
  assertEquals(out, "sent");
  assertEquals(expo.calls.length, 1);
  assertEquals(expo.calls[0].body.map((m) => m.to), [tok(1), tok(3)]); // not the signed-out phone's
  assertEquals(expo.calls[0].body[0], {
    to: tok(1), title: "Mom", body: "Dinner?", data: { url: `/chat/${T}`, kind: "message", profile_id: LEO },
    sound: "default", priority: "high", channelId: "default",
  });
  assertEquals(tables.push_tokens.filter((r) => r.profile_id === LEO).map((r) => r.token), [tok(1)]);
  assertEquals(tables.notification_log.length, 1);
  const row = tables.notification_log[0];
  assertEquals([row.family_id, row.profile_id, row.kind, row.app_initiated, row.dedupe_key, row.skipped_reason],
    [FAM, LEO, "message", false, "message:m1", undefined]);

  // The same dedupe key again: nothing sent, nothing logged.
  assertEquals(await R.notify({ db, fetch: expo.fetch }, LEO, { ...textPush, dedupeKey: "message:m1" }), "dup");
  assertEquals(expo.calls.length, 1);
  assertEquals(tables.notification_log.length, 1);
  // Without a key, a second push goes out.
  assertEquals(await R.notify({ db, fetch: expo.fetch }, LEO, textPush), "sent");
  assertEquals(tables.notification_log.length, 2);
});

t("notify skips removed, memorial & unknown people, and people with no phones", async () => {
  const tables = family();
  const { db } = fakeDb(tables);
  const expo = fakeExpo();
  assertEquals(await R.notify({ db, fetch: expo.fetch }, GRAN, textPush), "skipped");
  assertEquals(await R.notify({ db, fetch: expo.fetch }, SAM, textPush), "skipped");
  assertEquals(await R.notify({ db, fetch: expo.fetch }, crypto.randomUUID(), textPush), "skipped");
  assertEquals(await R.notify({ db, fetch: expo.fetch }, MOM, textPush), "none");
  assertEquals(expo.calls.length, 0);
  assertEquals(tables.notification_log.length, 0);
});

t("notify: app-initiated pushes are capped & skipped in quiet hours (logged), person ones aren't", async () => {
  const tables = family();
  const { db } = fakeDb(tables);
  const expo = fakeExpo();
  const deps = (now: string) => ({ db, fetch: expo.fetch, now: at(now) });

  // Saturday 22:00: quiet. Logged as skipped, with its key, nothing sent.
  assertEquals(await R.notify(deps("2026-10-17T22:00:00-07:00"), LEO, nudge("n:sat")), "quiet");
  assertEquals(tables.notification_log.at(-1)!.skipped_reason, "quiet");
  assertEquals(expo.calls.length, 0);
  // A skipped push doesn't use up the cap: Sunday 17:10 goes out.
  assertEquals(await R.notify(deps("2026-10-18T17:10:00-07:00"), LEO, nudge("n:sun")), "sent");
  assertEquals(tables.notification_log.at(-1)!.sent_at, "2026-10-19T00:10:00.000Z"); // the override clock
  // A second app-initiated push the same local day is capped.
  assertEquals(await R.notify(deps("2026-10-18T18:00:00-07:00"), LEO, nudge("n:sun2")), "daily");
  assertEquals(tables.notification_log.at(-1)!.skipped_reason, "daily");
  // A person's message still goes out, even at night.
  assertEquals(await R.notify(deps("2026-10-18T23:30:00-07:00"), LEO, textPush), "sent");
  assertEquals(expo.calls.length, 2);
  // The same key as a skipped push is a dup, not a second try.
  assertEquals(await R.notify(deps("2026-10-17T12:00:00-07:00"), LEO, nudge("n:sat")), "dup");
});

t("notify: a racing insert of the same key reads as dup; a broken database never throws", async () => {
  const tables = family();
  let raced = false;
  const { db } = fakeDb(tables, {
    beforeInsert: (table) => {
      if (table !== "notification_log" || raced) return;
      raced = true;
      tables.notification_log.push({ profile_id: LEO, dedupe_key: "started:x", app_initiated: false });
    },
  });
  const expo = fakeExpo();
  assertEquals(await R.notify({ db, fetch: expo.fetch }, LEO, { ...textPush, dedupeKey: "started:x" }), "dup");
  assertEquals(expo.calls.length, 0);

  const broken = { from: () => { throw new Error("db down"); } } as unknown as R.NotifyDeps["db"];
  assertEquals(await R.notify({ db: broken, fetch: expo.fetch }, LEO, textPush), "error");
  // Every phone's ticket an error = failed (still logged, so it isn't retried into a double).
  const allBad = fakeExpo(() => ({ status: "error", message: "MessageRateExceeded", details: { error: "MessageRateExceeded" } }));
  assertEquals(await R.notify({ db, fetch: allBad.fetch }, LEO, textPush), "failed");
});

t("syncTz stores a valid x-tz once per change and ignores junk", async () => {
  const tables = family();
  const { db } = fakeDb(tables);
  await R.syncTz(db, MOM, "Asia/Kolkata");
  assertEquals(tables.profiles.find((p) => p.id === MOM)!.tz, IN);
  tables.profiles.find((p) => p.id === MOM)!.tz = "changed elsewhere";
  await R.syncTz(db, MOM, "Asia/Kolkata"); // already stored by this isolate: no write
  assertEquals(tables.profiles.find((p) => p.id === MOM)!.tz, "changed elsewhere");
  await R.syncTz(db, LEO, "+05:30");
  await R.syncTz(db, LEO, null);
  await R.syncTz(db, null, "Europe/London");
  assertEquals(tables.profiles.find((p) => p.id === LEO)!.tz, LA);
});

// --- routes ------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
type TestProfile = R.RetentionProfile & { relation: string | null };
type TestCtx = R.RetentionCtx & { profiles: TestProfile[]; me: TestProfile | null; phones: Set<string> };

function routesFor(tables: Tables, opts: { denyRate?: boolean } = {}) {
  const { db, rpcCalls } = fakeDb(tables, { rpc: (fn, args) => fn === "cron_secret_ok" && args.p_secret === "test-cron" });
  const rate: string[] = [];
  const r = R.makeRetention({
    db,
    HttpError,
    requireMe: (ctx: TestCtx) => {
      if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
      return ctx.me;
    },
    rateLimit: (kind, value, max, windowMin) => {
      rate.push(`${kind}:${value}:${max}:${windowMin}`);
      return opts.denyRate ? Promise.reject(new HttpError(429, "Too many attempts. Please wait a few minutes.")) : Promise.resolve();
    },
    dbFail: (context) => {
      throw new Error(`db fail: ${context}`);
    },
    clientIp: () => "203.0.113.9",
    fetch: fakeExpo().fetch,
  });
  return { r, rate, rpcCalls };
}

const profilesOf = (tables: Tables): TestProfile[] =>
  tables.profiles.filter((p) => !p.removed_at).map((p) => ({ ...p, relation: null }) as TestProfile);
const ctxFor = (tables: Tables, me: string | null, device: { id: string; profile_id: string | null } | null, fam = FAM): TestCtx => ({
  family: { id: fam, name: "Test family" },
  profiles: profilesOf(tables),
  me: profilesOf(tables).find((p) => p.id === me) ?? null,
  device,
  phones: new Set(),
});
const bodyOf = (b: Record<string, unknown>) => () => Promise.resolve(b);
const req = (headers: Record<string, string> = {}) => new Request("http://x/api/cron/hourly", { method: "POST", headers });

async function httpError(p: Promise<unknown>, status: number, message: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals([e.status, e.message], [status, message]);
}

t("routes: the factory hands index.ts two signed-in routes and one public one", () => {
  const { r } = routesFor(family());
  assertEquals(r.routes.map((x) => [x.method, x.path, x.auth]), [
    ["POST", "/push-tokens", {}],
    ["POST", "/push-tokens/remove", { lenientMe: true }],
  ]);
  assertEquals(r.publicRoutes.map((x) => [x.method, x.path]), [["POST", "/cron/hourly"]]);
  assertEquals(r.cronJobs, []);
});

t("POST /push-tokens registers to the phone's own person, then moves the token on re-register", async () => {
  const tables = family();
  const { r, rate } = routesFor(tables);
  const token = "ExponentPushToken[new-phone-0001]";
  // Grandma acting on Mom's phone: the token stays Mom's.
  const lent = ctxFor(tables, GRAN, { id: MOM_PHONE, profile_id: MOM });
  assertEquals(await r.registerToken({ req: req(), ctx: lent, body: bodyOf({ token, platform: "ios" }) }), { ok: true });
  const row = () => tables.push_tokens.filter((x) => x.token === token);
  assertEquals(row().length, 1);
  assertEquals([row()[0].profile_id, row()[0].device_id, row()[0].family_id, row()[0].platform], [MOM, MOM_PHONE, FAM, "ios"]);
  assertEquals(rate, [`push-tokens:${MOM}:30:60`]);
  // The same token from a family-code caller acting as Leo: moved, never duplicated.
  await r.registerToken({ req: req(), ctx: ctxFor(tables, LEO, null), body: bodyOf({ token, platform: "android" }) });
  assertEquals(row().length, 1);
  assertEquals([row()[0].profile_id, row()[0].device_id, row()[0].platform], [LEO, null, "android"]);
});

t("POST /push-tokens refuses bad tokens and needs a person", async () => {
  const tables = family();
  const { r } = routesFor(tables);
  await httpError(r.registerToken({ req: req(), ctx: ctxFor(tables, LEO, null), body: bodyOf({ token: "abc", platform: "ios" }) }),
    400, "token must be an Expo push token");
  await httpError(r.registerToken({ req: req(), ctx: ctxFor(tables, LEO, null), body: bodyOf({ token: tok(9), platform: "web" }) }),
    400, "platform must be ios or android");
  await httpError(r.registerToken({ req: req(), ctx: ctxFor(tables, null, null), body: bodyOf({ token: tok(9), platform: "ios" }) }),
    400, "x-profile-id header is required for this request");
  // A phone with a person needs no x-profile-id.
  await r.registerToken({ req: req(), ctx: ctxFor(tables, null, { id: PHONE, profile_id: LEO }), body: bodyOf({ token: tok(9), platform: "ios" }) });
  assertEquals(tables.push_tokens.find((x) => x.token === tok(9))!.profile_id, LEO);
});

t("POST /push-tokens/remove only removes tokens in my family", async () => {
  const tables = family();
  tables.push_tokens.push({ token: tok(42), family_id: OTHER_FAM, profile_id: crypto.randomUUID(), device_id: null, platform: "ios" });
  const { r } = routesFor(tables);
  const ctx = ctxFor(tables, null, { id: PHONE, profile_id: LEO });
  assertEquals(await r.removeToken({ req: req(), ctx, body: bodyOf({ token: tok(42) }) }), { ok: true });
  assert(tables.push_tokens.some((x) => x.token === tok(42)));
  await r.removeToken({ req: req(), ctx, body: bodyOf({ token: tok(1) }) });
  assertFalse(tables.push_tokens.some((x) => x.token === tok(1)));
  await httpError(r.removeToken({ req: req(), ctx, body: bodyOf({ token: 7 }) }), 400, "token must be an Expo push token");
});

t("POST /cron/hourly: no or wrong secret is a rate-limited 401, before the body is read", async () => {
  const tables = family();
  const { r, rate, rpcCalls } = routesFor(tables);
  let bodyRead = false;
  const body = () => ((bodyRead = true), Promise.resolve({ now: "2026-10-18T17:10:00-07:00" }));
  await httpError(r.cronHourly({ req: req(), body }), 401, "Not allowed");
  assertEquals(rpcCalls.length, 0); // no header: no database round trip
  await httpError(r.cronHourly({ req: req({ "x-cron-secret": "guess" }), body }), 401, "Not allowed");
  assertEquals(rpcCalls, [{ fn: "cron_secret_ok", args: { p_secret: "guess" } }]);
  assertEquals(rate, ["badcron:203.0.113.9:20:10", "badcron:203.0.113.9:20:10"]);
  assertFalse(bodyRead);
  const { r: limited } = routesFor(tables, { denyRate: true });
  await httpError(limited.cronHourly({ req: req({ "x-cron-secret": "guess" }), body }), 429, "Too many attempts. Please wait a few minutes.");
});

t("POST /cron/hourly with the secret counts who is due (people with push on) and runs the jobs", async () => {
  const tables = family();
  // Mom gets a phone with push; a learner with no token is never counted.
  tables.push_tokens.push({ token: tok(10), family_id: FAM, profile_id: MOM, device_id: MOM_PHONE, platform: "ios" });
  tables.profiles.push({ id: crypto.randomUUID(), family_id: FAM, name: "Maya", role: "learner", tz: LA, memorial: false, removed_at: null });
  const { r } = routesFor(tables);
  const secret = req({ "x-cron-secret": "test-cron" });

  // Sunday 17:10 PDT: Leo is due a nudge (Grandma is memorial, Sam removed, Mom a cook).
  assertEquals(await r.cronHourly({ req: secret, body: bodyOf({ now: "2026-10-18T17:10:00-07:00" }) }),
    { ok: true, due: { nudge: 1, recap: 0 }, sent: 0, jobs: {} });
  // The 1st at 10:10 local: Leo & Mom are due a recap.
  assertEquals((await r.cronHourly({ req: secret, body: bodyOf({ now: "2026-11-01T10:10:00-08:00" }) }) as { due: unknown }).due,
    { nudge: 0, recap: 2 });
  await httpError(r.cronHourly({ req: secret, body: bodyOf({ now: "next sunday" }) }), 400, "now must be an ISO time");
  await httpError(r.cronHourly({ req: secret, body: bodyOf({ now: 1760000000 }) }), 400, "now must be an ISO time");
  // No override: the real clock.
  assertEquals((await r.cronHourly({ req: secret, body: bodyOf({}) }) as { ok: boolean }).ok, true);

  // Later PRs register jobs; each runs in its own try with the run's clock.
  const seen: string[] = [];
  r.cronJobs.push({ name: "table_nudge", run: ({ now, due }) => (seen.push(`${now.toISOString()} ${due.nudge.length}`), Promise.resolve(2)) });
  r.cronJobs.push({ name: "recap", run: () => Promise.reject(new Error("recap broke")) });
  assertEquals(await r.cronHourly({ req: secret, body: bodyOf({ now: "2026-10-18T17:10:00-07:00" }) }),
    { ok: true, due: { nudge: 1, recap: 0 }, sent: 2, jobs: { table_nudge: 2, recap: 0 } });
  assertEquals(seen, ["2026-10-19T00:10:00.000Z 1"]);
});

t("a cron job's notify uses the run's clock for caps & quiet hours", async () => {
  const tables = family();
  const { r } = routesFor(tables);
  const results: string[] = [];
  r.cronJobs.push({
    name: "probe",
    run: async ({ due, notify }) => {
      for (const p of due.nudge) results.push(await notify(p.id, nudge(`probe:${p.id}`)));
      return 0;
    },
  });
  // 17:10 on a Sunday: sent. The same run replayed: dedupe.
  const secret = req({ "x-cron-secret": "test-cron" });
  await r.cronHourly({ req: secret, body: bodyOf({ now: "2026-10-18T17:10:00-07:00" }) });
  await r.cronHourly({ req: secret, body: bodyOf({ now: "2026-10-18T17:10:00-07:00" }) });
  assertEquals(results, ["sent", "dup"]);
  assertEquals(tables.notification_log.map((x) => x.sent_at), ["2026-10-19T00:10:00.000Z"]);
});

// --- what the later routes read: one import, the family, the library, /dish-stats ----------------

t("retention.ts re-exports time.ts, table.ts & recap.ts, so index.ts imports one file", () => {
  for (const name of ["DEFAULT_TZ", "validTz", "localParts", "monthBounds", "NUDGE_AT", "RECAP_AT"]) assert(name in R, name);
  for (const name of ["computeTable", "familyPairs", "pairStreak", "nudgeCandidates", "pickNudgeQuote", "nudgePush", "weekStart"]) {
    assertEquals(typeof (R as Record<string, unknown>)[name], "function", name);
  }
  for (const name of ["computeRecap", "recapPush", "isMonth", "monthName"]) {
    assertEquals(typeof (R as Record<string, unknown>)[name], "function", name);
  }
  // One clock for everything: the cron's hours are the ones table.ts nudges in.
  assertEquals(R.NUDGE_AT, { weekday: 7, hour: 17 });
  assertEquals(R.weekStart(at("2026-10-18T17:10:00-07:00"), LA), "2026-10-12");
});

t("familyProfiles loads tz & memorial, and its rows feed table.ts, recap.ts & the cron as they are", async () => {
  const tables = family();
  tables.profiles.push({ id: "x", family_id: OTHER_FAM, name: "Elsewhere", role: "cook", tz: LA, memorial: false, removed_at: null });
  tables.profiles.push({ id: "old", family_id: FAM, name: "Old row", role: "learner" }); // columns not set yet
  const { db } = fakeDb(tables);
  const people = await R.familyProfiles(db, FAM);
  assertEquals(people.map((p) => p.id), [MOM, LEO, GRAN, SAM, "old"]);
  assertEquals(people.at(-1), { id: "old", family_id: FAM, name: "Old row", role: "learner", tz: null, memorial: false, removed_at: null });

  const now = at("2026-10-18T12:00:00-07:00");
  const activity: R.Activity[] = [
    { at: "2026-10-14T18:00:00Z", actor_id: LEO, kind: "cooked", target_cook_id: MOM },
    { at: "2026-10-15T18:00:00Z", actor_id: MOM, kind: "message", thread_with: LEO },
  ];
  const table = R.computeTable({ now, kidTz: LA, profiles: people, activity, me: LEO });
  // Memorial Grandma & removed Sam are in no pair.
  assertEquals(table.pairs.map((p) => [p.kid_id, p.cook_id, p.weeks]), [[LEO, MOM, 1]]);

  const recap = R.computeRecap({
    month: "2026-10", tz: LA, role: "learner", me: LEO, profiles: people,
    events: [{ profile_id: LEO, recipe_id: "mom-dal", kind: "cooked", cook_id: MOM, created_at: "2026-10-14T18:00:00Z" }],
    messages: [], favorites: [], recipes: new Map(), answers: new Map(),
  });
  assert(!("empty" in recap));
  assertEquals(R.dueProfiles(people, at("2026-10-18T17:05:00-07:00")).nudge.map((p) => p.id), [LEO, "old"]);
});

/** A fake public bucket: `files` by path ('library.json', '<id>/recipe.json'); anything else is 404. */
function fakeBucket(files: Record<string, unknown>, opts: { down?: () => boolean } = {}) {
  const calls: string[] = [];
  const fetch = ((url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (opts.down?.()) return Promise.reject(new TypeError("network is off"));
    const path = u.replace("https://bucket.test/", "");
    return Promise.resolve(path in files
      ? new Response(JSON.stringify(files[path]), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("<Error>NoSuchKey</Error>", { status: 404 }));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const LIBRARY = [
  { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", relation: "Mom", sample: false, recipe_url: "x" },
  { id: "mom-sample", title: "Sample Soup", cook_name: "mom ", relation: "Mom", sample: true, recipe_url: "x" },
  { id: "gordon-eggs", title: "Scrambled Eggs", cook_name: "Gordon", relation: "YouTube", sample: true, recipe_url: "x" },
];
const MOM_DAL = {
  id: "mom-dal", title: "Mom's Dal", cook: { name: "Mom", relation: "Mom" }, sample: false,
  steps: [{ order: 2, quote: "A pinch, then taste." }, { order: 1, quote: null }, { order: "x", quote: "dropped" }],
};

t("makeLibrary reads library.json & recipe.json, caches 10 min, and never caches an outage", async () => {
  let clock = 0;
  let down = false;
  const bucket = fakeBucket({ "library.json": LIBRARY, "mom-dal/recipe.json": MOM_DAL }, { down: () => down });
  const lib = R.makeLibrary({ bucketUrl: "https://bucket.test/", fetch: bucket.fetch, clock: () => clock });

  const index = await lib.libraryIndex();
  assertEquals(index.get("mom-dal"), { title: "Mom's Dal", cook_name: "Mom", sample: false });
  assertEquals(index.get("mom-sample")?.sample, true);
  assertEquals(R.dishesOf(index, " MOM"), ["mom-dal", "mom-sample"]); // the app's cookProfile rule
  assertEquals(R.dishesOf(index, ""), []);

  const dal = await lib.recipeInfo("mom-dal");
  assertEquals(dal, {
    id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", sample: false,
    steps: [{ order: 2, quote: "A pinch, then taste." }, { order: 1, quote: null }],
  });
  // RecipeDetails is table.ts's NudgeRecipe: her words, verbatim.
  assertEquals(R.pickNudgeQuote({ cookRecipes: [dal!], usedQuoteKeys: [] }), { text: "A pinch, then taste.", quoteKey: "mom-dal#step-2" });
  assertEquals(await lib.recipeInfo("nope"), null); // 404: cached as missing
  assertEquals(await lib.recipeInfo("../library.json"), null); // never fetched
  const fetched = bucket.calls.length;

  clock = 9 * 60_000; // still fresh: no fetches
  await lib.libraryIndex();
  await lib.recipeInfo("mom-dal");
  await lib.recipeInfo("nope");
  assertEquals(bucket.calls.length, fetched);

  clock = 11 * 60_000;
  down = true; // stale & the bucket is down: empty Map / null, and nothing cached
  assertEquals((await lib.libraryIndex()).size, 0);
  assertEquals(await lib.recipeInfo("mom-dal"), null);
  down = false;
  assertEquals((await lib.libraryIndex()).size, 3);
  assertEquals((await lib.recipeInfo("mom-dal"))?.title, "Mom's Dal");
});

t("buildDishStats has exactly the handoff's /dish-stats shape, zeros included", () => {
  const stats = R.buildDishStats(
    ["mom-dal", "mom-soup"],
    [
      { profile_id: LEO, recipe_id: "mom-dal", created_at: "2026-10-10T10:00:00Z" },
      { profile_id: SAM, recipe_id: "mom-dal", created_at: "2026-10-12T10:00:00Z" },
      { profile_id: LEO, recipe_id: "mom-dal", created_at: "2026-10-13T10:00:00Z" }, // a repeat row: one heart
      { profile_id: LEO, recipe_id: "dad-chili", created_at: "2026-10-13T10:00:00Z" }, // not asked for
    ],
    [
      { profile_id: LEO, recipe_id: "mom-dal", created_at: "2026-10-01T10:00:00Z" },
      { profile_id: LEO, recipe_id: "mom-dal", created_at: "2026-10-09T10:00:00Z" },
      { profile_id: SAM, recipe_id: "mom-dal", created_at: "2026-10-05T10:00:00Z" },
    ],
  );
  assertEquals(stats, {
    "mom-dal": {
      hearts: { count: 2, by: [{ profile_id: SAM, at: "2026-10-12T10:00:00Z" }, { profile_id: LEO, at: "2026-10-10T10:00:00Z" }] },
      cooked: {
        count: 3,
        by: [
          { profile_id: LEO, count: 2, last_at: "2026-10-09T10:00:00Z" },
          { profile_id: SAM, count: 1, last_at: "2026-10-05T10:00:00Z" },
        ],
      },
    },
    "mom-soup": { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } },
  });
  assertEquals(R.buildDishStats([], [], []), {});
});
