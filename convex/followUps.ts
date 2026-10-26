// The pipeline's own questions about a recipe (recipe.json follow_up_questions), asked of its cook. /worker/published
// hands them over; each becomes one of her open questions (questions.kind "followUp", askedBy = her, shown as homie's).
// Most are open gaps ("how long does it boil?") she answers like any question. One with an `ingredient` asks whether
// something the video's frames showed went in (pipeline/seen.py): her answer is read as yes, no or unclear
// (lib/yesNo.ts, on the English when there is one), and only a clear yes from the cook adds it to
// recipes.addedIngredients, with her words for how much. recipe.json itself never changes here.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { FollowUp } from "./lib/recipeJson";
import { textKeyName, textModel } from "./lib/textModel";
import { type YesNo, yesNo } from "./lib/yesNo";

export const followUpArg = v.object({
  id: v.string(),
  question: v.string(),
  step: v.optional(v.number()),
  ingredient: v.optional(v.string()),
});

const MAX_SAID = 300;

/** Adds each follow-up she hasn't been asked yet (by its recipe.json id) as an open question to the cook. */
export async function askFollowUps(
  ctx: MutationCtx,
  to: { recipeId: Id<"recipes">; familyId: Id<"families">; cookId: Id<"people"> },
  followUps: FollowUp[],
): Promise<void> {
  const existing = await ctx.db
    .query("questions")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", to.recipeId))
    .take(200);
  const asked = new Set(existing.flatMap((q) => (q.followUp ? [q.followUp.id] : [])));
  const cook = await ctx.db.get("people", to.cookId);
  for (const f of followUps) {
    if (asked.has(f.id)) continue;
    asked.add(f.id);
    const questionId = await ctx.db.insert("questions", {
      familyId: to.familyId,
      recipeId: to.recipeId,
      stepOrder: f.step,
      askedBy: to.cookId,
      text: f.question,
      kind: "followUp",
      followUp: { id: f.id, ingredient: f.ingredient },
      status: "asked_cook",
    });
    if (cook?.language && cook.language !== "en") {
      await ctx.scheduler.runAfter(0, internal.questions.translateForCook, { questionId, language: cook.language });
    }
  }
}

/** An answered ingredient question still to be read: the ingredient and her words (English when there is one). */
export const answerFor = internalQuery({
  args: { questionId: v.id("questions") },
  returns: v.union(v.null(), v.object({ ingredient: v.string(), answer: v.string() })),
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get("questions", questionId);
    const ingredient = q?.followUp?.ingredient;
    if (q?.kind !== "followUp" || !ingredient || q.status !== "answered" || !q.answer || q.followUp?.said) return null;
    return { ingredient, answer: answerWords(q) };
  },
});

function answerWords(q: Doc<"questions">): string {
  return (q.answer?.translation ?? q.answer?.transcript ?? q.answer?.text ?? "").trim();
}

async function readAnswer(ingredient: string, answer: string): Promise<YesNo> {
  if (!answer) return "unclear";
  const model = textModel();
  if (!model) {
    console.warn(`${textKeyName()} isn't set; a follow-up answer can't be read, so nothing is added`);
    return "unclear";
  }
  return await yesNo(`Did you add ${ingredient} to this dish?`, answer, model).catch((e) => {
    console.error(e);
    return "unclear" as const;
  });
}

/** After her answer is in (typed, or the voice note's transcript, or a note nobody could write out). */
export const decide = internalAction({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const found = await ctx.runQuery(internal.followUps.answerFor, { questionId });
    if (!found) return null;
    const said = await readAnswer(found.ingredient, found.answer);
    await ctx.runMutation(internal.followUps.settle, { questionId, said });
    return null;
  },
});

/** Notes how her answer read (once). A yes from the recipe's own cook adds the ingredient, once. */
export const settle = internalMutation({
  args: { questionId: v.id("questions"), said: v.union(v.literal("yes"), v.literal("no"), v.literal("unclear")) },
  returns: v.null(),
  handler: async (ctx, { questionId, said }) => {
    const q = await ctx.db.get("questions", questionId);
    const f = q?.followUp;
    if (q?.kind !== "followUp" || !f?.ingredient || q.status !== "answered" || f.said) return null;
    await ctx.db.patch("questions", questionId, { followUp: { ...f, said } });
    if (said !== "yes") return null;
    const recipe = await ctx.db.get("recipes", q.recipeId);
    if (!recipe || recipe.familyId !== q.familyId || q.answer?.by !== recipe.cookId) return null;
    const added = recipe.addedIngredients ?? [];
    const name = f.ingredient;
    if (added.some((a) => a.name.toLowerCase() === name.toLowerCase())) return null;
    const words = answerWords(q).slice(0, MAX_SAID) || undefined;
    await ctx.db.patch("recipes", recipe._id, {
      addedIngredients: [...added, { name, said: words, step: q.stepOrder, questionId }],
    });
    return null;
  },
});
