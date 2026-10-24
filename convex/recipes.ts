import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireSession, type Signed } from "./lib/auth";
import schema from "./schema";
import { requestMossSync } from "./worker";

const recipeView = schema.doc("recipes").extend({ cookName: v.string() });

/** The recipe, if it belongs to this family. */
export async function familyRecipe(ctx: QueryCtx, signed: Signed, recipeId: Id<"recipes">) {
  const recipe = await ctx.db.get("recipes", recipeId);
  return recipe && recipe.familyId === signed.family._id ? recipe : null;
}

/** Stories and tips show only once the cook said yes, except to the cook. */
function forViewer(recipe: Doc<"recipes">, signed: Signed) {
  const show = recipe.memoriesOptIn || recipe.cookId === signed.person._id;
  return show ? recipe : { ...recipe, memories: [] };
}

export const list = query({
  args: { sessionToken: v.string() },
  returns: v.array(recipeView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(100);
    const names = new Map<Id<"people">, string>();
    for (const r of recipes) {
      if (!names.has(r.cookId)) names.set(r.cookId, (await ctx.db.get("people", r.cookId))?.name ?? "");
    }
    return recipes.map((r) => ({ ...forViewer(r, signed), cookName: names.get(r.cookId) ?? "" }));
  },
});

export const get = query({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.union(v.null(), recipeView),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe) return null;
    const cook = await ctx.db.get("people", recipe.cookId);
    return { ...forViewer(recipe, signed), cookName: cook?.name ?? "" };
  },
});

/** The cook's yes (or no) to sharing the stories and tips from this video. */
export const setMemoriesOptIn = mutation({
  args: { sessionToken: v.string(), recipeId: v.id("recipes"), optIn: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, recipeId, optIn }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe) throw new ConvexError("That recipe isn't here anymore.");
    if (recipe.cookId !== signed.person._id) throw new ConvexError("Only the cook can share these.");
    await ctx.db.patch("recipes", recipeId, { memoriesOptIn: optIn });
    if (recipe.status === "ready") await requestMossSync(ctx, recipe.familyId);
    return null;
  },
});
