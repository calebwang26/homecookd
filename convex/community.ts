// Community: recipes families chose to share with people nearby, as a story card plus the recipe's
// text, and recipe swaps and "cook together" asks between families. Everything returned here is a whitelist: no video, moments,
// memories, library or GCS links, other families' person ids, or addresses. The only words of the
// cook's own are the one step quote on the card. Places are the ~1 km grid cell, never finer. Only the
// cook shares a recipe: her switch, her own tap, or her yes to a kid's ask (shareRequests.ts).
// Every read and ask here goes through lib/safety.ts (reports and blocks) and the word filter
// (lib/moderation.ts); "Report or block" is at the bottom.
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCook, requireSession, type Signed } from "./lib/auth";
import { distanceLabel, milesBetween, placeOf, roundToGrid } from "./lib/geo";
import { flagged, NOT_SHAREABLE, recipeWords } from "./lib/moderation";
import { fileReport, type Reportable, type Shield, seesDinner, seesRecipe, shieldFor } from "./lib/safety";
import { type Card, plainStory, quoteChoices, quoteTranslated, storiesFor } from "./lib/storyCard";
import { familyRecipe } from "./recipes";
import schema from "./schema";

// Only our own stock and cover photos; a recipe's poster is a frame of the family's video.
export const PUBLIC_COVER = /^https:\/\/homecookd\.app\/media\/(stock|app-covers)\/[\w.-]+\.(jpg|jpeg|png|webp)$/;

