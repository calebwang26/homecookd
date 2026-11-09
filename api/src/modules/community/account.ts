// What deleting an account, or leaving a family, does to Community (SCHEMA.md section 4). accounts/purgeSteps.ts, startDeletion and removePerson call this. Community
// holds no file keys, so nothing here marks a file. All are safe to run again: each step leaves the person's lists as it goes.
import { type Queryable, db } from "../../db.js";
import { inBatches, ON_ITS_OWN, type PurgeRun } from "../../purge.js";
import { recipeIdsOfCook } from "../recipes/service.js";
import * as data from "./data.js";

/**
 * At once, in the deletion's transaction: off the map now, the dinners they host and any around their recipes that haven't started. Theirs go in the batches below, but
 * until then a cancelled one shows no guest its address and its invite link opens nothing, so the ones that have started are called off too. Another host's
 * dinner of their dish that has started keeps what it was: nothing of the cook's is on it but the dish's name, which it keeps anyway.
 */
export async function cancelDinnersOfPerson(c: Queryable, personId: string): Promise<void> {
  await data.cancelDinnersOf(c, personId, await recipeIdsOfCook(c, personId));
}

/**
 * At once, in the transaction that takes them out of a family (leaving, or a move to another): the dinners they host that haven't started are called off. Only the host
 * may answer an ask, and they can't act in that family again. Unlike a deletion, dinners around their recipes go on, since the recipes stay, and a dinner that has
 * started keeps what it was. Their asks on dinners ahead go too, so a seat they held is free again (Caleb, Nov 8: decision 5; dinners.ts).
 */
export async function cancelDinnersOfLeaver(c: Queryable, personId: string): Promise<void> {
  await data.cancelDinnersAheadOf(c, personId);
  await data.dropUpcomingAsksOf(c, personId);
}

/**
 * Then in batches. Run before the person's recipes are deleted, because it finds what's around them: their dinners go with their asks and opens, another family's dinner
 * around their recipe keeps its dish's name and loses the recipe (cancelled unless it had started), their own asks go, swaps they asked or that name their recipes go. A
 * report loses who filed it and keeps the family's hide, and a block loses the label that could hold a cook's first name.
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
