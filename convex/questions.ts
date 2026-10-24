// A kid's question while cooking. The voice service records it (/voice/question): the video answered
// it (Moss found the moment) or it goes to the cook, who answers by text or voice note. A "share" ask
// (shareRequests.ts) reaches her the same way.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireCook, requireSession } from "./lib/auth";
import { geminiTranslate } from "./lib/translate";
import { familyRecipe } from "./recipes";
import schema from "./schema";

const MAX_TEXT = 2000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const questionView = schema.doc("questions").extend({
  recipeTitle: v.string(),
  askedByName: v.string(),
  answerAudioUrl: v.union(v.null(), v.string()),
});

async function view(ctx: QueryCtx, q: Doc<"questions">, recipeTitle?: string) {
  const asker = await ctx.db.get("people", q.askedBy);
  const audioId = q.answer?.audioId;
  return {
    ...q,
    recipeTitle: recipeTitle ?? (await ctx.db.get("recipes", q.recipeId))?.title ?? "",
    askedByName: asker?.name ?? "",
    answerAudioUrl: audioId ? await ctx.storage.getUrl(audioId) : null,
  };
}

export const forRecipe = query({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.array(questionView),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe) return [];
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .order("desc")
      .take(100);
    // A share ask isn't about cooking: cook mode never plays its answer.
    const cooking = questions.filter((q) => q.kind !== "share");
    return await Promise.all(cooking.map((q) => view(ctx, q, recipe.title)));
  },
});

/** Questions waiting on this cook (the ones about recipes they cooked). */
export const openForCook = query({
  args: { sessionToken: v.string() },
  returns: v.array(questionView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    if (signed.person.role !== "cook") return [];
    const open = await ctx.db
      .query("questions")
      .withIndex("by_familyId_and_status", (q) => q.eq("familyId", signed.family._id).eq("status", "asked_cook"))
      .order("desc")
      .take(100);
    const mine = [];
    for (const q of open) {
      const recipe = await ctx.db.get("recipes", q.recipeId);
      if (recipe?.cookId === signed.person._id) mine.push(await view(ctx, q, recipe.title));
    }
    return mine;
  },
});

export const answer = mutation({
  args: {
    sessionToken: v.string(),
    questionId: v.id("questions"),
    text: v.optional(v.string()),
    audioId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken, questionId, text, audioId }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const question = await ctx.db.get("questions", questionId);
    if (!question || question.familyId !== signed.family._id) throw new ConvexError("That question isn't here anymore.");
    if (question.status !== "asked_cook") throw new ConvexError("That question already has an answer.");
    // Sharing a recipe is its cook's yes alone, not any cook's in the family.
    if (question.kind === "share" && (await ctx.db.get("recipes", question.recipeId))?.cookId !== signed.person._id) {
      throw new ConvexError("Only the recipe's cook can answer this.");
    }
    const words = text?.trim() || undefined;
    if (!words && !audioId) throw new ConvexError("Say or type an answer first.");
    if (words && words.length > MAX_TEXT) throw new ConvexError("That answer is too long.");
    if (audioId) {
      const file = await ctx.db.system.get("_storage", audioId);
      if (!file) throw new ConvexError("Upload the voice note before sending it.");
      if (file.size > MAX_AUDIO_BYTES) throw new ConvexError("That voice note is too long.");
    }
    await ctx.db.patch("questions", questionId, {
      status: "answered",
      answer: { by: signed.person._id, text: words, audioId },
    });
    if (audioId) await ctx.scheduler.runAfter(0, internal.transcribe.questionAnswer, { questionId });
    // A typed yes is read now; a voice note once its transcript is in (transcribe.saveTranscript).
    else if (question.kind === "share") await ctx.scheduler.runAfter(0, internal.shareRequests.decide, { questionId });
    return null;
  },
});

/** From the voice service (/voice/question). */
export const ask = internalMutation({
  args: {
    familyId: v.id("families"),
    personId: v.id("people"),
    recipeId: v.id("recipes"),
    stepOrder: v.optional(v.number()),
    text: v.string(),
    found: v.optional(v.object({ startS: v.number(), endS: v.number(), quote: v.string() })),
  },
  returns: v.union(
    v.null(),
    v.object({ questionId: v.id("questions"), status: v.union(v.literal("found_in_video"), v.literal("asked_cook")) }),
  ),
  handler: async (ctx, { familyId, personId, recipeId, stepOrder, text, found }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    if (!recipe || recipe.familyId !== familyId) return null;
    const status = found ? ("found_in_video" as const) : ("asked_cook" as const);
    const questionId = await ctx.db.insert("questions", {
      familyId,
      recipeId,
      stepOrder,
      askedBy: personId,
      text: text.slice(0, MAX_TEXT),
      status,
      found: found && { moment: { startS: found.startS, endS: found.endS }, quote: found.quote.slice(0, MAX_TEXT) },
    });
    if (status === "asked_cook") {
      const language = (await ctx.db.get("people", recipe.cookId))?.language;
      if (language && language !== "en") {
        await ctx.scheduler.runAfter(0, internal.questions.translateForCook, { questionId, language });
      }
    }
    return { questionId, status };
  },
});

/** The kid's question in the cook's language (textForCook). On any failure it stays English only. */
export const translateForCook = internalAction({
  args: { questionId: v.id("questions"), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { questionId, language }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY isn't set; question left in English only");
      return null;
    }
    const text = await ctx.runQuery(internal.questions.textOf, { questionId });
    if (!text) return null;
    try {
      const textForCook = (await geminiTranslate(text, apiKey, language)).slice(0, MAX_TEXT);
      await ctx.runMutation(internal.questions.saveTextForCook, { questionId, textForCook });
    } catch (e) {
      console.error(e);
    }
    return null;
  },
});

export const textOf = internalQuery({
  args: { questionId: v.id("questions") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { questionId }) => (await ctx.db.get("questions", questionId))?.text ?? null,
});

export const saveTextForCook = internalMutation({
  args: { questionId: v.id("questions"), textForCook: v.string() },
  returns: v.null(),
  handler: async (ctx, { questionId, textForCook }) => {
    if (await ctx.db.get("questions", questionId)) await ctx.db.patch("questions", questionId, { textForCook });
    return null;
  },
});
