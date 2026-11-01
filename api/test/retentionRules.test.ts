// Carried over from the pure half of supabase/tests/retention_test.ts: time zones, the caps, push copy, the Expo sender, push tokens, the hourly job's targets. Field
// names follow the new columns. Dropped: runInBackground (the outbox replaced it) and parsePushToken (pushTokens.ts checks that, messagesPush.test.ts tests it).
import { Deno, assert, assertEquals, assertFalse } from "./denoAssert.js";
import * as expo from "../src/modules/messages/expo.js";
import * as rules from "../src/modules/messages/pushRules.js";
import * as time from "../src/modules/messages/time.js";

const R = { ...time, ...rules, ...expo };
declare namespace R {
  export type ExpoMessage = expo.ExpoMessage;
  export type ExpoTicket = expo.ExpoTicket;
  export type CronPerson = rules.CronPerson;
  export type CapRole = rules.CapRole;
  export type MessageLike = rules.MessageLike;
}

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
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 38, audio_key: "f/a.m4a" }), "Mom", null), {
    kind: "message", title: "Mom", body: "Sent a voice note · 0:38", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 12, clip_key: "https://b/x/voice.m4a" }), "Leo", "Sunday Chili")!.body,
    "Sent a clip from Sunday Chili · 0:12");
  assertEquals(R.messagePush(msg({ kind: "voice", duration_s: 12, clip_key: "https://b/x/voice.m4a" }), "Leo", null)!.body,
    "Sent a clip · 0:12");
});

t("question pushes: 'Leo asked about Sunday Chili' / 'Leo asked you', body the question", () => {
  assertEquals(R.messagePush(msg({ kind: "question", body: "How much bean paste?", library_id: "dad-sunday-chili" }), "Leo", "Sunday Chili"), {
    kind: "question", title: "Leo asked about Sunday Chili", body: "How much bean paste?", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "question", body: "When are you free?" }), "Leo", null)!.title, "Leo asked you");
  assertEquals(R.messagePush(msg({ kind: "question", audio_key: "f/q.m4a", duration_s: 12 }), "Leo", "Sunday Chili")!.body,
    "Sent a voice question · 0:12");
  // A learner's step message with words is a step question.
  assertEquals(R.messagePush(msg({ kind: "step", body: "Is this thick enough?", library_id: "r", step_order: 3 }), "Leo", "Sunday Chili"), {
    kind: "question", title: "Leo asked about Sunday Chili", body: "Is this thick enough?", url: `/chat/${T}`,
  });
  // Without words it just shares the step.
  assertEquals(R.messagePush(msg({ kind: "step", library_id: "r", step_order: 3 }), "Leo", "Sunday Chili"), {
    kind: "message", title: "Leo", body: "Sent step 3 of Sunday Chili", url: `/chat/${T}`,
  });
  assertEquals(R.messagePush(msg({ kind: "step", library_id: "r", step_order: 3 }), "Leo", null)!.body, "Sent step 3");
});

t("recipe pushes: 'Just in from Dad', the dish, opening the recipe", () => {
  assertEquals(R.messagePush(msg({ kind: "recipe", library_id: "dad-sunday-chili", body: "For Sunday" }), "Dad", "Sunday Chili"), {
    kind: "recipe", title: "Just in from Dad", body: "Sunday Chili", url: "/recipe/dad-sunday-chili",
  });
  assertEquals(R.recipePush(msg({ kind: "recipe", library_id: "x" }), "Dad", null).body, "A new recipe");
});

t("no push for a dish someone made, system notes or hearts; 'Just like mine' gets one", () => {
  assertEquals(R.messagePush(msg({ kind: "cooked", library_id: "r" }), "Leo", "Sunday Chili"), null);
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
    R.messagePush(msg({ kind: "voice", duration_s: 5, audio_key: "p" }), "Mom", null),
    R.messagePush(msg({ kind: "voice", duration_s: 5, clip_key: "u" }), "Mom", "Chili"),
    R.messagePush(msg({ kind: "question", audio_key: "p", duration_s: 5 }), "Leo", "Chili"),
    R.messagePush(msg({ kind: "question", body: "?" }), "Leo", null),
    R.messagePush(msg({ kind: "step", step_order: 2 }), "Leo", "Chili"),
    R.messagePush(msg({ kind: "recipe", library_id: "r" }), "Dad", null),
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
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ to: tok(i), title: "Leo", body: "hi", sound: "default" as const, priority: "high" as const, channelId: "default" as const, data: { url: "/", kind: "message", profile_id: "p" } }));

