import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import chili from "../data/synthetic/dad-sunday-chili.json";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

const moss = vi.hoisted(() => ({ calls: [] as { op: string; name: string; arg: unknown }[], exists: false, raceLost: false }));
vi.mock("@moss-js/moss", () => ({
  MossClient: class {
    async getIndex(name: string) {
      if (!moss.exists) throw new Error("not found");
      return { name };
    }
    async createIndex(name: string, docs: unknown) {
      if (moss.raceLost) throw new Error("index already exists");
      moss.calls.push({ op: "createIndex", name, arg: docs });
      moss.exists = true;
    }
    async addDocs(name: string, docs: unknown) {
      moss.calls.push({ op: "addDocs", name, arg: docs });
    }
    async deleteDocs(name: string, ids: unknown) {
      moss.calls.push({ op: "deleteDocs", name, arg: ids });
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  moss.calls = [];
  moss.exists = false;
  moss.raceLost = false;
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  process.env.VOICE_SECRET = "voice-secret-for-tests";
  process.env.MOSS_PROJECT_ID = "proj";
  process.env.MOSS_PROJECT_KEY = "key";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.CARTESIA_API_KEY;
  delete process.env.MUSE_API_KEY;
});

const post = (t: Backend, path: string, body: unknown, secret: Record<string, string>) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });
const asWorker = { "x-worker-secret": "worker-secret-for-tests" };
const asVoice = { "x-voice-secret": "voice-secret-for-tests" };

test("an upload goes from jobs.create through the worker to a ready, indexed recipe", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");

  await expect(
    t.mutation(api.jobs.create, { sessionToken: leo.sessionToken, uploadPath: "u/a.mov", source: "phone" }),
  ).rejects.toThrow("Only the cook");
  const { jobId, recipeId } = await t.mutation(api.jobs.create, {
    sessionToken: dad.sessionToken,
    uploadPath: "uploads/fam-1/chili.mov",
    source: "glasses",
  });
  expect((await t.query(api.recipes.get, { sessionToken: leo.sessionToken, recipeId }))?.status).toBe("processing");

  expect((await post(t, "/worker/claim", {}, { "x-worker-secret": "wrong" })).status).toBe(401);
  const claimed = await (await post(t, "/worker/claim", {}, asWorker)).json();
  expect(claimed).toMatchObject({ jobId, recipeId, cookName: "Dad", supabaseFamilyId: "fam-1", source: "glasses" });
  expect((await post(t, "/worker/claim", {}, asWorker)).status).toBe(204);

  expect((await post(t, "/worker/progress", { jobId, stage: "nope", progress: 0.1 }, asWorker)).status).toBe(400);
  expect((await post(t, "/worker/progress", { jobId: "bogus", stage: "writing", progress: 0.1 }, asWorker)).status).toBe(404);
  expect((await post(t, "/worker/progress", { jobId, stage: "writing", progress: 0.6 }, asWorker)).status).toBe(200);
  const [job] = await t.query(api.jobs.forFamily, { sessionToken: dad.sessionToken });
  expect(job).toMatchObject({ stage: "writing", progress: 0.6 });

  expect((await post(t, "/worker/published", { jobId, recipe: { title: "x", steps: [] } }, asWorker)).status).toBe(400);
  const pub = await post(
    t,
    "/worker/published",
    { jobId, recipe: chili, recipeJsonUrl: "https://storage.googleapis.com/b/dad-sunday-chili/recipe.json", memoriesOptIn: true },
    asWorker,
  );
  expect(await pub.json()).toEqual({ recipeId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const recipe = (await t.query(api.recipes.get, { sessionToken: leo.sessionToken, recipeId }))!;
  expect(recipe).toMatchObject({ title: chili.title, status: "ready", libraryId: "dad-sunday-chili" });
  expect(recipe.steps[0]).toMatchObject({ order: 1, quote: chili.steps[0].quote, moment: { startS: 60, endS: 330 } });
  expect(recipe.memories.some((m) => m.kind === "story")).toBe(true);
  expect(recipe.mossIndexedAt).toBeTypeOf("number");
  expect((await t.query(api.jobs.forFamily, { sessionToken: dad.sessionToken }))[0]).toMatchObject({ stage: "done", progress: 1 });

  expect(moss.calls[0].op).toBe("createIndex");
  expect(moss.calls[0].name).toBe(`family-${dad.familyId}`);
  const docs = moss.calls[0].arg as { id: string; metadata: Record<string, string> }[];
  expect(docs[0]).toMatchObject({ id: `${recipeId}:step:1`, metadata: { kind: "step", stepOrder: "1", startS: "60", endS: "330" } });
  expect(docs.some((d) => d.metadata.kind === "story")).toBe(true);
  expect(Object.values(docs[0].metadata).every((x) => typeof x === "string")).toBe(true);

  // The cook takes the stories back: they leave the index and the kid's view.
  await t.mutation(api.recipes.setMemoriesOptIn, { sessionToken: dad.sessionToken, recipeId, optIn: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(moss.calls.map((c) => c.op)).toEqual(["createIndex", "addDocs", "deleteDocs"]);
  expect((await t.query(api.recipes.get, { sessionToken: leo.sessionToken, recipeId }))!.memories).toEqual([]);
});

test("the voice service: session, steps, and questions that go to the cook", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);

  expect((await post(t, "/voice/session", { sessionToken: leo.sessionToken, recipeId }, {})).status).toBe(401);
  expect((await post(t, "/voice/session", { sessionToken: "x".repeat(43), recipeId }, asVoice)).status).toBe(401);
  expect((await post(t, "/voice/session", { sessionToken: leo.sessionToken, recipeId: "nope" }, asVoice)).status).toBe(404);
  const session = await (await post(t, "/voice/session", { sessionToken: leo.sessionToken, recipeId }, asVoice)).json();
  expect(session).toMatchObject({
    kid: { name: "Leo", role: "kid" },
    mossIndex: `family-${leo.familyId}`,
    recipe: { recipeId, title: "Sunday Chili", cookName: "Dad" },
    stepOrder: 1,
  });
  expect(session.recipe.steps).toHaveLength(2);

  expect((await post(t, "/voice/step", { sessionToken: leo.sessionToken, recipeId, stepOrder: 9 }, asVoice)).status).toBe(400);
  expect((await post(t, "/voice/step", { sessionToken: leo.sessionToken, recipeId, stepOrder: 2 }, asVoice)).status).toBe(200);
  expect(await t.query(api.cooking.current, { sessionToken: dad.sessionToken })).toMatchObject([
    { kidName: "Leo", recipeTitle: "Sunday Chili", stepOrder: 2, stepCount: 2 },
  ]);

  const found = await post(
    t,
    "/voice/question",
    { sessionToken: leo.sessionToken, recipeId, stepOrder: 1, text: "How brown?", found: { startS: 60, endS: 90, quote: "Let it argue with you." } },
    asVoice,
  );
  expect(await found.json()).toMatchObject({ status: "found_in_video" });
  const asked = await (
    await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, stepOrder: 2, text: "Canned beans ok?" }, asVoice)
  ).json();
  expect(asked.status).toBe("asked_cook");

  const open = await t.query(api.questions.openForCook, { sessionToken: dad.sessionToken });
  expect(open).toMatchObject([{ _id: asked.questionId, text: "Canned beans ok?", askedByName: "Leo", recipeTitle: "Sunday Chili" }]);
  expect(await t.query(api.questions.openForCook, { sessionToken: leo.sessionToken })).toEqual([]);

  await expect(
    t.mutation(api.questions.answer, { sessionToken: leo.sessionToken, questionId: asked.questionId, text: "sure" }),
  ).rejects.toThrow("Only the cook");
  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId: asked.questionId, text: "Yes, rinse them." });
  const all = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(all.find((q) => q._id === asked.questionId)).toMatchObject({ status: "answered", answer: { text: "Yes, rinse them." } });
  expect(await t.query(api.questions.openForCook, { sessionToken: dad.sessionToken })).toEqual([]);

  await t.mutation(api.cooking.finish, { sessionToken: leo.sessionToken });
  expect(await t.query(api.cooking.current, { sessionToken: dad.sessionToken })).toEqual([]);
});

