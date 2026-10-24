// A cook's upload going through the pipeline. The app creates the job after the video is in GCS;
// the worker (worker.ts, over HTTP) claims it and reports each stage, and the cook's phone watches.
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCook, requireSession } from "./lib/auth";
import schema from "./schema";

export const create = mutation({
  args: {
    sessionToken: v.string(),
    uploadPath: v.string(),
    source: v.union(v.literal("phone"), v.literal("glasses")),
  },
  returns: v.object({ jobId: v.id("jobs"), recipeId: v.id("recipes") }),
  handler: async (ctx, { sessionToken, uploadPath, source }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const path = uploadPath.trim();
    if (!path || path.length > 500 || path.includes("..") || path.startsWith("/")) {
      throw new ConvexError("Upload the video before sending it.");
    }
    const familyId = signed.family._id;
    const cookId = signed.person._id;
    // A "processing" card shows in the library right away; the worker fills it in when it publishes.
    const recipeId = await ctx.db.insert("recipes", {
      familyId,
      cookId,
      title: "New recipe",
      status: "processing",
      steps: [],
      memories: [],
      memoriesOptIn: false,
    });
    const jobId = await ctx.db.insert("jobs", {
      familyId,
      cookId,
      recipeId,
      uploadPath: path,
      source,
      stage: "queued",
      progress: 0,
    });
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
