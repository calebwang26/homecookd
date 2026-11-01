// Reads for the temporary one-way sync into Postgres (docs/build/SYNC-MIGRATION.md), through lib/syncRoutes.ts. Queries only, so nothing here can
// write, and only the three copied tables and a deletion's ids. Comes off with the sync.
//
// What leaves Convex is named field by field, so a field added to these tables later stays here until someone gives it a column in Postgres and adds it
// below. A test fails when the schema and these lists part, to make that a decision.
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import schema from "./schema";

export const FAMILY_FIELDS = ["_id", "_creationTime", "name", "supabaseFamilyId", "publicName", "mossSync"] as const;
export const PERSON_FIELDS = [
  "_id",
  "_creationTime",
  "familyId",
  "supabaseProfileId",
  "name",
  "role",
  "voiceClone",
  "language",
  "relation",
  "approx",
  "campus",
  "deletedAt",
] as const;
export const RECIPE_FIELDS = [
  "_id",
  "_creationTime",
  "familyId",
  "cookId",
  "title",
  "status",
  "libraryId",
  "recipeJsonUrl",
  "coverUrl",
  "steps",
  "memories",
  "memoriesOptIn",
  "mossIndexedAt",
  "language",
  "sharedAt",
  "storyCard",
  "hiddenAt",
  "addedIngredients",
] as const;

function only<T extends object, K extends keyof T>(doc: T, fields: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const field of fields) if (doc[field] !== undefined) out[field] = doc[field];
  return out;
}

export const families = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("families").pick(...FAMILY_FIELDS)),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("families").paginate(paginationOpts);
    return { ...result, page: result.page.map((doc) => only(doc, FAMILY_FIELDS)) };
  },
});

export const people = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("people").pick(...PERSON_FIELDS)),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("people").paginate(paginationOpts);
    return { ...result, page: result.page.map((doc) => only(doc, PERSON_FIELDS)) };
  },
});

export const recipes = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("recipes").pick(...RECIPE_FIELDS)),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("recipes").paginate(paginationOpts);
    return { ...result, page: result.page.map((doc) => only(doc, RECIPE_FIELDS)) };
  },
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
