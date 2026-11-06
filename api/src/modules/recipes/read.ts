// Read-only: what other modules may ask about a recipe. `recipes` moves with jobs, later; nothing here writes it.
import type { Queryable } from "../../db.js";
import type { RecipeStep } from "./data.js";
import { mediaUrl } from "./media.js";

export type RecipeBrief = { id: string; family_id: string; cook_id: string; title: string; status: string; library_id: string | null };

const COLUMNS = `id, family_id, cook_id, title, status, library_id`;

/** Convex's familyRecipe: another family's recipe reads as no recipe. Index: the primary key. Says nothing of who may see it: a route asks recipeFor. */
export async function familyRecipe(q: Queryable, familyId: string, id: string): Promise<RecipeBrief | null> {
  const { rows } = await q.query(`select ${COLUMNS} from recipes where id = $1 and family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

/**
 * Caleb's rule (Nov 1): a recipe that isn't ready yet, or failed, is its cook's alone, like the job behind it. To anyone else it's no recipe at all, the same as a
 * missing id. `readyOnly` is for what only a finished recipe can have (a cook-mode question, a photo of the dish made, a message about it): there it's no recipe to
 * its cook either.
 */
export function shownTo(r: { status: string; cook_id: string }, personId: string, o: { readyOnly?: boolean } = {}): boolean {
  return r.status === "ready" || (!o.readyOnly && r.cook_id === personId);
}

/** A family's recipe by id, as this person may act on it (shownTo): null reads the same as a missing id or another family's. */
export async function recipeFor(q: Queryable, familyId: string, personId: string, id: string, o: { readyOnly?: boolean } = {}): Promise<RecipeBrief | null> {
  const r = await familyRecipe(q, familyId, id);
  return r && shownTo(r, personId, o) ? r : null;
}

/**
 * Whether this family has a ready recipe by this library id. The worker on AWS writes its recipe.json in each attempt's own folder, not at `<id>/recipe.json`, so the
 * media host can't say. Index: recipes_family_library.
 */
export async function familyHasDish(q: Queryable, familyId: string, libraryId: string): Promise<boolean> {
  const { rowCount } = await q.query(`select 1 from recipes where family_id = $1 and library_id = $2 and status = 'ready' limit 1`, [familyId, libraryId]);
  return !!rowCount;
}

/**
 * Where a dish's recipe.json is, by its library id: this family's ready recipe's own key, the one GET /v1/recipes/:id links as `recipeJsonUrl`, or else the public
 * library's `<libraryId>/recipe.json`. The worker on AWS writes it in each attempt's own folder (recipe-<id>/<job>-a<n>/), where the library's path misses. Only a ready
 * row counts (shownTo): one that isn't ready reads as no row, so its key never leaves here. Index: recipes_family_library.
 */
export async function recipeJsonKey(q: Queryable, familyId: string, libraryId: string): Promise<string> {
  const { rows } = await q.query(
    `select recipe_json_key from recipes where family_id = $1 and library_id = $2 and status = 'ready' and recipe_json_key is not null
      order by created_at desc, id desc limit 1`,
    [familyId, libraryId],
  );
  return rows[0]?.recipe_json_key ?? `${libraryId}/recipe.json`;
}

/** The link to it, built as GET /v1/recipes/:id builds `recipeJsonUrl`. */
export async function recipeJsonUrl(q: Queryable, familyId: string, libraryId: string): Promise<string> {
  return mediaUrl(await recipeJsonKey(q, familyId, libraryId));
}

export async function recipesByIds(q: Queryable, ids: string[]): Promise<RecipeBrief[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(`select ${COLUMNS} from recipes where id = any($1::text[])`, [ids]);
  return rows;
}

export type StoryCardSource = {
  id: string;
  family_id: string;
  cook_id: string;
  title: string;
  status: string;
  steps: RecipeStep[];
  memories: { kind: string; text: string }[];
  memories_opt_in: boolean;
  shared_at: Date | null;
  hidden_at: Date | null;
  story_card_text: string | null;
  story_card_used_stories: boolean | null;
  story_card_culture: string | null;
};

/** What a story card is written from (Convex's storyFacts), and what sharing checks. Her memories only after her yes: otherwise they stay in the database. Index: the primary key. */
export async function storyCardSource(q: Queryable, id: string): Promise<StoryCardSource | null> {
  const { rows } = await q.query(
    `select id, family_id, cook_id, title, status, steps, case when memories_opt_in then memories else '[]'::jsonb end as memories, memories_opt_in, shared_at,
            hidden_at, story_card_text, story_card_used_stories, story_card_culture
       from recipes where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** A cook's recipes, a batch at a time, for the purge. Index: recipes_cook. */
export async function recipeIdsOfCook(q: Queryable, cookId: string, after: string, limit: number): Promise<string[]> {
  const { rows } = await q.query(`select id from recipes where cook_id = $1 and id > $2 order by id limit $3`, [cookId, after, limit]);
  return rows.map((row) => row.id);
}
