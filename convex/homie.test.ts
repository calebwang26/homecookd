// What's new for a tap on homie (homie.ts): the kid hears an answer, a new dish, someone cooking, a quiet week;
// the cook hears a question waiting and a kid cooking her dish. Only this person's own news, and /homie/news
// for the voice service.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addRecipe, FAMILY, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

const NOW = Date.parse("2026-10-24T18:00:00Z");
const DAY = 24 * 3600 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.VOICE_SECRET = "voice-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function family() {
  // Amy has joined here (she's only invited in FAMILY).
  stubFetch({ ...FAMILY, profiles: FAMILY.profiles.map((p) => (p.id === "p-amy" ? { id: p.id, name: p.name, role: p.role } : p)) });
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const amy = await signIn(t, "p-amy");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  return { t, dad, leo, amy, recipeId };
}

test("a kid: Dad's answer and his new dish; Amy cooking; nothing about Leo's own session", async () => {
  const { t, dad, leo, amy, recipeId } = await family();
  await t.run(async (ctx) => {
    await ctx.db.insert("questions", {
      familyId: dad.familyId as never,
      recipeId,
      askedBy: leo.personId as never,
      text: "How brown is brown?",
      status: "answered",
      answer: { by: dad.personId as never, text: "Darker than you think." },
    });
    // Someone else's answered question isn't Leo's news.
    await ctx.db.insert("questions", {
      familyId: dad.familyId as never,
      recipeId,
      askedBy: amy.personId as never,
      text: "Beans?",
      status: "answered",
      answer: { by: dad.personId as never, text: "Yes." },
    });
    await ctx.db.insert("cookingSessions", { familyId: dad.familyId as never, recipeId, kidId: amy.personId as never, stepOrder: 2, updatedAt: NOW - 60_000 });
    await ctx.db.insert("cookingSessions", { familyId: dad.familyId as never, recipeId, kidId: leo.personId as never, stepOrder: 1, updatedAt: NOW - 30_000 });
  });
  const facts = await t.query(api.homie.news, { sessionToken: leo.sessionToken, now: NOW });
  expect(facts.map((f) => f.line).sort()).toEqual(
    ["Amy is cooking Sunday Chili right now.", "Dad answered your question about the Sunday Chili.", "Dad just added Sunday Chili."].sort(),
  );
  expect(facts.every((f) => f.id.includes(":"))).toBe(true);
  // Old news isn't news.
  const later = await t.query(api.homie.news, { sessionToken: leo.sessionToken, now: NOW + 20 * DAY });
  expect(later.map((f) => f.kind)).toEqual(["quiet"]);
});

test("the cook: a question waiting and a kid cooking her dish; a quiet week only when nothing else is new", async () => {
  const { t, dad, leo, recipeId } = await family();
  expect(await t.query(api.homie.news, { sessionToken: dad.sessionToken, now: NOW })).toEqual([]);
  expect((await t.query(api.homie.news, { sessionToken: dad.sessionToken, now: NOW + 8 * DAY })).map((f) => f.line)).toEqual([
    "It's been a week since your last dish. Your family would love another.",
  ]);
  await t.run(async (ctx) => {
    await ctx.db.insert("questions", { familyId: dad.familyId as never, recipeId, askedBy: leo.personId as never, text: "Beans?", status: "asked_cook" });
    await ctx.db.insert("cookingSessions", { familyId: dad.familyId as never, recipeId, kidId: leo.personId as never, stepOrder: 1, updatedAt: NOW + 8 * DAY - 1000 });
  });
  const facts = await t.query(api.homie.news, { sessionToken: dad.sessionToken, now: NOW + 8 * DAY });
  expect(facts.map((f) => f.line)).toEqual([
    "Leo is cooking your Sunday Chili right now.",
    "Leo asked you about the Sunday Chili.",
    "It's been a week since your last dish. Your family would love another.",
  ]);
});

test("/homie/news: the voice service's copy, with who's asking; a bad token is 401, no secret 401", async () => {
  const { t, leo } = await family();
  const post = (body: unknown, secret = "voice-secret-for-tests") =>
    t.fetch("/homie/news", { method: "POST", headers: { "Content-Type": "application/json", "x-voice-secret": secret }, body: JSON.stringify(body) });
  const res = await post({ sessionToken: leo.sessionToken });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ name: "Leo", role: "kid", facts: [{ kind: "recipe", line: "Dad just added Sunday Chili." }] });
  expect((await post({ sessionToken: "x".repeat(43) })).status).toBe(401);
  expect((await post({ sessionToken: leo.sessionToken }, "wrong")).status).toBe(401);
});
