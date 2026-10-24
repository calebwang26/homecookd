// Community: recipes families chose to share with people nearby, as a story card plus the recipe's
// text. Everything returned here is a whitelist: no video, moments, memories, library or GCS links,
// other families' person ids, or addresses. The only words of the cook's own are the one step quote
// on the card. Places are the ~1 km grid cell, never finer. The cook alone turns sharing on.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireCook, requireSession } from "./lib/auth";
import { distanceLabel, milesBetween, placeOf, roundToGrid } from "./lib/geo";
import { type Card, fallbackCard, parseMuseCard, quoteChoices, STORY_WORDS } from "./lib/storyCard";
import { familyRecipe } from "./recipes";

const MUSE_URL = "https://api.meta.ai/v1/chat/completions";
const MUSE_MODEL = "muse-spark-1.3"; // pinned; not a "-contributor" model, which may train on family data

// Only our own stock and cover photos; a recipe's poster is a frame of the family's video.
export const PUBLIC_COVER = /^https:\/\/homecookd\.app\/media\/(stock|app-covers)\/[\w.-]+\.(jpg|jpeg|png|webp)$/;

/** "The Pawar family", or "Rajani's family" when the family has no public name. */
export function familyLabel(family: Doc<"families"> | null, cookName: string): string {
  if (family?.publicName) return `The ${family.publicName} family`;
  return `${cookName.split(/\s+/)[0] || "A"}'s family`;
}

/** The cook's stories Muse may use: only if she said yes to sharing them. */
function storiesFor(r: Doc<"recipes">): string[] {
  return r.memoriesOptIn ? r.memories.filter((m) => m.kind === "story").slice(0, 3).map((m) => m.text) : [];
}

/**
 * What neighbors see of the story card. Once she says no to the stories it was written from, the plain
 * line instead, and no culture (Muse may have read it in a story). A card that doesn't record whether
 * stories went in counts as written from them. The quote shows only while it's still one of her step
 * quotes.
 */
function publicCard(r: Doc<"recipes">, cookName: string, family: Doc<"families"> | null): Card | { text: null; culture: null; quote: null } {
  const card = r.storyCard;
  if (!card) return { text: null, culture: null, quote: null };
  const quote = card.quote && quoteChoices(r.steps).includes(card.quote) ? card.quote : null;
  if (card.usedStories !== false && !r.memoriesOptIn) {
    return { text: plainStory({ cookName, dish: r.title, publicName: family?.publicName ?? null }), culture: null, quote };
  }
  return { text: card.text, culture: card.culture ?? null, quote };
}

const latLng = v.object({ lat: v.number(), lng: v.number() });
const feedRecipe = v.object({
  recipeId: v.id("recipes"),
  dish: v.string(),
  familyName: v.string(),
  cookName: v.string(),
  distanceLabel: v.string(),
  approx: latLng, // the cook's ~1 km grid cell, for the map
  story: v.union(v.null(), v.string()),
  culture: v.union(v.null(), v.string()),
  quote: v.union(v.null(), v.string()),
  coverUrl: v.union(v.null(), v.string()),
  stepCount: v.number(),
  // The soonest open dinner around this dish, if there is one.
  dinner: v.union(v.null(), v.object({ dinnerId: v.id("dinners"), startsAt: v.number(), seatsLeft: v.number() })),
});
const feedDinner = v.object({
  dinnerId: v.id("dinners"),
  dish: v.string(),
  hostName: v.string(),
  placeName: v.string(),
  startsAt: v.number(),
  seatsLeft: v.number(),
  distanceLabel: v.string(),
});

export async function acceptedCount(ctx: QueryCtx, dinnerId: Id<"dinners">): Promise<number> {
  const requests = await ctx.db
    .query("dinnerRequests")
    .withIndex("by_dinnerId", (q) => q.eq("dinnerId", dinnerId))
    .take(200);
  return requests.filter((r) => r.status === "accepted").length;
}

/**
 * Shared recipes from other families, nearest first, and open dinners nearby; `here` is my own grid
 * cell (the map's middle). Queries can't read the clock, so the app must pass `now` (rounded, so the
 * subscription stays put) to hide past dinners.
 */
