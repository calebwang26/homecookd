// The dish card's version (docs/build/DISH-ASK-SPEC.md §3) as the /r page's Recipe, so the limited recipe
// view (recipe, ingredients, steps; everything else says "Get the app") runs on it unchanged. Only the
// skeleton is mapped: the titles, the counts, the dish photo. There is no video or recording, so no
// Watch or Hear. The amounts, her struck-through guesses and her own words are read straight from the
// dish recipe by the screens (RW.dish.recipe, same order).
import type { Quote, Recipe as DishRecipe } from '@/lib/dish/types';
import { stepText } from '@/lib/dish/text';
import type { Recipe, Share } from './types';

export function recipeFromDish(id: string, title: string, cook: string, photo: string | null, dish: DishRecipe): { recipe: Recipe; share: Share } {
  const recipe: Recipe = {
    id,
    title,
    cook: { name: cook, relation: cook },
    intro: '',
    servings: dish.servings,
    total_time: dish.time,
    sample: false,
    source: null,
    tags: [],
    media: { video_url: null, audio_url: null, poster_url: photo, duration_s: 0 },
    ingredients: dish.ingredients.map((i) => ({ name: i.name, feel: '', estimate: i.amount, confidence: 'high', first_seen_s: null })),
    steps: dish.steps.map((st, i) => ({
      order: i + 1,
      title: st.title,
      instruction: stepText(st.lines),
      sensory_cue: null,
      start_s: 0,
      end_s: 0,
      quote: null,
      wait_after: null,
      story_ids: [],
      special_ids: [],
    })),
    stories: [],
    special: [],
  };
  // Nobody sent this view to anyone: no "<name> sent you this recipe".
  const share: Share = { token: id, recipe_id: id, recipe_url: '', sender: null, family_name: null };
  return { recipe, share };
}

/** The first thing she said in her version (an ingredient, then a step line, then a tip): the recipe screen's one line of her words. */
export function firstQuote(r: DishRecipe): Quote | null {
  const ing = r.ingredients.find((i) => i.status === 'mom' && i.quote)?.quote;
  if (ing) return ing;
  for (const st of r.steps) {
    const q = st.lines.find((l) => l.status === 'mom' && l.quote)?.quote ?? st.tip;
    if (q) return q;
  }
  return null;
}
