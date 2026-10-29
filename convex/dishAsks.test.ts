/// <reference types="vite/client" />
// The dish ask (docs/build/DISH-ASK-SPEC.md), every route through the HTTP router: the kid's card, asking Mom, her
// voice answers and her version, the uploads, the limits and the daily budget, CORS, and what's deleted. The models
// run in fake mode (DISH_FAKE_AI=1, convex/dishAskModel.ts); `model` below can make one fail or answer otherwise.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { askTokenFor, sha256Hex } from "./lib/dishAskRoutes";
import { type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

type Model = typeof import("./dishAskModel");
const model = vi.hoisted(() => ({
  calls: { guess: 0, version: 0, transcribe: 0, toEnglish: 0, forMom: 0 },
  /** Replaces writeGuess / writeVersion / translateForMom for a test: gets the real one, returns what the route sees. */
  guess: null as null | ((real: () => Promise<unknown>) => Promise<unknown>),
  version: null as null | ((real: () => Promise<unknown>) => Promise<unknown>),
  forMom: null as null | ((real: () => Promise<unknown>) => Promise<unknown>),
}));
vi.mock("./dishAskModel", async (importOriginal) => {
  const m = await importOriginal<Model>();
  return {
    ...m,
    writeGuess: async (...a: Parameters<Model["writeGuess"]>) => {
      model.calls.guess++;
      return model.guess ? model.guess(() => m.writeGuess(...a)) : m.writeGuess(...a);
    },
    writeVersion: async (...a: Parameters<Model["writeVersion"]>) => {
      model.calls.version++;
      return model.version ? model.version(() => m.writeVersion(...a)) : m.writeVersion(...a);
    },
    transcribe: async (...a: Parameters<Model["transcribe"]>) => {
      model.calls.transcribe++;
      return m.transcribe(...a);
    },
    toEnglish: async (...a: Parameters<Model["toEnglish"]>) => {
      model.calls.toEnglish++;
      return m.toEnglish(...a);
    },
    translateForMom: async (...a: Parameters<Model["translateForMom"]>) => {
      model.calls.forMom++;
      return model.forMom ? model.forMom(() => m.translateForMom(...a)) : m.translateForMom(...a);
    },
  };
});
const { DishModelError, FAKE_COST, FAKE_WORDS } = await import("./dishAskModel");

const START = new Date("2026-10-29T12:00:00Z");
const MIN = 60_000;
const IP = "203.0.113.7";
const ORIGIN = "https://homecookd.app";
const TOKEN22 = /^[0-9A-Za-z]{22}$/;
const MOM_ASKED = [{ id: "q1", text: "How much ketchup do you squeeze in?" }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  process.env.DISH_FAKE_AI = "1";
  process.env.DISH_IP_SALT = "test-salt-for-the-dish-limits";
  model.calls = { guess: 0, version: 0, transcribe: 0, toEnglish: 0, forMom: 0 };
  model.guess = null;
  model.version = null;
  model.forMom = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DISH_FAKE_AI;
  delete process.env.DISH_IP_SALT;
  delete process.env.REPORT_ALERT_URL;
});

// ---------------------------------------------------------------------------------------------
// Helpers

type Reply = { status: number; data: any; headers: Headers };
type Opts = { ip?: string; origin?: string | null; headers?: Record<string, string> };

async function call(t: Backend, path: string, init: RequestInit, o: Opts = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "X-Forwarded-For": o.ip ?? IP,
    ...(o.origin === null ? {} : { Origin: o.origin ?? ORIGIN }),
    ...((init.headers as Record<string, string>) ?? {}),
    ...o.headers,
  };
  const res = await t.fetch(path, { ...init, headers });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

const post = (t: Backend, path: string, body: unknown = {}, o: Opts = {}) =>
  call(t, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }, o);

const upload = (t: Backend, kind: string, type: string, bytes: number, o: Opts = {}) =>
  call(t, `/dish/files?kind=${kind}`, { method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(bytes).fill(7) }, o);

async function fileId(t: Backend, kind: "photo" | "voice", o: Opts = {}): Promise<string> {
  const r = await upload(t, kind, kind === "photo" ? "image/jpeg" : "audio/webm;codecs=opus", 2000, o);
  expect(r.status).toBe(201);
  return r.data.fileId;
}

type AnswerOpts = { bytes?: number; type?: string; lang?: string; durationS?: number | string; token?: string | null; ip?: string };

function answer(t: Backend, askToken: string, q: string, o: AnswerOpts = {}) {
  const params = new URLSearchParams({ q, durationS: String(o.durationS ?? 4.2), ...(o.lang ? { lang: o.lang } : {}) });
  const headers: Record<string, string> = {
    "Content-Type": o.type ?? "audio/mp4",
    ...(o.token === null ? {} : { "X-Dish-Token": o.token ?? askToken }),
  };
  // 400 bytes: the fake Ink hears FAKE_WORDS; under 100 it hears nothing.
  return call(t, `/dish/ask/answer?${params}`, { method: "POST", headers, body: new Uint8Array(o.bytes ?? 400).fill(1) }, { ip: o.ip });
}

async function makeCard(t: Backend, body: Record<string, unknown> = { dish: "tomato egg", kidName: "Caleb" }, ip = IP) {
  const r = await post(t, "/dish/cards", body, { ip });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  const { kidToken, card } = r.data;
  const askToken = new URL(card.askUrl).searchParams.get("t")!;
  return { kidToken: kidToken as string, askToken, card };
}

const getCard = async (t: Backend, kidToken: string) => (await post(t, "/dish/cards/get", { kidToken })).data.card;
const peek = async (t: Backend, askToken: string, lang?: unknown) => (await post(t, "/dish/ask/peek", { askToken, lang })).data.ask;
const askMom = (t: Backend, kidToken: string, questions: unknown, o: Opts = {}) => post(t, "/dish/cards/ask", { kidToken, questions }, o);
const finish = (t: Backend, askToken: string) => post(t, "/dish/ask/finish", { askToken });
const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function rowOf(t: Backend, kidToken: string) {
  const hash = await sha256Hex(kidToken);
  return (await t.run((ctx) => ctx.db.query("dishAsks").withIndex("by_kid_token", (q) => q.eq("kidTokenHash", hash)).unique()))!;
}
const answersOf = (t: Backend, askId: Id<"dishAsks">) =>
  t.run((ctx) => ctx.db.query("dishAnswers").withIndex("by_ask_question", (q) => q.eq("askId", askId)).collect());
const storageIds = (t: Backend) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).map((f) => f._id));
const fileGone = (t: Backend, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) === null);
const spent = (t: Backend, day = "2026-10-29") =>
  t.run(async (ctx) => (await ctx.db.query("dishSpend").withIndex("by_day", (q) => q.eq("day", day)).unique())?.usd ?? 0);
/** Sets today's total (on top of nothing: a card made earlier in the test spent a little already). */
const seedSpend = (t: Backend, usd: number) =>
  t.run(async (ctx) => {
    const row = await ctx.db.query("dishSpend").withIndex("by_day", (q) => q.eq("day", "2026-10-29")).unique();
    if (row) await ctx.db.patch("dishSpend", row._id, { usd });
    else await ctx.db.insert("dishSpend", { day: "2026-10-29", usd });
  });
/** A time within a second of `ms` (each call moves the test clock on a millisecond or so). */
const near = (ms: number) => expect.closeTo(ms, -3);
/** Runs what's scheduled to start now (not the retries 3 minutes on), to the end. */
async function runNow(t: Backend) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

