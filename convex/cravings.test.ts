/// <reference types="vite/client" />
// Cravings (docs/build/DISH-ASK-SPEC.md §8): a parent's craving link, the kid's card from it through the web routes,
// her requests in the app, her filming day, and her voice recipe merged into her version. The models run in fake
// mode (DISH_FAKE_AI=1, convex/dishAskModel.ts), counted as in dishAsks.test.ts.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CRAVING_PER_DAY, CRAVING_TOTAL, DEFAULT_CRAVING_MESSAGE, LINK_BUSY } from "./lib/cravingLinks";
import { sha256Hex } from "./lib/dishAskRoutes";
import { type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

type Model = typeof import("./dishAskModel");
const model = vi.hoisted(() => ({ calls: { guess: 0, version: 0, transcribe: 0 } }));
vi.mock("./dishAskModel", async (importOriginal) => {
  const m = await importOriginal<Model>();
  return {
    ...m,
    writeGuess: async (...a: Parameters<Model["writeGuess"]>) => {
      model.calls.guess++;
      return m.writeGuess(...a);
    },
    writeVersion: async (...a: Parameters<Model["writeVersion"]>) => {
      model.calls.version++;
      return m.writeVersion(...a);
    },
    transcribe: async (...a: Parameters<Model["transcribe"]>) => {
      model.calls.transcribe++;
      return m.transcribe(...a);
    },
  };
});
const { FAKE_WORDS } = await import("./dishAskModel");

const START = new Date("2026-10-29T12:00:00Z");
/** A day and a minute: past the 24 hours a link's daily cap counts. */
const DAY = 24 * 60 * 60_000 + 60_000;
const ORIGIN = "https://homecookd.app";
const TOKEN22 = /^[0-9A-Za-z]{22}$/;
const OTHERS = { family: { id: "fam-2", name: "The Pawars" }, profiles: [{ id: "q-aai", name: "Aai", role: "cook" }] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  process.env.DISH_FAKE_AI = "1";
  process.env.DISH_IP_SALT = "test-salt-for-the-dish-limits";
  model.calls = { guess: 0, version: 0, transcribe: 0 };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DISH_FAKE_AI;
  delete process.env.DISH_IP_SALT;
});

// ---------------------------------------------------------------------------------------------
// Helpers

type Reply = { status: number; data: any };
let ipCount = 0;
/** A new IP per call by default, so the per-IP card limits stay out of the way. */
const nextIp = () => `198.51.100.${++ipCount % 250}`;

async function post(t: Backend, path: string, body: unknown, ip = nextIp()): Promise<Reply> {
  const res = await t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** A raw-body route (an upload, or Mom's web answer with her ask token): its JSON, after checking it worked. */
async function raw(t: Backend, path: string, type: string, bytes: number, askToken?: string) {
  const res = await t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": type, Origin: ORIGIN, "X-Forwarded-For": nextIp(), ...(askToken ? { "X-Dish-Token": askToken } : {}) },
    body: new Uint8Array(bytes).fill(7),
  });
  const data = await res.json();
  expect(res.status, JSON.stringify(data)).toBeLessThan(300);
  return data.fileId as string;
}

const tokenOf = (url: string) => new URL(url).searchParams.get("c")!;
const peek = (t: Backend, cravingToken: unknown) => post(t, "/dish/craving/peek", { cravingToken });
const craving = (t: Backend, cravingToken: string, body: Record<string, unknown> = { dish: "braised pork", kidName: "Caleb" }) =>
  post(t, "/dish/cards", { ...body, cravingToken });

async function cravingCard(t: Backend, cravingToken: string, body?: Record<string, unknown>) {
  const r = await craving(t, cravingToken, body);
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  const hash = await sha256Hex(r.data.kidToken);
  const row = (await t.run((ctx) => ctx.db.query("dishAsks").withIndex("by_kid_token", (q) => q.eq("kidTokenHash", hash)).unique()))!;
  return { kidToken: r.data.kidToken as string, card: r.data.card, row };
}

