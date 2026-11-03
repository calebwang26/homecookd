// The Community story card (Convex's storyCards.ts and community.shareOn), labelled AI in the app: one sentence that introduces a shared recipe to neighbors, a culture
// label, and one of the cook's own step quotes, picked by its number. Sharing queues it, and a task writes it on Claude (models.ts). The pure rules are in
// community/storyCard.ts.
//
// Both writes go through recipes/writes.ts. Unless the recipes switch is open, nothing here shares or writes a card: while the sync owns the rows, Convex does both,
// and the sync brings them over.
import { db, tx, type Queryable } from "../../db.js";
import { ApiError } from "../../errors.js";
import { enqueue } from "../../outbox.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { type Card, fallbackCard, parseCard, plainStory, quoteChoices, recipeWords, storiesFor } from "../community/storyCard.js";
import type { Trace } from "../dish/budget.js";
import { flagged } from "../dish/moderation.js";
import { namesOf } from "../people/reads.js";
import { familiesByIds } from "../people/service.js";
import { storyCardSource, type StoryCardSource } from "../recipes/read.js";
import { recipeWrites } from "../recipes/switch.js";
import { saveStoryCardIfOpen, shareRecipeIfOpen } from "../recipes/writes.js";
import { models } from "./models.js";

export const STORY_CARD_TASK = "story_cards.write";
/** A paid call, so a limit per cook, which Convex's didn't have. Past it, the plain line. */
export const CARD_LIMIT = { bucket: "messages-story-card", max: 30, windowS: 3600 };

const storiesOf = (r: StoryCardSource) => storiesFor({ memoriesOptIn: r.memories_opt_in, memories: r.memories });

/** No card yet, or one that no longer matches her answer about her stories. A card that doesn't say whether stories went in counts as written from them. */
export function storyCardDue(r: StoryCardSource): boolean {
  const withStories = storiesOf(r).length > 0; // what the model would get now
  return r.story_card_text === null || (r.story_card_used_stories !== false) !== withStories;
}

export type Shared = "shared" | "not_shareable" | "not_moved" | "taken_down";

/**
 * community.shareOn: puts a ready recipe on the map, for every way the cook says yes. The card is queued in the same transaction, the first time or when it no longer
 * matches her stories answer. Words the filter catches keep it in the family, and so does the team's take-down (community/reports.ts), until a `keep`. The caller has
 * checked who's asking and that it's ready.
 */
export async function shareOn(c: Queryable, r: StoryCardSource, requestId?: string): Promise<Shared> {
  if (r.hidden_at) return "taken_down";
  if (flagged(...recipeWords(r))) return "not_shareable";
  const wrote = await shareRecipeIfOpen(c, r.id);
  if (wrote === "closed") return "not_moved";
  if (wrote === "taken_down") return "taken_down";
  if (storyCardDue(r)) await enqueue(c, { queue: "scheduled", payload: { task: STORY_CARD_TASK, recipeId: r.id }, requestId });
  return "shared";
}

/** shareRequests.ask's first half: her own tap on her own ready recipe shares it at once. The caller has checked she's its cook and that it's ready. */
export async function shareMine(recipeId: string, requestId?: string): Promise<Shared> {
  return await tx(async (c) => {
    const r = await storyCardSource(c, recipeId);
    if (!r) return "not_moved";
    return r.shared_at ? "shared" : await shareOn(c, r, requestId);
  });
}

/** shareRequests.applyYes, in the settle's transaction: her clear yes shares her ready recipe, unless it's on the map already. readShare has checked she's its cook. */
export async function shareOnYes(c: Queryable, yes: { recipeId: string; familyId: string }, requestId?: string): Promise<void> {
  const r = await storyCardSource(c, yes.recipeId);
  if (!r || r.family_id !== yes.familyId || r.status !== "ready" || r.shared_at) return;
  await shareOn(c, r, requestId);
}

type Facts = { cookName: string; dish: string; publicName: string | null; steps: string[]; stories: string[]; quotes: string[] };

/** Convex's storyFacts. Never the family's private name. */
async function factsOf(r: StoryCardSource): Promise<Facts> {
  const cookName = (await namesOf(db(), [r.cook_id])).get(r.cook_id) ?? "";
  const family = (await familiesByIds(db(), [r.family_id])).get(r.family_id);
  return {
    cookName,
    dish: r.title,
    publicName: family?.public_name ?? null,
    steps: r.steps.slice(0, 3).map((s) => `${s.title}: ${s.text}`),
    stories: storiesOf(r),
    quotes: quoteChoices(r.steps),
  };
}

export function factLines(f: Facts): string {
  const facts = [`Cook: ${f.cookName || "a family cook"}`, `Dish: ${f.dish}`, `First steps:\n${f.steps.join("\n")}`];
  if (f.stories.length) facts.push(`What the cook said while cooking:\n${f.stories.join("\n")}`);
  if (f.quotes.length) facts.push(`The cook's own words, by number:\n${f.quotes.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  return facts.join("\n\n");
}

async function withinLimit(cookId: string): Promise<boolean> {
  try {
    await hit(subjectKey(cookId), [CARD_LIMIT]);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 429) return false;
    throw error;
  }
}

/**
 * Convex's writeStoryCard. A model that fails, isn't set up or answers something unusable, and a cook past the limit, all give the plain line, as on Convex, so the card
 * is always whole. Safe to repeat: once the card matches her stories answer, nothing is due. Nothing runs while writes are off, so no call is paid for a card that
 * couldn't be saved.
 */
export async function writeStoryCard(recipeId: string, trace: Trace): Promise<void> {
  if ((await recipeWrites(db())) !== "open") {
    trace.log.info({ task: STORY_CARD_TASK, recipeId }, "no story card: recipe writes are off");
    return;
  }
  const r = await storyCardSource(db(), recipeId);
  if (!r?.shared_at || !storyCardDue(r)) return;
  const facts = await factsOf(r);
  let card: Card | null = null;
  if (await withinLimit(r.cook_id)) {
    try {
      card = parseCard(await models.storyCard(factLines(facts), r.id), facts.quotes);
    } catch (error) {
      trace.log.error({ task: STORY_CARD_TASK, err: { type: (error as Error).name } }, "a story card fell back to the plain line");
    }
  }
  if (card && flagged(card.text, card.culture)) card = null;
  // The plain line never holds a story; the model's sentence may.
  const usedStories = card !== null && facts.stories.length > 0;
  const { text, culture, quote } = card ?? fallbackCard(plainStory(facts), facts.quotes);
  await saveStoryCardIfOpen(db(), r.id, { text, usedStories, culture, quote });
}
