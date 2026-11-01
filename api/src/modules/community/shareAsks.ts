// "Put it on the map" for a family dish (convex/shareRequests.ts). Only its cook can share a recipe, so when someone else in the family asks, homie asks her: it
// becomes one of her open questions. Only her clear yes shares it; no, unclear, or no readable answer leaves it private, and then nobody in the family can ask again for a
// day. Nobody outside the family can ask.
//
// What's here is the kid's side. Her own tap and her yes write `recipes.shared_at`, which is read-only until the jobs area moves, so her tap answers `not_moved` and
// nothing is shared from here. Reading her answer, and translating the question for her, go with the Messages area (COMMUNITY-MIGRATION.md).
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { ApiError, notFound, refused } from "../../errors.js";
import { afterCursor, encodeCursor } from "../../paging.js";
import { flagged } from "../dish/moderation.js";
import { peopleByIds } from "../people/service.js";
import { readyRecipesOfFamily, recipesByIds } from "../recipes/service.js";
import * as data from "./data.js";
import type { ShareAsk } from "./data.js";
import { recipeWords } from "./storyCard.js";
import { WORDS_SHAREABLE } from "./words.js";

/** After a no or an unclear answer, the family waits this long to ask her again. */
export const ASK_AGAIN_MS = 24 * 60 * 60_000;
const DISHES_PAGE = 100;
const PICK_RECIPE = "Pick one of your family's recipes.";

/**
 * TODO(caleb): the words homie asks the cook with (translated for her when she doesn't speak English). The culture is the model's guess at where the dish is from
 * ("Maharashtrian"), shown on the map card.
 */
export function shareQuestion(askerName: string, dish: string): string {
  const who = askerName.trim() || "Someone in your family";
  return `${who} wants to put your ${dish} on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?`;
}

/** Where the newest ask stands. `open`: waiting on her, or on homie reading what she said. `notNowAt`: when homie read a no or an unclear answer. */
function askState(q: ShareAsk | undefined): { open: boolean; notNowAt: number | null } {
  if (!q) return { open: false, notNowAt: null };
  if (q.share_said === null) return { open: true, notNowAt: null };
  return { open: false, notNowAt: q.share_said === "yes" || !q.share_decided_at ? null : q.share_decided_at.getTime() };
}

/** "shared": it's on the map already. "asked": waiting on the cook's answer. */
export async function askToShare(signed: Signed, recipeId: string): Promise<{ result: "shared" | "asked" }> {
  const recipe = (await recipesByIds(db(), [recipeId])).get(recipeId);
  if (!recipe || recipe.family_id !== signed.familyId || recipe.status !== "ready") throw notFound(PICK_RECIPE);
  if (recipe.shared_at) return { result: "shared" };
  if (recipe.cook_id === signed.personId) {
    if (flagged(...recipeWords(recipe))) throw refused(422, "words", WORDS_SHAREABLE);
    // Her own tap shares at once, which writes `recipes`. An adapter sends this to Convex until the jobs area moves. Never answered "shared" without sharing.
    throw new ApiError(501, "not_moved", {}, "This can't be done here yet.");
  }
  const last = askState((await data.latestShareAsks(db(), [recipeId])).get(recipeId));
  if (last.open) return { result: "asked" };
  const people = await peopleByIds(db(), [recipe.cook_id, signed.personId]);
  if (last.notNowAt !== null && Date.now() - last.notNowAt < ASK_AGAIN_MS) {
    throw refused(409, "not_now", `${people.get(recipe.cook_id)?.name.trim() || "The cook"} said not now. Ask again tomorrow.`);
  }
  await data.insertShareAsk(db(), { familyId: signed.familyId, recipeId, askedBy: signed.personId, text: shareQuestion(people.get(signed.personId)?.name ?? "", recipe.title) });
  return { result: "asked" };
}

/** My family's ready dishes for the "Share your recipe" chooser: whose, mine, on the map, asked, and when she last said not now. */
export async function familyDishes(signed: Signed, cursor?: string) {
  const rows = await readyRecipesOfFamily(db(), signed.familyId, afterCursor(cursor), DISHES_PAGE + 1);
  const page = rows.slice(0, DISHES_PAGE);
  const asks = await data.latestShareAsks(db(), page.filter((r) => !r.shared_at).map((r) => r.id));
  const cooks = await peopleByIds(db(), page.map((r) => r.cook_id));
  const last = page.at(-1);
  return {
    dishes: page.map((r) => {
      const state = askState(asks.get(r.id));
      return {
        recipeId: r.id,
        dish: r.title,
        cookName: cooks.get(r.cook_id)?.name ?? "",
        mine: r.cook_id === signed.personId,
        shared: !!r.shared_at,
        asked: state.open,
        notNowAt: state.notNowAt,
      };
    }),
    nextCursor: rows.length > DISHES_PAGE && last ? encodeCursor([last.cursor_at, last.id]) : null,
  };
}
