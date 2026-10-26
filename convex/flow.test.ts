import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import chili from "../data/synthetic/dad-sunday-chili.json";
import { addRecipe, type Backend, CLAUDE, claudeReply, newBackend, signIn, stubFetch } from "./test.helpers";

type Doc = { id: string; text: string; metadata: Record<string, string> };
// A stand-in for Moss that keeps each index's docs, so a test can check what ended up searchable.
const moss = vi.hoisted(() => ({
  calls: [] as { op: string; name: string; arg: unknown }[],
  indexes: new Map<string, Map<string, unknown>>(),
}));
vi.mock("@moss-js/moss", () => ({
  MossClient: class {
    async getDocs(name: string) {
      const index = moss.indexes.get(name);
      if (!index) throw new Error("not found");
      return [...index.values()];
    }
    async createIndex(name: string, docs: Doc[]) {
      if (moss.indexes.has(name)) throw new Error("index already exists");
      moss.calls.push({ op: "createIndex", name, arg: docs });
      moss.indexes.set(name, new Map(docs.map((d) => [d.id, d])));
    }
    async addDocs(name: string, docs: Doc[]) {
      moss.calls.push({ op: "addDocs", name, arg: docs });
      for (const d of docs) moss.indexes.get(name)!.set(d.id, d);
    }
    async deleteDocs(name: string, ids: string[]) {
      moss.calls.push({ op: "deleteDocs", name, arg: ids });
      for (const id of ids) moss.indexes.get(name)!.delete(id);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  moss.calls = [];
  moss.indexes.clear();
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
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.TEXT_PROVIDER;
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
  expect(form.get("language")).toBe("en");
  expect(fetch.mock.calls.some(([u]) => String(u).includes("generativelanguage"))).toBe(false);

  const [q] = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(q.answer).toMatchObject({ audioId, transcript: "Yes, rinse them first." });
  expect(q.answerAudioUrl).toBeTypeOf("string");
});

test("a Marathi voice-note answer keeps the cook's words and adds English", async () => {
  process.env.CARTESIA_API_KEY = "car-test";
  process.env.GEMINI_API_KEY = "gem-test";
  const marathi = "हो आधी तांदूळ तीन वेळा धुवून घे.";
  const gemini = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
  const fetch = stubFetch(
    undefined,
    (url) => (url === "https://api.cartesia.ai/stt" ? Response.json({ text: ` ${marathi} ` }) : undefined),
    (url) =>
      url === gemini
        ? Response.json({ candidates: [{ content: { parts: [{ text: "Yes, first wash the rice three times." }] } }] })
        : undefined,
  );
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  await t.mutation(internal.seed.language, { personId: dad.personId, language: "mr" });
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const asked = await (
    await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, text: "Wash the rice?" }, asVoice)
  ).json();
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));

  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId: asked.questionId, audioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const form = fetch.mock.calls.find(([u]) => u === "https://api.cartesia.ai/stt")![1]?.body as FormData;
  expect(form.get("language")).toBe("mr");
  // The first Gemini call put the question into Marathi for her (questions.textForCook); the last is her answer.
  const geminiCall = fetch.mock.calls.findLast(([u]) => u === gemini)!;
  expect((geminiCall[1]?.headers as Record<string, string>)["x-goog-api-key"]).toBe("gem-test");
  expect(JSON.parse(geminiCall[1]?.body as string).contents[0].parts[0].text).toBe(marathi);

  const [q] = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(q.answer).toMatchObject({ audioId, transcript: marathi, translation: "Yes, first wash the rice three times." });
  expect(q.answerAudioUrl).toBeTypeOf("string"); // the kid still hears the cook's own voice
});

