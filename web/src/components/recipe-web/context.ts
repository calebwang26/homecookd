'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { QuestionId, Recipe as DishRecipe } from '@/lib/dish/types';
import type { T } from '@/lib/dish/words';
import type { Recipe, Share } from '@/lib/recipe-web/types';
import type { LockCopy } from './GetAppPopover';
import type { RangeState } from './useRangeMedia';

export type Screen = { name: 'recipe' } | { name: 'ingredients' } | { name: 'step'; i: number };

/** Everything that needs the app opens the "Get the app" popover with words for what was tapped. */
export type LockKind = 'heart' | 'share' | 'askFamily' | 'askStep' | 'getApp' | 'madeIt';

/** `url`: a clip of its own (the dish pages' answers); without it the recipe's one recording plays. */
export type HearRequest = { key: string; start: number; end: number; label: string; words: string | null; url?: string };

/**
 * The same locked view on the dish pages (/a after Mom answers, /miss on the kid's card): the recipe, its
 * ingredients and its steps are read from the dish card's version instead of recipe.json (`recipe` is
 * parallel to the adapted `Recipe`), the words come from the page-language tables, and the "Get the app"
 * sheet is the dish pages' own. See DishRecipeView.
 */
export type DishLock = {
  recipe: DishRecipe;
  t: T;
  /** "Mom" in the page language: the cook's name in the Hear sheet */
  R: string;
  /** the Hear pill on a step she recorded: "Hear Mom say it" for the kid, "Play your answer" for her */
  hear: string;
  /** under the dish title: "From Mom’s kitchen · ~20 min · Serves 2" */
  meta: string;
  clips: Partial<Record<QuestionId, { audioUrl: string | null; durationS: number }>>;
  /** every locked tap says this */
  popover: LockCopy;
  /** back to the page this view opened from */
  onClose: () => void;
  /** No cover page: Back from the ingredients is `onClose`. */
  coverless?: boolean;
};

export type RW = {
  recipe: Recipe;
  share: Share;
  screen: Screen;
  go: (s: Screen) => void;
  lock: (kind: LockKind, anchor: HTMLElement | null) => void;
  hear: (h: HearRequest) => void;
  hearState: RangeState;
  hearing: HearRequest | null;
  toggleHear: () => void;
  stopHear: () => void;
  watchAll: () => void;
  reduced: boolean;
  dish: DishLock | null;
};

export const RWContext = createContext<RW | null>(null);

export function useRW(): RW {
  const v = useContext(RWContext);
  if (!v) throw new Error('useRW outside RecipeWebApp');
  return v;
}
