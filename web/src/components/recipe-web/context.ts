'use client';
import { createContext, useContext } from 'react';
import type { Recipe, Share } from '@/lib/recipe-web/types';
import type { RangeState } from './useRangeMedia';

export type Screen = { name: 'recipe' } | { name: 'ingredients' } | { name: 'step'; i: number };

/** Everything that needs the app opens the "Get the app" popover with words for what was tapped. */
export type LockKind = 'heart' | 'share' | 'askFamily' | 'askStep' | 'getApp' | 'madeIt';

export type HearRequest = { key: string; start: number; end: number; label: string; words: string | null };

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
};

export const RWContext = createContext<RW | null>(null);

export function useRW(): RW {
  const v = useContext(RWContext);
  if (!v) throw new Error('useRW outside RecipeWebApp');
  return v;
}
