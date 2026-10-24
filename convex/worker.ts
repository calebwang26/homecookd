// What the pipeline worker does to Convex, through the /worker/* routes in http.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import schema, { memory } from "./schema";

const moment = v.object({ startS: v.number(), endS: v.number() });
const RELEASE_DELAY_MS = 30_000;

const homieEntry = v.object({
  atS: v.number(),
  kind: schema.tables.homiePrompts.validator.fields.kind,
  text: v.string(),
  textEn: v.string(),
  answer: v.optional(
    v.object({ transcript: v.string(), transcriptEn: v.optional(v.string()), atS: v.number(), endS: v.number() }),
  ),
});

/** What homie said while this video was filmed, on the video's own clock (atS is from recordings.startedAt;
 *  the glasses' first frame can come later), oldest first. Anything said before the video started is left out. */
async function homieLog(ctx: QueryCtx, recording: Doc<"recordings">) {
  const shift =
    recording.startedAt !== undefined && recording.videoStartedAt !== undefined
      ? (recording.startedAt - recording.videoStartedAt) / 1000
      : 0;
  const t = (s: number) => Math.round((s + shift) * 10) / 10;
  const prompts = await ctx.db
    .query("homiePrompts")
    .withIndex("by_recordingId", (q) => q.eq("recordingId", recording._id))
    .take(200);
  return prompts
    .map((p) => ({
      atS: t(p.atS),
      kind: p.kind,
      text: p.text,
      textEn: p.textEn,
      answer: p.answer && { ...p.answer, atS: t(p.answer.atS), endS: t(p.answer.endS) },
    }))
    .filter((p) => p.atS >= 0)
    .sort((a, b) => a.atS - b.atS);
}

/** The oldest queued job, now marked as preparing, or null. */
export const claim = internalMutation({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("jobs"),
      recipeId: v.union(v.null(), v.id("recipes")),
      familyId: v.id("families"),
      supabaseFamilyId: v.string(),
      cookId: v.id("people"),
      cookName: v.string(),
      relation: v.optional(v.string()),
      uploadPath: v.string(),
      source: v.union(v.literal("phone"), v.literal("glasses")),
      title: v.optional(v.string()),
      language: v.string(),
      forKidName: v.optional(v.string()),
      memoriesOptIn: v.optional(v.boolean()),
      homieLog: v.array(homieEntry),
    }),
  ),
  handler: async (ctx) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_stage", (q) => q.eq("stage", "queued"))
      .first();
    if (!job) return null;
    await ctx.db.patch("jobs", job._id, { stage: "preparing", claimedAt: Date.now() });
    const family = await ctx.db.get("families", job.familyId);
    const cook = await ctx.db.get("people", job.cookId);
    const kid = job.forKidId && (await ctx.db.get("people", job.forKidId));
    const recording = job.recordingId && (await ctx.db.get("recordings", job.recordingId));
    return {
      jobId: job._id,
      recipeId: job.recipeId ?? null,
      familyId: job.familyId,
      supabaseFamilyId: family?.supabaseFamilyId ?? "",
      cookId: job.cookId,
      cookName: cook?.name ?? "",
      relation: cook?.relation,
      uploadPath: job.uploadPath,
      source: job.source,
      title: job.title,
      language: job.language ?? cook?.language ?? "en",
      forKidName: kid ? kid.name : undefined,
      memoriesOptIn: recording ? recording.memoriesOptIn : undefined,
      homieLog: recording ? await homieLog(ctx, recording) : [],
    };
  },
});

/** The worker found the upload incomplete: the job waits as "uploading" and is queued again in 30 s. */
export const release = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job || job.stage !== "preparing") return false; // only the worker that just claimed it
    await ctx.db.patch("jobs", jobId, { stage: "uploading", progress: 0, claimedAt: undefined });
    await ctx.scheduler.runAfter(RELEASE_DELAY_MS, internal.worker.requeue, { jobId });
    return true;
  },
});

export const requeue = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (job?.stage === "uploading") await ctx.db.patch("jobs", jobId, { stage: "queued" });
    return null;
  },
});