/** A card with q1 asked of Mom (and sent). */
async function askedCard(t: Backend, ip = IP) {
  const c = await makeCard(t, { dish: "tomato egg", kidName: "Caleb" }, ip);
  expect((await askMom(t, c.kidToken, MOM_ASKED, { ip })).status).toBe(200);
  expect((await post(t, "/dish/cards/sent", { kidToken: c.kidToken, via: "sms" }, { ip })).status).toBe(200);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The kid's card

test("a card: two 22-character tokens, only their hashes stored, tonight's guess and the Ask Mom message", async () => {
  const t = newBackend();
  const r = await post(t, "/dish/cards", { dish: "  tomato egg ", kidName: "Caleb" });
  expect(r.status).toBe(201);
  expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  const { kidToken, card } = r.data;
  expect(kidToken).toMatch(TOKEN22);
  const askToken = new URL(card.askUrl).searchParams.get("t")!;
  expect(card.askUrl).toBe(`https://homecookd.app/a?t=${askToken}`);
  expect(askToken).toBe(await askTokenFor(kidToken));
  expect(askToken).toMatch(TOKEN22);
  expect(card).toMatchObject({
    dish: "tomato egg",
    relation: "mom",
    kidName: "Caleb",
    status: "draft",
    version: null,
    answers: [],
    merging: false,
    asked: [],
    message: "Mom, how do you make your tomato egg? I'm trying to make it here.",
    kidVoiceUrl: null,
    photoUrls: [],
    askedAt: null,
    openedAt: null,
    finishedAt: null,
    createdAt: near(START.getTime()),
  });
  expect(card.guess.servings).toBe("1");
  expect(card.guess.questions.map((q: { id: string }) => q.id)).toEqual(["q1", "q2", "q3"]);
  const ketchup = card.guess.ingredients.find((i: { name: string }) => i.name === "ketchup");
  expect(ketchup).toMatchObject({ amount: "", status: "unknown", isGuess: true, ask: "q1", clip: null, was: null, quote: null });
  expect(card.guess.steps[0].lines[0]).toMatchObject({ status: "guessed", isGuess: true, was: null, quote: null });

  const row = await rowOf(t, kidToken);
  expect(row.kidTokenHash).toBe(await sha256Hex(kidToken));
  expect(row.askTokenHash).toBe(await sha256Hex(askToken));
  const stored = JSON.stringify(await t.run((ctx) => ctx.db.query("dishAsks").collect()));
  for (const secret of [kidToken, askToken, IP]) expect(stored).not.toContain(secret);
  expect(row.ipKey).toMatch(/^[0-9a-f]{64}$/);
  expect(await spent(t)).toBeCloseTo(FAKE_COST.guess);
});

test("cards: bad input, filtered words and words that aren't a dish are refused, and nothing is stored", async () => {
  const t = newBackend();
  const card = (body: unknown, ip: string) => post(t, "/dish/cards", body, { ip });
  const cases: [unknown, number, string][] = [
    [{ dish: "x" }, 400, "bad_request"],
    [{}, 400, "bad_request"],
    [{ dish: "dal", relation: "cousin" }, 400, "bad_request"],
    [{ dish: "dal", kidName: "x".repeat(41) }, 400, "bad_request"],
    [{ dish: "x".repeat(201) }, 400, "bad_request"],
    [{ dish: "dal", photos: ["a", "b", "c", "d"] }, 400, "bad_request"],
    [{ dish: "dal", photos: "nope" }, 400, "bad_request"],
    [{ dish: "dal", voiceNote: "not-a-file-id" }, 400, "bad_request"],
    ["not json", 400, "bad_request"],
    ["[1,2]", 400, "bad_request"],
    [{ dish: "fuck this dal" }, 422, "words"],
    [{ dish: "dal", kidName: "slut" }, 422, "words"],
    [{ dish: "asdf qwerty" }, 422, "not_a_dish"],
  ];
  for (const [i, [body, status, code]] of cases.entries()) {
    const r = await card(body, `198.51.100.${i}`);
    expect([r.status, r.data.code], JSON.stringify(body)).toEqual([status, code]);
    expect(typeof r.data.error).toBe("string");
  }
  expect((await card({ dish: "x".repeat(70_000) }, "198.51.100.99")).status).toBe(413);
  expect(await t.run((ctx) => ctx.db.query("dishAsks").collect())).toEqual([]);
  // Only the not-a-dish one reached the model.
  expect(model.calls.guess).toBe(1);
});

test("cards: a filtered word in the guess is refused; a model failure is 502 and a missing key 503", async () => {
  const t = newBackend();
  model.guess = async (real) => {
    const r = (await real()) as { notADish: false; recipe: { ingredients: { name: string }[] } };
    r.recipe.ingredients[0].name = "whore eggs";
    return r;
  };
  expect(await post(t, "/dish/cards", { dish: "tomato egg" })).toMatchObject({ status: 422, data: { code: "words" } });
  model.guess = async () => {
    throw new DishModelError("model", "Claude 500");
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await post(t, "/dish/cards", { dish: "tomato egg" })).toMatchObject({ status: 502, data: { code: "model" } });
  model.guess = async () => {
    throw new DishModelError("not_set_up", "ANTHROPIC_API_KEY isn't set");
  };
  expect(await post(t, "/dish/cards", { dish: "tomato egg" })).toMatchObject({ status: 503, data: { code: "not_set_up" } });
  expect(await t.run((ctx) => ctx.db.query("dishAsks").collect())).toEqual([]);
});

test("cards: 6 per IP in 10 minutes and 30 a day; the keys hold an HMAC of the IP, never the IP", async () => {
  const t = newBackend();
  for (let i = 0; i < 6; i++) await makeCard(t);
  const over = await post(t, "/dish/cards", { dish: "tomato egg" });
  expect(over).toMatchObject({ status: 429, data: { code: "rate" } });
  await makeCard(t, { dish: "dal" }, "192.0.2.50"); // another IP
  for (let w = 1; w < 5; w++) {
    vi.advanceTimersByTime(10 * MIN);
    for (let i = 0; i < 6; i++) await makeCard(t);
  }
  vi.advanceTimersByTime(10 * MIN); // a new 10 minutes, but 30 today
  expect(await post(t, "/dish/cards", { dish: "tomato egg" })).toMatchObject({ status: 429, data: { code: "rate" } });
  const keys = await t.run(async (ctx) => (await ctx.db.query("rateHits").collect()).map((r) => r.key));
  expect(keys.some((k) => k.startsWith("dish-cards-day:"))).toBe(true);
  for (const k of keys) {
    expect(k).not.toContain(IP);
    expect(k).toMatch(/^dish-[a-z-]+:[0-9a-f]{64}$/);
  }
});

test("cards from photos and a voice note: the photos stay on the card, the voice note is heard and dropped", async () => {
  const t = newBackend();
  const photos = [await fileId(t, "photo"), await fileId(t, "photo")];
  const voice = await fileId(t, "voice");
  const { card, kidToken } = await makeCard(t, { dish: "", photos, voiceNote: voice });
  expect(card.dish).toBe("tomato egg"); // nothing typed: the guess names it
  expect(card.photoUrls).toHaveLength(2);
  expect(model.calls.transcribe).toBe(1);
  const row = await rowOf(t, kidToken);
  const files = await t.run((ctx) => ctx.db.query("dishFiles").collect());
  expect(files.map((f) => [f.kind, f.askId])).toEqual([
    ["photo", row._id],
    ["photo", row._id],
  ]);
  expect(await spent(t)).toBeCloseTo(FAKE_COST.guess + FAKE_COST.transcribe);

  // A file goes on one card only; an unknown one is a 404; the wrong kind is a 400.
  expect(await post(t, "/dish/cards", { dish: "dal", photos: [photos[0]] })).toMatchObject({ status: 404, data: { code: "not_found" } });
  expect(await post(t, "/dish/cards", { dish: "dal", photos: ["A".repeat(22)] })).toMatchObject({ status: 404 });
  const another = await fileId(t, "voice");
  expect(await post(t, "/dish/cards", { dish: "dal", photos: [another] })).toMatchObject({ status: 400, data: { code: "bad_request" } });
  expect(await post(t, "/dish/cards", { dish: "dal", photos: [another, another] })).toMatchObject({ status: 400 });
});

// ---------------------------------------------------------------------------------------------
// Uploads

test("files: photos and voice notes by type and size, checked before anything is stored; 30 per IP in 10 minutes", async () => {
  const t = newBackend();
  const photo = await upload(t, "photo", "image/jpeg", 1000);
  expect(photo.status).toBe(201);
  expect(photo.data).toEqual({ fileId: expect.stringMatching(TOKEN22), kind: "photo", contentType: "image/jpeg", size: 1000 });
  const voice = await upload(t, "voice", "audio/webm;codecs=opus", 500);
  expect(voice.data).toMatchObject({ kind: "voice", contentType: "audio/webm", size: 500 });
  for (const type of ["audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"]) {
    expect((await upload(t, "voice", type, 10, { ip: "192.0.2.1" })).status).toBe(201);
  }
  const stored = (await storageIds(t)).length;
  expect(stored).toBe(9);
  const fileRow = await t.run((ctx) => ctx.db.query("dishFiles").first());
  expect(JSON.stringify(fileRow)).not.toContain(photo.data.fileId); // only its hash

  const refused: [string, string, number, number, string][] = [
    ["photo", "image/gif", 100, 415, "bad_type"],
    ["photo", "audio/webm", 100, 415, "bad_type"],
    ["voice", "image/jpeg", 100, 415, "bad_type"],
    ["voice", "video/mp4", 100, 415, "bad_type"],
    ["photo", "image/png", 5 * 1024 * 1024 + 1, 413, "too_large"],
    ["voice", "audio/mp4", 3 * 1024 * 1024 + 1, 413, "too_large"],
    ["photo", "image/png", 0, 400, "bad_request"],
    ["video", "video/mp4", 100, 400, "bad_request"],
  ];
  for (const [kind, type, bytes, status, code] of refused) {
    const r = await upload(t, kind, type, bytes, { ip: "192.0.2.2" });
    expect([r.status, r.data.code], `${kind} ${type} ${bytes}`).toEqual([status, code]);
  }
  expect((await storageIds(t)).length).toBe(stored);

  for (let i = 0; i < 28; i++) expect((await upload(t, "photo", "image/webp", 10)).status).toBe(201);
  expect(await upload(t, "photo", "image/webp", 10)).toMatchObject({ status: 429, data: { code: "rate" } });
});

test("an upload no card took is deleted after an hour; one on a card stays", async () => {
  const t = newBackend();
  const kept = await fileId(t, "photo");
  const orphan = await fileId(t, "photo");
  await makeCard(t, { dish: "dal", photos: [kept] });
  const before = await t.run((ctx) => ctx.db.query("dishFiles").collect());
  const orphanStorage = before.find((f) => !f.askId)!.storageId;
  vi.advanceTimersByTime(59 * MIN);
  await t.mutation(internal.dishAsks.dropOrphanFiles, {});
  expect(await t.run((ctx) => ctx.db.query("dishFiles").collect())).toHaveLength(2);
  vi.advanceTimersByTime(2 * MIN);
  await t.mutation(internal.dishAsks.dropOrphanFiles, {});
  const after = await t.run((ctx) => ctx.db.query("dishFiles").collect());
  expect(after.map((f) => f.kind)).toEqual(["photo"]);
  expect(after[0].askId).toBeDefined();
  expect(await fileGone(t, orphanStorage)).toBe(true);
  expect(await post(t, "/dish/cards", { dish: "dal", photos: [orphan] })).toMatchObject({ status: 404 });
});

// ---------------------------------------------------------------------------------------------
// get, update, sent

test("cards/get, update and sent: the same card back; who, name, message and the voice note to Mom change", async () => {
  const t = newBackend();
  const { kidToken, card } = await makeCard(t);
  expect(await getCard(t, kidToken)).toEqual(card);
  const update = (body: Record<string, unknown>) => post(t, "/dish/cards/update", { kidToken, ...body });

  // The untouched message follows who they're asking; an edited one stays.
  let r = await update({ relation: "grandma", kidName: "Cal" });
  expect(r.data.card).toMatchObject({ relation: "grandma", kidName: "Cal", message: "Grandma, how do you make your tomato egg? I'm trying to make it here." });
  r = await update({ message: "  Nani, how do you make it?  " });
  expect(r.data.card.message).toBe("Nani, how do you make it?");
  expect((await update({ relation: "dad" })).data.card.message).toBe("Nani, how do you make it?");
  expect((await update({ kidName: null })).data.card.kidName).toBeNull();

  expect(await update({ message: "   " })).toMatchObject({ status: 400, data: { code: "bad_request" } });
  expect(await update({ message: "x".repeat(501) })).toMatchObject({ status: 400 });
  expect(await update({ message: 5 })).toMatchObject({ status: 400 });
  expect(await update({ message: "fuck it, just tell me" })).toMatchObject({ status: 422, data: { code: "words" } });
  expect(await update({ kidName: "cunt" })).toMatchObject({ status: 422, data: { code: "words" } });
  expect(await update({ relation: "boss" })).toMatchObject({ status: 400 });

  // The voice note to Mom: a new one replaces (and deletes) the old; null removes it.
  const first = await fileId(t, "voice");
  r = await update({ voiceNote: first });
  expect(r.data.card.kidVoiceUrl).toEqual(expect.any(String));
  const firstStorage = (await rowOf(t, kidToken)).kidVoiceNote!;
  const second = await fileId(t, "voice");
  await update({ voiceNote: second });
  expect(await fileGone(t, firstStorage)).toBe(true);
  const secondStorage = (await rowOf(t, kidToken)).kidVoiceNote!;
  expect(secondStorage).not.toBe(firstStorage);
  expect(await update({ voiceNote: first })).toMatchObject({ status: 404 }); // gone with its card spot
  expect(await update({ voiceNote: await fileId(t, "photo") })).toMatchObject({ status: 400 });
  r = await update({ voiceNote: null });
  expect(r.data.card.kidVoiceUrl).toBeNull();
  expect(await fileGone(t, secondStorage)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("dishFiles").collect())).toHaveLength(1); // only the unused photo

  // Sent: the first one marks it asked.
  r = await post(t, "/dish/cards/sent", { kidToken, via: "whatsapp" });
  expect(r.data.card).toMatchObject({ status: "asked", askedAt: near(START.getTime()) });
  const askedAt = r.data.card.askedAt;
  vi.advanceTimersByTime(MIN);
  r = await post(t, "/dish/cards/sent", { kidToken, via: "copy" });
  expect(r.data.card.askedAt).toBe(askedAt);
  expect((await rowOf(t, kidToken)).askedVia).toBe("whatsapp");
  expect(await post(t, "/dish/cards/sent", { kidToken, via: "fax" })).toMatchObject({ status: 400 });
});

