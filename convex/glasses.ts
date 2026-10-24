// What the glasses VM does to Convex, through the /glasses/* routes in lib/glassesRoutes.ts
// (glasses/INGEST.md). There is one pair of glasses for the hackathon, so "active" is simply the newest
// glasses recording.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const status = v.union(
  v.literal("intro"),
  v.literal("recording"),
  v.literal("wrapping_up"),
  v.literal("ended"),
  v.literal("abandoned"),
);
const live = v.object({
  recordingId: v.id("recordings"),
  status,
  startedAt: v.optional(v.number()),
  jobId: v.optional(v.id("jobs")), // set once someone (the laptop bridge or the VM) has finished it
});

// A forgotten recording (the phone died mid-intro) shouldn't keep the glasses filming the next day.
const STALE_MS = 12 * 60 * 60 * 1000;

const report = (r: Doc<"recordings">) => ({ recordingId: r._id, status: r.status, startedAt: r.startedAt, jobId: r.jobId });

/**
 * The newest glasses recording that isn't over, or null. With `recordingId`, that recording in any
 * status instead, so the VM can tell "ended" (upload it) from "abandoned" (don't).
 */
export const active = internalQuery({
  args: { recordingId: v.optional(v.string()) },
  returns: v.union(v.null(), live),
  handler: async (ctx, { recordingId }) => {
    if (recordingId !== undefined) {
      const id = ctx.db.normalizeId("recordings", recordingId);
      const r = id && (await ctx.db.get(id));
      return r && r.source === "glasses" ? report(r) : null;
    }
    let newest: Doc<"recordings"> | null = null;
    for (const s of ["intro", "recording", "wrapping_up"] as const) {
      const rows = await ctx.db
        .query("recordings")
        .withIndex("by_status", (q) => q.eq("status", s))
        .order("desc")
        .take(20);
      const r = rows.find((row) => row.source === "glasses");
      if (r && (!newest || r._creationTime > newest._creationTime)) newest = r;
    }
    if (!newest || Date.now() - newest._creationTime > STALE_MS) return null;
    return report(newest);
  },
});

/**
 * The VM uploaded the MP4: create the "processing" card and the queued job, as jobs.create does, with
 * the recording's dish, language and kid. Calling it again returns the same job.
 */
export const finished = internalMutation({
  args: {
    recordingId: v.string(),
    uploadPath: v.string(),
    videoStartedAt: v.number(),
    videoGaps: v.optional(v.array(v.object({ startS: v.number(), endS: v.number() }))),
  },
  returns: v.union(
    v.object({ jobId: v.id("jobs"), recipeId: v.id("recipes") }),
    v.object({ error: v.string(), status: v.union(v.literal(400), v.literal(404)) }),
  ),
  handler: async (ctx, { recordingId, uploadPath, videoStartedAt, videoGaps }) => {
    const id = ctx.db.normalizeId("recordings", recordingId);
    const rec = id && (await ctx.db.get(id));
    if (!rec || rec.source !== "glasses") return { error: "no such glasses recording", status: 404 as const };
    if (rec.status === "abandoned") return { error: "the recording was abandoned", status: 400 as const };

    const existing = rec.jobId && (await ctx.db.get(rec.jobId));
    if (existing?.recipeId) return { jobId: existing._id, recipeId: existing.recipeId };

    const recipeId = await ctx.db.insert("recipes", {
      familyId: rec.familyId,
      cookId: rec.cookId,
      title: rec.dish ?? "New recipe",
      status: "processing",
      steps: [],
      memories: [],
      memoriesOptIn: false,
    });
    const jobId = await ctx.db.insert("jobs", {
      familyId: rec.familyId,
      cookId: rec.cookId,
      recipeId,
      uploadPath,
      source: "glasses",
      title: rec.dish,
      language: rec.language,
      forKidId: rec.forKidId,
      recordingId: rec._id,
      stage: "queued",
      progress: 0,
      videoGaps,
    });
    await ctx.db.patch(rec._id, { videoStartedAt, jobId, updatedAt: Date.now() });
    return { jobId, recipeId };
  },
});
