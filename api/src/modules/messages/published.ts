// What a published recipe owes the family's messages, from Convex's worker.published: her follow-up questions in her language. The worker's `recipe_published`
// message brings it here (jobs/tasks.ts), and so does staging's POST /v1/test/recipe {jobId}. SQS can deliver it twice, so every part is safe to repeat.
import { db, tx } from "../../db.js";
import type { Trace } from "../dish/budget.js";
import { memberById } from "../people/family.js";
import { familyRecipe } from "../recipes/read.js";
import { translateFollowUps } from "./questions.js";

/** The finished job, as jobs/tasks.ts read it. */
export type Published = { jobId: string; familyId: string; cookId: string; recipeId: string; uploadId: string };

export async function recipePublished(p: Published, trace: Trace): Promise<void> {
  const recipe = await familyRecipe(db(), p.familyId, p.recipeId);
  // A recipe that isn't ready is its cook's alone, so nothing here tells anyone of it.
  if (!recipe || recipe.status !== "ready" || recipe.cook_id !== p.cookId) return;
  const language = (await memberById(db(), p.cookId))?.language;
  if (language && language !== "en") await tx((c) => translateFollowUps(c, recipe.id, language, trace.requestId));
}
