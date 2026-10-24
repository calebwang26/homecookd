// "Put it on the map" for a family dish someone else cooks: homie asks the cook, and only her clear yes
// shares it (convex/shareRequests.ts).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { person, recipe, type Who, world } from "./community.helpers";
import { parseYesNo } from "./lib/yesNo";
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

type Said = "yes" | "no" | "unclear" | "fail";

/**
 * Stubs Gemini (and Cartesia's STT). A yes/no call (it has a responseSchema) answers `said(answer)`;
 * any other Gemini call is a translation and answers `translation`. Returns the yes/no calls' prompts.
 */
function stubAi(said: (answer: string) => Said, { translation = "श्रेयाला विचारायचं आहे", transcript = "" } = {}) {
  const yesNo: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === STT) return Response.json({ text: transcript });
      if (url !== GEMINI) throw new Error(`unexpected fetch ${url}`);
      const body = JSON.parse(String(init.body));
      if (!body.generationConfig?.responseSchema) return Response.json({ candidates: [{ content: { parts: [{ text: translation }] } }] });
      const prompt: string = body.contents[0].parts[0].text;
      yesNo.push(prompt);
      const answer = said(prompt.split("\nAnswer: ")[1] ?? "");
      if (answer === "fail") return new Response("busy", { status: 503 });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer }) }] } }] });
    }),
  );
  return yesNo;
}

const shareAsks = (t: Backend) => t.run(async (ctx) => (await ctx.db.query("questions").collect()).filter((q) => q.kind === "share"));
const sharedAt = (t: Backend, recipeId: Id<"recipes">) => t.run(async (ctx) => (await ctx.db.get("recipes", recipeId))?.sharedAt ?? null);
const ask = (who: Who, recipeId: Id<"recipes">, t: Backend) => t.mutation(api.shareRequests.ask, { sessionToken: who.sessionToken, recipeId });

test("a kid's ask becomes one of the cook's open questions, in her language, and never plays in cook mode", async () => {
  const { t, rajani, shreya } = await world();
  await t.run((ctx) => ctx.db.patch("people", rajani.personId, { language: "mr" }));
  stubAi(() => "unclear");
  const poha = await recipe(t, rajani);

  expect(await ask(shreya, poha, t)).toBe("asked");
  expect(await ask(shreya, poha, t)).toBe("asked"); // asking again doesn't ask her twice
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const asks = await shareAsks(t);
  expect(asks).toHaveLength(1);
  expect(asks[0]).toMatchObject({ recipeId: poha, shareRecipeId: poha, askedBy: shreya.personId, status: "asked_cook", textForCook: "श्रेयाला विचारायचं आहे" });
  expect(asks[0].text).toBe(
    "Shreya wants to put your Kanda Poha on the map for neighbors. They'd see the recipe and one line you said, never your video. Is that okay?",
  );
  const open = await t.query(api.questions.openForCook, { sessionToken: rajani.sessionToken });
  expect(open.map((q) => [q.kind, q.recipeTitle, q.askedByName])).toEqual([["share", "Kanda Poha", "Shreya"]]);
  expect(await t.query(api.questions.forRecipe, { sessionToken: shreya.sessionToken, recipeId: poha })).toEqual([]);
  expect(await t.query(api.shareRequests.familyDishes, { sessionToken: shreya.sessionToken })).toEqual([
    { recipeId: poha, dish: "Kanda Poha", cookName: "Rajani", mine: false, shared: false, asked: true },
  ]);
  expect(await sharedAt(t, poha)).toBeNull();
});

test("her typed yes shares the dish by her switch's path; a no, an unclear answer or a failure doesn't", async () => {
  const { t, rajani, shreya, serene } = await world();
  const cases: [string, string, Said][] = [
    ["Kanda Poha", "Yes, of course.", "yes"],
    ["Varan", "No, keep it ours.", "no"],
    ["Thalipeeth", "Maybe after Diwali.", "unclear"],
    ["Sheera", "Haan.", "fail"],
  ];
  const yesNo = stubAi((answer) => cases.find(([, a]) => a === answer)?.[2] ?? "no");
  const ids: Id<"recipes">[] = [];
  for (const [title] of cases) {
    const recipeId = await recipe(t, rajani, { title });
    ids.push(recipeId);
    await ask(shreya, recipeId, t);
  }
  for (const q of await shareAsks(t)) {
    const [, answer] = cases[ids.indexOf(q.recipeId)];
    await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, text: answer });
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(yesNo).toHaveLength(4);
  expect(yesNo[0]).toMatch(/^Question: Shreya wants to put your .* on the map/);
  const result = await t.run(async (ctx) => {
    const out: Record<string, [boolean, string | null]> = {};
    for (const id of ids) {
      const r = await ctx.db.get("recipes", id);
      out[r!.title] = [!!r?.sharedAt, r?.storyCard?.text ?? null];
    }
    return out;
  });
  expect(result).toEqual({
    "Kanda Poha": [true, "Rajani's Kanda Poha, from the Pawar family."], // the plain card: no Muse key here
    Varan: [false, null],
    Thalipeeth: [false, null],
    Sheera: [false, null],
  });
  // Her yes shows up for neighbors like any shared dish.
  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(feed.recipes.map((r) => r.dish)).toEqual(["Kanda Poha"]);
});

