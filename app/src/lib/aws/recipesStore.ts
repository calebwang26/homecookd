// The family's recipes on the AWS api (1.1): GET /v1/recipes has no live topic, so it's read when a screen first
// watches it, when the app comes back to the front, and when one of her jobs turns done (refreshAwsRecipes).
// One shared copy per person, as Convex's recipes.list subscription was. A failed read keeps what's on screen.

import { onFront } from './live';
import { recipes, type Recipe } from './jobs';

type Store = { watchers: Set<(r: Recipe[]) => void>; value: Recipe[] | null; loading: boolean; offFront: () => void };
const stores = new Map<string, Store>();

async function load(key: string, as: string | null) {
  const s = stores.get(key);
  if (!s || s.loading) return;
  s.loading = true;
  try {
    const list = await recipes.all(20, as);
    if (stores.get(key) !== s) return;
    s.value = list;
    s.watchers.forEach((w) => w(list));
  } catch (e) {
    console.warn('[aws] recipes', e instanceof Error ? e.message : e);
  } finally {
    s.loading = false;
  }
}

/** Watch the family's recipes as `as` (default: whoever is in). Returns the way to stop. */
export function watchAwsRecipes(onData: (r: Recipe[]) => void, as: string | null = null): () => void {
  const key = as ?? '';
  let s = stores.get(key);
  if (!s) {
    s = { watchers: new Set(), value: null, loading: false, offFront: onFront(() => void load(key, as)) };
    stores.set(key, s);
    void load(key, as);
  } else if (s.value) {
    onData(s.value);
  }
  s.watchers.add(onData);
  const store = s;
  return () => {
    store.watchers.delete(onData);
    if (!store.watchers.size) {
      store.offFront();
      stores.delete(key);
    }
  };
}

/** Read every watched list again (a job just turned done, or a recipe changed). */
export function refreshAwsRecipes() {
  for (const [key] of stores) void load(key, key || null);
}

/** One read, not shared (a lookup by recipe id). */
export const readAwsRecipes = (as: string | null = null) => recipes.all(20, as);
