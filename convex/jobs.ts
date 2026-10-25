// A cook's upload going through the pipeline. The app creates the job once the upload has started
// (jobs.create is idempotent per upload folder, so the phone retries it until it lands);
// the worker (worker.ts, over HTTP) claims it and reports each stage, and the cook's phone watches.
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireCook, requireSession } from "./lib/auth";
import { familyKids, forKidArgs, forKidFields, forKids } from "./lib/forKids";
import { languageCode } from "./people";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

export const create = mutation({
  args: {
    sessionToken: v.string(),
    uploadPath: v.string(),
    source: v.union(v.literal("phone"), v.literal("glasses")),
    title: v.optional(v.string()),
    language: v.optional(v.string()),
    ...forKidArgs,
    recordingId: v.optional(v.id("recordings")), // homie's live session for this video
  },
  returns: v.object({ jobId: v.id("jobs"), recipeId: v.id("recipes") }),
  handler: async (ctx, args) => {
    const signed = await requireSession(ctx, args.sessionToken);
    requireCook(signed);
    const path = args.uploadPath.trim();
    if (!path || path.length > 500 || path.includes("..") || path.startsWith("/")) {
      throw new ConvexError("Upload the video before sending it.");
    }
    const familyId = signed.family._id;
    const cookId = signed.person._id;
    // An upload folder belongs to the family whose phone sent it: never another family's videos (a
    // worker reads them, and deletes them when the job is stopped).
    const sameFolder = await ctx.db
      .query("jobs")
      .withIndex("by_uploadPath", (q) => q.eq("uploadPath", path))
      .order("desc")
      .take(20);
    if (sameFolder.some((j) => j.familyId !== familyId)) throw new ConvexError("Upload the video before sending it.");
    // Idempotent per folder: the phone asks again until it hears back (a lost answer, a relaunch), so a
    // second call gets the job the first one made, never a second recipe. (A stopped one stays stopped.)
    const made = sameFolder.find((j) => j.recipeId);
    if (made?.recipeId) return { jobId: made._id, recipeId: made.recipeId };

    const recording = args.recordingId && (await ctx.db.get("recordings", args.recordingId));
    if (args.recordingId && (!recording || recording.familyId !== familyId || recording.cookId !== cookId)) {
      throw new ConvexError("That recording isn't yours.");
    }
    const title = (args.title?.trim() || recording?.dish?.trim() || "").slice(0, 120) || undefined;
    let language = signed.person.language ?? "en";
    if (args.language !== undefined) {
      const code = languageCode(args.language);
      if (!code) throw new ConvexError("Pick a language from the list.");
      language = code;
    } else if (recording) {
      language = recording.language;
    }
    // The kids picked on Send, else the ones picked before homie's recording.
    const named = forKids(args).length ? args : recording || {};
    const kids = await familyKids(ctx, familyId, named, "That person isn't in your family.");

    // A "processing" card shows in the library right away; the worker fills it in when it publishes.
    const recipeId = await ctx.db.insert("recipes", {
      familyId,
      cookId,
      title: title ?? "New recipe",
      status: "processing",
      steps: [],
      memories: [],
      memoriesOptIn: false,
      language,
    });
    const jobId = await ctx.db.insert("jobs", {
      familyId,
      cookId,
      recipeId,
      uploadPath: path,
      source: args.source,
      title,
      language,
      ...forKidFields(kids),
      recordingId: recording ? recording._id : undefined,
      stage: "queued",
      progress: 0,
    });
    if (recording) await ctx.db.patch("recordings", recording._id, { jobId, updatedAt: Date.now() });
    return { jobId, recipeId };
  },
});

export const forFamily = query({
  args: { sessionToken: v.string() },
  returns: v.array(schema.doc("jobs")),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    return await ctx.db
      .query("jobs")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(20);
  },
});

/** What a cancelled job says; worker.progress leaves a job with it alone, so a worker mid-way can't revive it. */
export const CANCELLED = "Cancelled.";
const FINISHED = new Set(["done", "failed"]);

async function cancelJob(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  if (FINISHED.has(job.stage)) return false;
  await ctx.db.patch(job._id, { stage: "failed", progress: 0, error: CANCELLED, claimedAt: undefined });
  if (job.recipeId) await ctx.db.patch(job.recipeId, { status: "failed" });
  return true;
}

/** The cook stops one of her family's jobs (the progress row's cancel). Queued: no worker takes it. Running: the worker's reports are ignored. */
export const cancel = mutation({
  args: { sessionToken: v.string(), jobId: v.id("jobs") },
  returns: v.boolean(),
  handler: async (ctx, { sessionToken, jobId }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const job = await ctx.db.get(jobId);
    if (!job || job.familyId !== signed.family._id) return false;
    return await cancelJob(ctx, job);
  },
});

/**
 * The same stop by the upload folder, for a phone that doesn't have the Convex job id (its live list
 * hasn't loaded, or matched nothing): `uploadId` is the signer's job id, the folder jobs.create got as
 * "<uploadId>/". Stops every unfinished job of her family from that folder; true when one was stopped.
 */
export const cancelUpload = mutation({
  args: { sessionToken: v.string(), uploadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { sessionToken, uploadId }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const id = uploadId.trim();
    if (!id || id.length > 100 || id.includes("/")) return false;
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(200);
    let stopped = false;
    for (const job of jobs) if (job.uploadPath === `${id}/` && (await cancelJob(ctx, job))) stopped = true;
    return stopped;
  },
});

/** Clears the whole pipeline (every family): `npx convex run jobs:cancelUnfinished`. Returns how many it cancelled. */
export const cancelUnfinished = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let n = 0;
    for (const stage of ["uploading", "queued", "preparing", "understanding", "writing", "indexing"] as const) {
      for (const job of await ctx.db.query("jobs").withIndex("by_stage", (q) => q.eq("stage", stage)).take(500)) {
        if (await cancelJob(ctx, job)) n++;
      }
    }
    return n;
  },
});