/** "The Pawar family", or "Rajani's family" when the family has no public name. */
export function familyLabel(family: Doc<"families"> | null, cookName: string): string {
  if (family?.publicName) return `The ${family.publicName} family`;
  return `${cookName.split(/\s+/)[0] || "A"}'s family`;
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

/**
 * Puts a ready recipe on the map. One path for every way the cook says yes (her switch, her own tap,
 * her answer to a kid's ask). Muse writes the story card the first time, or again when the card no
 * longer matches her answer about her stories. Words the filter catches keep it in the family.
 */
export async function shareOn(ctx: MutationCtx, recipe: Doc<"recipes">): Promise<void> {
  if (flagged(...recipeWords(recipe))) throw new ConvexError(NOT_SHAREABLE);
  await ctx.db.patch("recipes", recipe._id, { sharedAt: Date.now() });
  const card = recipe.storyCard;
  const withStories = storiesFor(recipe).length > 0; // what Muse would get now
  if (!card || (card.usedStories !== false) !== withStories) {
    await ctx.scheduler.runAfter(0, internal.storyCards.writeStoryCard, { recipeId: recipe._id });
  }
}

const latLng = v.object({ lat: v.number(), lng: v.number() });
const feedRecipe = v.object({
  recipeId: v.id("recipes"),
  dish: v.string(),
  familyName: v.string(),
  cookName: v.string(),
  distanceLabel: v.string(),
  approx: latLng, // the cook's ~1 km grid cell, for the map
  ours: v.boolean(), // my own family's dish
  story: v.union(v.null(), v.string()),
  culture: v.union(v.null(), v.string()),
  quote: v.union(v.null(), v.string()),
  quoteTranslated: v.boolean(), // the quote is the English of words she said in another language
  coverUrl: v.union(v.null(), v.string()),
  stepCount: v.number(),
  // The soonest open dinner around this dish that's still ahead (never on my own family's dish). It
  // sits where its host is, which may be far from the cook, so it has its own distance.
  dinner: v.union(
    v.null(),
    v.object({ dinnerId: v.id("dinners"), startsAt: v.number(), seatsLeft: v.number(), hostName: v.string(), distanceLabel: v.string() }),
  ),
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
type FeedDinner = Infer<typeof feedDinner>;

export async function acceptedCount(ctx: QueryCtx, dinnerId: Id<"dinners">): Promise<number> {
  const requests = await ctx.db
    .query("dinnerRequests")
    .withIndex("by_dinnerId", (q) => q.eq("dinnerId", dinnerId))
    .take(200);
  return requests.filter((r) => r.status === "accepted").length;
}

/**
 * Shared recipes nearest first (my own family's too, marked `ours`) and other families' open dinners
 * nearby; `here` is my own grid cell (the map's middle). Queries can't read the clock, so the app
 * passes `now` (rounded, and moving on as time passes) to leave out dinners that have started.
 */
export const feed = query({
  args: { sessionToken: v.string(), maxMiles: v.optional(v.number()), now: v.number() },
  returns: v.object({ here: latLng, recipes: v.array(feedRecipe), dinners: v.array(feedDinner) }),
  handler: async (ctx, { sessionToken, maxMiles, now }) => {
    const signed = await requireSession(ctx, sessionToken);
    const shield = await shieldFor(ctx, signed.family._id);
    const here = roundToGrid(placeOf(signed.person));
    const near = (miles: number) => maxMiles === undefined || miles <= maxMiles;

    const open = await ctx.db
      .query("dinners")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(100);
    const dinners: { miles: number; recipeId: Id<"recipes">; row: FeedDinner }[] = [];
    for (const d of open) {
      if (d.startsAt <= now || d.hostFamilyId === signed.family._id || !seesDinner(shield, d)) continue;
      const miles = milesBetween(here, d.approx);
      if (!near(miles)) continue;
      const hostName = (await ctx.db.get("people", d.hostId))?.name ?? "";
      if (flagged(d.dish, d.placeName, hostName)) continue; // the word filter's backstop
      dinners.push({
        miles,
        recipeId: d.recipeId,
        row: {
          dinnerId: d._id,
          dish: d.dish,
          hostName,
          placeName: d.placeName,
          startsAt: d.startsAt,
          seatsLeft: Math.max(0, d.seats - (await acceptedCount(ctx, d._id))),
          distanceLabel: distanceLabel(miles),
        },
      });
    }
    dinners.sort((a, b) => a.row.startsAt - b.row.startsAt || a.miles - b.miles);
    const dinnerFor = new Map<Id<"recipes">, FeedDinner>();
    for (const d of dinners) {
      if (d.row.seatsLeft > 0 && !dinnerFor.has(d.recipeId)) dinnerFor.set(d.recipeId, d.row);
    }

    const shared = await ctx.db
      .query("recipes")
      .withIndex("by_sharedAt", (q) => q.gt("sharedAt", 0))
      .order("desc")
      .take(200);
    const recipes = [];
    for (const r of shared) {
      if (r.status !== "ready" || !seesRecipe(shield, r)) continue;
      const cook = await ctx.db.get("people", r.cookId);
      const approx = roundToGrid(placeOf(cook));
      const miles = milesBetween(here, approx);
      if (!near(miles)) continue;
      const cookName = cook?.name ?? "";
      const family = await ctx.db.get("families", r.familyId);
      const card = publicCard(r, cookName, family);
      const ours = r.familyId === signed.family._id;
      if (!ours && flagged(...recipeWords(r), card.text, card.quote, cookName, family?.publicName)) continue;
      const dinner = dinnerFor.get(r._id);
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
          ours,
          story: card.text,
          culture: card.culture,
          quote: card.quote,
          quoteTranslated: quoteTranslated(r.steps, card.quote),
          coverUrl: r.coverUrl && PUBLIC_COVER.test(r.coverUrl) ? r.coverUrl : null,
          stepCount: r.steps.length,
          dinner: dinner
            ? { dinnerId: dinner.dinnerId, startsAt: dinner.startsAt, seatsLeft: dinner.seatsLeft, hostName: dinner.hostName, distanceLabel: dinner.distanceLabel }
            : null,
        },
      });
    }
    recipes.sort((a, b) => a.miles - b.miles || b.sharedAt - a.sharedAt);

    return { here, recipes: recipes.slice(0, 50).map((r) => r.row), dinners: dinners.slice(0, 20).map((d) => d.row) };
  },
});

/**
 * A shared recipe's text: the story card and the steps. Your own family's recipes always open (`ours`:
 * nothing to report); one we reported or blocked, or one the filter caught, doesn't.
 */
