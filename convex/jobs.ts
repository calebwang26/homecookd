// A cook's upload going through the pipeline. The app creates the job after the video is in GCS;
// the worker (worker.ts, over HTTP) claims it and reports each stage, and the cook's phone watches.
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCook, requireSession } from "./lib/auth";
import { languageCode } from "./people";
import schema from "./schema";

export const create = mutation({
  args: {
    sessionToken: v.string(),
    uploadPath: v.string(),
    source: v.union(v.literal("phone"), v.literal("glasses")),
    title: v.optional(v.string()),
    language: v.optional(v.string()),
    forKidId: v.optional(v.id("people")),
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
    const forKidId = args.forKidId ?? recording?.forKidId;
    if (forKidId) {
      const kid = await ctx.db.get("people", forKidId);
      if (!kid || kid.familyId !== familyId) throw new ConvexError("That person isn't in your family.");
    }

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
      forKidId,
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
