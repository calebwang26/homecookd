// A dish inside the kid's Recipes tab: the same screen as /recipe/<id>. Keyed by id, so a dish
// opened in place of another starts fresh.
import { useLocalSearchParams } from 'expo-router';

import { RecipeScreen } from '@/app/recipe/[id]/index';

export default function KidRecipe() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = raw ? String(raw) : '';
  return <RecipeScreen key={id} id={id} />;
}