const kidCard = async (t: Backend, kidToken: string) => (await post(t, "/dish/cards/get", { kidToken })).data.card;
const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);
const fileGone = (t: Backend, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) === null);
const audio = (t: Backend, bytes = 400, type = "audio/mp4") =>
  t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes).fill(1)], { type })));
const links = (t: Backend) => t.run((ctx) => ctx.db.query("cravingLinks").collect());
const answersOf = (t: Backend, askId: Id<"dishAsks">) =>
  t.run((ctx) => ctx.db.query("dishAnswers").withIndex("by_ask_question", (q) => q.eq("askId", askId)).collect());
/** Sets today's total (the cards made earlier in the test spent a little already). */
const seedSpend = (t: Backend, usd: number) =>
  t.run(async (ctx) => {
    const row = await ctx.db.query("dishSpend").withIndex("by_day", (q) => q.eq("day", "2026-10-29")).unique();
    if (row) await ctx.db.patch("dishSpend", row._id, { usd });
    else await ctx.db.insert("dishSpend", { day: "2026-10-29", usd });
  });

/** Dad (a cook) and Leo (a kid) of the Wangs, signed in; Dad's craving link. */
async function wangs(t: Backend) {
  stubFetch();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const { url } = await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken });
  return { dad, leo, url, token: tokenOf(url) };
}

/** Aai, a cook in another family. */
async function aai(t: Backend) {
  stubFetch(OTHERS);
  return await signIn(t, "q-aai");
}

const send = (t: Backend, sessionToken: string, id: string, audioId: Id<"_storage">, extra: Record<string, unknown> = {}) =>
  t.action(api.cravings.sendVoiceRecipe, { sessionToken, id, audioId, durationS: 42.5, ...extra });

// ---------------------------------------------------------------------------------------------
// Her link

test("createLink: one live link per person, reused (a new message updates it); revoked, it's refused and the next is new", async () => {
  const t = newBackend();
  const { dad, leo, url, token } = await wangs(t);
  expect(url).toBe(`https://homecookd.app/miss?c=${token}`);
  expect(token).toMatch(TOKEN22);
  expect((await links(t))[0]).toMatchObject({ token, message: DEFAULT_CRAVING_MESSAGE, uses: 0, personId: dad.personId });

  // Reused, any number of times; a new message replaces her line.
  expect(await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken })).toEqual({ url });
  expect(await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken, message: "  What should I cook when you're home?  " })).toEqual({ url });
  expect((await peek(t, token)).data.message).toBe("What should I cook when you're home?");
  await cravingCard(t, token);
  const second = await cravingCard(t, token, { dish: "dal", kidName: "Amy" });
  expect((await links(t))[0].uses).toBe(2);

  // Bad messages change nothing.
  await expect(t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken, message: "x".repeat(301) })).rejects.toThrow(
    "Your message must be 1 to 300 characters.",
  );
  await expect(t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken, message: "   " })).rejects.toThrow("1 to 300");
  await expect(t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken, message: "what the fuck do you miss" })).rejects.toThrow(
    "can't be used here",
  );
  // Someone else's link is their own.
  expect((await t.mutation(api.cravings.createLink, { sessionToken: leo.sessionToken })).url).not.toBe(url);

  // Stopped: no new cards (a 404, counted as a bad token); the cards it made stay.
  expect(await t.mutation(api.cravings.revokeLink, { sessionToken: dad.sessionToken })).toBeNull();
  expect(await t.mutation(api.cravings.revokeLink, { sessionToken: dad.sessionToken })).toBeNull(); // again: nothing to stop
  expect(await peek(t, token)).toMatchObject({ status: 404, data: { code: "not_found" } });
  expect(await craving(t, token)).toMatchObject({ status: 404, data: { code: "not_found" } });
  expect((await post(t, "/dish/cards/get", { kidToken: second.kidToken })).status).toBe(200);
  // Her next createLink is a new link.
  const fresh = await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken });
  expect(fresh.url).not.toBe(url);
  expect((await peek(t, tokenOf(fresh.url))).status).toBe(200);
});

