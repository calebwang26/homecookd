// The pipeline's follow-up questions reach the recipe's cook (convex/followUps.ts): /worker/published adds each
// once, and only her clear yes to a "did you add …?" one adds the ingredient to the recipe.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { person, recipe, type Who, world } from "./community.helpers";
import type { Backend } from "./test.helpers";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
const STT = "https://api.cartesia.ai/stt";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.GEMINI_API_KEY = "gem-test";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
  delete process.env.CARTESIA_API_KEY;
});

/** Gemini answers a yes/no call (it has a responseSchema) with `said`, a translation with `translation`; STT with `transcript`. */
function stubAi(said: "yes" | "no" | "unclear", { translation = "तुम्ही कढीपत्ता घातला का?", transcript = "" } = {}) {
  const yesNo: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === STT) return Response.json({ text: transcript });
      if (url !== GEMINI) return Response.json({}); // Moss and anything else the publish starts
      const body = JSON.parse(String(init.body));
      if (!body.generationConfig?.responseSchema) return Response.json({ candidates: [{ content: { parts: [{ text: translation }] } }] });
      yesNo.push(body.contents[0].parts[0].text);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: said }) }] } }] });
    }),
  );
  return yesNo;
}

const STEPS = [
  { order: 1, title: "Rinse the poha", text: "Rinse it twice.", moment: { startS: 10, endS: 40 } },
  { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", moment: { startS: 50, endS: 90 } },
];
const SEEN = { id: "seen1", step: 2, question: "Step 2: we saw curry leaves but didn't hear it named. Does that go in, and how much?", ingredient: "curry leaves" };
const GAP = { id: "q1", step: 1, question: "How long do you soak the poha?" };

async function publish(t: Backend, cook: Who, recipeId: Id<"recipes">, followUps: (typeof SEEN | typeof GAP)[]) {
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { familyId: cook.familyId, cookId: cook.personId, recipeId, uploadPath: "poha-1/", source: "phone", stage: "writing", progress: 0.8 }),
  );
  await t.mutation(internal.worker.published, { jobId, recipe: { title: "Kanda Poha", steps: STEPS, memories: [] }, followUps });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

const followUps = (t: Backend) =>
  t.run(async (ctx) => (await ctx.db.query("questions").collect()).filter((q) => q.kind === "followUp"));
const added = (t: Backend, recipeId: Id<"recipes">) => t.run(async (ctx) => (await ctx.db.get("recipes", recipeId))?.addedIngredients ?? []);

test("a published recipe's follow-ups become the cook's open questions, once, from homie, in her language", async () => {
  const { t, rajani } = await world();
  await t.run((ctx) => ctx.db.patch("people", rajani.personId, { language: "mr" }));
  stubAi("unclear");
  const poha = await recipe(t, rajani);

  await publish(t, rajani, poha, [SEEN, GAP]);
  await publish(t, rajani, poha, [SEEN, GAP]); // re-published: not asked twice

  const asked = await followUps(t);
  expect(asked).toHaveLength(2);
  expect(asked.find((q) => q.followUp?.id === "seen1")).toMatchObject({
    askedBy: rajani.personId,
    status: "asked_cook",
    stepOrder: 2,
    text: SEEN.question,
    textForCook: "तुम्ही कढीपत्ता घातला का?",
    followUp: { id: "seen1", ingredient: "curry leaves" },
  });
  const open = await t.query(api.questions.openForCook, { sessionToken: rajani.sessionToken });
  expect(open.map((q) => q.askedByName)).toEqual(["homie", "homie"]);
  expect((await t.query(api.homie.news, { sessionToken: rajani.sessionToken, now: Date.now() })).map((f) => f.line)).toContain(
    "I have a question about your Kanda Poha.",
  );
});

test("her typed yes adds the ingredient with her words; a no adds nothing", async () => {
  const { t, rajani } = await world();
  const yesNo = stubAi("yes");
  const poha = await recipe(t, rajani);
  await publish(t, rajani, poha, [SEEN]);
  const [q] = await followUps(t);

  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, text: "Yes, a handful, at the start" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(yesNo).toHaveLength(1);
  expect(yesNo[0]).toContain("Did you add curry leaves to this dish?");
  expect(await added(t, poha)).toEqual([{ name: "curry leaves", said: "Yes, a handful, at the start", step: 2, questionId: q._id }]);
  expect((await followUps(t))[0].followUp?.said).toBe("yes");

  // The recipe the app reads carries it.
  expect((await t.query(api.recipes.get, { sessionToken: rajani.sessionToken, recipeId: poha }))?.addedIngredients).toHaveLength(1);

  const other = await recipe(t, rajani, { title: "Upma" });
  stubAi("no");
  await publish(t, rajani, other, [SEEN]);
  const q2 = (await followUps(t)).find((x) => x.recipeId === other)!;
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q2._id, text: "No, not in this one" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await added(t, other)).toEqual([]);
  expect((await followUps(t)).find((x) => x.recipeId === other)?.followUp?.said).toBe("no");
});

