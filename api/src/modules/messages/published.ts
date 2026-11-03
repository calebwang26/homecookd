// What a published recipe owes the family's messages, from Convex's worker.published, Supabase's /jobs/:id/published and V2-LINKING.md §1.4: her follow-up
// questions in her language, the recording's pending send delivered, and the "filmed" push to the kid whose request card the recording answers. The worker's
// `recipe_published` message brings it here (jobs/tasks.ts), and so does staging's POST /v1/test/recipe {jobId}. SQS can deliver it twice, so every part is safe
// to repeat.
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import type { Trace } from "../dish/budget.js";
import { memberById } from "../people/family.js";
import { familyRecipe } from "../recipes/read.js";
import { deliverPending } from "./activity.js";
import { translateFollowUps } from "./questions.js";

/** The finished job, as jobs/tasks.ts read it. */
export type Published = { jobId: string; familyId: string; cookId: string; recipeId: string; uploadId: string; dishAskId: string | null };

export async function recipePublished(p: Published, trace: Trace): Promise<void> {
  const recipe = await familyRecipe(db(), p.familyId, p.recipeId);
  // A recipe that isn't ready is its cook's alone, so nothing here tells anyone of it.
  if (!recipe || recipe.status !== "ready" || recipe.cook_id !== p.cookId) return;
  const language = (await memberById(db(), p.cookId))?.language;
  if (language && language !== "en") await tx((c) => translateFollowUps(c, recipe.id, language, trace.requestId));
  // Who she picked before it was done gets what send-recipe sends, once: the claim and the messages are one transaction, so a repeat finds it delivered.
  if (recipe.library_id) await deliverPending(p.familyId, p.uploadId, recipe.library_id, trace.requestId, undefined, { id: p.jobId, cookId: p.cookId });
  // A repeat queues it again, and its dedupe key (filmed:<recipeId>) sends it once.
  if (p.dishAskId) await enqueue(db(), { queue: "scheduled", payload: { task: "push.dish_filmed", askId: p.dishAskId, recipeId: recipe.id }, requestId: trace.requestId });
}
