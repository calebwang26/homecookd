// The upload signer (cloud/signer) asks this before it lets a signed-in phone cancel a job or delete a
// recipe: the id must belong to the caller's family, and only a cook may do either.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession } from "./lib/auth";
import { hitBuckets, LIMITS } from "./lib/rateLimit";

export const owns = query({
  args: { sessionToken: v.string(), kind: v.union(v.literal("job"), v.literal("recipe")), id: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { sessionToken, kind, id }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    if (person.role !== "cook" || !id || id.length > 100) return false;
    if (kind === "job") {
      // The signer's job id is the folder the phone uploads into: jobs.create gets `<job_id>/`.
      const jobs = await ctx.db.query("jobs").withIndex("by_familyId", (q) => q.eq("familyId", family._id)).order("desc").take(500);
      return jobs.some((j) => j.uploadPath === `${id}/` || j.uploadPath.startsWith(`${id}/`));
    }
    const recipes = await ctx.db.query("recipes").withIndex("by_familyId", (q) => q.eq("familyId", family._id)).take(500);
    return recipes.some((r) => r.libraryId === id);
  },
});

/**
 * And before it signs upload links: only a cook sends recordings (jobs.create refuses anyone else's), and each person
 * gets so many a day, because a signed link can't limit a file's size.
 */
export const allowUpload = mutation({
  args: { sessionToken: v.string() },
  returns: v.union(v.literal("ok"), v.literal("cook_only"), v.literal("too_many")),
  handler: async (ctx, { sessionToken }) => {
    const { person } = await requireSession(ctx, sessionToken);
    if (person.role !== "cook") return "cook_only";
    const { bucket, max, windowMs } = LIMITS.signerUploads;
    return (await hitBuckets(ctx, [{ key: `${bucket}:${person._id}`, max, windowMs }])) ? "ok" : "too_many";
  },
});