test("once Mom sent her answers, the message and the voice note to her are closed (409); who and name aren't", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle(t);
  const update = (body: Record<string, unknown>) => post(t, "/dish/cards/update", { kidToken, ...body });
  expect(await update({ message: "Mom?" })).toMatchObject({ status: 409, data: { code: "closed", error: "Mom already sent her answers." } });
  expect(await update({ voiceNote: null })).toMatchObject({ status: 409 });
  expect((await update({ kidName: "Cal" })).status).toBe(200);
});

// ---------------------------------------------------------------------------------------------
// Tokens, CORS

test("unknown and malformed tokens are 404, and after 20 in 10 minutes the IP gets 429; good tokens still work", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await makeCard(t);
  const bad = "Z".repeat(22);
  expect(await post(t, "/dish/cards/get", { kidToken: bad })).toMatchObject({
    status: 404,
    data: { code: "not_found", error: "This link doesn't work anymore." },
  });
  expect(await post(t, "/dish/cards/get", {})).toMatchObject({ status: 400 }); // missing: not counted
  expect(await post(t, "/dish/ask/peek", { askToken: "short" })).toMatchObject({ status: 404 });
  expect(await post(t, "/dish/cards/get", { kidToken: askToken })).toMatchObject({ status: 404 }); // the ask token reads no card
  expect(await post(t, "/dish/ask/peek", { askToken: kidToken })).toMatchObject({ status: 404 }); // and the kid token isn't Mom's
  expect(await answer(t, askToken, "q1", { token: bad })).toMatchObject({ status: 404 });
  for (let i = 5; i < 20; i++) expect((await post(t, "/dish/ask/finish", { askToken: bad })).status).toBe(404);
  expect(await post(t, "/dish/cards/update", { kidToken: bad })).toMatchObject({ status: 429, data: { code: "rate" } });
  expect((await post(t, "/dish/cards/get", { kidToken })).status).toBe(200);
  expect((await post(t, "/dish/ask/peek", { askToken })).status).toBe(200);
  expect((await post(t, "/dish/cards/get", { kidToken: bad }, { ip: "192.0.2.77" })).status).toBe(404);
  vi.advanceTimersByTime(10 * MIN);
  expect((await post(t, "/dish/cards/get", { kidToken: bad })).status).toBe(404);
});