test("an open-gap follow-up is answered like any question, with no yes/no read", async () => {
  const { t, rajani } = await world();
  const yesNo = stubAi("yes");
  const poha = await recipe(t, rajani);
  await publish(t, rajani, poha, [GAP]);
  const [q] = await followUps(t);
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, text: "Two minutes in water" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(yesNo).toHaveLength(0);
  expect(await added(t, poha)).toEqual([]);
});

test("only the recipe's own cook can answer a follow-up", async () => {
  const { t, rajani } = await world();
  stubAi("yes");
  const poha = await recipe(t, rajani);
  await publish(t, rajani, poha, [SEEN]);
  const [q] = await followUps(t);
  const grandpa = await person(t, rajani.familyId, "Grandpa", "cook");
  await expect(
    t.mutation(api.questions.answer, { sessionToken: grandpa.sessionToken, questionId: q._id, text: "Yes" }),
  ).rejects.toThrow("Only the recipe's cook can answer this.");
});

test("a voice-note yes is read from its transcript", async () => {
  const { t, rajani } = await world();
  process.env.CARTESIA_API_KEY = "sk_car_test";
  stubAi("yes", { transcript: "Yes, eight or ten leaves" });
  const poha = await recipe(t, rajani);
  await publish(t, rajani, poha, [SEEN]);
  const [q] = await followUps(t);
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob(["voice"], { type: "audio/m4a" })));

  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, audioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await added(t, poha)).toEqual([{ name: "curry leaves", said: "Yes, eight or ten leaves", step: 2, questionId: q._id }]);
});

test("recipe.json's follow_up_questions are read: ingredient kept, steps checked, at most five, no repeats", async () => {
  const { parseRecipeJson, MAX_FOLLOW_UPS } = await import("./lib/recipeJson");
  const parsed = parseRecipeJson({
    title: "Kanda Poha",
    steps: [{ order: 1, title: "Rinse", instruction: "Rinse it." }, { order: 2, title: "Temper", instruction: "Temper it." }],
    follow_up_questions: [
      { id: "seen1", about_step: 2, question: SEEN.question, ingredient: "curry leaves" },
      { id: "q1", about_step: 9, question: "How long?" }, // no step 9: kept, without a step
      { id: "q1", about_step: 1, question: "A repeat id" },
      { id: "", question: "No id" },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, about_step: null, question: `Extra ${i}` })),
    ],
  });
  if (typeof parsed === "string") throw new Error(parsed);
  expect(parsed.followUps).toHaveLength(MAX_FOLLOW_UPS);
  expect(parsed.followUps[0]).toEqual({ id: "seen1", step: 2, question: SEEN.question, ingredient: "curry leaves" });
  expect(parsed.followUps[1]).toEqual({ id: "q1", step: undefined, question: "How long?", ingredient: undefined });
});

test("ingredient questions come first, so many gap questions never crowd them out of the five", async () => {
  const { parseRecipeJson, MAX_FOLLOW_UPS } = await import("./lib/recipeJson");
  const gaps = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, about_step: 1, question: `Gap ${i}?` }));
  const parsed = parseRecipeJson({
    title: "Kanda Poha",
    steps: [{ order: 1, title: "Rinse", instruction: "Rinse it." }, { order: 2, title: "Temper", instruction: "Temper it." }],
    follow_up_questions: [...gaps, { id: "seen-curry-leaves", about_step: 2, question: SEEN.question, ingredient: "curry leaves" }],
  });
  if (typeof parsed === "string") throw new Error(parsed);
  expect(parsed.followUps).toHaveLength(MAX_FOLLOW_UPS);
  expect(parsed.followUps[0]).toMatchObject({ id: "seen-curry-leaves", ingredient: "curry leaves", step: 2 });
  expect(parsed.followUps.slice(1).map((f) => f.id)).toEqual(["q0", "q1", "q2", "q3"]); // the rest keep their order
});
