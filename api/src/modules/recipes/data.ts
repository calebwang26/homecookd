// Reads of `recipes` for other modules. READ-ONLY: the temporary one-way sync owns these rows until the jobs area moves (SCHEMA.md, M1), so nothing here writes
// them. Every query, and the index behind it:
//
//   Query                              Index                   Limit
//   a recipe, or a page's recipes      recipes primary key     the ids asked for
//   shared recipes, newest first       recipes_shared_recent   the caller's window
//   a family's ready recipes           recipes_family_recent   the caller's page
//   a cook's recipes (purge)           recipes_cook            500
//
// Never `memories`, the video or the library id: nothing that reads these can leak what it never selected.
import type { Queryable } from "../../db.js";
import type { After } from "../../paging.js";

export type RecipeStep = { order: number; title: string; text: string; quote?: string; quoteOriginal?: string };

export type RecipeRow = {
  id: string;
  family_id: string;
  cook_id: string;
  title: string;
  status: "processing" | "ready" | "failed";
  steps: RecipeStep[];
  step_count: number;
  memories_opt_in: boolean;
  cover_stock_path: string | null;
  shared_at: Date | null;
  hidden_at: Date | null;
  story_card_text: string | null;
  story_card_used_stories: boolean | null;
  story_card_culture: string | null;
  story_card_quote: string | null;
  cursor_at: string;
};

const RECIPE = `id, family_id, cook_id, title, status, steps, step_count, memories_opt_in, cover_stock_path, shared_at, hidden_at,
  story_card_text, story_card_used_stories, story_card_culture, story_card_quote`;

export async function recipesByIds(q: Queryable, ids: string[]): Promise<Map<string, RecipeRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select ${RECIPE}, created_at::text as cursor_at from recipes where id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, row]));
}

/** Newest shared first. `cursor_at` is shared_at here. */
export async function sharedRecipes(q: Queryable, before: After | null, limit: number): Promise<RecipeRow[]> {
  const { rows } = await q.query(
    `select ${RECIPE}, shared_at::text as cursor_at from recipes
      where shared_at is not null ${before ? "and (shared_at, id) < ($2::timestamptz, $3)" : ""}
      order by shared_at desc, id desc limit $1`,
    before ? [limit, before.at, before.id] : [limit],
  );
  return rows;
}

/** Newest first. `cursor_at` is created_at here. */
export async function readyRecipesOfFamily(q: Queryable, familyId: string, before: After | null, limit: number): Promise<RecipeRow[]> {
  const { rows } = await q.query(
    `select ${RECIPE}, created_at::text as cursor_at from recipes
      where family_id = $1 and status = 'ready' ${before ? "and (created_at, id) < ($3::timestamptz, $4)" : ""}
      order by created_at desc, id desc limit $2`,
    before ? [familyId, limit, before.at, before.id] : [familyId, limit],
  );
  return rows;
}

export async function recipeIdsOfCook(q: Queryable, personId: string, limit = 500): Promise<string[]> {
  const { rows } = await q.query(`select id from recipes where cook_id = $1 order by created_at desc limit $2`, [personId, limit]);
  return rows.map((row) => row.id);
}
