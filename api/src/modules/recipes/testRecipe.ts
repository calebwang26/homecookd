// Staging only: a made-up ready recipe, because staging has no worker to finish a real job (docs/build/contracts/JOBS.md, "Staging testing"). The route is gated like the
// test sign-in (accounts/testSignIn.ts): it doesn't exist without TEST_SIGNIN_KEY, which production's Terraform refuses, and it checks the same header the same way. It also
// needs a cook's session: the recipe goes in her family, with her as its cook.
//
// It leaves what the worker's publish leaves (pipeline/queue_job.py, queue_worker.py _publish, queue_db.py finish): small made-up files in the media bucket in the worker's
// layout, under a folder named test-recipe-<id>/ so nobody takes it for a family's, a recipe.json shaped as publish.py writes a family's, and a ready row pointing at them.
// Given `jobId`, one of her own jobs that hasn't finished, it finishes that job as the worker's final transaction does, and the job's "processing" card becomes the recipe.
// Given `newestJob: true` instead, it finishes the family's newest queued job, whoever filmed it, as that cook's: a phone test on a real account (Caleb's, Nov 2) films a
// job only its cook can see, so the test cook beside him can't read its id.
// The account purge takes it like any recipe: the row by its cook, the folder by media_prefix.
import { randomBytes } from "node:crypto";
import { requireCook, type Signed } from "../../auth.js";
import { db, tx } from "../../db.js";
import { ApiError, invalid, notFound, providerDown, refused } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { mediaStore } from "../../storage.js";
import * as jobs from "../jobs/data.js";
import { cookOf } from "../people/reads.js";
import { mediaUrl } from "./media.js";
import { notMoved, recipeWrites } from "./switch.js";
import { DURATION_S, HEIGHT, PLAY_MP4, STILL_JPG, VOICE_M4A, WIDTH } from "./testMedia.js";
import { saveTestRecipe } from "./writes.js";

/** Every step gets at least 2 seconds of the video. */
export const MAX_STEPS = DURATION_S / 2;
const LIMIT = { bucket: "test-recipe", max: 60, windowS: 3600 };
// publish.py's: media is cached for an hour, recipe.json must update at once.
const MEDIA_CACHE = "public, max-age=3600";
const JSON_CACHE = "no-cache, max-age=0";
export const DEFAULT_TITLE = "Masala chai (test recipe)";

export const TEST_RECIPE_BODY = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 120 },
    steps: { type: "array", minItems: 1, maxItems: MAX_STEPS, items: { type: "string", minLength: 1, maxLength: 1000 } },
    jobId: { type: "string", minLength: 1, maxLength: 100 },
    newestJob: { type: "boolean" },
  },
};

export type TestRecipeAsk = { title?: string; steps?: string[]; jobId?: string; newestJob?: boolean };

type MadeStep = { title: string; instruction: string; quote?: string; substeps?: string[]; uses?: { name: string; amount: string }[] };

const CHAI: MadeStep[] = [
  {
    title: "Boil the water",
    instruction: "Bring the water to a boil with the ginger and cardamom.",
    quote: "Let the ginger boil properly, don't rush it.",
    substeps: ["Pour **2 cups** of water into a pot.", "Add the ginger and cardamom.", "Bring it to a **boil**."],
    uses: [{ name: "water", amount: "~2 cups" }, { name: "ginger", amount: "~1 inch" }, { name: "cardamom", amount: "~2 pods" }],
  },
  {
    title: "Add the tea",
    instruction: "Add the tea leaves and let it simmer for two minutes, until the water turns dark.",
    substeps: ["Add the tea leaves.", "Simmer for **2 minutes**.", "Ready when it's **dark brown**."],
    uses: [{ name: "tea leaves", amount: "~2 tsp" }],
  },
  {
    title: "Add the milk",
    instruction: "Pour in the milk and sugar, bring it back to a boil, then strain it into cups.",
    substeps: ["Pour in the milk and sugar.", "Bring it back to a **boil**.", "Strain it into cups."],
    uses: [{ name: "milk", amount: "~1 cup" }, { name: "sugar", amount: "~2 tsp" }],
  },
];