test("peek: her first name, what the family calls her and her line; 404 when unknown, counted as a bad token", async () => {
  const t = newBackend();
  const { dad, token } = await wangs(t);
  expect(await peek(t, token)).toMatchObject({
    status: 200,
    data: { parentName: "Dad", relation: null, message: DEFAULT_CRAVING_MESSAGE },
  });
  await t.run((ctx) => ctx.db.patch("people", dad.personId, { name: "Ravi Wang", relation: " Appa " }));
  expect((await peek(t, token)).data).toEqual({ parentName: "Ravi", relation: "Appa", message: DEFAULT_CRAVING_MESSAGE });

  expect(await peek(t, "A".repeat(22))).toMatchObject({ status: 404, data: { code: "not_found", error: "This link doesn't work anymore." } });
  expect(await peek(t, "short")).toMatchObject({ status: 404 });
  expect(await peek(t, undefined)).toMatchObject({ status: 400, data: { code: "bad_request" } });
  // 20 unknown tokens from one IP in 10 minutes, then 429.
  for (let i = 0; i < 18; i++) expect((await post(t, "/dish/craving/peek", { cravingToken: "B".repeat(22) }, "192.0.2.9")).status).toBe(404);
  expect((await post(t, "/dish/craving/peek", { cravingToken: "B".repeat(22) }, "192.0.2.9")).status).toBe(404);
  expect((await post(t, "/dish/craving/peek", { cravingToken: "B".repeat(22) }, "192.0.2.9")).status).toBe(404);
  expect(await post(t, "/dish/craving/peek", { cravingToken: "B".repeat(22) }, "192.0.2.9")).toMatchObject({ status: 429, data: { code: "rate" } });
});

// ---------------------------------------------------------------------------------------------
// The kid's card from it

test("a craving card is tied to her: familyId, requestedOf, cravingId, cookClaimedAt; nobody joins her family", async () => {
  const t = newBackend();
  const { dad, token } = await wangs(t);
  const people = async () => (await t.run((ctx) => ctx.db.query("people").collect())).map((p) => [p._id, p.familyId, p.name]);
  const before = { people: await people(), families: await t.run((ctx) => ctx.db.query("families").collect()) };

  const { card, row } = await cravingCard(t, token);
  expect(card).toMatchObject({ kidName: "Caleb", relation: "mom", status: "draft", filmingDay: null });
  const link = (await links(t))[0];
  expect(row).toMatchObject({ familyId: dad.familyId, requestedOf: dad.personId, cravingId: link._id, cookClaimedAt: row.createdAt });
  expect(row.personId).toBeUndefined(); // the kid isn't anyone in the app
  expect(await people()).toEqual(before.people);
  expect(await t.run((ctx) => ctx.db.query("families").collect())).toEqual(before.families);

  // Who the kid asks: from what the family calls her when it's one of the six, else mom; the kid's pick wins.
  await t.run((ctx) => ctx.db.patch("people", dad.personId, { relation: "Dad" }));
  expect((await cravingCard(t, token)).card.relation).toBe("dad");
  expect((await cravingCard(t, token, { dish: "dal", kidName: "Amy", relation: "grandpa" })).card.relation).toBe("grandpa");
  await t.run((ctx) => ctx.db.patch("people", dad.personId, { relation: "Aaji" }));
  expect((await cravingCard(t, token)).card.relation).toBe("mom");
});

