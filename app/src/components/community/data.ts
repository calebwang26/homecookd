// Small Community helpers on top of lib/live/community.ts:
//   useFamilyRecipes()   recipes.list, live: this family's Convex recipes (null until it answers),
//                        for the share switch and the host form's dish chips
//   rememberCovers(feed) / coverFor(recipeId)   the feed's public stock photos, so the recipe and
//                        dinner pages can show the same photo without a second query
//   useNow()             the clock, once a minute (past dinners drop off while a screen stays open)
//   useWaited(ms)        true after `ms`: until then an empty answer may just be loading
import { useEffect, useState } from 'react';

import type { FeedRecipe } from '@/lib/live/community';
import { useLive } from '@/lib/live/convex';

export type FamilyRecipe = {
  _id: string;
  title: string;
  status: 'processing' | 'ready' | 'failed';
  libraryId?: string;
  cookName: string;
  sharedAt?: number;
};

const noRecipes = (onData: (v: FamilyRecipe[] | null) => void) => {
  onData([]);
  return () => {};
};

export function useFamilyRecipes(enabled = true): FamilyRecipe[] | null {
  return useLive<FamilyRecipe[] | null>('recipes:list', null, noRecipes, enabled);
}

const covers = new Map<string, string>();

export function rememberCovers(recipes: FeedRecipe[]): void {
  for (const r of recipes) if (r.coverUrl) covers.set(r.recipeId, r.coverUrl);
}

export function coverFor(recipeId: string | null | undefined): string | null {
  return (recipeId && covers.get(recipeId)) || null;
}

export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function useWaited(ms: number): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return waited;
}
