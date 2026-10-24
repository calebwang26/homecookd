// Track F: the cook's language end to end (people.setLanguage, jobs from homie's recordings, the worker's
// homie log and release, Marathi quotes, and the kid's question translated for the cook).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import chili from "../data/synthetic/dad-sunday-chili.json";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({
  MossClient: class {
    async getIndex() {
      return {};
    }
    async addDocs() {}
    async deleteDocs() {}
  },
}));

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  process.env.VOICE_SECRET = "voice-secret-for-tests";
  process.env.MOSS_PROJECT_ID = "proj";
  process.env.MOSS_PROJECT_KEY = "key";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

const post = (t: Backend, path: string, body: unknown, secret: Record<string, string>) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });
const asWorker = { "x-worker-secret": "worker-secret-for-tests" };
const asVoice = { "x-voice-secret": "voice-secret-for-tests" };

/** homie's recording for Dad: filming started at t0, the glasses' first frame 5 s later. */
async function addRecording(t: Backend, familyId: Id<"families">, cookId: Id<"people">, kidId: Id<"people">) {
  return await t.run(async (ctx) => {
    const t0 = 1_700_000_000_000;
    const recordingId = await ctx.db.insert("recordings", {
      familyId,
      cookId,
      forKidId: kidId,
      dish: "Varan Bhaat",
      language: "mr",
      source: "glasses",
      status: "ended",
      startedAt: t0,
      videoStartedAt: t0 + 5000,
      memoriesOptIn: true,
      updatedAt: t0,
    });
    const prompt = (atS: number, kind: "intro" | "amount" | "story", answer?: { atS: number; endS: number }) =>
      ctx.db.insert("homiePrompts", {
        recordingId,
        familyId,
        kind,
        text: "किती मीठ?",
        textEn: "How much salt?",
        atS,
        status: answer ? "answered" : "spoken",
        answer: answer && { transcript: "एक चमचा", transcriptEn: "One spoon", ...answer },
      });
    await prompt(300, "story");
    await prompt(-20, "intro"); // before filming: not in the video
    await prompt(120, "amount", { atS: 124, endS: 130 });
    return recordingId;
  });
}

test("people.me and people.setLanguage", async () => {
  stubFetch();
  const t = newBackend();
  const leo = await signIn(t, "p-leo");
  expect(await t.query(api.people.me, { sessionToken: leo.sessionToken })).toEqual({
    personId: leo.personId,
    name: "Leo",
    role: "kid",
    language: "en",
  });
  await expect(t.mutation(api.people.setLanguage, { sessionToken: leo.sessionToken, language: "Marathi" })).rejects.toThrow(
    "Pick a language",
  );
  await t.mutation(api.people.setLanguage, { sessionToken: leo.sessionToken, language: " MR " });
  expect((await t.query(api.people.me, { sessionToken: leo.sessionToken })).language).toBe("mr");
  await expect(t.query(api.people.me, { sessionToken: "x".repeat(43) })).rejects.toThrow("signed out");
});

test("a job from homie's recording: title, language and kid, then the worker's homie log on the video clock", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const recordingId = await addRecording(t, dad.familyId, dad.personId, leo.personId);

  await expect(
    t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "u/a.mp4", source: "glasses", forKidId: dad.familyId as never }),
  ).rejects.toThrow();
  const notHers = await t.run((ctx) =>
    ctx.db.insert("recordings", { familyId: dad.familyId, cookId: leo.personId, language: "en", source: "phone", status: "ended", updatedAt: 0 }),
  );
  await expect(
    t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "u/a.mp4", source: "phone", recordingId: notHers }),
  ).rejects.toThrow("isn't yours");
  const { jobId, recipeId } = await t.mutation(api.jobs.create, {
    sessionToken: dad.sessionToken,
    uploadPath: "glasses/rec1.mp4",
    source: "glasses",
    recordingId,
  });
  expect((await t.query(api.recipes.get, { sessionToken: leo.sessionToken, recipeId }))?.title).toBe("Varan Bhaat");
  expect((await t.run((ctx) => ctx.db.get("recordings", recordingId)))?.jobId).toBe(jobId);

  const claimed = await (await post(t, "/worker/claim", {}, asWorker)).json();
  expect(claimed).toMatchObject({ jobId, title: "Varan Bhaat", language: "mr", forKidName: "Leo", memoriesOptIn: true });
  // Video clock = atS + (startedAt - videoStartedAt) / 1000 = atS - 5; the intro (-20 s) is left out.
  expect(claimed.homieLog).toEqual([
    {
      atS: 115,
      kind: "amount",
      text: "किती मीठ?",
      textEn: "How much salt?",
      answer: { transcript: "एक चमचा", transcriptEn: "One spoon", atS: 119, endS: 125 },
    },
    { atS: 295, kind: "story", text: "किती मीठ?", textEn: "How much salt?" },
  ]);

  // A plain upload: the cook's own language, the given title, no homie log.
  await t.mutation(internal.seed.language, { personId: dad.personId, language: "mr" });
  const plain = await t.mutation(api.jobs.create, {
    sessionToken: dad.sessionToken,
    uploadPath: "u/b.mov",
    source: "phone",
    title: "  Poha ",
  });
  const second = await (await post(t, "/worker/claim", {}, asWorker)).json();
  expect(second).toMatchObject({ jobId: plain.jobId, title: "Poha", language: "mr", homieLog: [] });
  expect(second.forKidName).toBeUndefined();
});

