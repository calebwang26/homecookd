// "Put it on the map" for a family dish. Only its cook can share a recipe, so when someone else in the
// family asks, homie asks her: it becomes one of her open questions (questions.kind "share"), in her
// language, answered by voice or text like any other. Only a clear yes shares it (lib/yesNo.ts, on the
// English when there is one); no, unclear, or no answer at all leaves it private. Her own tap on her
// own dish shares it at once. Nobody outside the family can ask.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { shareOn } from "./community";
import { requireSession } from "./lib/auth";
import { geminiYesNo } from "./lib/yesNo";
import { familyRecipe } from "./recipes";

/** TODO(caleb): the words homie asks the cook with (translated for her when she doesn't speak English). */
export function shareQuestion(askerName: string, dish: string): string {
  const who = askerName.trim() || "Someone in your family";
  return `${who} wants to put your ${dish} on the map for neighbors. They'd see the recipe and one line you said, never your video. Is that okay?`;
}

async function openAsk(ctx: QueryCtx, recipeId: Id<"recipes">): Promise<Doc<"questions"> | null> {
  const asked = await ctx.db
    .query("questions")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .take(100);
  return asked.find((q) => q.kind === "share" && q.status === "asked_cook") ?? null;
}

/** "shared": it's on the map (it was, or I'm its cook). "asked": waiting on the cook's answer. */
export const ask = mutation({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.union(v.literal("shared"), v.literal("asked")),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe || recipe.status !== "ready") throw new ConvexError("Pick one of your family's recipes.");
    if (recipe.sharedAt) return "shared";
    if (recipe.cookId === signed.person._id) {
      await shareOn(ctx, recipe);
      return "shared";
    }
    if (await openAsk(ctx, recipeId)) return "asked";
    const questionId = await ctx.db.insert("questions", {
      familyId: signed.family._id,
      recipeId,
      askedBy: signed.person._id,
      text: shareQuestion(signed.person.name, recipe.title),
      status: "asked_cook",
      kind: "share",
      shareRecipeId: recipeId,
    });
    const language = (await ctx.db.get("people", recipe.cookId))?.language;
    if (language && language !== "en") {
      await ctx.scheduler.runAfter(0, internal.questions.translateForCook, { questionId, language });
    }
    return "asked";
  },
});

/** My family's ready dishes for the "Share your recipe" chooser: whose, mine, on the map, asked. */
export const familyDishes = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({ recipeId: v.id("recipes"), dish: v.string(), cookName: v.string(), mine: v.boolean(), shared: v.boolean(), asked: v.boolean() }),
  ),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(100);
    const out = [];
    for (const r of recipes) {
      if (r.status !== "ready") continue;
      out.push({
        recipeId: r._id,
        dish: r.title,
        cookName: (await ctx.db.get("people", r.cookId))?.name ?? "",
        mine: r.cookId === signed.person._id,
        shared: !!r.sharedAt,
        asked: !r.sharedAt && !!(await openAsk(ctx, r._id)),
      });
    }
    return out;
  },
});

/** Her answer to a share ask, in English when there is one; null when there's nothing to read. */
export const answerFor = internalQuery({
  args: { questionId: v.id("questions") },
  returns: v.union(v.null(), v.object({ question: v.string(), answer: v.string() })),
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get("questions", questionId);
    if (q?.kind !== "share" || q.status !== "answered" || !q.answer) return null;
    const answer = (q.answer.translation ?? q.answer.transcript ?? q.answer.text ?? "").trim();
    return answer ? { question: q.text, answer } : null;
  },
});

/** After her answer is in (typed, or the voice note's transcript): only a clear yes shares the dish. */
export const decide = internalAction({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const found = await ctx.runQuery(internal.shareRequests.answerFor, { questionId });
    if (!found) return null;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY isn't set; a share answer can't be read, so nothing is shared");
      return null;
    }
    const said = await geminiYesNo(found.question, found.answer, apiKey).catch((e) => {
      console.error(e);
      return "unclear" as const;
    });
    if (said === "yes") await ctx.runMutation(internal.shareRequests.applyYes, { questionId });
    return null;
  },
});

/** Her yes, checked once more: a share ask about her own ready recipe, answered by her. */
export const applyYes = internalMutation({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get("questions", questionId);
    if (q?.kind !== "share" || q.status !== "answered" || !q.shareRecipeId || q.shareRecipeId !== q.recipeId) return null;
    const recipe = await ctx.db.get("recipes", q.shareRecipeId);
    if (!recipe || recipe.familyId !== q.familyId || recipe.status !== "ready" || recipe.sharedAt) return null;
    if (q.answer?.by !== recipe.cookId) return null;
    await shareOn(ctx, recipe);
    return null;
  },
});
