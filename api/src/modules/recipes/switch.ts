// The one switch for the api writing `recipes`. OFF.
//
// Since Nov 2 there's one switch for every area at launch (docs/build/CUTOVER.md), and no sync runs: the api owns `recipes` from its first row. So the flag
// opens writes by itself, unless a sync is copying the table right now. Then the sync owns the rows (docs/build/SYNC-MIGRATION.md), whatever the flag says:
//
//   the copy is read-only and not moved               locked: a sync is copying. Writes answer 501 not_moved, and so does a new job, since the worker
//                                                     couldn't save its recipe at the end.
//   RECIPE_WRITES=on                                  open: the routes write, and a new job gets its "processing" card.
//   anything else                                     closed: writes answer 501 not_moved; a new job has no card, and the worker makes the recipe when it
//                                                     publishes.
//
// Before Nov 2, open also needed sync_copies.moved_at, which only the sync's own release set: production would never have opened.
import type { Queryable } from "../../db.js";
import { refused } from "../../errors.js";

export type RecipeWrites = "open" | "closed" | "locked";

export const recipeWritesFlag = (env: NodeJS.ProcessEnv = process.env) => env.RECIPE_WRITES === "on"; // anything not spelled exactly is off

/** sync_copies has three rows, read by its primary key. */
export async function recipeWrites(q: Queryable, env: NodeJS.ProcessEnv = process.env): Promise<RecipeWrites> {
  const { rows } = await q.query(`select read_only, moved_at from sync_copies where table_name = 'recipes'`);
  const copy = rows[0] as { read_only: boolean; moved_at: Date | null } | undefined;
  if (copy?.read_only && !copy.moved_at) return "locked";
  return recipeWritesFlag(env) ? "open" : "closed";
}

export const notMoved = () => refused(501, "not_moved", "This can't be done here yet.");
