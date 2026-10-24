// Recipe search for the Recipes tabs. Pure (no React Native imports) so scripts/test-recommend.mjs
// runs it under plain Node.
type Searchable = { title: string; cook_name: string; relation: string; tags?: string[] | null };

const fold = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '');

/** The words of a search box ("Dad's  chili" -> ["dads", "chili"]). */
export function searchWords(query: string): string[] {
  return fold(query).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Recipes-tab search: dishes whose title, cook, relation or tags contain every typed word (as a prefix of
 * a word, so "nood" finds noodles but "a" doesn't find every title with an "a" in it).
 * Title matches first, then library order.
 */
export function searchDishes<T extends Searchable>(entries: T[], query: string): T[] {
  const words = searchWords(query);
  if (!words.length) return [];
  const hits: { e: T; rank: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const title = ` ${searchWords(e.title).join(' ')}`;
    const hay = ` ${searchWords([e.title, e.cook_name, e.relation, ...(e.tags ?? [])].join(' ')).join(' ')}`;
    if (!words.every((w) => hay.includes(` ${w}`))) return;
    hits.push({ e, rank: words.every((w) => title.includes(` ${w}`)) ? 0 : 1, i });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).map((h) => h.e);
}
