// "Put it on the map" for a family dish (convex/shareRequests.ts). Only its cook can share a recipe, so when someone else in the family asks, homie asks her: it
// becomes one of her open questions, and only her clear yes shares it. Nobody outside the family can ask.
//
// The ask and its question are Messages' (messages/shareAsks.ts), because Messages owns `questions`: so are her answer, homie's reading of it and what her yes does
// (questions.ts read_share, storyCards.ts). Her own tap shares it at once, through recipes/writes.ts: with recipe writes off that's 501 `not_moved`, never "shared"
// without it being so.
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { notFound, refused } from "../../errors.js";
import { afterCursor, encodeCursor } from "../../paging.js";
import { flagged } from "../dish/moderation.js";
import { askCookToShare, askState, latestShareAsks } from "../messages/shareAsks.js";
import { shareMine } from "../messages/storyCards.js";
import { peopleByIds } from "../people/service.js";
import { notMoved } from "../recipes/switch.js";
import { readyRecipesOfFamily, recipesByIds } from "../recipes/service.js";
import { unshareRecipeIfOpen } from "../recipes/writes.js";
import { recipeWords } from "./storyCard.js";
import { WORDS_SHAREABLE } from "./words.js";

const DISHES_PAGE = 100;
const PICK_RECIPE = "Pick one of your family's recipes.";
const takenDown = () => refused(409, "taken_down", "Our team took this recipe off the map after a report. It stays with your family.");

/**
 * "shared": it's on the map (it was, or she's its cook and just shared it). "asked": waiting on the cook's answer. One the team took down (community/reports.ts) is
 * 409 `taken_down` for everyone in the family, so nobody asks her about it.
 */
export async function askToShare(signed: Signed, recipeId: string, requestId?: string): Promise<{ result: "shared" | "asked" }> {
  const recipe = (await recipesByIds(db(), [recipeId])).get(recipeId);
  if (!recipe || recipe.family_id !== signed.familyId || recipe.status !== "ready") throw notFound(PICK_RECIPE);
  if (recipe.shared_at) return { result: "shared" };
  if (recipe.hidden_at) throw takenDown();
  if (recipe.cook_id !== signed.personId) return { result: await askCookToShare(signed, recipe, requestId) };
  if (flagged(...recipeWords(recipe))) throw refused(422, "words", WORDS_SHAREABLE);
  const shared = await shareMine(recipe.id, requestId);
  if (shared === "not_shareable") throw refused(422, "words", WORDS_SHAREABLE);
  if (shared === "not_moved") throw notMoved();
  if (shared === "taken_down") throw takenDown();
  return { result: "shared" };
}

/**
 * community.setShare with on: false, her switch: takes her own recipe off the map. Only its cook, as on Convex: anyone else in the family is 403, and another
 * family's, a missing one or one that isn't ready the same 404 as asking. Off already: nothing changes. One the team took down is 409 `taken_down`: it's off,
 * and only the team can change that. The story card stays, and a dinner of it already posted goes on without a link to the dish.
 */
export async function unshare(signed: Signed, recipeId: string): Promise<void> {
  const recipe = (await recipesByIds(db(), [recipeId])).get(recipeId);
  if (!recipe || recipe.family_id !== signed.familyId || recipe.status !== "ready") throw notFound(PICK_RECIPE);
  if (recipe.cook_id !== signed.personId) throw refused(403, "forbidden", "Only the cook can take this off the map.");
  if (recipe.hidden_at) throw takenDown();
  if (!recipe.shared_at) return;
  if (!(await unshareRecipeIfOpen(db(), recipe.id))) throw notMoved();
}

/** My family's ready dishes for the "Share your recipe" chooser: whose, mine, on the map, taken off it by the team, asked, and when she last said not now. */
export async function familyDishes(signed: Signed, cursor?: string) {
  const rows = await readyRecipesOfFamily(db(), signed.familyId, afterCursor(cursor), DISHES_PAGE + 1);
  const page = rows.slice(0, DISHES_PAGE);
  const asks = await latestShareAsks(db(), page.filter((r) => !r.shared_at).map((r) => r.id));
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
        takenDown: !!r.hidden_at,
        asked: state.open,
        notNowAt: state.notNowAt,
      };
    }),
    nextCursor: rows.length > DISHES_PAGE && last ? encodeCursor([last.cursor_at, last.id]) : null,
  };
}
