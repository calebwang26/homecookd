// What deleting an account does to Community (SCHEMA.md section 4). Nothing calls this yet: the account purge moves last. Community holds no file keys, so nothing here
// marks a file. Both are safe to run again: each step leaves the person's lists as it goes.
import { type Queryable, db } from "../../db.js";
import { recipeIdsOfCook } from "../recipes/service.js";
import * as data from "./data.js";

const BATCH = 500;

/** At once, in the deletion's transaction: off the map now, the dinners they host and any around their recipes. */
export async function cancelDinnersOfPerson(c: Queryable, personId: string): Promise<void> {
  await data.cancelDinnersOf(c, personId, await recipeIdsOfCook(c, personId));
}

const inBatches = async (step: () => Promise<number>) => {
  while ((await step()) === BATCH);
};

/**
 * Then in batches. Run before the person's recipes are deleted, because it finds what's around them: their dinners go with their asks and opens, another family's dinner
 * around their recipe stays cancelled with its dish's name and no recipe, their own asks go, swaps they asked or that name their recipes go. A report loses who filed it and
 * keeps the family's hide, and a block loses the label that could hold a cook's first name.
 */
export async function purgeCommunityForPerson(personId: string, familyId: string): Promise<void> {
  const recipes = await recipeIdsOfCook(db(), personId);
  await inBatches(() => data.deleteHostedDinners(db(), personId, BATCH));
  await inBatches(() => data.detachDinnersFromRecipes(db(), recipes, BATCH));
  await inBatches(() => data.deleteAsksOf(db(), personId, BATCH));
  await inBatches(() => data.deleteSwapsOf(db(), personId, recipes, BATCH));
  await inBatches(() => data.forgetReporter(db(), personId, BATCH));
  await inBatches(() => data.blankBlockLabels(db(), familyId, BATCH));
  await data.forgetRetryKeys(db(), personId);
}
