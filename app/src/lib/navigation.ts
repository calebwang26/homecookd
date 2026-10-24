// Where a dish opens (FEEDBACK-OCT16b 1.2).
//
//   openRecipe(router, id)    a kid: inside the Recipes tab (/kid/recipes/<id>, the list under it,
//                             so Back returns to Recipes); anyone else: /recipe/<id>.
//   backToRecipe(router, id)  from ingredients / cook mode: back to that dish's page, wherever it lives.
//
// The kid tabs tell this module whether they are mounted and on top (useKidTabsPresence), because
// the right action differs: on top, a plain navigate switches tabs; covered by a chat, ingredients
// or cook mode, those are dismissed first (navigating would stack a second copy of the tabs).
import { useIsFocused, type Href, type ImperativeRouter } from 'expo-router';
import { useEffect } from 'react';

/** `router` from expo-router or `useRouter()`. */
export type RouterLike = Pick<ImperativeRouter, 'navigate' | 'push' | 'dismissTo'>;

let kidTabs = { mounted: 0, focused: false };

/** Kid tabs layout only: report that the tabs exist and whether they are the top screen. */
export function useKidTabsPresence() {
  const focused = useIsFocused();
  useEffect(() => {
    kidTabs = { ...kidTabs, mounted: kidTabs.mounted + 1 };
    return () => {
      kidTabs = { mounted: kidTabs.mounted - 1, focused: false };
    };
  }, []);
  useEffect(() => {
    kidTabs = { ...kidTabs, focused };
  }, [focused]);
}

export function kidRecipeHref(id: string): Href {
  return { pathname: '/kid/recipes/[id]', params: { id } };
}

/** Open a dish. Kids land in the Recipes tab; parents (and anyone without kid tabs) on /recipe/<id>. */
export function openRecipe(router: RouterLike, id: string): void {
  if (!id) return;
  if (kidTabs.mounted <= 0) {
    router.push({ pathname: '/recipe/[id]', params: { id } });
    return;
  }
  // withAnchor: the Recipes list is always under the dish, so Back lands on it.
  if (kidTabs.focused) router.navigate(kidRecipeHref(id), { withAnchor: true });
  else router.dismissTo(kidRecipeHref(id), { withAnchor: true });
}

/** Back to a dish's page from ingredients or cook mode (dismissing them). */
export function backToRecipe(router: RouterLike, id: string): void {
  if (kidTabs.mounted > 0) router.dismissTo(kidRecipeHref(id), { withAnchor: true });
  else router.dismissTo({ pathname: '/recipe/[id]', params: { id } });
}