test("CORS: homecookd.app and local dev pages get their origin back, other sites 403, and the preflight allows X-Dish-Token", async () => {
  const t = newBackend();
  const pre = (origin: string) => t.fetch("/dish/ask/answer", { method: "OPTIONS", headers: { Origin: origin } });
  const ok = await pre("https://www.homecookd.app");
  expect(ok.status).toBe(204);
  expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://www.homecookd.app");
  expect(ok.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, X-Dish-Token");
  expect(ok.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  expect((await pre("https://evil.example")).status).toBe(403);
  expect((await pre("https://homecookd.app.evil.example")).status).toBe(403);

  const evil = await post(t, "/dish/cards", { dish: "dal" }, { origin: "https://evil.example" });
  expect(evil).toMatchObject({ status: 403, data: { code: "origin" } });
  expect(model.calls.guess).toBe(0);
  const local = await post(t, "/dish/cards/get", { kidToken: "Z".repeat(22) }, { origin: "http://localhost:3105" });
  expect([local.status, local.headers.get("Access-Control-Allow-Origin")]).toEqual([404, "http://localhost:3105"]);
  expect((await post(t, "/dish/cards", { dish: "dal" }, { origin: null })).status).toBe(201); // no Origin: allowed
  expect(await post(t, "/dish/nope", {})).toMatchObject({ status: 404, data: { code: "not_found" } });
});

// ---------------------------------------------------------------------------------------------
// Asking Mom

test("cards/ask: her answered questions stay first and are left out when asked again; at most 3 open and 6 in all", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await makeCard(t);
  let r = await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup, really?" }, { text: "Do you salt the eggs?" }]);
  expect(r.data.card.asked).toEqual([
    { id: "q1", text: "How much ketchup, really?" },
    { id: "q4", text: "Do you salt the eggs?" },
  ]);
  expect((await answer(t, askToken, "q1")).status).toBe(200);
  expect((await answer(t, askToken, "q4")).status).toBe(200);
  r = await askMom(t, kidToken, [
    { id: "q1", text: "How much ketchup again?" },
    { id: "q2", text: "How do you know the eggs are ready?" },
  ]);
  expect(r.data.card.asked).toEqual([
    { id: "q1", text: "How much ketchup, really?" },
    { id: "q4", text: "Do you salt the eggs?" },
    { id: "q2", text: "How do you know the eggs are ready?" },
  ]);
  expect((await peek(t, askToken)).questions.map((q: { id: string }) => q.id)).toEqual(["q2"]);
  expect(await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup again?" }])).toMatchObject({
    status: 409,
    data: { code: "closed", error: "That was already answered." },
  });
  const bad: [unknown, string][] = [
    [[], "questions must be a list of 1 to 3 questions"],
    ["q1", "questions must be a list of 1 to 3 questions"],
    [[{ text: "One?" }, { text: "Two?" }, { text: "Three?" }, { text: "Four?" }], "At most 3 questions at a time"],
    [[{ id: "q1", text: "How much?" }, { id: "q1", text: "How much, again?" }], "The same question is in the list twice"],
    [[{ id: "q4", text: "Mine?" }], "questions[0].id must be q1, q2 or q3, or left out for the kid's own question"],
    [[{ text: "Hm" }], "questions[0].text must be 3 to 120 characters"],
    [[{ text: "x".repeat(121) }], "questions[0].text must be 3 to 120 characters"],
    [[{ text: 5 }], "questions[0].text must be a string"],
  ];
  for (const [questions, error] of bad) expect(await askMom(t, kidToken, questions)).toMatchObject({ status: 400, data: { code: "bad_request", error } });
  expect(await askMom(t, kidToken, [{ text: "Why the fuck is it red?" }])).toMatchObject({ status: 422, data: { code: "words" } });

  r = await askMom(t, kidToken, [{ id: "q2", text: "How do you know they're ready?" }, { id: "q3", text: "What goes on top?" }, { text: "Can I use canned tomatoes?" }]);
  expect(r.data.card.asked.map((q: { id: string }) => q.id)).toEqual(["q1", "q4", "q2", "q3", "q5"]);
  await answer(t, askToken, "q2");
  await answer(t, askToken, "q3");
  const three = [{ text: "One?" }, { text: "Two?" }, { text: "Three?" }];
  expect((await askMom(t, kidToken, three)).data.error).toBe("At most 6 questions in all");
  r = await askMom(t, kidToken, three.slice(0, 2));
  expect(r.data.card.asked.map((q: { id: string }) => q.id)).toEqual(["q1", "q4", "q2", "q3", "q5", "q6"]);
  // A line break in a question becomes a space.
  r = await askMom(t, kidToken, [{ text: "How long\ndo you fry?" }]);
  expect(r.data.card.asked.at(-1)).toEqual({ id: "q5", text: "How long do you fry?" });

  // The kid's own questions run out at q6.
  const own = await makeCard(t, { dish: "dal" }, "192.0.2.9");
  await askMom(t, own.kidToken, [{ text: "One?" }, { text: "Two?" }, { text: "Three?" }], { ip: "192.0.2.9" });
  for (const q of ["q4", "q5", "q6"]) await answer(t, own.askToken, q, { ip: "192.0.2.9" });
  expect((await askMom(t, own.kidToken, [{ text: "Four?" }], { ip: "192.0.2.9" })).data.error).toBe("At most 3 questions of your own");
});

test("cards/ask: a text/plain body works (the share tap's keepalive save); 30 per IP in 10 minutes", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await makeCard(t);
  const questions = [{ id: "q2", text: "How do you know the eggs are ready?" }];
  const r = await call(t, "/dish/cards/ask", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ kidToken, questions }) });
  expect(r.data.card.asked).toEqual(questions);
  expect((await peek(t, askToken)).questions).toEqual(questions);
  for (let i = 1; i < 30; i++) expect((await askMom(t, kidToken, questions)).status).toBe(200);
  expect(await askMom(t, kidToken, questions)).toMatchObject({ status: 429, data: { code: "rate" } });
});

