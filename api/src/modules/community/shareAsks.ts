// "Put it on the map" for a family dish (convex/shareRequests.ts). Only its cook can share a recipe, so when someone else in the family asks, homie asks her: it
// becomes one of her open questions, and only her clear yes shares it. Nobody outside the family can ask.
//
// Only what can be true here is here. Asking stays on Convex until Messages moves: a question written in Postgres reaches no cook, no answer and no purge, so a kid would
// be told it was asked and she'd never hear. Her own tap and her yes write `recipes.shared_at`, which is read-only until the jobs area moves. Both answer `not_moved`, and an
// adapter sends them to Convex (COMMUNITY-MIGRATION.md). Nothing here writes.
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

const DISHES_PAGE = 100;
const PICK_RECIPE = "Pick one of your family's recipes.";

/** Where the newest ask stands. `open`: waiting on her, or on homie reading what she said. `notNowAt`: when homie read a no or an unclear answer. */
function askState(q: ShareAsk | undefined): { open: boolean; notNowAt: number | null } {
  if (!q) return { open: false, notNowAt: null };
  if (q.share_said === null) return { open: true, notNowAt: null };
  return { open: false, notNowAt: q.share_said === "yes" || !q.share_decided_at ? null : q.share_decided_at.getTime() };
}

/** "shared": it's on the map already. Anything that would ask her or share it answers `not_moved`: never "asked" or "shared" without it being so. */
export async function askToShare(signed: Signed, recipeId: string): Promise<{ result: "shared" }> {
  const recipe = (await recipesByIds(db(), [recipeId])).get(recipeId);
  if (!recipe || recipe.family_id !== signed.familyId || recipe.status !== "ready") throw notFound(PICK_RECIPE);
  if (recipe.shared_at) return { result: "shared" };
  if (recipe.cook_id === signed.personId && flagged(...recipeWords(recipe))) throw refused(422, "words", WORDS_SHAREABLE);
  throw new ApiError(501, "not_moved", {}, "This can't be done here yet.");
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
