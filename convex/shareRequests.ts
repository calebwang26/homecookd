// "Put it on the map" for a family dish. Only its cook can share a recipe, so when someone else in the
// family asks, homie asks her: it becomes one of her open questions (questions.kind "share"), with
// textForCook in her language once Gemini translates it. The parent screens must show textForCook
// (LiveQuestions and the walkie-talkie do from #35 on), or she reads the English. She answers by voice
// or text like any other question. Only a clear yes shares it (lib/yesNo.ts reads the English when
// there is one, against a fixed question); no, unclear, or no readable answer leaves it private, and
// then nobody in the family can ask her again for a day. Her own tap on her own dish shares it at once.
// Nobody outside the family can ask.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { shareOn } from "./community";
import { requireSession } from "./lib/auth";
import { flagged, recipeWords } from "./lib/moderation";
import { geminiYesNo, type YesNo } from "./lib/yesNo";
import { familyRecipe } from "./recipes";

/** What the yes/no reader is told she was asked. Fixed: never the stored question, whose words come from the family. */
export const YES_NO_QUESTION = "May homie put your recipe on the neighborhood map?";
/** After a no or an unclear answer, the family waits this long to ask her again. */
export const ASK_AGAIN_MS = 24 * 60 * 60_000;

/**
 * TODO(caleb): the words homie asks the cook with (translated for her when she doesn't speak English).
 * The culture is Muse's guess at where the dish is from ("Maharashtrian"), shown on the map card.
 */
export function shareQuestion(askerName: string, dish: string): string {
  const who = askerName.trim() || "Someone in your family";
  return `${who} wants to put your ${dish} on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?`;
}

async function latestAsk(ctx: QueryCtx, recipeId: Id<"recipes">): Promise<Doc<"questions"> | null> {
  const asked = await ctx.db
    .query("questions")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .order("desc")
    .take(100);
  return asked.find((q) => q.kind === "share") ?? null;
}

/**
 * Where the newest ask stands. `open`: waiting on her, or on homie reading what she said.
 * `notNowAt`: when homie read a no or an unclear answer (null otherwise).
 */
function askState(q: Doc<"questions"> | null): { open: boolean; notNowAt: number | null } {
  if (!q) return { open: false, notNowAt: null };
  if (!q.shareDecision) return { open: true, notNowAt: null };
  return { open: false, notNowAt: q.shareDecision.said === "yes" ? null : q.shareDecision.at };
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
    const last = askState(await latestAsk(ctx, recipeId));
    if (last.open) return "asked";
    const cook = await ctx.db.get("people", recipe.cookId);
    if (last.notNowAt !== null && Date.now() - last.notNowAt < ASK_AGAIN_MS) {
      throw new ConvexError(`${cook?.name.trim() || "The cook"} said not now. Ask again tomorrow.`);
    }
    const questionId = await ctx.db.insert("questions", {
      familyId: signed.family._id,
      recipeId,
      askedBy: signed.person._id,
      text: shareQuestion(signed.person.name, recipe.title),
      status: "asked_cook",
      kind: "share",
      shareRecipeId: recipeId,
    });
    if (cook?.language && cook.language !== "en") {
      await ctx.scheduler.runAfter(0, internal.questions.translateForCook, { questionId, language: cook.language });
    }
    return "asked";
  },
});

/**
 * My family's ready dishes for the "Share your recipe" chooser: whose, mine, on the map, asked, and
 * `notNowAt` (when she last said not now; the app compares it with ASK_AGAIN_MS on its own clock).
 */
export const familyDishes = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      recipeId: v.id("recipes"),
      dish: v.string(),
      cookName: v.string(),
      mine: v.boolean(),
      shared: v.boolean(),
      asked: v.boolean(),
      notNowAt: v.union(v.null(), v.number()),
    }),
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
      const state = r.sharedAt ? { open: false, notNowAt: null } : askState(await latestAsk(ctx, r._id));
      out.push({
        recipeId: r._id,
        dish: r.title,
        cookName: (await ctx.db.get("people", r.cookId))?.name ?? "",
        mine: r.cookId === signed.person._id,
        shared: !!r.sharedAt,
        asked: state.open,
        notNowAt: state.notNowAt,
      });
    }
    return out;
  },
});

/** Her answer to a share ask, in English when there is one ("" when there are no words to read); null when there's nothing to decide. */
export const answerFor = internalQuery({
  args: { questionId: v.id("questions") },
  returns: v.union(v.null(), v.object({ answer: v.string() })),
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get("questions", questionId);
    if (q?.kind !== "share" || q.status !== "answered" || !q.answer || q.shareDecision) return null;
    return { answer: (q.answer.translation ?? q.answer.transcript ?? q.answer.text ?? "").trim() };
  },
});

async function readAnswer(answer: string): Promise<YesNo> {
  if (!answer) return "unclear";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY isn't set; a share answer can't be read, so nothing is shared");
    return "unclear";
  }
  return await geminiYesNo(YES_NO_QUESTION, answer, apiKey).catch((e) => {
    console.error(e);
    return "unclear" as const;
  });
}

/** After her answer is in (typed, or the voice note's transcript, or a note nobody could write out): only a clear yes shares the dish. */
export const decide = internalAction({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const found = await ctx.runQuery(internal.shareRequests.answerFor, { questionId });
    if (!found) return null;
    const said = await readAnswer(found.answer);
    await ctx.runMutation(internal.shareRequests.settle, { questionId, said });
    return null;
  },
});

/** Notes what homie read (once). A yes is checked once more: a share ask about her own ready recipe, answered by her. */
export const settle = internalMutation({
  args: { questionId: v.id("questions"), said: v.union(v.literal("yes"), v.literal("no"), v.literal("unclear")) },
  returns: v.null(),
  handler: async (ctx, { questionId, said }) => {
    const q = await ctx.db.get("questions", questionId);
    if (q?.kind !== "share" || q.status !== "answered" || q.shareDecision) return null;
    await ctx.db.patch("questions", questionId, { shareDecision: { said, at: Date.now() } });
    if (said === "yes") await applyYes(ctx, q);
    return null;
  },
});

async function applyYes(ctx: MutationCtx, q: Doc<"questions">): Promise<void> {
  if (!q.shareRecipeId || q.shareRecipeId !== q.recipeId) return;
  const recipe = await ctx.db.get("recipes", q.shareRecipeId);
  if (!recipe || recipe.familyId !== q.familyId || recipe.status !== "ready" || recipe.sharedAt) return;
  if (q.answer?.by !== recipe.cookId) return;
  if (flagged(...recipeWords(recipe))) return; // the word filter keeps it in the family (shareOn would throw)
  await shareOn(ctx, recipe);
}
