// What the live voice service reads through /voice/session (http.ts): who is cooking and the recipe
// they're cooking, checked against the kid's own session token.
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { findSession } from "./lib/auth";

const moment = v.object({ startS: v.number(), endS: v.number() });

export const sessionView = internalQuery({
  args: { sessionToken: v.string(), recipeId: v.string() },
  returns: v.union(
    v.object({ error: v.union(v.literal("signed_out"), v.literal("no_recipe")) }),
    v.object({
      kid: v.object({ personId: v.id("people"), name: v.string(), role: v.union(v.literal("cook"), v.literal("kid")) }),
      familyId: v.id("families"),
      mossIndex: v.string(),
      recipe: v.object({
        recipeId: v.id("recipes"),
        title: v.string(),
        cookName: v.string(),
        steps: v.array(v.object({ order: v.number(), title: v.string(), text: v.string(), quote: v.optional(v.string()), quoteOriginal: v.optional(v.string()), moment })),
        memories: v.array(v.object({ kind: v.union(v.literal("story"), v.literal("tip")), text: v.string(), moment })),
      }),
    }),
  ),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return { error: "signed_out" as const };
    const id = ctx.db.normalizeId("recipes", recipeId);
    const recipe = id && (await ctx.db.get("recipes", id));
    if (!recipe || recipe.familyId !== signed.family._id || recipe.status !== "ready") {
      return { error: "no_recipe" as const };
    }
    const cook = await ctx.db.get("people", recipe.cookId);
    return {
      kid: { personId: signed.person._id, name: signed.person.name, role: signed.person.role },
      familyId: signed.family._id,
      mossIndex: `family-${signed.family._id}`,
      recipe: {
        recipeId: recipe._id,
        title: recipe.title,
        cookName: cook?.name ?? "",
        steps: recipe.steps,
        memories: recipe.memoriesOptIn ? recipe.memories : [],
      },
    };
  },
});