// ---------------------------------------------------------------------------------------------
// Mom

test("ask/peek: the dish, the kid's guess and message, the asked questions; never the kid token; opened once", async () => {
  const t = newBackend();
  const photo = await fileId(t, "photo");
  const { kidToken, askToken } = await makeCard(t, { dish: "tomato egg", kidName: "Caleb", photos: [photo] });
  await askMom(t, kidToken, MOM_ASKED);
  const voice = await fileId(t, "voice");
  await post(t, "/dish/cards/update", { kidToken, voiceNote: voice });
  const r = await post(t, "/dish/ask/peek", { askToken });
  expect(r.status).toBe(200);
  const ask = r.data.ask;
  expect(ask).toMatchObject({
    dish: "tomato egg",
    relation: "mom",
    kidName: "Caleb",
    message: "Mom, how do you make your tomato egg? I'm trying to make it here.",
    kidVoiceUrl: expect.any(String),
    inLang: null,
    photoUrls: [expect.any(String)],
    questions: MOM_ASKED,
    answered: [],
    clips: [],
    finished: false,
    version: null,
    merging: false,
  });
  expect(ask.guess.ingredients[2]).toMatchObject({ name: "ketchup", isGuess: true });
  expect(JSON.stringify(r.data)).not.toContain(kidToken);
  const openedAt = (await getCard(t, kidToken)).openedAt;
  expect(openedAt).toEqual(near(START.getTime()));
  vi.advanceTimersByTime(5 * MIN);
  await peek(t, askToken);
  expect((await getCard(t, kidToken)).openedAt).toBe(openedAt);
});

test("Mom's page in her language: translated once and cached, again when the message or questions change", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const before = await spent(t);
  const hi = await peek(t, askToken, "hi");
  expect(hi.inLang).toMatchObject({
    lang: "hi",
    questions: [{ id: "q1", text: `[hi] ${MOM_ASKED[0].text}` }],
    message: "[hi] Mom, how do you make your tomato egg? I'm trying to make it here.",
  });
  expect(hi.inLang.guess.dish).toBe("[hi] tomato egg");
  // Ids, statuses and links stay; an empty amount stays empty.
  expect(hi.inLang.guess.ingredients[2]).toMatchObject({ name: "[hi] ketchup", amount: "", status: "unknown", isGuess: true, ask: "q1" });
  expect(hi.inLang.guess.steps[0].lines[0].text).toBe("[hi] Beat the eggs with **a pinch** of salt");
  expect(hi.guess.dish).toBe("tomato egg"); // the English stays alongside
  expect(hi.message).toBe("Mom, how do you make your tomato egg? I'm trying to make it here.");
  expect(model.calls.forMom).toBe(1);
  expect(await spent(t)).toBeCloseTo(before + FAKE_COST.forMom);

  expect((await peek(t, askToken, "hi")).inLang).toEqual(hi.inLang); // cached: no call, no spend
  expect(model.calls.forMom).toBe(1);
  expect(await spent(t)).toBeCloseTo(before + FAKE_COST.forMom);
  // The kid's card stays in English.
  expect((await getCard(t, kidToken)).guess.dish).toBe("tomato egg");

  await post(t, "/dish/cards/update", { kidToken, message: "Mom, I need your tomato egg" });
  expect((await peek(t, askToken, "hi")).inLang.message).toBe("[hi] Mom, I need your tomato egg");
  expect(model.calls.forMom).toBe(2);
  await askMom(t, kidToken, [{ id: "q2", text: "How do you know the eggs are done?" }]);
  const asked = await peek(t, askToken, "hi");
  expect(asked.inLang.questions).toEqual([{ id: "q2", text: "[hi] How do you know the eggs are done?" }]);
  expect(model.calls.forMom).toBe(3);

  // Another language has its own entry; the first stays cached.
  expect((await peek(t, askToken, "mr")).inLang.lang).toBe("mr");
  expect((await peek(t, askToken, "hi")).inLang.lang).toBe("hi");
  expect(model.calls.forMom).toBe(4);
  expect((await rowOf(t, kidToken)).momLang?.map((m) => m.lang)).toEqual(["hi", "mr"]);

  // English, an unknown code or no lang: no translation. A lang that isn't a string is a 400.
  for (const lang of ["en", "xx", undefined, null]) expect((await peek(t, askToken, lang)).inLang).toBeNull();
  expect(await post(t, "/dish/ask/peek", { askToken, lang: 5 })).toMatchObject({ status: 400, data: { code: "bad_request" } });
  expect(model.calls.forMom).toBe(4);

  // Her answer (in its language) and Send (with lang) give the cached translation back; they never translate.
  expect((await answer(t, askToken, "q2", { lang: "hi" })).data.ask.inLang.lang).toBe("hi");
  expect((await post(t, "/dish/ask/finish", { askToken, lang: "mr" })).data.ask.inLang.lang).toBe("mr");
  expect(model.calls.forMom).toBe(4);
});

test("Mom's page stays in English past $11, when the translation fails, and when it has a filtered word", async () => {
  const t = newBackend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { askToken } = await askedCard(t);
  await seedSpend(t, 11);
  expect((await peek(t, askToken, "hi")).inLang).toBeNull();
  expect(model.calls.forMom).toBe(0);
  await seedSpend(t, 10.5); // over the budget for cards, still under Mom's overage
  model.forMom = async () => null;
  expect((await peek(t, askToken, "hi")).inLang).toBeNull();
  model.forMom = async (real) => {
    const r = (await real()) as { message: string };
    r.message = "fuck";
    return r;
  };
  expect((await peek(t, askToken, "hi")).inLang).toBeNull();
  model.forMom = null;
  expect((await peek(t, askToken, "hi")).inLang?.lang).toBe("hi");
  expect(model.calls.forMom).toBe(3);
  expect(await spent(t)).toBeCloseTo(10.5 + 2 * FAKE_COST.forMom); // the null one cost nothing
});

test("a failing translation is tried at most 3 times an hour per card and language, however often her page polls", async () => {
  const t = newBackend();
  const { askToken } = await askedCard(t);
  model.forMom = async () => null;
  for (let i = 0; i < 6; i++) expect((await peek(t, askToken, "hi")).inLang).toBeNull();
  expect(model.calls.forMom).toBe(3);
  model.forMom = null;
  expect((await peek(t, askToken, "mr")).inLang?.lang, "another language has its own tries").toBe("mr");
  vi.setSystemTime(Date.now() + 61 * MIN);
  expect((await peek(t, askToken, "hi")).inLang?.lang, "an hour later it's tried again").toBe("hi");
  expect(model.calls.forMom).toBe(5);
});

