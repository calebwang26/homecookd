// Reads for the temporary one-way sync into Postgres (docs/build/SYNC-MIGRATION.md), through lib/syncRoutes.ts. Queries only, so nothing here can
// write, and only the three copied tables and a deletion's ids. Comes off with the sync.
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import schema from "./schema";

export const families = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("families")),
  handler: (ctx, { paginationOpts }) => ctx.db.query("families").paginate(paginationOpts),
});

export const people = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("people")),
  handler: (ctx, { paginationOpts }) => ctx.db.query("people").paginate(paginationOpts),
});

export const recipes = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("recipes")),
  handler: (ctx, { paginationOpts }) => ctx.db.query("recipes").paginate(paginationOpts),
});

/** Deletions made after a time, oldest first: ids only, never their file URLs or voice clone id. The sync reads back over an overlap, so this needn't be exact. */
export const deletions = internalQuery({
  args: { after: v.number(), limit: v.number() },
  returns: v.array(
    v.object({
      id: v.id("accountDeletions"),
      creationTime: v.number(),
      personId: v.id("people"),
      familyId: v.id("families"),
      supabaseProfileId: v.string(),
      requestedAt: v.number(),
      recipeIds: v.array(v.id("recipes")),
    }),
  ),
  handler: async (ctx, { after, limit }) => {
    const rows = await ctx.db
      .query("accountDeletions")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", after))
      .take(limit);
    return rows.map((d) => ({
      id: d._id,
      creationTime: d._creationTime,
      personId: d.personId,
      familyId: d.familyId,
      supabaseProfileId: d.supabaseProfileId,
      requestedAt: d.requestedAt,
      recipeIds: d.recipeIds,
    }));
  },
});
