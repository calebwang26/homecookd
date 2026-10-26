// What the pipeline worker does to Convex, through the /worker/* routes in http.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { CANCELLED } from "./jobs";
import { kidNames } from "./lib/forKids";
import { liveEvent, liveLog } from "./liveEvents";
import schema, { memory } from "./schema";

const moment = v.object({ startS: v.number(), endS: v.number() });
const RELEASE_DELAY_MS = 30_000;

const homieEntry = v.object({
  atS: v.number(),
  kind: schema.tables.homiePrompts.validator.fields.kind,
  text: v.string(),
  textEn: v.string(),
  said: v.optional(v.object({ atS: v.number(), endS: v.number() })),
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
      said: p.said && { atS: t(p.said.atS), endS: t(p.said.endS) },
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
      forKidName: v.optional(v.string()), // only when it's for exactly one kid
      forKidNames: v.array(v.string()),
      memoriesOptIn: v.optional(v.boolean()),
      // The plate photo homie asked for at the end of an in-app phone recording: use it as the cover.
      coverUrl: v.optional(v.string()),
      homieLog: v.array(homieEntry),
      // Glasses through the laptop bridge: the live analysis (video seconds) as hints, the spans it missed,
      // and the spans with no footage at all.
      liveLog: v.array(liveEvent),
      liveGaps: v.array(moment),
      videoGaps: v.array(moment),
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
    const kids = await kidNames(ctx, job);
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
      forKidName: kids.length === 1 ? kids[0] : undefined,
      forKidNames: kids,
      memoriesOptIn: recording ? recording.memoriesOptIn : undefined,
      coverUrl: (recording && recording.coverStorageId && (await ctx.storage.getUrl(recording.coverStorageId))) || undefined,
      homieLog: recording ? await homieLog(ctx, recording) : [],
      ...(recording ? await liveLog(ctx, recording) : { liveLog: [], liveGaps: [] }),
      videoGaps: job.videoGaps ?? [],
    };
  },
});

/** The worker found the upload incomplete: the job waits as "uploading" and is queued again in 30 s. */
export const release = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.union(v.literal("ok"), v.literal("cancelled"), v.literal("no")),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (job?.error === CANCELLED) return "cancelled"; // the cook stopped it while it waited for the video
    if (!job || job.stage !== "preparing") return "no"; // only the worker that just claimed it
    await ctx.db.patch("jobs", jobId, { stage: "uploading", progress: 0, claimedAt: undefined });
    await ctx.scheduler.runAfter(RELEASE_DELAY_MS, internal.worker.requeue, { jobId });
    return "ok";
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
  returns: v.union(v.literal("ok"), v.literal("missing"), v.literal("cancelled")),
  handler: async (ctx, { jobId, stage, progress, error }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) return "missing";
    // The cook stopped it: a worker mid-way can't bring it back, and is told to stop (HTTP 409).
    if (job.error === CANCELLED) return "cancelled";
    await ctx.db.patch("jobs", jobId, {
      stage,
      progress: Math.min(1, Math.max(0, progress)),
      error: stage === "failed" ? (error ?? "Something went wrong.").slice(0, 500) : undefined,
    });
    const recipe = stage === "failed" && job.recipeId && (await ctx.db.get("recipes", job.recipeId));
    if (recipe) await ctx.db.patch("recipes", recipe._id, { status: "failed" }); // gone if its cook deleted her account
    return "ok";
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
  returns: v.union(v.id("recipes"), v.literal("missing"), v.literal("cancelled")),
  handler: async (ctx, { jobId, recipe, memoriesOptIn }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) return "missing";
    if (job.error === CANCELLED) return "cancelled";
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
 *  without search still cooks), then runs again if something changed meanwhile, or, after a Moss error,
 *  tries again in `retry.inMs` (moss.ts; the family's sync stays held meanwhile). */
export const synced = internalMutation({
  args: {
    familyId: v.id("families"),
    recipeIds: v.array(v.id("recipes")),
    ok: v.boolean(),
    retry: v.optional(v.object({ attempt: v.number(), inMs: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, { familyId, recipeIds, ok, retry }) => {
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
    if (family && retry) {
      // The retry sends everything as it is then, so a change meanwhile needs no run of its own.
      await ctx.db.patch("families", familyId, { mossSync: { startedAt: now, again: false } });
      await ctx.scheduler.runAfter(retry.inMs, internal.moss.syncFamily, { familyId, attempt: retry.attempt });
    } else if (family?.mossSync?.again) {
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
