// What the live voice service reads through /voice/session (http.ts): who is cooking and the recipe
// they're cooking, checked against the kid's own session token.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { findSession } from "./lib/auth";

const moment = v.object({ startS: v.number(), endS: v.number() });
type Moment = { startS: number; endS: number };

const overlap = (a: Moment, b: Moment) => Math.max(0, Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS));

/** The step a memory was told during: the one whose moment overlaps it most (none if no overlap). */
function stepOf(steps: Doc<"recipes">["steps"], m: Moment): number | undefined {
  let best: { order: number; s: number } | undefined;
  for (const st of steps) {
    const s = overlap(st.moment, m);
    if (s > 0 && (!best || s > best.s)) best = { order: st.order, s };
  }
  return best?.order;
}

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
        cookLanguage: v.string(), // the cook's own language (Ink code), for homie's greeting word
        cookRelation: v.optional(v.string()),
        steps: v.array(
          v.object({
            order: v.number(),
            title: v.string(),
            text: v.string(),
            quote: v.optional(v.string()),
            quoteOriginal: v.optional(v.string()),
            moment,
          }),
        ),
        memories: v.array(
          v.object({ kind: v.union(v.literal("story"), v.literal("tip")), text: v.string(), moment, stepOrder: v.optional(v.number()) }),
        ),
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
        cookLanguage: cook?.language ?? recipe.language ?? "en",
        cookRelation: cook?.relation,
        steps: recipe.steps,
        memories: recipe.memoriesOptIn ? recipe.memories.map((m) => ({ ...m, stepOrder: stepOf(recipe.steps, m.moment) })) : [],
      },
    };
  },
});