const INGREDIENTS = [
  { name: "water", feel: "two cups, a little over", estimate: "~2 cups", confidence: "medium", first_seen_s: 1 },
  { name: "ginger", feel: "a thumb's worth, crushed", estimate: "~1 inch", confidence: "low", first_seen_s: 2 },
  { name: "cardamom", feel: "two pods, cracked open", estimate: "~2 pods", confidence: "high", first_seen_s: 3 },
  { name: "tea leaves", feel: "two spoons", estimate: "~2 tsp", confidence: "medium", first_seen_s: 9 },
  { name: "milk", feel: "about half the water", estimate: "~1 cup", confidence: "medium", first_seen_s: 17 },
  { name: "sugar", feel: "two spoons, more if you like", estimate: "~2 tsp", confidence: "low", first_seen_s: 18 },
];

/** Step i of n, in whole seconds of the video, as the schema wants: 0 <= start < end <= the video's length. */
const span = (i: number, n: number) => ({ start: Math.floor((i * DURATION_S) / n), end: Math.floor(((i + 1) * DURATION_S) / n) });

function madeSteps(given: string[] | undefined): MadeStep[] {
  if (!given) return CHAI;
  return given.map((text, i) => {
    const instruction = text.trim();
    if (!instruction) throw invalid("steps", "Each step needs some words.");
    return { title: `Step ${i + 1}`, instruction };
  });
}

const finished = (job: jobs.JobRow) => job.cancelled_at !== null || job.stage === "done" || job.stage === "failed";
const alreadyFinished = () => refused(409, "conflict", "That job is already finished.");

/** Her own job that hasn't finished. Anyone else's reads as one that isn't there. */
async function finishable(signed: Signed, jobId: string): Promise<jobs.JobRow> {
  const job = await jobs.jobById(db(), jobId);
  if (!job || job.family_id !== signed.familyId || job.cook_id !== signed.personId) throw notFound();
  if (finished(job)) throw alreadyFinished();
  return job;
}

/** Her family's newest queued job, by any cook in it. Another family's is never one. */
async function newestOfFamily(signed: Signed): Promise<jobs.JobRow> {
  const job = await jobs.newestQueuedJob(db(), signed.familyId);
  if (!job) throw notFound("No job in your family is waiting to finish.");
  return job;
}

/** S3 being down isn't the caller's fault, and nothing was saved. */
async function storage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw Object.assign(providerDown(502, "The media bucket is having trouble. Please try again in a minute."), { cause: error });
  }
}