test("without Gemini nobody can read her answer, so nothing is shared", async () => {
  const { t, rajani, shreya } = await world();
  delete process.env.GEMINI_API_KEY;
  stubAi(() => "yes");
  const poha = await recipe(t, rajani);
  await ask(shreya, poha, t);
  const [q] = await shareAsks(t);
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, text: "Yes." });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await sharedAt(t, poha)).toBeNull();
});

test("her Marathi voice note is read in English once it's written out; a note nobody could write out shares nothing", async () => {
  const { t, rajani, shreya } = await world();
  await t.run((ctx) => ctx.db.patch("people", rajani.personId, { language: "mr" }));
  process.env.CARTESIA_API_KEY = "car-test";
  const yesNo = stubAi((answer) => (answer === "Yes, that's fine." ? "yes" : "no"), { translation: "Yes, that's fine.", transcript: "हो, चालेल." });
  const poha = await recipe(t, rajani);
  await ask(shreya, poha, t);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [q] = await shareAsks(t);
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: q._id, audioId });
  expect(yesNo).toHaveLength(0); // nothing to read until Ink writes it out
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(yesNo).toEqual([`Question: ${q.text}\nAnswer: Yes, that's fine.`]);
  expect(await sharedAt(t, poha)).toBeTypeOf("number");

  // Ink isn't set up: the voice note has no words, which is no answer at all.
  delete process.env.CARTESIA_API_KEY;
  const dal = await recipe(t, rajani, { title: "Varan" });
  await ask(shreya, dal, t);
  const later = (await shareAsks(t)).find((s) => s.recipeId === dal)!;
  const note = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: later._id, audioId: note });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(yesNo).toHaveLength(1);
  expect(await sharedAt(t, dal)).toBeNull();
});

test("her own tap shares at once; nobody outside the family can ask, and only she can answer", async () => {
  const { t, rajani, shreya, serene, serenesMom } = await world();
  const yesNo = stubAi(() => "yes");
  const poha = await recipe(t, rajani);
  expect(await ask(rajani, poha, t)).toBe("shared");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await shareAsks(t)).toEqual([]);
  expect(await t.run(async (ctx) => (await ctx.db.get("recipes", poha))?.storyCard?.text)).toBe("Rajani's Kanda Poha, from the Pawar family.");
  expect(await ask(shreya, poha, t)).toBe("shared"); // already on the map: nothing to ask

  const dal = await recipe(t, rajani, { title: "Varan" });
  await expect(ask(serene, dal, t)).rejects.toThrow("Pick one of your family's recipes.");
  await expect(ask(serenesMom, dal, t)).rejects.toThrow("Pick one of your family's recipes.");
  expect(await shareAsks(t)).toEqual([]);

  await ask(shreya, dal, t);
  const [q] = await shareAsks(t);
  const otherCook = await person(t, rajani.familyId, "Vikas", "cook"); // Shreya's dad: a cook, but not this dish's
  const answer = (who: Who) => t.mutation(api.questions.answer, { sessionToken: who.sessionToken, questionId: q._id, text: "Yes." });
  await expect(answer(serenesMom)).rejects.toThrow("isn't here anymore");
  await expect(answer(shreya)).rejects.toThrow("Only the cook");
  await expect(answer(otherCook)).rejects.toThrow("Only the recipe's cook");
  expect(await t.query(api.shareRequests.familyDishes, { sessionToken: serenesMom.sessionToken })).toEqual([]); // the Zhangs have no dishes
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(yesNo).toHaveLength(0);
  expect(await sharedAt(t, dal)).toBeNull();

  // A cooking question answered "yes" is just an answer: it never shares anything.
  const cooking = await t.mutation(internal.questions.ask, { familyId: rajani.familyId, personId: shreya.personId, recipeId: dal, text: "More salt?" });
  await t.mutation(api.questions.answer, { sessionToken: rajani.sessionToken, questionId: cooking!.questionId, text: "Yes." });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(internal.shareRequests.applyYes, { questionId: cooking!.questionId });
  expect(yesNo).toHaveLength(0);
  expect(await sharedAt(t, dal)).toBeNull();
});

test("only a yes is a yes", () => {
  expect(['{"answer": "yes"}', '{"answer":"no"}', '{"answer": "unclear"}', '{"answer": "Yes"}', '{"answer": "yes, but"}', "yes", "", '```json\n{"answer": "yes"}\n```'].map(parseYesNo)).toEqual([
    "yes", "no", "unclear", "unclear", "unclear", "unclear", "unclear", "yes",
  ]);
  expect(parseYesNo(undefined)).toBe("unclear");
});