test("ask/answer: only an asked question, her audio checked before it's stored; a re-record replaces the old clip", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const askId = (await rowOf(t, kidToken))._id;
  const files = (await storageIds(t)).length;
  const refused: [AnswerOpts & { q?: string }, number, string][] = [
    [{ q: "q5" }, 400, "That question wasn't asked."],
    [{ q: "q9" }, 400, "q must be one of q1 to q6"],
    [{ token: null }, 400, "The X-Dish-Token header is required"],
    [{ type: "video/mp4" }, 415, "That recording type isn't supported."],
    [{ type: "text/plain" }, 415, "That recording type isn't supported."],
    [{ bytes: 5 * 1024 * 1024 + 1 }, 413, "That answer is too long."],
    [{ bytes: 0 }, 400, "The recording is empty."],
    [{ durationS: 0 }, 400, "durationS must be more than 0 and at most 120"],
    [{ durationS: 126 }, 400, "durationS must be more than 0 and at most 120"],
    [{ durationS: "abc" }, 400, "durationS must be more than 0 and at most 120"],
    [{ lang: "xx" }, 400, "lang must be one of en hi mr gu ta te pa ur bn zh ko es tl ar pt vi"],
  ];
  for (const [o, status, error] of refused) {
    const r = await answer(t, askToken, o.q ?? "q1", { ...o, ip: "192.0.2.3" });
    expect([r.status, r.data.error], JSON.stringify(o)).toEqual([status, error]);
  }
  expect((await storageIds(t)).length).toBe(files);

  let r = await answer(t, askToken, "q1", { durationS: 124.6, type: "audio/webm;codecs=opus" });
  expect(r.status).toBe(200);
  expect(r.data.ask).toMatchObject({ answered: ["q1"], questions: [], finished: false, merging: false });
  expect(r.data.ask.clips).toEqual([{ id: "q1", audioUrl: expect.any(String), durationS: 120 }]);
  await settle(t); // Ink hears it after the reply
  let [a] = await answersOf(t, askId);
  expect(a).toMatchObject({ questionId: "q1", durationS: 120, language: "en", words: FAKE_WORDS, english: null, merged: false });
  const firstClip = a.audio;

  r = await answer(t, askToken, "q1", { lang: "mr", durationS: 3 });
  expect(r.status).toBe(200);
  expect(r.data.ask.clips).toEqual([{ id: "q1", audioUrl: expect.any(String), durationS: 3 }]);
  [a] = await answersOf(t, askId);
  expect(a).toMatchObject({ language: "mr", durationS: 3, merged: false });
  expect(a.words).toBeUndefined();
  expect(await fileGone(t, firstClip)).toBe(true);
  await settle(t);
  [a] = await answersOf(t, askId);
  expect(a).toMatchObject({ words: FAKE_WORDS, english: `(English) ${FAKE_WORDS}` });
  expect(await answersOf(t, askId)).toHaveLength(1);
  // Her answers reach the kid only with her version (or once no version will come).
  expect((await getCard(t, kidToken)).answers).toEqual([]);
});

test("ask/answer: 30 per IP in 10 minutes", async () => {
  const t = newBackend();
  const { askToken } = await askedCard(t);
  for (let i = 0; i < 30; i++) expect((await answer(t, askToken, "q1")).status).toBe(200);
  expect(await answer(t, askToken, "q1")).toMatchObject({ status: 429, data: { code: "rate" } });
});

test("Send: finished and merging at once, then her version in her words; the kid gets it with her clip; no more answers", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const sent = await finish(t, askToken);
  expect(sent.status).toBe(200);
  expect(sent.data.ask).toMatchObject({ finished: true, merging: true, version: null, answered: ["q1"] });
  expect(await getCard(t, kidToken)).toMatchObject({ status: "asked", merging: true });

  await settle(t);
  const ask = await peek(t, askToken);
  expect(ask.merging).toBe(false);
  expect(ask.finished).toBe(true);
  // Settled: hers, with her clip, and nothing left to ask about it.
  expect(ask.version.ingredients[2]).toMatchObject({ name: "ketchup", amount: "two big spoons", status: "mom", isGuess: false, ask: null, clip: "q1" });
  expect(ask.clips).toEqual([{ id: "q1", audioUrl: expect.any(String), durationS: 4.2 }]);
  const card = await getCard(t, kidToken);
  expect(card).toMatchObject({ status: "answered", merging: false });
  expect(card.version).toEqual(ask.version);
  expect(card.finishedAt).toEqual(near(START.getTime()));
  expect(card.answers).toEqual([{ id: "q1", words: FAKE_WORDS, english: null, audioUrl: expect.any(String), durationS: 4.2 }]);
  expect((await rowOf(t, kidToken)).mergedAt).toBeTypeOf("number");
  expect(model.calls.version).toBe(1);

  expect(await answer(t, askToken, "q1")).toMatchObject({ status: 409, data: { code: "closed", error: "These answers were already sent." } });
  // Send again changes nothing, and no merge runs twice.
  expect((await finish(t, askToken)).data.ask).toMatchObject({ finished: true, merging: false });
  await settle(t);
  expect(model.calls.version).toBe(1);

  // Send with nothing answered keeps her link open.
  const other = await askedCard(t, "192.0.2.20");
  expect((await finish(t, other.askToken)).data.ask).toMatchObject({ finished: false, merging: false });
  expect((await getCard(t, other.kidToken)).status).toBe("asked");
});

test("a second card's ask token sees only that card, and can't answer the first card's questions", async () => {
  const t = newBackend();
  const first = await askedCard(t); // q1 asked
  const second = await makeCard(t, { dish: "dal", kidName: "Priya", relation: "grandma" });
  await askMom(t, second.kidToken, [{ id: "q2", text: "How do you know it's done?" }]);
  const theirs = await peek(t, second.askToken);
  expect(theirs).toMatchObject({ kidName: "Priya", relation: "grandma", questions: [{ id: "q2", text: "How do you know it's done?" }] });
  expect(JSON.stringify(theirs)).not.toContain("Caleb");

  expect(await answer(t, first.askToken, "q1", { token: second.askToken })).toMatchObject({
    status: 400,
    data: { error: "That question wasn't asked." },
  });
  expect((await answer(t, second.askToken, "q2")).status).toBe(200);
  const firstId = (await rowOf(t, first.kidToken))._id;
  const secondId = (await rowOf(t, second.kidToken))._id;
  expect(await answersOf(t, firstId)).toEqual([]);
  expect((await answersOf(t, secondId)).map((a) => a.questionId)).toEqual(["q2"]);
  expect((await peek(t, first.askToken)).answered).toEqual([]);
  expect((await finish(t, second.askToken)).data.ask.finished).toBe(true);
  expect((await peek(t, first.askToken)).finished).toBe(false);
});

test("silent clips: no version comes, Claude never sees them, and the kid gets her clip without words", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { bytes: 50 });
  await settle(t);
  const sent = (await finish(t, askToken)).data.ask;
  expect(sent).toMatchObject({ finished: true, merging: false });
  await settle(t);
  expect(model.calls.version).toBe(0);
  const card = await getCard(t, kidToken);
  expect(card).toMatchObject({ status: "answered", version: null });
  expect(card.answers).toEqual([{ id: "q1", words: "", english: null, audioUrl: expect.any(String), durationS: 4.2 }]);
});

