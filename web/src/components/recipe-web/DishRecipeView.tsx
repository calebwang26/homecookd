'use client';
// The locked recipe view on the dish pages (/a after Mom answered, /miss on the kid's card): the /r page's
// limited view of a recipe (RecipeWebView: the recipe, its ingredients and its steps; any other tap opens
// "Get the app", then the sheet) read from the dish card's version instead of recipe.json. The page that
// opens it passes what is theirs: the words, the sheet, the way back.
import { useEffect, useMemo, type ReactNode } from 'react';
import { useLang } from '@/components/dish/lang';
import type { Recipe as DishRecipe } from '@/lib/dish/types';
import { recipeFromDish } from '@/lib/recipe-web/fromDish';
import type { DishLock } from './context';
import { RecipeWebView } from './RecipeWebApp';
import ui from './RecipeWeb.module.css';

type Props = Omit<DishLock, 't' | 'recipe' | 'renderSheet'> & {
  /** the card's token: keeps this view's ticked ingredients apart from other dishes */
  id: string;
  /** the screen it opens on: the recipe, or "Get these ready" from the card's Start cooking */
  start?: 'recipe' | 'ingredients';
  title: string;
  photo: string | null;
  version: DishRecipe;
  sheet: (p: { open: boolean; onClose: () => void }) => ReactNode;
};

export function DishRecipeView({ id, start = 'recipe', title, photo, version, sheet, R, hear, meta, clips, popover, onClose, coverless }: Props) {
  const { t } = useLang();
  const { recipe, share } = useMemo(() => recipeFromDish(`dish-${id}`, title, R, photo, version), [id, title, R, photo, version]);
  const dish = useMemo<DishLock>(
    () => ({ recipe: version, t, R, hear, meta, clips, popover, renderSheet: sheet, onClose, coverless }),
    [version, t, R, hear, meta, clips, popover, sheet, onClose, coverless],
  );
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className={ui.page}>
      <div className={ui.column}>
        <RecipeWebView share={share} recipe={recipe} dish={dish} start={start} />
      </div>
    </div>
  );
}
