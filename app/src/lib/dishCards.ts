// A dish-ask card in the app (/dish/[id]): dishAsks.get, live, for the card's kid or cook (DISH-ASK-SPEC.md §9).
// Soft: a deployment without it yet gives null ("This card isn't here"). The shapes and what the screen shows of
// them: lib/dishView.ts.
// Web dev aid (screenshots): `?preview=dish` (the kid, waiting), `?preview=dish-answered` (the kid, Mom answered),
// `?preview=dish-cook` (Mom's side), for the id 'preview'.
import { Platform } from 'react-native';

import type { DishRecipe, MyCard } from './dishView';
import { useLive } from './live/convex';

const PREVIEW = __DEV__ && Platform.OS === 'web' ? /[?&]preview=(dish(?:-answered|-cook)?)\b/.exec(globalThis.location?.search ?? '')?.[1] : undefined;

const GUESS: DishRecipe = {
  dish: 'braised pork',
  servings: '1',
  time: '~20 min',
  cost: '~$3',
  ingredients: [
    { name: 'pork belly', amount: '~1 lb', status: 'guessed', clip: null },
    { name: 'soy sauce', amount: '~3 tbsp', status: 'guessed', clip: null },
    { name: 'sugar', amount: '~1 tbsp', status: 'guessed', clip: null },
    { name: 'eggs, maybe?', amount: '', status: 'unknown', clip: null },
  ],
  steps: [
    { title: 'Brown the pork in a dry pot.', lines: [], tip: null },
    { title: 'Add soy sauce, sugar and water to cover.', lines: [], tip: null },
    { title: 'Simmer, covered, until soft.', lines: [], tip: null },
  ],
};

const VERSION: DishRecipe = {
  ...GUESS,
  ingredients: [
    { name: 'dark soy sauce', amount: '2 big spoons', status: 'mom', clip: 'q1' },
    { name: 'rock sugar', amount: 'a handful', status: 'mom', clip: 'q1' },
    { name: 'pork belly', amount: '~1 lb', status: 'guessed', clip: null },
    { name: 'eggs, boiled first', amount: '4', status: 'mom', clip: 'q2' },
  ],
  steps: [
    { title: 'Brown the pork in a dry pot.', lines: [], tip: null },
    { title: 'Add the soy, the rock sugar and water to cover.', lines: [], tip: null },
    { title: 'Low heat, about an hour, lid on.', lines: [], tip: { words: 'If it bubbles hard, it goes tough.', english: null, clip: 'q2' } },
  ],
};

const SAMPLE: MyCard = {
  id: 'preview',
  side: PREVIEW === 'dish-cook' ? 'cook' : 'kid',
  dish: 'braised pork',
  relation: 'mom',
  kidName: 'Caleb',
  status: PREVIEW === 'dish' ? 'asked' : 'answered',
  guess: GUESS,
  version: PREVIEW === 'dish' ? null : VERSION,
  answers:
    PREVIEW === 'dish'
      ? []
      : [
          { id: 'q1', words: 'Two big spoons of the dark soy, and rock sugar. Low heat, an hour.', english: null, audioUrl: 'https://homecookd.app/preview.m4a', durationS: 12 },
          { id: 'q2', words: 'If it bubbles hard, it goes tough.', english: null, audioUrl: 'https://homecookd.app/preview.m4a', durationS: 5 },
        ],
  filmingDay: 0,
  photoUrls: [],
  createdAt: Date.now() - 3_600_000,
};

const none = () => () => {};

/** The card, live (undefined while loading, null when it isn't this person's or doesn't exist). */
export function useMyCard(id: string | null | undefined): MyCard | null | undefined {
  const preview = !!PREVIEW && id === 'preview';
  const live = useLive<MyCard | null | undefined>('dishAsks:get', undefined, none, !!id && !preview, { id: id ?? '' }, true);
  return preview ? SAMPLE : live;
}