test("a failed merge is tried again 3 minutes later, 5 tries at most; then the kid gets her clips", async () => {
  const t = newBackend();
  vi.spyOn(console, "error").mockImplementation(() => {});
  model.version = async () => {
    throw new DishModelError("model", "Claude 500");
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await runNow(t); // the first try
  const row = await rowOf(t, kidToken);
  expect([row.mergeTries, row.version]).toEqual([1, undefined]);
  expect((await getCard(t, kidToken)).status).toBe("asked");
  expect((await peek(t, askToken)).merging).toBe(true);
  expect(model.calls.version).toBe(1);

  await settle(t); // the retries, 3 minutes apart
  expect(model.calls.version).toBe(5);
  expect((await rowOf(t, kidToken)).mergeTries).toBe(5);
  const card = await getCard(t, kidToken);
  expect(card).toMatchObject({ status: "answered", version: null });
  expect(card.answers.map((a: { id: string; words: string }) => [a.id, a.words])).toEqual([["q1", ""]]);
  expect(card.merging).toBe(false);
  expect((await peek(t, askToken)).merging).toBe(false); // right after the last try, not 3 minutes on
  vi.advanceTimersByTime(60 * MIN);
  await getCard(t, kidToken);
  await settle(t);
  expect(model.calls.version).toBe(5); // no sixth try
});

test("a failed merge is finished by the kid's next look once Claude is back", async () => {
  const t = newBackend();
  vi.spyOn(console, "error").mockImplementation(() => {});
  let down = true;
  model.version = async (real) => {
    if (down) throw new DishModelError("model", "Claude 503");
    return real();
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await runNow(t);
  down = false;
  vi.setSystemTime(Date.now() + 3 * MIN + 1); // the scheduled retry hasn't fired yet
  await getCard(t, kidToken); // starts the try that's due
  await runNow(t);
  const card = await getCard(t, kidToken);
  expect(card.status).toBe("answered");
  expect(card.version.ingredients[2].clip).toBe("q1");
  await settle(t); // the scheduled retry finds nothing to do
  expect(model.calls.version).toBe(2);
});

test("what her answer changed carries the guess's value it replaced and her words (was, quote), to both pages", async () => {
  const t = newBackend();
  model.version = async (real) => {
    const r = (await real()) as { ingredients: Record<string, unknown>[]; steps: { lines: Record<string, unknown>[] }[] };
    Object.assign(r.ingredients[2], { was: "", quote: { words: "दो बड़े चम्मच", english: "two big spoons" } });
    Object.assign(r.steps[1].lines[1], { was: "Stir in the ketchup and **1/2 tsp** sugar", quote: { words: FAKE_WORDS, english: null } });
    return r;
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle(t);
  const card = await getCard(t, kidToken);
  expect(card.version.ingredients[2]).toMatchObject({ was: "", quote: { words: "दो बड़े चम्मच", english: "two big spoons" } });
  expect(card.version.steps[1].lines[1]).toMatchObject({ was: "Stir in the ketchup and **1/2 tsp** sugar", quote: { words: FAKE_WORDS, english: null } });
  expect(card.version.ingredients[0]).toMatchObject({ was: null, quote: null }); // untouched
  expect((await peek(t, askToken)).version.ingredients[2].quote).toEqual({ words: "दो बड़े चम्मच", english: "two big spoons" });
});

test("a filtered word in her version isn't saved (the try fails)", async () => {
  const t = newBackend();
  vi.spyOn(console, "error").mockImplementation(() => {});
  model.version = async (real) => {
    const r = (await real()) as { steps: { title: string }[] };
    r.steps[0].title = "Scramble the fucking eggs";
    return r;
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle(t);
  expect((await rowOf(t, kidToken)).version).toBeUndefined();
  expect((await getCard(t, kidToken)).status).toBe("answered");
});

test("a try that a newer answer overtook writes nothing", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const row = await rowOf(t, kidToken);
  await t.run((ctx) => ctx.db.patch("dishAsks", row._id, { finishedAt: Date.now() }));
  const claim = (await t.mutation(internal.dishAsks.claimMerge, { askId: row._id }))!;
  expect(claim.tries).toBe(1);
  expect(await t.mutation(internal.dishAsks.claimMerge, { askId: row._id })).toBeNull(); // one is running
  await t.run((ctx) => ctx.db.patch("dishAsks", row._id, { finishedAt: undefined }));
  await answer(t, askToken, "q1"); // she records again: the merges start over
  expect(await t.mutation(internal.dishAsks.saveVersion, { askId: row._id, claimedAt: claim.claimedAt, version: claim.guess, audios: [] })).toBe(false);
  expect((await rowOf(t, kidToken)).version).toBeUndefined();
});

test("answers she left 20 minutes without Send count as sent; the kid asking again gives her 20 more", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  vi.advanceTimersByTime(15 * MIN);
  await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup?" }, { id: "q2", text: "How do you know the eggs are done?" }]);
  vi.advanceTimersByTime(10 * MIN);
  await getCard(t, kidToken);
  expect((await rowOf(t, kidToken)).finishedAt).toBeUndefined(); // 25 minutes after her answer, 10 after the ask
  vi.advanceTimersByTime(10 * MIN + 100);
  const closed = await getCard(t, kidToken);
  expect(closed.finishedAt).toEqual(near(START.getTime() + 35 * MIN));
  await settle(t);
  const got = await getCard(t, kidToken);
  expect(got.status).toBe("answered");
  expect(got.answers.map((a: { id: string }) => a.id)).toEqual(["q1"]);
  expect((await peek(t, askToken)).finished).toBe(true);
  expect(await answer(t, askToken, "q2")).toMatchObject({ status: 409 });
});

test("asking again after Send reopens her link; her version stays, and her new answer rebuilds it", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle(t);
  const v1 = (await getCard(t, kidToken)).version;
  const r = await askMom(t, kidToken, [{ text: "What else goes in the eggs?" }]);
  expect(r.data.card).toMatchObject({ status: "asked", finishedAt: null, version: v1 });
  expect(await peek(t, askToken)).toMatchObject({ finished: false, questions: [{ id: "q4", text: "What else goes in the eggs?" }], answered: ["q1"] });
  await answer(t, askToken, "q4");
  await finish(t, askToken);
  await settle(t);
  const card = await getCard(t, kidToken);
  expect(card.status).toBe("answered");
  expect(card.answers.map((a: { id: string }) => a.id)).toEqual(["q1", "q4"]);
  expect(model.calls.version).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// The daily budget

test("at $10 new cards are refused, but Mom's answer and Send still work and her version is written", async () => {
  const t = newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await seedSpend(t, 10);
  const r = await post(t, "/dish/cards", { dish: "dal" }, { ip: "192.0.2.30" });
  expect(r).toMatchObject({
    status: 429,
    data: { code: "rate", error: "homecookd has made all the recipes it can today. Try again tomorrow." },
  });
  expect((await answer(t, askToken, "q1", { lang: "hi" })).status).toBe(200);
  expect((await finish(t, askToken)).data.ask).toMatchObject({ finished: true, merging: true });
  await settle(t);
  expect((await getCard(t, kidToken)).status).toBe("answered");
  expect((await peek(t, askToken)).version).not.toBeNull();
  // Her calls were counted: Ink, the translation, the merge.
  expect(await spent(t)).toBeCloseTo(10 + FAKE_COST.guess + FAKE_COST.transcribe + FAKE_COST.toEnglish + FAKE_COST.version);
});

test("past $11 her clips are saved but not heard: merging is false and the kid gets her clip; a later day merges it", async () => {
  const t = newBackend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { kidToken, askToken } = await askedCard(t);
  await seedSpend(t, 11);
  expect((await answer(t, askToken, "q1")).status).toBe(200);
  const sent = (await finish(t, askToken)).data.ask;
  expect(sent).toMatchObject({ finished: true, merging: false });
  await settle(t);
  expect(model.calls.transcribe).toBe(0);
  expect(model.calls.version).toBe(0);
  let card = await getCard(t, kidToken);
  expect(card).toMatchObject({ status: "answered", version: null, merging: false });
  expect(card.answers).toEqual([{ id: "q1", words: "", english: null, audioUrl: expect.any(String), durationS: 4.2 }]);
  expect((await rowOf(t, kidToken)).mergeTries).toBe(0); // no try was spent

  vi.setSystemTime(new Date("2026-10-30T00:05:00Z")); // a new UTC day
  expect(await getCard(t, kidToken)).toMatchObject({ status: "asked", merging: true }); // merging again
  await settle(t);
  card = await getCard(t, kidToken);
  expect(card.status).toBe("answered");
  expect(card.answers[0].words).toBe(FAKE_WORDS);
  expect(card.version).not.toBeNull();
  expect(await spent(t, "2026-10-30")).toBeCloseTo(FAKE_COST.transcribe + FAKE_COST.version);
});

test("the first time a day reaches $10 the team is told once", async () => {
  const t = newBackend();
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  const pushes: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    pushes.push({ url, init });
    return new Response("ok");
  });
  const loud = vi.spyOn(console, "error").mockImplementation(() => {});
  await seedSpend(t, 9.9995);
  const { askToken } = await askedCard(t); // its guess crosses $10
  expect(loud).toHaveBeenCalledWith(expect.stringContaining("ALERT dish budget"));
  const day = await t.run((ctx) => ctx.db.query("dishSpend").first());
  expect(day?.alertedAt).toEqual(near(START.getTime()));
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle(t);
  expect(pushes).toHaveLength(1);
  expect(pushes[0].url).toBe("https://ntfy.sh/homecookd-test");
  expect((pushes[0].init.headers as Record<string, string>).Title).toBe("homecookd: dish budget reached");
  expect(String(pushes[0].init.body)).toContain("2026-10-29");
  expect(loud.mock.calls.filter((c) => String(c[0]).includes("ALERT dish budget"))).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------
// What's deleted

/**
 * Leo (the kid) and Dad (asked as Mom) in the app, on one card with a photo, the kid's voice note to him and his
 * answer merged into a version; plus a card that's only in their family, and a stranger's.
 */
async function linkedCards(t: Backend) {
  stubFetch();
  const leo = await signIn(t, "p-leo");
  const dad = await signIn(t, "p-dad");
  const photo = await fileId(t, "photo");
  const c = await makeCard(t, { dish: "tomato egg", kidName: "Leo", photos: [photo] });
  await askMom(t, c.kidToken, MOM_ASKED);
  await post(t, "/dish/cards/update", { kidToken: c.kidToken, voiceNote: await fileId(t, "voice") });
  await answer(t, c.askToken, "q1");
  await finish(t, c.askToken);
  await settle(t);
  const familyOnly = await makeCard(t, { dish: "dal" });
  const stranger = await makeCard(t, { dish: "pozole" }, "192.0.2.40");
  const row = await rowOf(t, c.kidToken);
  const link = (patch: { personId?: string; requestedOf?: string; familyId?: string }) =>
    t.run((ctx) => ctx.db.patch("dishAsks", row._id, patch as never));
  const familyRow = await rowOf(t, familyOnly.kidToken);
  await t.run((ctx) => ctx.db.patch("dishAsks", familyRow._id, { familyId: leo.familyId as Id<"families"> }));
  const [clip] = await answersOf(t, row._id);
  return { leo, dad, c, row, link, clip, familyOnly, stranger };
}

const deleteAccount = async (t: Backend, who: { sessionToken: string }) => {
  await t.mutation(api.account.deleteMe, { sessionToken: who.sessionToken });
  await settle(t);
};

test("the kid deletes, Mom is still here: the card stays for her, without the kid's name, photos or voice note", async () => {
  const t = newBackend();
  const { leo, dad, c, row, link, clip, familyOnly, stranger } = await linkedCards(t);
  await link({ personId: leo.personId, requestedOf: dad.personId, familyId: leo.familyId });
  await deleteAccount(t, leo);
  const kept = (await t.run((ctx) => ctx.db.get("dishAsks", row._id)))!;
  expect(kept).toMatchObject({ requestedOf: dad.personId, photos: [], status: "answered" });
  expect(kept.personId).toBeUndefined();
  expect(kept.kidName).toBeUndefined();
  expect(kept.kidVoiceNote).toBeUndefined();
  expect(kept.version).toBeDefined();
  for (const id of [...row.photos, row.kidVoiceNote!]) expect(await fileGone(t, id)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("dishFiles").collect())).toEqual([]);
  expect(await answersOf(t, row._id)).toHaveLength(1); // her answer is hers
  expect(await fileGone(t, clip.audio)).toBe(false);
  const ask = await peek(t, c.askToken);
  expect(ask).toMatchObject({ kidName: null, photoUrls: [], kidVoiceUrl: null });
  // Their family alone deletes nothing; a stranger's card is untouched.
  expect((await post(t, "/dish/cards/get", { kidToken: familyOnly.kidToken })).status).toBe(200);
  expect((await post(t, "/dish/cards/get", { kidToken: stranger.kidToken })).status).toBe(200);
});

test("the kid deletes and no Mom is left on the card: the card goes, with her answers and every file", async () => {
  const t = newBackend();
  const { leo, dad, c, row, link, clip, familyOnly } = await linkedCards(t);
  await link({ personId: leo.personId, familyId: leo.familyId });
  // A second card asked of a Mom who has deleted her account already goes too.
  const other = await makeCard(t, { dish: "upma" }, "192.0.2.41");
  const otherRow = await rowOf(t, other.kidToken);
  await t.run(async (ctx) => {
    await ctx.db.patch("dishAsks", otherRow._id, { personId: leo.personId as Id<"people">, requestedOf: dad.personId as Id<"people"> });
    await ctx.db.patch("people", dad.personId as Id<"people">, { deletedAt: Date.now() });
  });
  await deleteAccount(t, leo);
  expect(await t.run((ctx) => ctx.db.get("dishAsks", row._id))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("dishAsks", otherRow._id))).toBeNull();
  expect(await answersOf(t, row._id)).toEqual([]);
  for (const id of [...row.photos, row.kidVoiceNote!, clip.audio]) expect(await fileGone(t, id)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("dishFiles").collect())).toEqual([]);
  expect((await post(t, "/dish/cards/get", { kidToken: c.kidToken })).status).toBe(404);
  expect((await post(t, "/dish/cards/get", { kidToken: familyOnly.kidToken })).status).toBe(200);
});

