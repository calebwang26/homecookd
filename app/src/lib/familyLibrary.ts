// The signed-in family's own dishes in the library (recipes.ts useLibrary). The pipeline publishes a
// family's recipe through Convex (recipes.list) and never into the public library.json, which every
// copy of the app reads, so the library is library.json (or the bundled copy) plus the family's
// finished dishes that aren't in it yet.
//   familyEntries(rows, profiles)   recipes.list rows -> library entries (ready ones only)
//   withheldIds(rows)               those dishes whose stories and tips this viewer may not see
//   withoutStories(recipe)          a recipe without the cook's stories and tips
//   mergeLibrary(base, family)      the family's new dishes first, then library.json's, one per id
// Pure, so scripts/test-library.mjs runs it in Node.
import type { LibraryEntry, Recipe } from './types';

/** The fields of a Convex `recipes.list` row the library reads. */
export type FamilyRecipe = {
  _id: string;
  title: string;
  status: 'processing' | 'ready' | 'failed';
  cookId: string;
  cookName: string;
  libraryId?: string;
  recipeJsonUrl?: string;
  coverUrl?: string;
  /** The cook's yes to sharing this video's stories and tips (recipes.setMemoriesOptIn). */
  memoriesOptIn?: boolean;
  /** Those stories and tips. recipes.list sends them only to the cook, or to everyone after her yes. */
  memories?: readonly { kind: 'story' | 'tip'; text: string }[];
};

type Person = { name: string; relation: string | null };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const https = (s: unknown) => (typeof s === 'string' && /^https:\/\//.test(s.trim()) ? s.trim() : null);

/**
 * The rows the library lists, in `rows` order, with their library id and recipe.json: ready ones with
 * a library id and an https recipe.json, the first (newest) per id.
 */
function listedRows(rows: readonly FamilyRecipe[]): { row: FamilyRecipe; id: string; url: string }[] {
  const out: { row: FamilyRecipe; id: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = typeof row.libraryId === 'string' ? row.libraryId.trim() : '';
    const url = https(row.recipeJsonUrl);
    if (row.status !== 'ready' || !id || !url || seen.has(id)) continue;
    seen.add(id);
    out.push({ row, id, url });
  }
  return out;
}

/**
 * The family's finished dishes as library entries, in `rows` order (recipes.list: newest first),
 * one per library id. A dish still being made, or one that failed, isn't listed: the kid's library
 * has no "being made" card, and the cook's own upload already shows as a ProcessingRow. Neither is a
 * dish without a library id or an https recipe.json to load. The relation comes from the family's
 * profile with the cook's name.
 */
export function familyEntries(rows: readonly FamilyRecipe[], people: readonly Person[] = []): LibraryEntry[] {
  return listedRows(rows).map(({ row: r, id, url }) => {
    const cook = typeof r.cookName === 'string' ? r.cookName.trim() : '';
    const person = cook ? people.find((p) => norm(p.name) === norm(cook)) : undefined;
    return {
      id,
      title: (typeof r.title === 'string' && r.title.trim()) || 'A family recipe',
      cook_name: cook || 'Family',
      relation: person?.relation?.trim() ?? '',
      poster_url: https(r.coverUrl),
      tags: [],
      sample: false,
      recipe_url: url,
    };
  });
}

/**
 * Whether this viewer may see the dish's stories and tips: the cook said yes, or recipes.list sent
 * them anyway, which it does only to the cook (convex/recipes.ts forViewer). A cook whose video has
 * none has nothing to lose.
 */
export function storiesShared(row: Pick<FamilyRecipe, 'memoriesOptIn' | 'memories'>): boolean {
  return row.memoriesOptIn === true || (Array.isArray(row.memories) && row.memories.length > 0);
}

/**
 * The listed dishes (familyEntries) whose stories and tips this viewer may not see. Convex holds back
 * only its own copy: the recipe.json the library loads from recipeJsonUrl has them all, so the library
 * takes them out (withoutStories) before it caches the recipe, whichever copy of the dish it loads.
 */
export function withheldIds(rows: readonly FamilyRecipe[]): Set<string> {
  return new Set(listedRows(rows).flatMap(({ row, id }) => (storiesShared(row) ? [] : [id])));
}

/**
 * The recipe without what recipes.list holds back as `memories` (convex/lib/recipeJson.ts): its
 * stories, special moments and step tips, the steps' links to them, and the intro, which the pipeline
 * writes from the stories. Everything else stays. The same object when it has none of them.
 */
export function withoutStories(recipe: Recipe): Recipe {
  const steps = recipe.steps ?? [];
  const none =
    !recipe.intro &&
    !recipe.stories?.length &&
    !recipe.special?.length &&
    steps.every((s) => !s.tip && !s.story_ids?.length && !s.special_ids?.length);
  if (none) return recipe;
  return {
    ...recipe,
    intro: '',
    stories: [],
    special: [],
    steps: steps.map((s) => ({ ...s, story_ids: [], special_ids: [], tip: null })),
  };
}

/**
 * `base` (library.json or the bundled copy) with the family's dishes it doesn't have in front, in
 * their own order. A dish in both stays `base`'s, so everything already listed looks the same.
 */
export function mergeLibrary(base: readonly LibraryEntry[], family: readonly LibraryEntry[]): LibraryEntry[] {
  const have = new Set(base.map((e) => e.id));
  const mine: LibraryEntry[] = [];
  for (const e of family) {
    if (have.has(e.id)) continue;
    have.add(e.id);
    mine.push(e);
  }
  return [...mine, ...base];
}