export const feed = query({
  args: { sessionToken: v.string(), maxMiles: v.optional(v.number()), now: v.number() },
  returns: v.object({ here: latLng, recipes: v.array(feedRecipe), dinners: v.array(feedDinner) }),
  handler: async (ctx, { sessionToken, maxMiles, now }) => {
    const signed = await requireSession(ctx, sessionToken);
    const here = roundToGrid(placeOf(signed.person));
    const near = (miles: number) => maxMiles === undefined || miles <= maxMiles;

    const open = await ctx.db
      .query("dinners")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(100);
    const dinners = [];
    for (const d of open) {
      if (d.startsAt <= now || d.hostFamilyId === signed.family._id) continue;
      const miles = milesBetween(here, d.approx);
      if (!near(miles)) continue;
      dinners.push({
        miles,
        recipeId: d.recipeId,
        row: {
          dinnerId: d._id,
          dish: d.dish,
          hostName: (await ctx.db.get("people", d.hostId))?.name ?? "",
          placeName: d.placeName,
          startsAt: d.startsAt,
          seatsLeft: Math.max(0, d.seats - (await acceptedCount(ctx, d._id))),
          distanceLabel: distanceLabel(miles),
        },
      });
    }
    dinners.sort((a, b) => a.row.startsAt - b.row.startsAt || a.miles - b.miles);
    const dinnerFor = new Map<Id<"recipes">, { dinnerId: Id<"dinners">; startsAt: number; seatsLeft: number }>();
    for (const d of dinners) {
      if (d.row.seatsLeft > 0 && !dinnerFor.has(d.recipeId)) {
        dinnerFor.set(d.recipeId, { dinnerId: d.row.dinnerId, startsAt: d.row.startsAt, seatsLeft: d.row.seatsLeft });
      }
    }

    const shared = await ctx.db
      .query("recipes")
      .withIndex("by_sharedAt", (q) => q.gt("sharedAt", 0))
      .order("desc")
      .take(200);
    const recipes = [];
    for (const r of shared) {
      if (r.familyId === signed.family._id || r.status !== "ready") continue;
      const cook = await ctx.db.get("people", r.cookId);
      const approx = roundToGrid(placeOf(cook));
      const miles = milesBetween(here, approx);
      if (!near(miles)) continue;
      const cookName = cook?.name ?? "";
      const family = await ctx.db.get("families", r.familyId);
      const card = publicCard(r, cookName, family);
      recipes.push({
        miles,
        sharedAt: r.sharedAt ?? 0,
        row: {
          recipeId: r._id,
          dish: r.title,
          familyName: familyLabel(family, cookName),
          cookName,
          distanceLabel: distanceLabel(miles),
          approx,
          story: card.text,
          culture: card.culture,
          quote: card.quote,
          coverUrl: r.coverUrl && PUBLIC_COVER.test(r.coverUrl) ? r.coverUrl : null,
          stepCount: r.steps.length,
          dinner: dinnerFor.get(r._id) ?? null,
        },
      });
    }
    recipes.sort((a, b) => a.miles - b.miles || b.sharedAt - a.sharedAt);

    return { here, recipes: recipes.slice(0, 50).map((r) => r.row), dinners: dinners.slice(0, 20).map((d) => d.row) };
  },
});

/** A shared recipe's text: the story card and the steps. Your own family's recipes always open. */
export const recipe = query({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.union(
    v.null(),
    v.object({
      recipeId: v.id("recipes"),
      dish: v.string(),
      familyName: v.string(),
      cookName: v.string(),
      story: v.union(v.null(), v.string()),
      steps: v.array(v.object({ order: v.number(), title: v.string(), text: v.string() })),
    }),
  ),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const r = await ctx.db.get("recipes", recipeId);
    if (!r || r.status !== "ready" || (!r.sharedAt && r.familyId !== signed.family._id)) return null;
    const cookName = (await ctx.db.get("people", r.cookId))?.name ?? "";
    const family = await ctx.db.get("families", r.familyId);
    return {
      recipeId: r._id,
      dish: r.title,
      familyName: familyLabel(family, cookName),
      cookName,
      story: publicCard(r, cookName, family).text,
      steps: r.steps.map(({ order, title, text }) => ({ order, title, text })),
    };
  },
});

/**
 * The cook's switch. On: shared, and Muse writes the story card the first time, or again when the card
 * doesn't match her answer about her stories anymore. Off keeps the card.
 */
export const setShare = mutation({
  args: { sessionToken: v.string(), recipeId: v.id("recipes"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, recipeId, on }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe) throw new ConvexError("That recipe isn't here anymore.");
    if (recipe.cookId !== signed.person._id) throw new ConvexError("Only the cook can share this.");
    if (!on) {
      await ctx.db.patch("recipes", recipeId, { sharedAt: undefined });
      return null;
    }
    if (recipe.status !== "ready") throw new ConvexError("Share it once the recipe is ready.");
    await ctx.db.patch("recipes", recipeId, { sharedAt: Date.now() });
    const card = recipe.storyCard;
    const withStories = storiesFor(recipe).length > 0; // what Muse would get now
    if (!card || (card.usedStories !== false) !== withStories) {
      await ctx.scheduler.runAfter(0, internal.community.writeStoryCard, { recipeId });
    }
    return null;
  },
});

/** Where I am, snapped to the ~1 km grid before it's stored. */
export const setLocation = mutation({
  args: { sessionToken: v.string(), lat: v.number(), lng: v.number(), campus: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sessionToken, lat, lng, campus }) => {
    const signed = await requireSession(ctx, sessionToken);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new ConvexError("That location doesn't look right.");
    const name = campus?.trim().slice(0, 100);
    await ctx.db.patch("people", signed.person._id, { approx: roundToGrid({ lat, lng }), ...(name ? { campus: name } : {}) });
    return null;
  },
});

// ---- The story card (Muse Spark, labelled AI in the app) ----

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

/** "Rajani's Kanda Poha, from the Pawar family." when Muse isn't set up or doesn't answer. */
export function plainStory(f: { cookName: string; dish: string; publicName: string | null }): string {
  const whose = f.cookName ? `${f.cookName}'s ${f.dish}` : f.dish;
  return f.publicName ? `${whose}, from the ${f.publicName} family.` : `${whose}.`;
}

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
    const facts = await ctx.runQuery(internal.community.storyFacts, { recipeId });
    if (!facts) return null;
    const apiKey = process.env.MUSE_API_KEY;
    let card: Card | null = null;
    if (apiKey) {
      card = await museCard(facts, apiKey).catch((e) => {
        console.error("Muse Spark story card failed", String(e).slice(0, 200));
        return null;
      });
    }
    // The plain line never holds a story; Muse's sentence may.
    const usedStories = card !== null && facts.stories.length > 0;
    const { text, culture, quote } = card ?? fallbackCard(plainStory(facts), facts.quotes);
    await ctx.runMutation(internal.community.saveStoryCard, { recipeId, text, usedStories, culture, quote });
    return null;
  },
});
