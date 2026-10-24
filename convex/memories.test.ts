import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import chili from "../data/synthetic/dad-sunday-chili.json";
import { parseRecipeJson } from "./lib/recipeJson";
import { newBackend, signIn, stubFetch } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  process.env.VOICE_SECRET = "voice-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("each memory keeps where it sits in recipe.json, so the app can put it back", () => {
  const parsed = parseRecipeJson(chili);
  if (typeof parsed === "string") throw new Error(parsed);
  expect(parsed.memories).toEqual([
    { kind: "story", text: chili.stories[0].text, moment: { startS: 130, endS: 230 }, step: 1, id: "s1", title: "The first pot" },
    { kind: "story", text: chili.stories[1].text, moment: { startS: 2150, endS: 2260 }, step: 7, id: "s2", title: "Sunday afternoon" },
    { kind: "tip", text: chili.special[0].text, moment: { startS: 700, endS: 745 }, step: 3, id: "x1", why: chili.special[0].why },
    { kind: "tip", text: chili.special[1].text, moment: { startS: 1000, endS: 1040 }, step: 4, id: "x2", why: chili.special[1].why },
    { kind: "tip", text: chili.steps[1].tip, moment: { startS: 340, endS: 600 }, step: 2 },
    { kind: "tip", text: chili.steps[4].tip, moment: { startS: 1190, endS: 1600 }, step: 5 },
  ]);
});

test("the kid gets the stories, titles and all, only after the cook's yes", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const { jobId, recipeId } = await t.mutation(api.jobs.create, {
    sessionToken: dad.sessionToken,
    uploadPath: "uploads/fam-1/chili.mov",
    source: "phone",
  });
  const post = (path: string, body: unknown, secret: Record<string, string>) =>
    t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });
  const asWorker = { "x-worker-secret": "worker-secret-for-tests" };
  await post("/worker/claim", {}, asWorker);
  const url = "https://storage.googleapis.com/b/dad-sunday-chili/recipe.json";
  expect((await post("/worker/published", { jobId, recipe: chili, recipeJsonUrl: url }, asWorker)).status).toBe(200);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const kidView = () => t.query(api.recipes.get, { sessionToken: leo.sessionToken, recipeId });
  expect((await kidView())!.memories).toEqual([]);
  const cookView = (await t.query(api.recipes.get, { sessionToken: dad.sessionToken, recipeId }))!;
  expect(cookView.memories.find((m) => m.id === "s1")).toMatchObject({ kind: "story", step: 1, title: "The first pot" });
  expect((await t.query(api.recipes.list, { sessionToken: leo.sessionToken }))[0].memories).toEqual([]);

  await t.mutation(api.recipes.setMemoriesOptIn, { sessionToken: dad.sessionToken, recipeId, optIn: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await kidView())!.memories).toEqual(cookView.memories);
  expect((await t.query(api.recipes.list, { sessionToken: leo.sessionToken }))[0].memories).toHaveLength(6);

  // The voice service still gets its own fields only.
  const session = await (
    await post("/voice/session", { sessionToken: leo.sessionToken, recipeId }, { "x-voice-secret": "voice-secret-for-tests" })
  ).json();
  expect(session.recipe.memories[0]).toEqual({ kind: "story", text: chili.stories[0].text, moment: { startS: 130, endS: 230 }, stepOrder: 1 });
});
