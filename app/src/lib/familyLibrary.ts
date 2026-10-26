// The signed-in family's own dishes in the library (recipes.ts useLibrary). The pipeline publishes a
// family's recipe through Convex (recipes.list) and never into the public library.json, which every
// copy of the app reads, so the library is library.json (or the bundled copy) plus the family's
// finished dishes that aren't in it yet.
//   familyEntries(rows, profiles)   recipes.list rows -> library entries (ready ones only)
//   withheldIds(rows)               those dishes whose stories and tips this viewer may not see
//   withoutStories(recipe)          a recipe without the cook's stories and tips
//   sharedMemories(rows, prev)      the stories and tips Convex sent for each dish
//   withMemories(recipe, memories)  those put back into a recipe.json published without them
//   sharedAdded(rows, prev)         the ingredients each dish's cook confirmed after the video
//   withAdded(recipe, added)        those added to its ingredient list
//   mergeLibrary(base, family)      the family's new dishes first, then library.json's, one per id
// Pure, so scripts/test-library.mjs runs it in Node.
import type { Ingredient, LibraryEntry, Recipe, Special, Story } from './types';

/**
 * A story or tip as Convex keeps it (convex/schema.ts `memory`). Since the pipeline stopped putting them
 * in the public recipe.json, these are the only copy: `step`, `id`, `title` and `why` say where each one
 * goes. Older rows have only kind, text and moment.
 */
export type Memory = {
  kind: 'story' | 'tip';
  text: string;
  moment?: { startS: number; endS: number };
  step?: number;
  id?: string;
  title?: string;
  why?: string;
};

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
  memories?: readonly Memory[];
  /** Ingredients the cook confirmed after the video, to homie's follow-up questions (convex/followUps.ts). */
  addedIngredients?: readonly AddedIngredient[];
};

/** One of them (convex/schema.ts recipes.addedIngredients): `said` is her answer, in English when there is one. */
export type AddedIngredient = { name: string; said?: string; step?: number; questionId?: string };

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
 * only its own copy: a recipe.json published before they left the file has them all, so the library
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
 * One list per listed dish, by library id (none: not in the map). `prev` is the last result: a dish whose
 * list didn't change keeps its array, and when none changed the result is `prev` itself, so only a
 * changed dish loads again.
 */
function perDish<T>(
  rows: readonly FamilyRecipe[],
  pick: (row: FamilyRecipe) => readonly T[] | undefined,
  prev: ReadonlyMap<string, readonly T[]>,
): ReadonlyMap<string, readonly T[]> {
  const next = new Map<string, readonly T[]>();
  for (const { row, id } of listedRows(rows)) {
    const list = pick(row);
    if (!Array.isArray(list) || !list.length) continue;
    const was = prev.get(id);
    next.set(id, was && JSON.stringify(was) === JSON.stringify(list) ? was : list);
  }
  const same = next.size === prev.size && [...next].every(([id, m]) => prev.get(id) === m);
  return same ? prev : next;
}

/** The stories and tips recipes.list sent for each listed dish (perDish). */
export function sharedMemories(rows: readonly FamilyRecipe[], prev: ReadonlyMap<string, readonly Memory[]> = new Map()) {
  return perDish(rows, (row) => row.memories, prev);
}

/** The ingredients each listed dish's cook confirmed after the video (perDish). */
export function sharedAdded(rows: readonly FamilyRecipe[], prev: ReadonlyMap<string, readonly AddedIngredient[]> = new Map()) {
  return perDish(rows, (row) => row.addedIngredients, prev);
}

const sameName = (a: string) => a.replace(/\s*\(.*?\)/g, '').trim().toLowerCase();

/**
 * The recipe with what the cook confirmed after the video at the end of its ingredient list (marked
 * `confirmed`, her words as `said`), once each; a name the list already has isn't added again. The same
 * object when there's nothing new, so it can run on a recipe that already has them.
 */
export function withAdded(recipe: Recipe, added: readonly AddedIngredient[]): Recipe {
  const have = new Set((recipe.ingredients ?? []).map((i) => sameName(i.name ?? '')));
  const extra: Ingredient[] = [];
  for (const a of added) {
    const name = (a.name ?? '').trim();
    if (!name || have.has(sameName(name))) continue;
    have.add(sameName(name));
    const said = a.said?.trim() || null;
    extra.push({ name, feel: said ?? '', estimate: 'unknown', confidence: 'high', first_seen_s: null, confirmed: { said, step: a.step ?? null } });
  }
  return extra.length ? { ...recipe, ingredients: [...(recipe.ingredients ?? []), ...extra] } : recipe;
}

/**
 * The recipe with Convex's stories and tips put back: a family recipe.json is published without them
 * (pipeline/publish.py without_memories). A recipe that has its own (one published before that) keeps
 * them, and so does one with none to add: the same object comes back. A memory from an older row,
 * without its step, goes to the step it was told in.
 */
export function withMemories(recipe: Recipe, memories: readonly Memory[]): Recipe {
  const steps = recipe.steps ?? [];
  const own = recipe.stories?.length || recipe.special?.length || steps.some((s) => s.tip);
  if (own || !memories.length || !steps.length) return recipe;
  const stories: Story[] = [];
  const special: Special[] = [];
  const tips = new Map<number, string>();
  memories.forEach((m, i) => {
    const start_s = m.moment?.startS ?? 0;
    const end_s = m.moment?.endS ?? start_s;
    const known = steps.some((s) => s.order === m.step);
    const step = known ? m.step! : (steps.filter((s) => s.start_s <= start_s).pop() ?? steps[0]).order;
    if (m.kind === 'story') {
      stories.push({ id: m.id ?? `story-${i + 1}`, step, start_s, end_s, title: m.title ?? '', text: m.text });
    } else if (!m.id && !tips.has(step)) {
      tips.set(step, m.text); // a tip without an id is its step's own
    } else {
      special.push({ id: m.id ?? `special-${i + 1}`, step, start_s, end_s, text: m.text, why: m.why ?? '' });
    }
  });
  return {
    ...recipe,
    stories,
    special,
    steps: steps.map((s) => ({
      ...s,
      tip: tips.get(s.order) ?? null,
      story_ids: stories.filter((x) => x.step === s.order).map((x) => x.id),
      special_ids: special.filter((x) => x.step === s.order).map((x) => x.id),
    })),
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
