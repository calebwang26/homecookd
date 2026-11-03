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

export type TestRecipe = {
  familyId: string;
  cookId: string;
  title: string;
  libraryId: string;
  mediaPrefix: string;
  recipeJsonKey: string;
  coverKey: string;
  coverVersion: string;
  steps: object[];
  memories: object[];
  language: string | null;
};

/**
 * Staging's made-up recipe (testRecipe.ts), saved as the worker saves a finished job's (pipeline/queue_db.py _save_recipe): the job's "processing" card is filled in, or
 * there's a new ready row when it has none or it's gone.
 */
export async function saveTestRecipe(c: Queryable, r: TestRecipe, cardId: string | null): Promise<string> {
  if ((await recipeWrites(c)) !== "open") throw notMoved();
  const fields = [r.title, r.libraryId, r.mediaPrefix, r.recipeJsonKey, r.coverKey, r.coverVersion, JSON.stringify(r.steps), JSON.stringify(r.memories), r.language];
  if (cardId) {
    const { rows } = await c.query(
      `update recipes set status = 'ready', title = $1, library_id = $2, media_prefix = $3, recipe_json_key = $4, cover_key = $5, cover_stock_path = null, cover_version = $6,
              steps = $7::jsonb, memories = $8::jsonb, language = $9, moss_indexed_at = null
        where id = $10 returning id`,
      [...fields, cardId],
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows } = await c.query(
    `insert into recipes (title, library_id, media_prefix, recipe_json_key, cover_key, cover_version, steps, memories, language, memories_opt_in, family_id, cook_id, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, false, $10, $11, 'ready') returning id`,
    [...fields, r.familyId, r.cookId],
  );
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

/**
 * community.shareOn's write: on the map from now. Never one the team took down, even when the review lands between the caller's read and this (the update sees
 * its commit). With writes off it's the sync's row, and Convex shares it.
 */
export async function shareRecipeIfOpen(c: Queryable, recipeId: string): Promise<"shared" | "taken_down" | "closed"> {
  if ((await recipeWrites(c)) !== "open") return "closed";
  const { rowCount } = await c.query(`update recipes set shared_at = now() where id = $1 and hidden_at is null`, [recipeId]);
  return rowCount ? "shared" : "taken_down";
}

/** community.setShare's "off": her own switch takes it off the map. The story card stays, for the next time she shares it. */
export async function unshareRecipeIfOpen(c: Queryable, recipeId: string): Promise<boolean> {
  if ((await recipeWrites(c)) !== "open") return false;
  await c.query(`update recipes set shared_at = null where id = $1`, [recipeId]);
  return true;
}

/**
 * The team's review of a reported recipe (convex/reports.ts review): `remove` takes it off the map for good, unshared and hidden from every other family, and `keep`
 * lifts a hide. A removed recipe can't be shared again until a `keep` (storyCards.ts shareOn). With writes off it's refused, and the script says so.
 */
export async function reviewRecipeIfOpen(c: Queryable, recipeId: string, keep: boolean): Promise<boolean> {
  if ((await recipeWrites(c)) !== "open") return false;
  if (keep) await c.query(`update recipes set hidden_at = null where id = $1`, [recipeId]);
  else await c.query(`update recipes set shared_at = null, hidden_at = coalesce(hidden_at, now()) where id = $1`, [recipeId]);
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
