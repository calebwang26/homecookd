// Reading a family's recipes, for the app (recipes.list, recipes.get) and the jobs module's purge. Every query, and the index behind it:
//
//   Query                          Index                  Limit
//   a family's recipes, newest     recipes_family_recent  a page, 100
//   one recipe                     recipes primary key    1
//   a cook's recipes (the purge)   recipes_cook           the caller's batch
//   has the list changed? (a poll)  recipes_family_recent  101
//
// Keeps Convex's field names and epoch milliseconds, and builds links from keys here (SCHEMA.md, "What doesn't change").
import type { Signed } from "../../auth.js";
import { db, type Queryable } from "../../db.js";
import { notFound, refused } from "../../errors.js";
import { afterCursor, pageOf, type After } from "../../paging.js";
import { namesOf } from "../people/reads.js";
import { mediaUrl, stockUrl } from "./media.js";
import { saveMemoriesOptIn } from "./writes.js";

export const PAGE = 100; // recipes.list's .take(100)

export type RecipeRow = {
  id: string;
  family_id: string;
  cook_id: string;
  title: string;
  status: "processing" | "ready" | "failed";
  library_id: string | null;
  media_prefix: string | null;
  recipe_json_key: string | null;
  cover_key: string | null;
  cover_version: string | null;
  cover_stock_path: string | null;
  steps: unknown[];
  memories: unknown[];
  added_ingredients: unknown[];
  step_count: number;
  memories_opt_in: boolean;
  moss_indexed_at: Date | null;
  language: string | null;
  shared_at: Date | null;
  story_card_text: string | null;
  story_card_written_at: Date | null;
  story_card_used_stories: boolean | null;
  story_card_culture: string | null;
  story_card_quote: string | null;
  hidden_at: Date | null;
  created_at: Date;
  cursor_at: string;
};

const ms = (at: Date | null | undefined) => at?.getTime() ?? undefined;

/** Stories and tips show only once the cook said yes, except to the cook. */
export function recipeView(row: RecipeRow, viewer: Signed, cookName: string) {
  const show = row.memories_opt_in || row.cook_id === viewer.personId;
  return {
    _id: row.id,
    _creationTime: row.created_at.getTime(),
    familyId: row.family_id,
    cookId: row.cook_id,
    cookName,
    title: row.title,
    status: row.status,
    libraryId: row.library_id ?? undefined,
    recipeJsonUrl: row.recipe_json_key ? mediaUrl(row.recipe_json_key) : undefined,
    coverUrl: row.cover_stock_path ? stockUrl(row.cover_stock_path) : row.cover_key ? mediaUrl(row.cover_key, row.cover_version) : undefined,
    steps: row.steps,
    stepCount: row.step_count,
    memories: show ? row.memories : [],
    memoriesOptIn: row.memories_opt_in,
    mossIndexedAt: ms(row.moss_indexed_at),
    language: row.language ?? undefined,
    sharedAt: ms(row.shared_at),
    storyCard: row.story_card_text
      ? {
          text: row.story_card_text,
          writtenAt: ms(row.story_card_written_at),
          usedStories: row.story_card_used_stories ?? undefined,
          culture: row.story_card_culture ?? undefined,
          quote: row.story_card_quote ?? undefined,
        }
      : undefined,
    hiddenAt: ms(row.hidden_at),
    addedIngredients: row.added_ingredients.length ? row.added_ingredients : undefined,
  };
}

const COLUMNS = `id, family_id, cook_id, title, status, library_id, media_prefix, recipe_json_key, cover_key, cover_version, cover_stock_path, steps, memories,
  added_ingredients, step_count, memories_opt_in, moss_indexed_at, language, shared_at, story_card_text, story_card_written_at, story_card_used_stories,
  story_card_culture, story_card_quote, hidden_at, created_at, created_at::text as cursor_at`;

/** A recipe that isn't ready yet, or failed, shows only to its cook (Caleb, Nov 1), like the job behind it. */
async function familyRecipes(q: Queryable, familyId: string, viewerId: string, before: After | null, limit: number): Promise<RecipeRow[]> {
  const { rows } = await q.query(
    `select ${COLUMNS} from recipes
      where family_id = $1 and (status = 'ready' or cook_id = $2) ${before ? "and (created_at, id) < ($4::timestamptz, $5)" : ""}
      order by created_at desc, id desc limit $3`,
    before ? [familyId, viewerId, limit, before.at, before.id] : [familyId, viewerId, limit],
  );
  return rows;
}

async function recipeById(q: Queryable, id: string): Promise<RecipeRow | null> {
  const { rows } = await q.query(`select ${COLUMNS} from recipes where id = $1`, [id]);
  return rows[0] ?? null;
}

/** The recipes a person cooked, for the purge. */
export async function recipesOfCook(q: Queryable, personId: string, limit: number): Promise<RecipeRow[]> {
  const { rows } = await q.query(`select ${COLUMNS} from recipes where cook_id = $1 order by created_at desc limit $2`, [personId, limit]);
  return rows;
}

/**
 * The cheap check a live poll needs before loading whole recipes (LIVE-UPDATES.md, "How later areas plug in"). `updated_at` is kept by a trigger (071), so the worker's writes
 * and the sync's count, and the count catches a row that went. It doesn't depend on who's asking: what a viewer sees of a row changes only when the row does.
 */
export async function recipesVersion(familyId: string): Promise<string> {
  const { rows } = await db().query(
    `select count(*)::int as n, coalesce(max(updated_at)::text, '') as newest
       from (select updated_at from recipes where family_id = $1 order by created_at desc, id desc limit $2) newest_page`,
    [familyId, PAGE + 1],
  );
  return `${rows[0].n}:${rows[0].newest}`;
}

export async function listRecipes(signed: Signed, cursor?: string) {
  const fetched = await familyRecipes(db(), signed.familyId, signed.personId, afterCursor(cursor), PAGE + 1);
  const { rows, nextCursor } = pageOf(fetched, PAGE);
  const names = await namesOf(db(), rows.map((r) => r.cook_id));
  return { recipes: rows.map((r) => recipeView(r, signed, names.get(r.cook_id) ?? "")), nextCursor };
}

/** Null for a missing recipe and for another family's: they read the same. */
export async function readRecipe(signed: Signed, id: string) {
  const row = await recipeById(db(), id);
  if (!row || row.family_id !== signed.familyId) return null;
  if (row.status !== "ready" && row.cook_id !== signed.personId) return null;
  const names = await namesOf(db(), [row.cook_id]);
  return recipeView(row, signed, names.get(row.cook_id) ?? "");
}

export async function getRecipe(signed: Signed, id: string) {
  const recipe = await readRecipe(signed, id);
  if (!recipe) throw notFound();
  return recipe;
}

const GONE = "That recipe isn't here anymore.";

/** The cook's yes (or no) to sharing the stories and tips from this video. Who's asking is refused before the switch says anything. */
export async function setMemoriesOptIn(signed: Signed, id: string, optIn: boolean): Promise<void> {
  const row = await recipeById(db(), id);
  if (!row || row.family_id !== signed.familyId) throw notFound(GONE);
  if (row.cook_id !== signed.personId) throw refused(403, "forbidden", "Only the cook can share these.");
  await saveMemoriesOptIn(db(), id, optIn);
}
