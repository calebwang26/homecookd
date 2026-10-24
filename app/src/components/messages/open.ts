// Where a dish opens from a chat (recipe cards, cooked cards, dish attachments, step-less chips):
// the cook's own page for a dish that is mine, else openRecipe (kids: inside the Recipes tab).
import { router } from 'expo-router';

import { openRecipe } from '@/lib/navigation';

export function openDish(recipeId: string | null | undefined, opts: { mine?: boolean } = {}) {
  if (!recipeId) return;
  if (opts.mine) {
    router.push({ pathname: '/my-recipe/[id]', params: { id: recipeId } });
    return;
  }
  openRecipe(router, recipeId);
}
