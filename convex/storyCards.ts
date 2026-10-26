// The Community story card (Muse Spark, labelled AI in the app): one sentence that introduces a shared
// recipe to neighbors, a culture label, and one of the cook's own step quotes, picked by its number.
// community.shareOn schedules writeStoryCard; the pure rules are in lib/storyCard.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { flagged } from "./lib/moderation";
import { type Card, fallbackCard, parseMuseCard, plainStory, quoteChoices, STORY_WORDS, storiesFor } from "./lib/storyCard";

const MUSE_URL = "https://api.meta.ai/v1/chat/completions";
const MUSE_MODEL = "muse-spark-1.3"; // pinned; not a "-contributor" model, which may train on family data

export const storyFacts = internalQuery({
  args: { recipeId: v.id("recipes") },
  returns: v.union(
    v.null(),
    v.object({
      cookName: v.string(),
      dish: v.string(),
      publicName: v.union(v.null(), v.string()),
      steps: v.array(v.string()),
      stories: v.array(v.string()),
      quotes: v.array(v.string()), // her own step quotes; the card may show one of them
    }),
  ),
  handler: async (ctx, { recipeId }) => {
    const r = await ctx.db.get("recipes", recipeId);
    if (!r || !r.sharedAt) return null;
    const family = await ctx.db.get("families", r.familyId);
    return {
      cookName: (await ctx.db.get("people", r.cookId))?.name ?? "",
      dish: r.title,
      publicName: family?.publicName ?? null,
      steps: r.steps.slice(0, 3).map((s) => `${s.title}: ${s.text}`),
      stories: storiesFor(r),
      quotes: quoteChoices(r.steps),
    };
  },
});

export const saveStoryCard = internalMutation({
  args: {
    recipeId: v.id("recipes"),
    text: v.string(),
    usedStories: v.boolean(),
    culture: v.union(v.null(), v.string()),
    quote: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { recipeId, text, usedStories, culture, quote }) => {
    if (await ctx.db.get("recipes", recipeId)) {
      await ctx.db.patch("recipes", recipeId, {
        storyCard: { text, writtenAt: Date.now(), usedStories, culture: culture ?? undefined, quote: quote ?? undefined },
      });
    }
    return null;
  },
});

const CARD_SCHEMA = {
  type: "object",
  properties: { story: { type: "string" }, culture: { type: "string" }, quote: { type: "integer" } },
  required: ["story", "culture", "quote"],
  additionalProperties: false,
};

type Facts = { cookName: string; dish: string; steps: string[]; stories: string[]; quotes: string[] };

/** One Muse call: the sentence, a culture label and the number of one of her quotes (lib/storyCard.ts). */
async function museCard(f: Facts, apiKey: string): Promise<Card | null> {
  const facts = [`Cook: ${f.cookName || "a family cook"}`, `Dish: ${f.dish}`, `First steps:\n${f.steps.join("\n")}`];
  if (f.stories.length) facts.push(`What the cook said while cooking:\n${f.stories.join("\n")}`);
  if (f.quotes.length) facts.push(`The cook's own words, by number:\n${f.quotes.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  const res = await fetch(MUSE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MUSE_MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 1200, // reasoning shares this budget
      response_format: { type: "json_schema", json_schema: { name: "StoryCard", schema: CARD_SCHEMA } },
      messages: [
        {
          role: "system",
          content:
            "You write a short card that introduces a family's home recipe to neighbors, as JSON. " +
            `story: one warm sentence, at most ${STORY_WORDS} words. Use only the facts given; never invent people, ` +
            "places, memories, history or how it tastes. No hashtags, no emoji, no quotation marks. " +
            "culture: the food culture the dish comes from, in one to three words (like Maharashtrian, Filipino " +
            "or Polish American), or an empty string if you can't tell. " +
            "quote: the number of the cook's own words that best show how they cook, or 0 if none are given.",
        },
        { role: "user", content: facts.join("\n\n") },
      ],
    }),
  });
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = body?.choices?.[0]?.message?.content;
  return res.ok && typeof content === "string" ? parseMuseCard(content, f.quotes) : null;
}

export const writeStoryCard = internalAction({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, { recipeId }) => {
    const facts = await ctx.runQuery(internal.storyCards.storyFacts, { recipeId });
    if (!facts) return null;
    const apiKey = process.env.MUSE_API_KEY;
    let card: Card | null = null;
    if (apiKey) {
      card = await museCard(facts, apiKey).catch((e) => {
        console.error("Muse Spark story card failed", String(e).slice(0, 200));
        return null;
      });
    }
    if (card && flagged(card.text, card.culture)) card = null; // the plain line instead (lib/moderation.ts)
    // The plain line never holds a story; Muse's sentence may.
    const usedStories = card !== null && facts.stories.length > 0;
    const { text, culture, quote } = card ?? fallbackCard(plainStory(facts), facts.quotes);
    await ctx.runMutation(internal.storyCards.saveStoryCard, { recipeId, text, usedStories, culture, quote });
    return null;
  },
});
