// The one switch for the api writing `recipes`. OFF.
//
// `recipes` is the temporary sync's copy until its area moves (docs/build/SYNC-MIGRATION.md). The rule there: a migration sets sync_copies.moved_at for the
// table, in the release that switches the worker, and from then on the api may write it. This adds a flag on top, so turning writes off needs no release:
//
//   RECIPE_WRITES=on  AND  sync_copies.moved_at set   open: the routes write, and a new job gets its "processing" card.
//   anything else, and the copy is read-only          locked: the sync owns the rows. Writes answer 501 not_moved, and so does a new job, since the worker
//                                                     couldn't save its recipe at the end.
//   anything else, and the copy isn't read-only       closed: the sync has never run, so only fake data is here. Writes answer 501 not_moved; a new job has no
//                                                     card, and the worker makes the recipe when it publishes.
//
// Comes off with the sync: sync_copies goes then, and writes are simply open.
import type { Queryable } from "../../db.js";
import { refused } from "../../errors.js";

export type RecipeWrites = "open" | "closed" | "locked";

export const recipeWritesFlag = (env: NodeJS.ProcessEnv = process.env) => env.RECIPE_WRITES === "on"; // anything not spelled exactly is off

/** sync_copies has three rows, read by its primary key. */
export async function recipeWrites(q: Queryable, env: NodeJS.ProcessEnv = process.env): Promise<RecipeWrites> {
  const { rows } = await q.query(`select read_only, moved_at from sync_copies where table_name = 'recipes'`);
  const copy = rows[0] as { read_only: boolean; moved_at: Date | null } | undefined;
  const moved = !!copy?.moved_at;
  if (moved && recipeWritesFlag(env)) return "open";
  return copy?.read_only && !moved ? "locked" : "closed";
}

export const notMoved = () => refused(501, "not_moved", "This can't be done here yet.");