test("Mom deletes: her answers, clips and version go; the card waits for an answer again and stays for the kid", async () => {
  const t = newBackend();
  const { leo, dad, c, row, link, clip } = await linkedCards(t);
  await link({ personId: leo.personId, requestedOf: dad.personId, familyId: leo.familyId });
  await deleteAccount(t, dad);
  const kept = (await t.run((ctx) => ctx.db.get("dishAsks", row._id)))!;
  expect(kept).toMatchObject({ personId: leo.personId, status: "asked", kidName: "Leo", mergeTries: 0 });
  expect(kept.requestedOf).toBeUndefined();
  expect(kept.version).toBeUndefined();
  expect(kept.finishedAt).toBeUndefined();
  expect(await answersOf(t, row._id)).toEqual([]);
  expect(await fileGone(t, clip.audio)).toBe(true);
  expect(await fileGone(t, row.photos[0])).toBe(false); // the kid's photo stays
  const card = await getCard(t, c.kidToken);
  expect(card).toMatchObject({ status: "asked", version: null, answers: [], merging: false, asked: MOM_ASKED });
  expect((await peek(t, c.askToken)).questions).toEqual(MOM_ASKED); // her link asks again
});

test("the limiter's old windows are pruned; this window's stay", async () => {
  const t = newBackend();
  await makeCard(t);
  const count = () => t.run(async (ctx) => (await ctx.db.query("rateHits").collect()).length);
  expect(await count()).toBe(2);
  vi.advanceTimersByTime(24 * 60 * MIN);
  await makeCard(t);
  expect(await count()).toBe(4);
  vi.advanceTimersByTime(24 * 60 * MIN + 1);
  await t.mutation(internal.lib.rateLimit.prune, {});
  expect(await count()).toBe(2);
});