t("sendExpoPush batches by 100 and returns a ticket per message, in order", async () => {
  const dead = new Set([tok(5), tok(215)]);
  const expo = fakeExpo((m) =>
    dead.has(m.to)
      ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
      : { status: "ok", id: `id-${m.to}` }
  );
  const out = await R.sendExpoPush(msgs(230), { fetch: expo.fetch, timeoutMs: 1000 });
  assertEquals(expo.calls.map((c) => c.body.length), [100, 100, 30]);
  assertEquals(expo.calls[0].url, "https://exp.host/--/api/v2/push/send");
  assertEquals(expo.calls[2].body[0].to, tok(200));
  assertEquals(out.tickets.length, 230);
  assertEquals(out.tickets[7], { status: "ok", id: `id-${tok(7)}` });
  assertEquals(out.dead.sort(), [tok(215), tok(5)].sort());
  assertEquals(expo.calls[0].headers.authorization, undefined);
});

t("sendExpoPush sends the access token only when there is one", async () => {
  const expo = fakeExpo();
  await R.sendExpoPush(msgs(1), { fetch: expo.fetch, accessToken: "secret-x", timeoutMs: 1000 });
  assertEquals(expo.calls[0].headers.authorization, "Bearer secret-x");
  // The default timeout path works too.
  const out = await R.sendExpoPush(msgs(1), { fetch: fakeExpo().fetch });
  assertEquals(out.tickets[0].status, "ok");
  assertEquals(await R.sendExpoPush([], { fetch: expo.fetch }), { tickets: [], dead: [] });
});

t("sendExpoPush never throws: a failed batch becomes error tickets, the rest still go", async () => {
  // Ours tries a batch Expo refused once more (a timeout never: Expo may have taken it), so the second batch fails twice here.
  const expo = fakeExpo(undefined, (n) => (n === 2 || n === 3 ? 500 : 200));
  const out = await R.sendExpoPush(msgs(250), { fetch: expo.fetch, timeoutMs: 1000, retryWaitMs: 0 });
  assertEquals(expo.calls.length, 4);
  assertEquals(out.tickets.length, 250);
  assertEquals(out.tickets.slice(0, 100).every((x) => x.status === "ok"), true);
  assertEquals(out.tickets.slice(100, 200).every((x) => x.status === "error"), true);
  assertEquals(out.tickets.slice(200).every((x) => x.status === "ok"), true);

  const offline = (() => Promise.reject(new TypeError("network is off"))) as typeof fetch;
  const down = await R.sendExpoPush(msgs(3), { fetch: offline, timeoutMs: 1000 });
  assertEquals(down.tickets.map((x) => x.status), ["error", "error", "error"]);
  assertEquals(down.dead, []);

  const garbage = (() => Promise.resolve(new Response("<html>", { status: 200 }))) as typeof fetch;
  assertEquals((await R.sendExpoPush(msgs(2), { fetch: garbage, timeoutMs: 1000 })).tickets.map((x) => x.status), ["error", "error"]);
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

// --- the hourly cron's targets ---------------------------------------------------------------

const person = (id: string, role: "cook" | "learner", tz: string | null, extra: Partial<R.CronPerson & { name: string }> = {}): R.CronPerson & { name: string } => ({
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
  const ids = (d: { nudge: { id: string }[]; recap: { id: string }[] }) => ({ nudge: d.nudge.map((p) => p.id), recap: d.recap.map((p) => p.id) });
  // Cron runs at minute 5 UTC; Sunday 17:05 PDT.
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T17:05:00-07:00"))), { nudge: ["kid-la", "kid-none", "kid-bad"], recap: [] });
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T18:05:00-07:00"))), { nudge: [], recap: [] });
  // Half-hour zone: 12:05 UTC is 17:35 IST, still the 17:00 hour.
  assertEquals(ids(R.dueProfiles(people, at("2026-10-18T12:05:00Z"))).nudge, ["kid-in"]);
  // The 1st at 10:05 local, after LA fell back.
  assertEquals(ids(R.dueProfiles(people, at("2026-11-01T10:05:00-08:00"))), { nudge: [], recap: ["kid-la", "cook-la", "kid-none", "kid-bad"] });
  assertEquals(ids(R.dueProfiles(people, at("2026-11-01T04:35:00Z"))).recap, ["kid-in"]); // 10:05 IST
});