test("a craving card needs the kid's name (400) and clean words (422); nothing is made or counted", async () => {
  const t = newBackend();
  const { token } = await wangs(t);
  const count = async () => (await t.run((ctx) => ctx.db.query("dishAsks").collect())).length;
  expect(await craving(t, token, { dish: "braised pork" })).toMatchObject({ status: 400, data: { error: "kidName is required" } });
  expect(await craving(t, token, { dish: "braised pork", kidName: "   " })).toMatchObject({ status: 400 });
  expect(await craving(t, token, { dish: "braised pork", kidName: "slut" })).toMatchObject({ status: 422, data: { code: "words" } });
  expect(await craving(t, "C".repeat(22))).toMatchObject({ status: 404, data: { code: "not_found" } });
  expect(await count()).toBe(0);
  expect(model.calls.guess).toBe(0);
  expect((await links(t))[0].uses).toBe(0);
});

test(`a link makes at most ${CRAVING_PER_DAY} cards a day and ${CRAVING_TOTAL} in all (429); then createLink makes a new one`, async () => {
  const t = newBackend();
  const { dad, token, url } = await wangs(t);
  for (let i = 0; i < CRAVING_PER_DAY; i++) await cravingCard(t, token);
  const busy = { status: 429, data: { code: "rate", error: LINK_BUSY } };
  expect(await craving(t, token)).toMatchObject(busy);
  expect(model.calls.guess).toBe(CRAVING_PER_DAY); // refused before any model ran
  // The kid's own web cards aren't the link's.
  expect((await post(t, "/dish/cards", { dish: "dal" })).status).toBe(201);
  vi.advanceTimersByTime(DAY);
  await cravingCard(t, token);
  expect((await links(t))[0].uses).toBe(CRAVING_PER_DAY + 1);

  // Its total: the last one it may make, then 429 whatever the day.
  await t.run(async (ctx) => {
    const link = (await ctx.db.query("cravingLinks").first())!;
    await ctx.db.patch("cravingLinks", link._id, { uses: CRAVING_TOTAL - 1 });
  });
  vi.advanceTimersByTime(DAY);
  await cravingCard(t, token);
  expect(await craving(t, token)).toMatchObject(busy);
  vi.advanceTimersByTime(DAY);
  expect(await craving(t, token)).toMatchObject(busy);
  expect((await links(t))[0].uses).toBe(CRAVING_TOTAL);
  // Used up, so she gets a new one.
  const next = await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken });
  expect(next.url).not.toBe(url);
  expect((await craving(t, tokenOf(next.url))).status).toBe(201);
});

// ---------------------------------------------------------------------------------------------
// Her requests

test("forCook: the cards asked of her, newest first, in the app's shape; get is null for anyone else's", async () => {
  const t = newBackend();
  const { dad, leo, token } = await wangs(t);
  const photo = await raw(t, "/dish/files?kind=photo", "image/jpeg", 2000);
  const first = await cravingCard(t, token, { dish: "braised pork", kidName: "Caleb", photos: [photo] });
  vi.advanceTimersByTime(60_000);
  const second = await cravingCard(t, token, { dish: "dal", kidName: "Amy" });
  // Leo's own link, and another family's: not Dad's.
  const leoLink = await t.mutation(api.cravings.createLink, { sessionToken: leo.sessionToken });
  const leos = await cravingCard(t, tokenOf(leoLink.url));
  const other = await aai(t);
  const theirs = await cravingCard(t, tokenOf((await t.mutation(api.cravings.createLink, { sessionToken: other.sessionToken })).url));

  const asks = await t.query(api.cravings.forCook, { sessionToken: dad.sessionToken });
  expect(asks.map((a) => a.id)).toEqual([second.row._id, first.row._id]);
  expect(asks[1]).toEqual({
    id: first.row._id,
    kidName: "Caleb",
    dish: "tomato egg", // the fake guess names every dish so
    guess: first.row.guess.ingredients.map((i) => ({ amount: i.amount, name: i.name })),
    kidVoiceUrl: null,
    photoUrl: expect.stringMatching(/^https:/),
    message: first.card.message,
    createdAt: first.row.createdAt,
    answered: false,
    voiceRecipe: null,
    filmingDay: null,
  });
  expect(asks[1].guess.length).toBeGreaterThan(0);
  expect(asks[0].photoUrl).toBeNull();

  expect(await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: first.row._id })).toEqual(asks[1]);
  for (const id of [leos.row._id, theirs.row._id, "nope", "x".repeat(32)]) {
    expect(await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id })).toBeNull();
  }
  expect(await t.query(api.cravings.get, { sessionToken: other.sessionToken, id: first.row._id })).toBeNull();
  expect((await t.query(api.cravings.forCook, { sessionToken: other.sessionToken })).map((a) => a.id)).toEqual([theirs.row._id]);
  await expect(t.query(api.cravings.forCook, { sessionToken: "x".repeat(43) })).rejects.toThrow("This phone was signed out.");
});