test("/worker/release hands an incomplete upload back for 30 s", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const { jobId } = await t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "a/", source: "phone" });
  await post(t, "/worker/claim", {}, asWorker);
  expect((await post(t, "/worker/release", { jobId: "bogus" }, asWorker)).status).toBe(404);
  expect(await (await post(t, "/worker/release", { jobId }, asWorker)).json()).toEqual({ ok: true });
  const stage = async () => (await t.run((ctx) => ctx.db.get("jobs", jobId)))?.stage;
  expect(await stage()).toBe("uploading");
  expect((await post(t, "/worker/claim", {}, asWorker)).status).toBe(204);
  vi.advanceTimersByTime(29_000);
  await t.finishInProgressScheduledFunctions();
  expect(await stage()).toBe("uploading");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await stage()).toBe("queued");
  expect((await (await post(t, "/worker/claim", {}, asWorker)).json()).jobId).toBe(jobId);

  await post(t, "/worker/progress", { jobId, stage: "failed", progress: 0, error: "x" }, asWorker);
  expect((await post(t, "/worker/release", { jobId }, asWorker)).status).toBe(404);
});

test("/worker/published keeps the cook's language and her own words", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const { jobId, recipeId } = await t.mutation(api.jobs.create, {
    sessionToken: dad.sessionToken,
    uploadPath: "u/c.mov",
    source: "phone",
    language: "mr",
  });
  await post(t, "/worker/claim", {}, asWorker);
  const recipe = structuredClone(chili) as Record<string, unknown> & { steps: Record<string, unknown>[] };
  recipe.steps[0].quote_original = "चांगलं परतून घ्या";
  expect((await post(t, "/worker/published", { jobId, recipe, language: "Marathi" }, asWorker)).status).toBe(400);
  expect((await post(t, "/worker/published", { jobId, recipe, memoriesOptIn: true }, asWorker)).status).toBe(200);
  const saved = await t.run((ctx) => ctx.db.get("recipes", recipeId));
  expect(saved?.language).toBe("mr"); // from the job
  expect(saved?.steps[0].quoteOriginal).toBe("चांगलं परतून घ्या");
  expect(saved?.steps[1].quoteOriginal).toBeUndefined();
  expect(saved?.memoriesOptIn).toBe(true);
});

test("a question for a Marathi-speaking cook gets textForCook; English cooks and failures don't", async () => {
  process.env.GEMINI_API_KEY = "gem-test";
  let geminiOk = true;
  const fetch = stubFetch(undefined, (url) => {
    if (url !== GEMINI) return undefined;
    return geminiOk
      ? Response.json({ candidates: [{ content: { parts: [{ text: " कॅन मधले बीन्स चालतील का? " }] } }] })
      : new Response("busy", { status: 503 });
  });
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const ask = async (text: string) => {
    const res = await (await post(t, "/voice/question", { sessionToken: leo.sessionToken, recipeId, text }, asVoice)).json();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return (await t.run((ctx) => ctx.db.get("questions", res.questionId as Id<"questions">)))!;
  };

  expect((await ask("Canned beans ok?")).textForCook).toBeUndefined();
  expect(fetch.mock.calls.some(([u]) => String(u) === GEMINI)).toBe(false);

  await t.mutation(internal.seed.language, { personId: dad.personId, language: "mr" });
  expect((await ask("Canned beans ok?")).textForCook).toBe("कॅन मधले बीन्स चालतील का?");
  const call = fetch.mock.calls.find(([u]) => String(u) === GEMINI)!;
  const body = JSON.parse(String(call[1]?.body));
  expect(body.systemInstruction.parts[0].text).toContain("Marathi");
  expect(body.contents[0].parts[0].text).toBe("Canned beans ok?");
  const [open] = await t.query(api.questions.openForCook, { sessionToken: dad.sessionToken });
  expect(open.textForCook).toBe("कॅन मधले बीन्स चालतील का?");

  geminiOk = false;
  expect((await ask("How long?")).textForCook).toBeUndefined();
});
