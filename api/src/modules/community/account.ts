// What deleting an account does to Community (SCHEMA.md section 4). accounts/purgeSteps.ts and startDeletion call this. Community holds no file keys, so nothing here
// marks a file. Both are safe to run again: each step leaves the person's lists as it goes.
import { type Queryable, db } from "../../db.js";
import { inBatches, ON_ITS_OWN, type PurgeRun } from "../../purge.js";
import { recipeIdsOfCook } from "../recipes/service.js";
import * as data from "./data.js";

/** At once, in the deletion's transaction: off the map now, the dinners they host and any around their recipes. */
export async function cancelDinnersOfPerson(c: Queryable, personId: string): Promise<void> {
  await data.cancelDinnersOf(c, personId, await recipeIdsOfCook(c, personId));
}

/**
 * Then in batches. Run before the person's recipes are deleted, because it finds what's around them: their dinners go with their asks and opens, another family's dinner
 * around their recipe stays cancelled with its dish's name and no recipe, their own asks go, swaps they asked or that name their recipes go. A report loses who filed it and
 * keeps the family's hide, and a block loses the label that could hold a cook's first name.
 */
export async function purgeCommunityForPerson(personId: string, familyId: string, run: PurgeRun = ON_ITS_OWN): Promise<number> {
  const recipes = await recipeIdsOfCook(db(), personId);
  let changed = 0;
  changed += await inBatches(run, "dinners they host", (c, max) => data.deleteHostedDinners(c, personId, max));
  changed += await inBatches(run, "dinners around their recipes", (c, max) => data.detachDinnersFromRecipes(c, recipes, max));
  changed += await inBatches(run, "dinners they asked for", (c, max) => data.deleteAsksOf(c, personId, max));
  changed += await inBatches(run, "swaps", (c, max) => data.deleteSwapsOf(c, personId, recipes, max));
  changed += await inBatches(run, "reports", (c, max) => data.forgetReporter(c, personId, max));
  changed += await inBatches(run, "blocks", (c, max) => data.blankBlockLabels(c, familyId, max));
  await data.forgetRetryKeys(db(), personId);
  return changed;
}