test("setFilmingDay: only the one it was asked of; the kid's card shows it; null clears it", async () => {
  const t = newBackend();
  const { dad, leo, token } = await wangs(t);
  const { kidToken, row } = await cravingCard(t, token);
  await expect(t.mutation(api.cravings.setFilmingDay, { sessionToken: leo.sessionToken, id: row._id, day: 0 })).rejects.toThrow(
    "Only Dad can pick the day.",
  );
  const other = await aai(t);
  await expect(t.mutation(api.cravings.setFilmingDay, { sessionToken: other.sessionToken, id: row._id, day: 0 })).rejects.toThrow("Not found.");
  for (const day of [7, -1, 1.5]) {
    await expect(t.mutation(api.cravings.setFilmingDay, { sessionToken: dad.sessionToken, id: row._id, day })).rejects.toThrow(
      "Pick a day of the week.",
    );
  }
  expect((await kidCard(t, kidToken)).filmingDay).toBeNull();

  expect(await t.mutation(api.cravings.setFilmingDay, { sessionToken: dad.sessionToken, id: row._id, day: 0 })).toBeNull();
  expect((await kidCard(t, kidToken)).filmingDay).toBe(0);
  expect((await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!.filmingDay).toBe(0);
  await t.mutation(api.cravings.setFilmingDay, { sessionToken: dad.sessionToken, id: row._id, day: null });
  expect((await kidCard(t, kidToken)).filmingDay).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// Her voice recipe

test("sendVoiceRecipe: only the one it was asked of; a wrong type or size is refused and deleted", async () => {
  const t = newBackend();
  const { dad, leo, token } = await wangs(t);
  const { row } = await cravingCard(t, token);
  const clip = await audio(t);
  await expect(send(t, leo.sessionToken, row._id, clip)).rejects.toThrow("Only Dad can answer this one.");
  const other = await aai(t);
  await expect(send(t, other.sessionToken, row._id, clip)).rejects.toThrow("Not found.");
  expect(await fileGone(t, clip)).toBe(false); // not theirs to delete

  const photo = await audio(t, 400, "image/jpeg");
  await expect(send(t, dad.sessionToken, row._id, photo)).rejects.toThrow("That recording type isn't supported.");
  expect(await fileGone(t, photo)).toBe(true);
  const huge = await audio(t, 5 * 1024 * 1024 + 1, "audio/webm;codecs=opus");
  await expect(send(t, dad.sessionToken, row._id, huge)).rejects.toThrow("That recording is too long.");
  expect(await fileGone(t, huge)).toBe(true);
  // A file a card already holds (a kid's photo, someone's clip) is refused and never deleted: storage ids show in
  // file URLs. So is an old one.
  const held = await audio(t, 400, "image/png");
  await t.run((ctx) => ctx.db.insert("dishFiles", {
    fileIdHash: "x".repeat(64), storageId: held, kind: "photo", contentType: "image/png", size: 400, ipKey: "k", askId: row._id, createdAt: Date.now(),
  }));
  await expect(send(t, dad.sessionToken, row._id, held)).rejects.toThrow("Upload the recording first.");
  expect(await fileGone(t, held)).toBe(false);
  const old = await audio(t, 400, "image/png");
  vi.advanceTimersByTime(2 * 60 * 60_000);
  await expect(send(t, dad.sessionToken, row._id, old)).rejects.toThrow("Upload the recording first.");
  expect(await fileGone(t, old)).toBe(false);

  for (const durationS of [0.5, 126, Number.NaN]) {
    await expect(send(t, dad.sessionToken, row._id, clip, { durationS })).rejects.toThrow("1 second to 2 minutes");
  }
  await expect(send(t, dad.sessionToken, row._id, clip, { language: "xx" })).rejects.toThrow("Pick a language from the list.");
  expect(await answersOf(t, row._id)).toEqual([]);
  expect(model.calls.transcribe).toBe(0);
});

test("sendVoiceRecipe: writing, then her version on the kid's card with her clip; a second one replaces the first", async () => {
  const t = newBackend();
  const { dad, token } = await wangs(t);
  await t.run((ctx) => ctx.db.patch("people", dad.personId, { language: "mr" }));
  const { kidToken, row } = await cravingCard(t, token);
  const first = await audio(t);
  expect(await send(t, dad.sessionToken, row._id, first, { durationS: 124 })).toBeNull();
  let ask = (await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!;
  expect(ask).toMatchObject({ answered: false, voiceRecipe: "writing" });
  const [answer] = await answersOf(t, row._id);
  expect(answer).toMatchObject({ questionId: "q4", language: "mr", durationS: 120, merged: false });
  let card = await kidCard(t, kidToken);
  expect(card).toMatchObject({ status: "asked", merging: true, version: null });
  expect(card.asked).toEqual([{ id: "q4", text: "How do you make it?" }]);

  await settle(t);
  ask = (await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!;
  expect(ask).toMatchObject({ answered: true, voiceRecipe: "ready" });
  card = await kidCard(t, kidToken);
  expect(card).toMatchObject({ status: "answered", merging: false });
  expect(card.version).not.toBeNull();
  expect(card.answers).toEqual([
    { id: "q4", words: FAKE_WORDS, english: `(English) ${FAKE_WORDS}`, audioUrl: expect.any(String), durationS: 120 },
  ]);
  expect(model.calls).toMatchObject({ transcribe: 1, version: 1 });

  // A second one replaces the first (the old clip is deleted) and her version is written again.
  const second = await audio(t, 500);
  await send(t, dad.sessionToken, row._id, second, { language: "en" });
  expect((await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!.voiceRecipe).toBe("writing");
  await settle(t);
  expect(await fileGone(t, first)).toBe(true);
  const answers = await answersOf(t, row._id);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ questionId: "q4", audio: second, language: "en", english: null, merged: true });
  expect((await kidCard(t, kidToken)).asked).toEqual([{ id: "q4", text: "How do you make it?" }]);
  expect((await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!.voiceRecipe).toBe("ready");
  expect(model.calls.version).toBe(2);
});

test("sendVoiceRecipe: a silent clip fails (she can send again); past $11 nothing is merged until a later day", async () => {
  const t = newBackend();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { dad, token } = await wangs(t);
  const { row } = await cravingCard(t, token);
  await send(t, dad.sessionToken, row._id, await audio(t, 50)); // under 100 bytes: the fake Ink hears nothing
  await settle(t);
  expect((await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: row._id }))!).toMatchObject({
    answered: false,
    voiceRecipe: "failed",
  });
  expect(model.calls.version).toBe(0);

  const other = await cravingCard(t, token, { dish: "dal", kidName: "Amy" });
  await seedSpend(t, 11);
  await send(t, dad.sessionToken, other.row._id, await audio(t));
  await settle(t);
  expect(model.calls).toMatchObject({ transcribe: 1, version: 0 }); // only the silent clip was heard
  expect((await t.query(api.cravings.get, { sessionToken: dad.sessionToken, id: other.row._id }))!).toMatchObject({
    answered: false,
    voiceRecipe: "writing",
  });
  expect((await kidCard(t, other.kidToken)).merging).toBe(false);
});

test("sendVoiceRecipe takes the next free own question, and refuses when q4–q6 all have her answers", async () => {
  const t = newBackend();
  const { dad, token } = await wangs(t);
  const { kidToken, row } = await cravingCard(t, token);
  // The kid asks q1 and an own question (q4); Mom answers q4 on the web.
  const asked = await post(t, "/dish/cards/ask", { kidToken, questions: [{ id: "q1", text: "How much ketchup?" }, { text: "Which pot?" }] });
  expect(asked.data.card.asked.map((q: { id: string }) => q.id)).toEqual(["q1", "q4"]);
  const askToken = new URL(asked.data.card.askUrl).searchParams.get("t")!;
  await raw(t, "/dish/ask/answer?q=q4&durationS=4", "audio/mp4", 400, askToken);
  await send(t, dad.sessionToken, row._id, await audio(t));
  expect((await t.run((ctx) => ctx.db.get("dishAsks", row._id)))!.asked).toEqual([
    { id: "q1", text: "How much ketchup?" },
    { id: "q4", text: "Which pot?" },
    { id: "q5", text: "How do you make it?" },
  ]);
  await settle(t);

  // q4 and q5 answered; with q6 answered too (the kid asks it, Mom answers), a fresh card would have nothing free.
  const full = await cravingCard(t, token, { dish: "dal", kidName: "Amy" });
  const r = await post(t, "/dish/cards/ask", {
    kidToken: full.kidToken,
    questions: [{ text: "Which pot?" }, { text: "How long?" }, { text: "What heat?" }],
  });
  const fullAsk = new URL(r.data.card.askUrl).searchParams.get("t")!;
  for (const q of ["q4", "q5", "q6"]) await raw(t, `/dish/ask/answer?q=${q}&durationS=4`, "audio/mp4", 400, fullAsk);
  const clip = await audio(t);
  await expect(send(t, dad.sessionToken, full.row._id, clip)).rejects.toThrow("This one already has her answer.");
});

// ---------------------------------------------------------------------------------------------
// What's deleted

test("deleting the link's maker deletes her links; the cards stay for the kid, without her answer", async () => {
  const t = newBackend();
  const { dad, leo, token } = await wangs(t);
  const { kidToken, row } = await cravingCard(t, token);
  await t.mutation(api.cravings.revokeLink, { sessionToken: dad.sessionToken });
  await t.mutation(api.cravings.createLink, { sessionToken: dad.sessionToken });
  await t.mutation(api.cravings.createLink, { sessionToken: leo.sessionToken });
  await t.mutation(api.cravings.setFilmingDay, { sessionToken: dad.sessionToken, id: row._id, day: 3 });
  const clip = await audio(t);
  await send(t, dad.sessionToken, row._id, clip);
  await settle(t);
  expect(await links(t)).toHaveLength(3);

  await t.mutation(api.account.deleteMe, { sessionToken: dad.sessionToken });
  await settle(t);
  expect((await links(t)).map((l) => l.personId)).toEqual([leo.personId]); // Leo's is his
  expect(await peek(t, token)).toMatchObject({ status: 404 });
  const kept = (await t.run((ctx) => ctx.db.get("dishAsks", row._id)))!;
  expect(kept.requestedOf).toBeUndefined();
  expect(kept.filmingDay).toBeUndefined();
  expect(kept.voiceRecipeQ).toBeUndefined();
  expect(await fileGone(t, clip)).toBe(true);
  expect(await kidCard(t, kidToken)).toMatchObject({ version: null, answers: [], filmingDay: null });
});
