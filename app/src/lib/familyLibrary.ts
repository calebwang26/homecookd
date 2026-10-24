// The signed-in family's own dishes in the library (recipes.ts useLibrary). The pipeline publishes a
// family's recipe through Convex (recipes.list) and never into the public library.json, which every
// copy of the app reads, so the library is library.json (or the bundled copy) plus the family's
// finished dishes that aren't in it yet.
//   familyEntries(rows, profiles)   recipes.list rows -> library entries (ready ones only)
//   mergeLibrary(base, family)      the family's new dishes first, then library.json's, one per id
// Pure, so scripts/test-library.mjs runs it in Node.
import type { LibraryEntry } from './types';

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
};

type Person = { name: string; relation: string | null };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const https = (s: unknown) => (typeof s === 'string' && /^https:\/\//.test(s.trim()) ? s.trim() : null);

/**
 * The family's finished dishes as library entries, in `rows` order (recipes.list: newest first),
 * one per library id. A dish still being made, or one that failed, isn't listed: the kid's library
 * has no "being made" card, and the cook's own upload already shows as a ProcessingRow. Neither is a
 * dish without a library id or an https recipe.json to load. The relation comes from the family's
 * profile with the cook's name.
 */
export function familyEntries(rows: readonly FamilyRecipe[], people: readonly Person[] = []): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = typeof r.libraryId === 'string' ? r.libraryId.trim() : '';
    const url = https(r.recipeJsonUrl);
    if (r.status !== 'ready' || !id || !url || seen.has(id)) continue;
    seen.add(id);
    const cook = typeof r.cookName === 'string' ? r.cookName.trim() : '';
    const person = cook ? people.find((p) => norm(p.name) === norm(cook)) : undefined;
    out.push({
      id,
      title: (typeof r.title === 'string' && r.title.trim()) || 'A family recipe',
      cook_name: cook || 'Family',
      relation: person?.relation?.trim() ?? '',
      poster_url: https(r.coverUrl),
      tags: [],
      sample: false,
      recipe_url: url,
    });
  }
  return out;
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