test("a voice-note answer is transcribed by Cartesia Ink", async () => {
  process.env.CARTESIA_API_KEY = "car-test";
  const fetch = stubFetch(undefined, (url) =>
    url === "https://api.cartesia.ai/stt" ? Response.json({ type: "transcript", text: " Yes, rinse them first. " }) : undefined,
  );
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const asked = await (
    await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, text: "Canned beans ok?" }, asVoice)
  ).json();
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));

  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId: asked.questionId, audioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const sttCall = fetch.mock.calls.find(([u]) => u === "https://api.cartesia.ai/stt")!;
  const headers = sttCall[1]?.headers as Record<string, string>;
  expect(headers["Cartesia-Version"]).toBe("2026-08-14");
  expect(headers.Authorization).toBe("Bearer car-test");
  const form = sttCall[1]?.body as FormData;
  expect(form.get("model")).toBe("ink-whisper");
  expect((form.get("file") as File).name).toBe("answer.m4a");

  const [q] = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(q.answer).toMatchObject({ audioId, transcript: "Yes, rinse them first." });
  expect(q.answerAudioUrl).toBeTypeOf("string");
});

test("messages: privacy, and the photo note Muse Spark drafts", async () => {
  process.env.MUSE_API_KEY = "muse-test";
  const fetch = stubFetch(undefined, (url) =>
    url === "https://api.meta.ai/v1/chat/completions"
      ? Response.json({ choices: [{ message: { content: '"Made your chili, Dad. Not as good as yours yet!"' } }] })
      : undefined,
  );
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const photoId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "image/jpeg" })));

  const { draft, aiDrafted } = await t.action(api.messages.sharePhoto, { sessionToken: leo.sessionToken, recipeId, fileId: photoId });
  expect(aiDrafted).toBe(true);
  expect(draft).toBe("Made your chili, Dad. Not as good as yours yet!");
  const museBody = JSON.parse(fetch.mock.calls.find(([u]) => u === "https://api.meta.ai/v1/chat/completions")![1]!.body as string);
  expect(museBody.model).toBe("muse-spark-1.3");
  expect(museBody.messages[1].content[1].type).toBe("image_url");

  await t.mutation(api.messages.send, {
    sessionToken: leo.sessionToken,
    kind: "photo",
    fileId: photoId,
    recipeId,
    to: dad.personId,
    text: draft + " Thank you!",
    aiDrafted: true,
  });
  await expect(t.mutation(api.messages.send, { sessionToken: leo.sessionToken, kind: "photo" })).rejects.toThrow("Upload");
  await expect(t.mutation(api.messages.send, { sessionToken: leo.sessionToken, kind: "text", text: "  " })).rejects.toThrow();

  const [msg] = await t.query(api.messages.list, { sessionToken: dad.sessionToken });
  expect(msg).toMatchObject({ kind: "photo", aiDrafted: true, fromName: "Leo" });
  expect(msg.fileUrl).toBeTypeOf("string");

  // A message to Dad isn't shown to a third person in the family.
  stubFetch({ family: { id: "fam-1", name: "The Wangs" }, profiles: [{ id: "p-sis", name: "Sis", role: "learner" }] });
  const sis = await signIn(t, "p-sis");
  expect(await t.query(api.messages.list, { sessionToken: sis.sessionToken })).toEqual([]);

  delete process.env.MUSE_API_KEY;
  await expect(
    t.action(api.messages.sharePhoto, { sessionToken: leo.sessionToken, recipeId, fileId: photoId }),
  ).rejects.toThrow("isn't set up");
});

test("Moss: a recipe that loses the race to create the index adds to it; reindexMissing retries", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  moss.raceLost = true; // getIndex says none, createIndex says it exists
  expect(await t.mutation(internal.worker.reindexMissing, {})).toBe(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(moss.calls.map((c) => c.op)).toEqual(["addDocs"]);
  expect((await t.run((ctx) => ctx.db.get("recipes", recipeId)))?.mossIndexedAt).toBeTypeOf("number");
  expect(await t.mutation(internal.worker.reindexMissing, {})).toBe(0);
});
