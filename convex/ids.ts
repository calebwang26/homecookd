// HTTP bodies carry ids as plain strings; these check that a string is an id of that table.
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const job = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.null(), v.id("jobs")),
  handler: async (ctx, { id }) => ctx.db.normalizeId("jobs", id),
});

export const deletion = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.null(), v.id("accountDeletions")),
  handler: async (ctx, { id }) => ctx.db.normalizeId("accountDeletions", id),
});

export const recipe = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.null(), v.id("recipes")),
  handler: async (ctx, { id }) => ctx.db.normalizeId("recipes", id),
});
