// What the pipeline worker does to Convex, through the /worker/* routes in http.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";

const moment = v.object({ startS: v.number(), endS: v.number() });

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
      uploadPath: v.string(),
      source: v.union(v.literal("phone"), v.literal("glasses")),
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
    return {
      jobId: job._id,
      recipeId: job.recipeId ?? null,
      familyId: job.familyId,
      supabaseFamilyId: family?.supabaseFamilyId ?? "",
      cookId: job.cookId,
      cookName: cook?.name ?? "",
      uploadPath: job.uploadPath,
      source: job.source,
    };
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
      steps: v.array(v.object({ order: v.number(), title: v.string(), text: v.string(), quote: v.optional(v.string()), moment })),
      memories: v.array(v.object({ kind: v.union(v.literal("story"), v.literal("tip")), text: v.string(), moment })),
    }),
    memoriesOptIn: v.optional(v.boolean()),
  },
  returns: v.union(v.null(), v.id("recipes")),
  handler: async (ctx, { jobId, recipe, memoriesOptIn }) => {
    const job = await ctx.db.get("jobs", jobId);
    if (!job) return null;
    let recipeId = job.recipeId;
    if (recipeId && (await ctx.db.get("recipes", recipeId))) {
      await ctx.db.patch("recipes", recipeId, {
        ...recipe,
        status: "ready",
        mossIndexedAt: undefined,
        ...(memoriesOptIn === undefined ? {} : { memoriesOptIn }),
      });
    } else {
      recipeId = await ctx.db.insert("recipes", {
        ...recipe,
        familyId: job.familyId,
        cookId: job.cookId,
        status: "ready",
        memoriesOptIn: memoriesOptIn ?? false,
      });
    }
    await ctx.db.patch("jobs", jobId, { recipeId, stage: "indexing", progress: 0.95, error: undefined });
    await ctx.scheduler.runAfter(0, internal.moss.indexRecipe, { recipeId, jobId });
    return recipeId;
  },
});

export const indexInput = internalQuery({
  args: { recipeId: v.id("recipes") },
  returns: v.union(v.null(), schema.doc("recipes")),
  handler: async (ctx, { recipeId }) => await ctx.db.get("recipes", recipeId),
});

/** After Moss: the job is done either way (a recipe without search still cooks). */
export const indexed = internalMutation({
  args: { recipeId: v.id("recipes"), jobId: v.optional(v.id("jobs")), indexed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { recipeId, jobId, indexed }) => {
    if (indexed && (await ctx.db.get("recipes", recipeId))) {
      await ctx.db.patch("recipes", recipeId, { mossIndexedAt: Date.now() });
    }
    const job = jobId && (await ctx.db.get("jobs", jobId));
    if (job && job.stage === "indexing") await ctx.db.patch("jobs", job._id, { stage: "done", progress: 1 });
    return null;
  },
});

/** Re-sends every recipe Moss doesn't have yet (after a Moss outage):
 *    npx convex run worker:reindexMissing */
export const reindexMissing = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let n = 0;
    for await (const r of ctx.db.query("recipes")) {
      if (r.status !== "ready" || r.mossIndexedAt !== undefined) continue;
      await ctx.scheduler.runAfter(n * 2000, internal.moss.indexRecipe, { recipeId: r._id });
      n++;
    }
    return n;
  },
});