test("with TEXT_PROVIDER=claude, Claude writes the English of her Marathi voice note", async () => {
  process.env.CARTESIA_API_KEY = "car-test";
  process.env.TEXT_PROVIDER = "claude";
  process.env.ANTHROPIC_API_KEY = "ant-test";
  const marathi = "हो आधी तांदूळ तीन वेळा धुवून घे.";
  const fetch = stubFetch(
    undefined,
    (url) => (url === "https://api.cartesia.ai/stt" ? Response.json({ text: ` ${marathi} ` }) : undefined),
    (url, init) => {
      if (url !== CLAUDE) return undefined;
      const { messages } = JSON.parse(String(init?.body));
      const translation = messages[0].content === marathi ? "Yes, first wash the rice three times." : "तांदूळ धुवायचे का?";
      return claudeReply(JSON.stringify({ translation }));
    },
  );
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  await t.mutation(internal.seed.language, { personId: dad.personId, language: "mr" });
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const asked = await (
    await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, text: "Wash the rice?" }, asVoice)
  ).json();
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));
  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId: asked.questionId, audioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [q] = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(q.answer).toMatchObject({ audioId, transcript: marathi, translation: "Yes, first wash the rice three times." });
  const toEnglish = JSON.parse(String(fetch.mock.calls.findLast(([u]) => u === CLAUDE)![1]?.body));
  expect(toEnglish.system).toContain("into plain English");
  expect(fetch.mock.calls.some(([u]) => String(u).startsWith("https://generativelanguage."))).toBe(false);
});

test("a failed translation still saves the cook's words", async () => {
  process.env.CARTESIA_API_KEY = "car-test";
  process.env.GEMINI_API_KEY = "gem-test";
  stubFetch(
    undefined,
    (url) => (url === "https://api.cartesia.ai/stt" ? Response.json({ text: "हो." }) : undefined),
    (url) => (url.startsWith("https://generativelanguage.googleapis.com/") ? new Response("busy", { status: 503 }) : undefined),
  );
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  await t.mutation(internal.seed.language, { personId: dad.personId, language: "mr" });
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const asked = await (
    await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, text: "Wash the rice?" }, asVoice)
  ).json();
  const audioId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));
  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId: asked.questionId, audioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [q] = await t.query(api.questions.forRecipe, { sessionToken: leo.sessionToken, recipeId });
  expect(q.answer?.transcript).toBe("हो.");
  expect(q.answer?.translation).toBeUndefined();
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

test("Moss: one sync per family at a time; a change during a sync runs one more pass", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const chiliId = await addRecipe(t, dad.familyId, dad.personId);
  const porkId = await addRecipe(t, dad.familyId, dad.personId);

  expect(await t.mutation(internal.worker.reindexMissing, {})).toBe(1);
  // Asked again while the first sync hasn't run: no second sync starts beside it.
  await t.mutation(internal.worker.reindexMissing, {});
  const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(pending.filter((f) => f.name.includes("syncFamily") && f.state.kind === "pending")).toHaveLength(1);
  expect((await t.run((ctx) => ctx.db.get("families", dad.familyId)))?.mossSync).toMatchObject({ again: true });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // Two passes, one after the other: create, then the "again" pass.
  expect(moss.calls.map((c) => c.op)).toEqual(["createIndex", "addDocs"]);
  const index = moss.indexes.get(`family-${dad.familyId}`)!;
  expect(index.has(`${chiliId}:step:1`) && index.has(`${porkId}:step:1`)).toBe(true);
  expect(index.size).toBe(6); // 2 steps + 1 story, for each recipe
  expect((await t.run((ctx) => ctx.db.get("families", dad.familyId)))?.mossSync).toBeUndefined();
  expect((await t.run((ctx) => ctx.db.get("recipes", porkId)))?.mossIndexedAt).toBeTypeOf("number");
  expect(await t.mutation(internal.worker.reindexMissing, {})).toBe(0);
});

test("Moss: a sync that never reported back stops blocking after 10 minutes", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  await addRecipe(t, dad.familyId, dad.personId);
  await t.run((ctx) => ctx.db.patch("families", dad.familyId, { mossSync: { startedAt: Date.now() - 11 * 60_000, again: false } }));
  expect(await t.mutation(internal.worker.reindexMissing, {})).toBe(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(moss.calls.map((c) => c.op)).toEqual(["createIndex"]);
});
