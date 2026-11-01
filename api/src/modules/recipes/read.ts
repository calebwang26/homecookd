// Read-only: what other modules may ask about a recipe. `recipes` moves with jobs, later; nothing here writes it.
import type { Queryable } from "../../db.js";

export type RecipeBrief = { id: string; family_id: string; cook_id: string; title: string; status: string; library_id: string | null };

const COLUMNS = `id, family_id, cook_id, title, status, library_id`;

/** Convex's familyRecipe: another family's recipe reads as no recipe. Index: the primary key. */
export async function familyRecipe(q: Queryable, familyId: string, id: string): Promise<RecipeBrief | null> {
  const { rows } = await q.query(`select ${COLUMNS} from recipes where id = $1 and family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function recipesByIds(q: Queryable, ids: string[]): Promise<RecipeBrief[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(`select ${COLUMNS} from recipes where id = any($1::text[])`, [ids]);
  return rows;
}

/** A cook's recipes, a batch at a time, for the purge. Index: recipes_cook. */
export async function recipeIdsOfCook(q: Queryable, cookId: string, after: string, limit: number): Promise<string[]> {
  const { rows } = await q.query(`select id from recipes where cook_id = $1 and id > $2 order by id limit $3`, [cookId, after, limit]);
  return rows.map((row) => row.id);
}