export const recipe = query({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.union(
    v.null(),
    v.object({
      recipeId: v.id("recipes"),
      dish: v.string(),
      familyName: v.string(),
      cookName: v.string(),
      ours: v.boolean(),
      story: v.union(v.null(), v.string()),
      steps: v.array(v.object({ order: v.number(), title: v.string(), text: v.string() })),
    }),
  ),
  handler: async (ctx, { sessionToken, recipeId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const r = await ctx.db.get("recipes", recipeId);
    const ours = r?.familyId === signed.family._id;
    if (!r || r.status !== "ready" || (!r.sharedAt && !ours)) return null;
    if (!seesRecipe(await shieldFor(ctx, signed.family._id), r)) return null;
    const cookName = (await ctx.db.get("people", r.cookId))?.name ?? "";
    const family = await ctx.db.get("families", r.familyId);
    const story = publicCard(r, cookName, family).text;
    if (!ours && flagged(...recipeWords(r), story, cookName, family?.publicName)) return null;
    return {
      recipeId: r._id,
      dish: r.title,
      familyName: familyLabel(family, cookName),
      cookName,
      ours,
      story,
      steps: r.steps.map(({ order, title, text }) => ({ order, title, text })),
    };
  },
});

/** The cook's switch. On: shared (shareOn). Off keeps the card. */
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
    await shareOn(ctx, recipe);
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

// ---- Swaps ("Teach each other your family dishes") and "Cook together" ----
// Anyone in a family asks for another family's shared recipe, offering one of their own shared ones
// (or none yet), or asks that family to cook their dish together (kind "cook"); anyone in the family
// that was asked says yes or no. Every recipe in one is shared already, so it shows no new recipe
// text; the other family is named the way the cards name it. Once a "cook together" is agreed, the
// family that asked may host a dinner of that dish (dinners.create).

const swapDish = v.union(v.null(), v.object({ recipeId: v.id("recipes"), dish: v.string() }));
const swapView = v.object({
  swapId: v.id("swapRequests"),
  kind: v.union(v.literal("swap"), v.literal("cook")),
  status: schema.tables.swapRequests.validator.fields.status,
  incoming: v.boolean(), // the other family asked us
  ourDish: swapDish, // our family's recipe in it
  theirDish: swapDish, // theirs, while it's still shared
  familyName: v.string(), // the other family
});

const kindOf = (s: Doc<"swapRequests">): "swap" | "cook" => s.kind ?? "swap";

async function viewSwap(ctx: QueryCtx, signed: Signed, shield: Shield, s: Doc<"swapRequests">) {
  const incoming = s.otherFamilyId === signed.family._id;
  const theirRecipe = await ctx.db.get("recipes", s.theirRecipeId);
  const myRecipe = s.myRecipeId ? await ctx.db.get("recipes", s.myRecipeId) : null;
  const [ours, theirs] = incoming ? [theirRecipe, myRecipe] : [myRecipe, theirRecipe];
  const shown = (r: Doc<"recipes"> | null) =>
    r && (r.familyId === signed.family._id || (r.sharedAt && seesRecipe(shield, r))) ? { recipeId: r._id, dish: r.title } : null;
  // Named like a card: the public name, else whoever asked us, or the cook of the dish we asked for.
  const otherFamily = await ctx.db.get("families", incoming ? s.requesterFamilyId : s.otherFamilyId);
  const nameFrom = incoming ? s.requesterId : theirRecipe?.cookId;
  const name = nameFrom ? ((await ctx.db.get("people", nameFrom))?.name ?? "") : "";
  return {
    swapId: s._id,
    kind: kindOf(s),
    status: s.status,
    incoming,
    ourDish: shown(ours),
    theirDish: shown(theirs),
    familyName: familyLabel(otherFamily, name),
  };
}

async function familySwaps(ctx: QueryCtx, familyId: Id<"families">) {
  const asked = await ctx.db
    .query("swapRequests")
    .withIndex("by_requesterFamilyId", (q) => q.eq("requesterFamilyId", familyId))
    .take(50);
  const askedOfUs = await ctx.db
    .query("swapRequests")
    .withIndex("by_otherFamilyId", (q) => q.eq("otherFamilyId", familyId))
    .take(50);
  return { asked, askedOfUs };
}

/**
 * One ask of my family's for another family's shared recipe: a swap (offering `myRecipeId`, one of
 * ours that's shared too, or none) or "cook together". Asking again returns the same ask.
 */
async function askFamily(ctx: MutationCtx, signed: Signed, recipeId: Id<"recipes">, kind: "swap" | "cook", myRecipeId?: Id<"recipes">) {
  const theirs = await ctx.db.get("recipes", recipeId);
  const visible = !!theirs && seesRecipe(await shieldFor(ctx, signed.family._id), theirs);
  if (!theirs || !visible || theirs.status !== "ready" || !theirs.sharedAt) throw new ConvexError("That recipe isn't shared anymore.");
  if (theirs.familyId === signed.family._id) throw new ConvexError("This is your family's recipe.");
  if (myRecipeId) {
    const mine = await familyRecipe(ctx, signed, myRecipeId);
    if (!mine || mine.status !== "ready" || !mine.sharedAt) throw new ConvexError("Share that recipe first.");
  }
  const { asked } = await familySwaps(ctx, signed.family._id);
  const before = asked.find((s) => s.theirRecipeId === recipeId && kindOf(s) === kind);
  if (before?.status === "declined") throw new ConvexError("They said not this time.");
  if (before) return before._id;
  return await ctx.db.insert("swapRequests", {
    requesterId: signed.person._id,
    requesterFamilyId: signed.family._id,
    theirRecipeId: recipeId,
    myRecipeId,
    otherFamilyId: theirs.familyId,
    ...(kind === "cook" ? { kind } : {}),
    status: "pending",
  });
}

/** Ask for another family's shared recipe, offering one of ours (shared too) or none. */
export const requestSwap = mutation({
  args: { sessionToken: v.string(), recipeId: v.id("recipes"), myRecipeId: v.optional(v.id("recipes")) },
  returns: v.id("swapRequests"),
  handler: async (ctx, { sessionToken, recipeId, myRecipeId }) => {
    return await askFamily(ctx, await requireSession(ctx, sessionToken), recipeId, "swap", myRecipeId);
  },
});

/** "Cook together": ask the family whose shared dish it is to make it with us. Answered like a swap (respondSwap). */
export const cookTogether = mutation({
  args: { sessionToken: v.string(), recipeId: v.id("recipes") },
  returns: v.id("swapRequests"),
  handler: async (ctx, { sessionToken, recipeId }) => {
    return await askFamily(ctx, await requireSession(ctx, sessionToken), recipeId, "cook");
  },
});

/** True when the other family said yes to cooking this shared dish of theirs with my family. */
export async function cookingTogether(ctx: QueryCtx, familyId: Id<"families">, recipeId: Id<"recipes">): Promise<boolean> {
  const { asked } = await familySwaps(ctx, familyId);
  return asked.some((s) => s.theirRecipeId === recipeId && s.kind === "cook" && s.status === "accepted");
}

/** Anyone in the family that was asked says yes or no to a swap or a "cook together", once. */
export const respondSwap = mutation({
  args: { sessionToken: v.string(), swapId: v.id("swapRequests"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, swapId, accept }) => {
    const signed = await requireSession(ctx, sessionToken);
    const s = await ctx.db.get("swapRequests", swapId);
    if (!s || s.otherFamilyId !== signed.family._id) throw new ConvexError("Only the family that was asked can answer.");
    if (s.status !== "pending") throw new ConvexError("You already answered.");
    if ((await shieldFor(ctx, signed.family._id)).blocked.has(s.requesterFamilyId)) throw new ConvexError("That ask isn't open anymore.");
    await ctx.db.patch("swapRequests", swapId, { status: accept ? "accepted" : "declined" });
    return null;
  },
});

/** My family's swaps and "cook together" asks, both ways, newest first. */
export const mySwaps = query({
  args: { sessionToken: v.string() },
  returns: v.array(swapView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const shield = await shieldFor(ctx, signed.family._id);
    const { asked, askedOfUs } = await familySwaps(ctx, signed.family._id);
    const out = [];
    for (const s of [...asked, ...askedOfUs].sort((a, b) => b._creationTime - a._creationTime)) {
      const other = s.requesterFamilyId === signed.family._id ? s.otherFamilyId : s.requesterFamilyId;
      if (!shield.blocked.has(other)) out.push(await viewSwap(ctx, signed, shield, s));
    }
    return out;
  },
});

// ---- "Report or block" ----
// From another family's recipe or dinner page. A report hides it from my family at once, and from
// everyone once two families reported it (lib/safety.ts). A block works both ways and tells the team
// too (a "family" report). Anyone in a family can do either, for the whole family.

const reportable = v.union(v.literal("recipe"), v.literal("dinner"));

/** Whose recipe or dinner it is, named the way its card names that family. Never my own family's. */
async function ownerOf(ctx: QueryCtx, signed: Signed, kind: Reportable, targetId: string) {
  let owner: { id: string; familyId: Id<"families">; name: string } | null = null;
  if (kind === "recipe") {
    const id = ctx.db.normalizeId("recipes", targetId);
    const r = id && (await ctx.db.get("recipes", id));
    if (r) owner = { id: r._id, familyId: r.familyId, name: (await ctx.db.get("people", r.cookId))?.name ?? "" };
  } else {
    const id = ctx.db.normalizeId("dinners", targetId);
    const d = id && (await ctx.db.get("dinners", id));
    if (d) owner = { id: d._id, familyId: d.hostFamilyId, name: (await ctx.db.get("people", d.hostId))?.name ?? "" };
  }
  if (!owner) throw new ConvexError(`That ${kind} isn't here anymore.`);
  if (owner.familyId === signed.family._id) throw new ConvexError(`This is your family's ${kind}.`);
  return { ...owner, label: familyLabel(await ctx.db.get("families", owner.familyId), owner.name) };
}

export const report = mutation({
  args: { sessionToken: v.string(), kind: reportable, targetId: v.string(), reason: schema.tables.reports.validator.fields.reason },
  returns: v.null(),
  handler: async (ctx, { sessionToken, kind, targetId, reason }) => {
    const signed = await requireSession(ctx, sessionToken);
    const owner = await ownerOf(ctx, signed, kind, targetId);
    await fileReport(ctx, { familyId: signed.family._id, personId: signed.person._id }, { kind, id: owner.id, familyId: owner.familyId }, reason);
    return null;
  },
});

/** Block the family behind a recipe or dinner. Blocking again changes nothing. */
export const block = mutation({
  args: { sessionToken: v.string(), kind: reportable, targetId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, kind, targetId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const owner = await ownerOf(ctx, signed, kind, targetId);
    const before = await ctx.db
      .query("blocks")
      .withIndex("by_familyId_and_blockedFamilyId", (q) => q.eq("familyId", signed.family._id).eq("blockedFamilyId", owner.familyId))
      .first();
    if (before) return null;
    await ctx.db.insert("blocks", { familyId: signed.family._id, blockedFamilyId: owner.familyId, label: owner.label, createdAt: Date.now() });
    await fileReport(ctx, { familyId: signed.family._id, personId: signed.person._id }, { kind: "family", id: owner.familyId, familyId: owner.familyId });
    return null;
  },
});

/** The families mine blocked, for the list under "You" (never the ones that blocked us). */
export const blocked = query({
  args: { sessionToken: v.string() },
  returns: v.array(v.object({ blockId: v.id("blocks"), familyName: v.string() })),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_familyId_and_blockedFamilyId", (q) => q.eq("familyId", signed.family._id))
      .take(100);
    return rows.map((b) => ({ blockId: b._id, familyName: b.label }));
  },
});

export const unblock = mutation({
  args: { sessionToken: v.string(), blockId: v.id("blocks") },
  returns: v.null(),
  handler: async (ctx, { sessionToken, blockId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const b = await ctx.db.get("blocks", blockId);
    if (b?.familyId === signed.family._id) await ctx.db.delete("blocks", blockId);
    return null;
  },
});
