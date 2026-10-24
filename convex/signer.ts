// The upload signer (cloud/signer) asks this before it lets a signed-in phone cancel a job or delete a
// recipe: the id must belong to the caller's family, and only a cook may do either.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireSession } from "./lib/auth";

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
