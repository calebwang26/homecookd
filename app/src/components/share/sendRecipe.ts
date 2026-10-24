// Send recipe cards inside homecookd (POST /send-recipe): the one send path for the share sheet's
// family row and the parent "Send a recipe" sheet. The API takes one recipe per call, so several
// recipes go out as parallel calls. The spinner never flashes (motion spec 5: at least 450 ms).
import { api } from '@/lib/api';
import { refreshThreads } from '@/lib/messaging';
import { motion } from '@/theme/tokens';

export type SendTo = string[] | 'everyone';

/** Sends every recipe to `to`. Resolves with the ids that didn't go out and the first error. */
export async function sendRecipes(recipeIds: string[], to: SendTo): Promise<{ failed: string[]; error: unknown }> {
  const started = Date.now();
  const results = await Promise.allSettled(recipeIds.map((id) => api.sendRecipe({ recipe_id: id, to })));
  const failed = recipeIds.filter((_, i) => results[i].status === 'rejected');
  const error = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason ?? null;
  // Anything sent shows up in the inbox (and in "Sent to Leo" lines) without waiting for a poll.
  if (failed.length < recipeIds.length) void refreshThreads();
  const left = motion.loadingMinMs - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  return { failed, error };
}
