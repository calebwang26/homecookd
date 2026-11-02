// Every write the api makes to `recipes`, all in this file, so a test can hold them to the switch (switch.ts). The sync's own writes are in modules/sync, and the
// worker's in pipeline/queue_db.py. Each statement names one row by its primary key.
import type { Queryable } from "../../db.js";
import { notMoved, recipeWrites } from "./switch.js";

/** A job's "processing" card, shown in the library right away. The worker fills it in when it publishes. */
export async function insertProcessingRecipe(c: Queryable, r: { familyId: string; cookId: string; title: string; language: string | null }): Promise<string> {
  if ((await recipeWrites(c)) !== "open") throw notMoved();
  const { rows } = await c.query(`insert into recipes (family_id, cook_id, title, status, language) values ($1, $2, $3, 'processing', $4) returning id`, [
    r.familyId,
    r.cookId,
    r.title,
    r.language,
  ]);
  return rows[0].id;
}

/** A null `moss_indexed_at` says the search index is behind, so whatever re-syncs it finds this row (recipes_moss_missing). */
export async function saveMemoriesOptIn(c: Queryable, recipeId: string, optIn: boolean): Promise<void> {
  if ((await recipeWrites(c)) !== "open") throw notMoved();
  await c.query(`update recipes set memories_opt_in = $2, moss_indexed_at = null where id = $1`, [recipeId, optIn]);
}

/** A stopped job's card. With writes off there's nothing to do: a job only gets a card while they're open. */
export async function failRecipeIfOpen(c: Queryable, recipeId: string): Promise<boolean> {
  if ((await recipeWrites(c)) !== "open") return false;
  await c.query(`update recipes set status = 'failed' where id = $1`, [recipeId]);
  return true;
}

/** community.shareOn's write: on the map from now. With writes off it's the sync's row, and Convex shares it. */
export async function shareRecipeIfOpen(c: Queryable, recipeId: string): Promise<boolean> {
  if ((await recipeWrites(c)) !== "open") return false;
  await c.query(`update recipes set shared_at = now() where id = $1`, [recipeId]);
  return true;
}

/** The story card, all of it in one statement, so a card is never part new and part old. With writes off, Convex writes its own. */
export async function saveStoryCardIfOpen(c: Queryable, recipeId: string, card: { text: string; usedStories: boolean; culture: string | null; quote: string | null }): Promise<boolean> {
  if ((await recipeWrites(c)) !== "open") return false;
  await c.query(
    `update recipes set story_card_text = $2, story_card_written_at = now(), story_card_used_stories = $3, story_card_culture = $4, story_card_quote = $5 where id = $1`,
    [recipeId, card.text, card.usedStories, card.culture, card.quote],
  );
  return true;
}

/**
 * For the account purge, which doesn't wait for the flag: a deletion must happen. Only the sync's own rule stops it, and then the sync has already removed
 * the recipe (SYNC-MIGRATION.md, "Account deletion").
 */
export async function deleteRecipeUnlessLocked(c: Queryable, recipeId: string): Promise<boolean> {
  if ((await recipeWrites(c)) === "locked") return false;
  await c.query(`delete from recipes where id = $1`, [recipeId]);
  return true;
}
