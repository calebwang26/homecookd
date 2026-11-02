// Read-only: what other modules may ask about a recipe. `recipes` moves with jobs, later; nothing here writes it.
import type { Queryable } from "../../db.js";
import type { RecipeStep } from "./data.js";

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
  story_card_text: string | null;
  story_card_used_stories: boolean | null;
  story_card_culture: string | null;
};

/** What a story card is written from (Convex's storyFacts), and what sharing checks. Her memories only after her yes: otherwise they stay in the database. Index: the primary key. */
export async function storyCardSource(q: Queryable, id: string): Promise<StoryCardSource | null> {
  const { rows } = await q.query(
    `select id, family_id, cook_id, title, status, steps, case when memories_opt_in then memories else '[]'::jsonb end as memories, memories_opt_in, shared_at,
            story_card_text, story_card_used_stories, story_card_culture
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