export async function makeTestRecipe(signed: Signed, ask: TestRecipeAsk, requestId?: string): Promise<{ recipeId: string; recipeUrl: string }> {
  requireCook(signed);
  await hit(subjectKey(signed.personId), [LIMIT]);
  const steps = madeSteps(ask.steps);
  // Everything that can refuse comes before the files, so a refusal leaves nothing in the bucket. The switch and the job are asked again where the rows are written.
  if (ask.jobId && ask.newestJob) throw invalid("newestJob", "Send jobId or newestJob, not both.");
  const job = ask.jobId ? await finishable(signed, ask.jobId) : ask.newestJob ? await newestOfFamily(signed) : null;
  if ((await recipeWrites(db())) !== "open") throw notMoved();
  const cookId = job?.cook_id ?? signed.personId; // the cook who filmed it
  const cook = await cookOf(db(), cookId);
  if (!cook) throw notFound();

  const id = randomBytes(6).toString("hex");
  const folder = `test-recipe-${id}`;
  const attempt = `${folder}/${id}-a1/`; // the worker's <recipe folder>/<job>-a<n>/ (queue_worker.py job_prefix)
  const keys = {
    video: `${attempt}play.mp4`,
    voice: `${attempt}voice.m4a`,
    cover: `${attempt}poster.jpg`,
    steps: steps.map((_, i) => `${attempt}steps/${String(i + 1).padStart(2, "0")}.jpg`),
    json: `${attempt}recipe.json`,
  };
  const recipeUrl = mediaUrl(keys.json); // fails loudly without MEDIA_BASE_URL, before anything is written
  const title = ask.title?.trim() || job?.title?.trim() || DEFAULT_TITLE;
  const language = job?.language ?? cook.language ?? "en";

  try {
    const put = (key: string, bytes: Uint8Array, type: string) =>
      storage(() => mediaStore().write(key, bytes, type, MEDIA_CACHE)).then(({ version }) => ({ url: mediaUrl(key, version ?? "0"), version: version ?? "0" }));
    const [video, voice, cover, ...stills] = await Promise.all([
      put(keys.video, PLAY_MP4, "video/mp4"),
      put(keys.voice, VOICE_M4A, "audio/mp4"),
      put(keys.cover, STILL_JPG, "image/jpeg"),
      ...keys.steps.map((key) => put(key, STILL_JPG, "image/jpeg")),
    ]);

    const timed = steps.map((s, i) => ({ ...s, order: i + 1, ...span(i, steps.length) }));
    // pipeline/schema.py Recipe, as publish.without_memories leaves a family's: the stories and tips are only in the row.
    const recipeJson = {
      id: folder,
      title,
      cook: { name: cook.name, relation: cook.relation || cook.name },
      language,
      intro: "",
      servings: "2 cups",
      total_time: "~10 min",
      sample: false,
      family: true,
      source: null,
      tags: ["test"],
      media: { video_url: video.url, audio_url: voice.url, poster_url: cover.url, duration_s: DURATION_S, width: WIDTH, height: HEIGHT },
      sessions: [{ index: 1, recorded_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), offset_s: 0, duration_s: DURATION_S }],
      ingredients: INGREDIENTS,
      steps: timed.map((s, i) => ({
        order: s.order,
        title: s.title,
        instruction: s.instruction,
        sensory_cue: null,
        start_s: s.start,
        end_s: s.end,
        quote: s.quote ?? null,
        quote_original: null,
        wait_after: null,
        story_ids: [],
        special_ids: [],
        image_url: stills[i].url,
        // align.py's rule: the first at the step's start, then strictly later, all inside the step.
        substeps: s.substeps?.map((text, k, all) => ({ text, detail: null, start_s: s.start + Math.floor((k * (s.end - s.start)) / all.length) })) ?? null,
        uses: s.uses ?? null,
        tip: null,
      })),
      stories: [],
      special: [],
      follow_up_questions: [],
    };
    await storage(() => mediaStore().write(keys.json, new TextEncoder().encode(JSON.stringify(recipeJson, null, 2)), "application/json", JSON_CACHE));

    // pipeline/queue_db.py recipe_row's columns: the steps and her memories as the row keeps them.
    const first = timed[0];
    const last = timed[timed.length - 1];
    const row = {
      familyId: signed.familyId,
      cookId,
      title,
      libraryId: folder,
      mediaPrefix: `${folder}/`,
      recipeJsonKey: keys.json,
      coverKey: keys.cover,
      coverVersion: cover.version,
      steps: timed.map((s) => ({ order: s.order, title: s.title, text: s.instruction, ...(s.quote ? { quote: s.quote } : {}), moment: { startS: s.start, endS: s.end } })),
      memories: [
        {
          kind: "story",
          text: "A made-up story, so the story screens have something to show. My mother made this every morning before school.",
          moment: { startS: first.start, endS: first.end },
          step: 1,
          id: "s1",
          title: "A made-up story",
        },
        { kind: "tip", text: "A made-up tip: let it boil up twice before you strain it.", moment: { startS: last.start, endS: last.end }, step: last.order },
      ],
      language,
    };

    const recipeId = await tx(async (c) => {
      if (!job) return await saveTestRecipe(c, row, null);
      const locked = await jobs.lockJob(c, job.id);
      if (!locked || finished(locked)) throw alreadyFinished(); // a stop got there first
      const saved = await saveTestRecipe(c, row, locked.recipe_id);
      await jobs.finishTestJob(c, locked.id, saved, requestId);
      return saved;
    });
    return { recipeId, recipeUrl };
  } catch (error) {
    // Nothing points at the folder, so nothing would ever take it away.
    await mediaStore()
      .removeMany([keys.video, keys.voice, keys.cover, ...keys.steps, keys.json])
      .catch(() => {});
    throw error;
  }
}
