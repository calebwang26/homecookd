// Tile data for the Every family cloud (brief 8.7, a7 M15). Pure, deterministic (seeded), server-safe.
import type { Recipe } from '@/content/types';
import { CLOUD_BOTTOM, CLOUD_TOP, getRecipe } from '@/content/recipes';
import { PHOTOS, type Photo } from '@/content/media';
import { seeded } from '@/lib/deck/layouts';

export type RowName = 'top' | 'bottom';

export interface Tile {
  /** index inside the 12-tile row */
  i: number;
  recipe: Recipe;
  /** use the recipe's cookPhoto */
  face?: 'cook';
  /** a lifestyle photo of the family instead of the dish */
  photo?: Photo;
  /** degrees, −8 → +8 */
  tilt: number;
  /** depth scale .85 → 1.1 (smaller = farther = slightly desaturated) */
  depth: number;
  /** wave offset in amplitudes (≈ −1.2 → 1.2); y = wave × --amp */
  wave: number;
}

/**
 * a7's cloud is people; ours mixes dishes with the families who cook them, so the rows read as
 * "every kind of family" and not as a menu. Keys are `${row}:${index}` in CLOUD_TOP / CLOUD_BOTTOM.
 */
const PEOPLE: Record<string, Pick<Tile, 'face' | 'photo'>> = {
  'top:5': { face: 'cook' }, // Dad's Sunday Chili: Dad with his grown son
  'top:8': { photo: PHOTOS.familyLaughingTable }, // Auntie Dee's Mac and Cheese: the whole table laughing
  'top:9': { face: 'cook' }, // Grandpa Joe's Pierogi: Grandpa chopping in his gingham apron
  'top:10': { photo: PHOTOS.elderHandsDumpling }, // Grandma's Sunday Dumplings: her floury hands
  'bottom:1': { photo: PHOTOS.familyDinnerTable }, // Papa's Dal Tadka: three generations at the table
  // Grandpa Rey's Adobo and Mom's Jollof repeat from the top row, so they show their families here
  // (as Dad's Chili does in the top row): no dish photo appears twice in one viewport.
  'bottom:5': { photo: PHOTOS.grandpaGrandson }, // Grandpa Rey's Adobo: Grandpa with his grandson
  'bottom:6': { photo: PHOTOS.momDaughter }, // Mom's Banana Bread: Mom and her grown daughter
  'bottom:10': { photo: PHOTOS.cookRecordingPhone }, // Mom's Jollof: Mom cooking while her phone records
};

/** The wave repeats every 6 tiles, so a 12-tile row (and its duplicate) loops without a seam. */
const WAVE_PERIOD = 6;
const ROW_SEED: Record<RowName, { seed: number; phase: number }> = {
  top: { seed: 20261012, phase: 0.35 },
  bottom: { seed: 7031958, phase: 2.2 },
};

function buildRow(row: RowName, ids: readonly string[]): Tile[] {
  const rand = seeded(ROW_SEED[row].seed);
  return ids.map((id, i) => {
    const tilt = Math.round((rand() * 16 - 8) * 10) / 10;
    const depth = Math.round((0.85 + rand() * 0.25) * 100) / 100;
    const jitter = (rand() - 0.5) * 0.45;
    const wave = Math.round((Math.sin((2 * Math.PI * i) / WAVE_PERIOD + ROW_SEED[row].phase) + jitter) * 100) / 100;
    return { i, recipe: getRecipe(id), tilt, depth, wave, ...PEOPLE[`${row}:${i}`] };
  });
}

export const ROWS: Record<RowName, Tile[]> = {
  top: buildRow('top', CLOUD_TOP),
  bottom: buildRow('bottom', CLOUD_BOTTOM),
};

/** Every distinct recipe in the cloud, for the visually hidden list. */
export const CLOUD_RECIPES: Recipe[] = Array.from(
  new Map([...ROWS.top, ...ROWS.bottom].map((t) => [t.recipe.id, t.recipe])).values(),
);