export const progress = internalMutation({
  args: {
    jobId: v.id("jobs"),
    stage: v.union(
      v.literal("preparing"),
      v.literal("understanding"),
      v.literal("writing"),
      v.literal("indexing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    progress: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { jobId, stage, progress, error }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) return false;
    await ctx.db.patch("jobs", jobId, {
      stage,
      progress: Math.min(1, Math.max(0, progress)),
      error: stage === "failed" ? (error ?? "Something went wrong.").slice(0, 500) : undefined,
    });
    if (stage === "failed" && job.recipeId) await ctx.db.patch("recipes", job.recipeId, { status: "failed" });
    return true;
  },
});

/** Saves the finished recipe and hands it to Moss; the job is done once indexing finishes. */
export const published = internalMutation({
  args: {
    jobId: v.id("jobs"),
    recipe: v.object({
      title: v.string(),
      libraryId: v.optional(v.string()),
      coverUrl: v.optional(v.string()),
      recipeJsonUrl: v.optional(v.string()),
      steps: v.array(
        v.object({
          order: v.number(),
          title: v.string(),
          text: v.string(),
          quote: v.optional(v.string()),
          quoteOriginal: v.optional(v.string()),
          moment,
        }),
      ),
      memories: v.array(memory),
      language: v.optional(v.string()),
    }),
    memoriesOptIn: v.optional(v.boolean()),
  },
  returns: v.union(v.null(), v.id("recipes")),
  handler: async (ctx, { jobId, recipe, memoriesOptIn }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) return null;
    let recipeId = job.recipeId;
    const fields = { ...recipe, language: recipe.language ?? job.language };
    if (recipeId && (await ctx.db.get("recipes", recipeId))) {
      await ctx.db.patch("recipes", recipeId, {
        ...fields,
        status: "ready",
        mossIndexedAt: undefined,
        ...(memoriesOptIn === undefined ? {} : { memoriesOptIn }),
      });
    } else {
      recipeId = await ctx.db.insert("recipes", {
        ...fields,
        familyId: job.familyId,
        cookId: job.cookId,
        status: "ready",
        memoriesOptIn: memoriesOptIn ?? false,
      });
    }
    await ctx.db.patch("jobs", jobId, { recipeId, stage: "indexing", progress: 0.95, error: undefined });
    await requestMossSync(ctx, job.familyId);
    return recipeId;
  },
});

// ---- Moss: one sync per family at a time ----

const SYNC_STALE_MS = 10 * 60 * 1000; // a sync that never reported back (crashed action) stops blocking

/** Asks for the family's Moss index to be brought up to date. Starts a sync, or, if one is
 *  running, marks it to go again once it finishes, so writes never overlap. */
export async function requestMossSync(ctx: MutationCtx, familyId: Id<"families">) {
  const family = await ctx.db.get("families", familyId);
  if (!family) return;
  const running = family.mossSync && Date.now() - family.mossSync.startedAt < SYNC_STALE_MS;
  if (running) {
    if (!family.mossSync!.again) await ctx.db.patch("families", familyId, { mossSync: { ...family.mossSync!, again: true } });
    return;
  }
  await ctx.db.patch("families", familyId, { mossSync: { startedAt: Date.now(), again: false } });
  await ctx.scheduler.runAfter(0, internal.moss.syncFamily, { familyId });
}

/** Every ready recipe in the family: a sync always sends all of them. */
export const syncInput = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.array(schema.doc("recipes")),
  handler: async (ctx, { familyId }) => {
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .take(200);
    return recipes.filter((r) => r.status === "ready");
  },
});

/** After a sync: marks what was indexed, finishes the jobs waiting on it (done either way: a recipe
 *  without search still cooks), then runs again if something changed meanwhile. */
export const synced = internalMutation({
  args: { familyId: v.id("families"), recipeIds: v.array(v.id("recipes")), ok: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { familyId, recipeIds, ok }) => {
    const now = Date.now();
    for (const id of recipeIds) {
      if (ok && (await ctx.db.get("recipes", id))) await ctx.db.patch("recipes", id, { mossIndexedAt: now });
    }
    const included = new Set<string>(recipeIds);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .order("desc")
      .take(50);
    for (const job of jobs) {
      if (job.stage === "indexing" && job.recipeId && included.has(job.recipeId)) {
        await ctx.db.patch("jobs", job._id, { stage: "done", progress: 1 });
      }
    }
    const family = await ctx.db.get("families", familyId);
    if (family?.mossSync?.again) {
      await ctx.db.patch("families", familyId, { mossSync: { startedAt: now, again: false } });
      await ctx.scheduler.runAfter(0, internal.moss.syncFamily, { familyId });
    } else if (family) {
      await ctx.db.patch("families", familyId, { mossSync: undefined });
    }
    return null;
  },
});

/** Re-syncs every family with a recipe Moss doesn't have yet (after a Moss outage):
 *    npx convex run worker:reindexMissing */
export const reindexMissing = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const families = new Set<Id<"families">>();
    for await (const r of ctx.db.query("recipes")) {
      if (r.status === "ready" && r.mossIndexedAt === undefined) families.add(r.familyId);
    }
    for (const familyId of families) await requestMossSync(ctx, familyId);
    return families.size;
  },
});
