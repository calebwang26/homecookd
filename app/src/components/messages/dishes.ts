// Recipe lookups for messages: library entries by id (titles, posters, cooks) and full recipes for
// the ones a chat needs step titles / times from.
import { useMemo } from 'react';

import { getCachedEntry, useLibrary, useRecipes } from '@/lib/recipes';
import type { LibraryEntry, Recipe } from '@/lib/types';

/** `entry(id)` resolves a recipe id to its library entry (or null when it isn't in the library). */
export function useDishLookup() {
  const { entries } = useLibrary();
  return useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e] as const));
    return {
      entries,
      entry: (id: string | null | undefined): LibraryEntry | null => (id ? (byId.get(id) ?? getCachedEntry(id) ?? null) : null),
    };
  }, [entries]);
}

/** Full recipes for every recipe id in a chat (for step titles and "~50 min"). */
export function useChatRecipes(ids: (string | null | undefined)[]): Record<string, Recipe> {
  const unique = useMemo(() => [...new Set(ids.filter((x): x is string => !!x))].sort(), [ids]);
  return useRecipes(unique);
}
