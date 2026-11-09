// "Grandma's kitchen, 4 of 7" (RETENTION-HANDOFF 3.6): how many of each family cook's dishes a kid
// can make, the cook's mirror of it, and the "I made it" milestones. Pure functions (no React Native
// imports) so scripts/test-retention.mjs runs them under Node.
//
//   kitchenCounts(entries, profiles, stats.byId, me.id)  // kid: [{cookId, cookName, total, cooked, complete, …}]
//   cookMirror(recipesByCook(entries, me), dishStats, profiles, me.id)  // dishStats: GET /dish-stats
//   mirrorLine(mirror)                                   // "Leo can cook 4 of your 7. Maya, 2."
//   madeItMilestone({ entries, profiles, meId, before: stats.byId, recipeId })  // before the refresh
//   madeItTitle(milestone, res.eventSaved, 'You made it')  // the SuccessBurst title, once cooked() answers
//
// What counts: a family cook's real recordings. Sample dishes (synthetic words) and YouTube dishes
// (a stranger's kitchen) never count, and neither do my own dishes. A dish's cook is the family
// profile whose name matches its cook_name, case-insensitively: the same rule as cookProfile() in
// lib/recipes.ts (repeated here so this file stays importable under Node). The cook's own dishes
// (cookMirror's) come from recipesByCook(), which goes by the dish's cook id first (cookedBy).
// Counts are shown only to the two people they are about: never compared across cooks or kids.
import type { Profile, RecipeStat } from './api';
import type { LibraryEntry } from './types';

type Person = Pick<Profile, 'id' | 'name'> & Partial<Pick<Profile, 'role' | 'memorial'>>;
/** My history per dish (useRecipeStats().byId); only `cooked` matters here. */
export type CookedById = Record<string, Pick<RecipeStat, 'cooked'> | undefined>;
/**
 * GET /dish-stats?ids=a,b exactly as the handoff's API table (2.2) and the server's buildDishStats()
 * (supabase/functions/api/retention.ts) give it: per dish, hearts & cooks from my family, me excluded.
 * TODO(wiring): move DishStat/DishStats into lib/api.ts next to api.dishStats() and import them here.
 */
export type DishStat = {
  hearts: { count: number; by: { profile_id: string; at: string }[] };
  cooked: { count: number; by: { profile_id: string; count: number; last_at: string }[] };
};
export type DishStats = Record<string, DishStat>;
/** The part of DishStats this file reads (so tests can pass less). A DishStats always fits. */
export type DishStatsLike = Record<string, { cooked?: { by?: Pick<DishStat['cooked']['by'][number], 'profile_id' | 'count'>[] } | null } | undefined>;

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** A sample (synthetic) or YouTube dish never counts toward a kitchen. */
export function countableEntry(e: Pick<LibraryEntry, 'sample' | 'relation'>): boolean {
  return !e.sample && !/youtube/i.test(e.relation ?? '');
}

/** The family profile who cooked this dish, when it counts (not mine, not a sample, not YouTube). */
export function kitchenCookOf<P extends Person>(e: LibraryEntry, profiles: P[], meId: string | null | undefined): P | null {
  if (!countableEntry(e)) return null;
  const n = norm(e.cook_name);
  const cook = (n && profiles.find((p) => norm(p.name) === n)) || null;
  return cook && cook.id !== meId ? cook : null;
}

export type KitchenCount = {
  cookId: string;
  cookName: string;
  /** That cook's counted dishes, in library order. */
  recipeIds: string[];
  /** The ones I have cooked at least once. */
  cookedIds: string[];
  total: number;
  cooked: number;
  /** Every one of that cook's dishes cooked: "Keeper of Grandma's kitchen". */
  complete: boolean;
};

/**
 * Kid side: one row per family cook with at least one counted dish, cooks (role) first, then in
 * profile order. A cook with no counted dishes has no row, so the header hides for them.
 */
export function kitchenCounts(entries: LibraryEntry[], profiles: Person[], stats: CookedById, meId: string | null | undefined): KitchenCount[] {
  const byCook = new Map<string, KitchenCount>();
  for (const e of entries) {
    const cook = kitchenCookOf(e, profiles, meId);
    if (!cook) continue;
    let k = byCook.get(cook.id);
    if (!k) {
      k = { cookId: cook.id, cookName: cook.name, recipeIds: [], cookedIds: [], total: 0, cooked: 0, complete: false };
      byCook.set(cook.id, k);
    }
    if (k.recipeIds.includes(e.id)) continue; // a library listing a dish twice counts it once
    k.recipeIds.push(e.id);
    if ((stats[e.id]?.cooked ?? 0) > 0) k.cookedIds.push(e.id);
  }
  const order = (p: Person) => (p.role === 'cook' ? 0 : 1);
  return profiles
    .filter((p) => byCook.has(p.id))
    .sort((a, b) => order(a) - order(b))
    .map((p) => {
      const k = byCook.get(p.id)!;
      return { ...k, total: k.recipeIds.length, cooked: k.cookedIds.length, complete: k.cookedIds.length === k.recipeIds.length };
    });
}

/** The row for a recipe-list chip (a cook's name), or null. */
export function kitchenFor(counts: KitchenCount[], cookName: string | null | undefined): KitchenCount | null {
  const n = norm(cookName);
  return (n && counts.find((k) => norm(k.cookName) === n)) || null;
}

/** True when a recipe-list row earns the "cooked it" stamp: a counted family dish I have cooked. */
export function earnsStamp(e: LibraryEntry, profiles: Person[], stats: CookedById, meId: string | null | undefined): boolean {
  return !!kitchenCookOf(e, profiles, meId) && (stats[e.id]?.cooked ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// Cook side: "Leo can cook 4 of your 7. Maya, 2."

export type MirrorPerson = { profileId: string; name: string; cooked: number };
export type CookMirror = { total: number; people: MirrorPerson[] };

/**
 * From my own dishes (recipesByCook(entries, me)) and GET /dish-stats: how many of my counted
 * dishes each other family member has cooked. Kids (learners) first, then most cooked; nobody at 0.
 * A remembered (memorial) person is never in it: "Grandma, 2." would speak of them as present
 * (guardrail 2).
 */
export function cookMirror(myEntries: LibraryEntry[], dishStats: DishStatsLike, profiles: Person[], meId: string | null | undefined): CookMirror {
  const ids = [...new Set(myEntries.filter(countableEntry).map((e) => e.id))];
  const people = profiles
    .filter((p) => p.id !== meId && p.memorial !== true)
    .map((p, i) => {
      const cooked = ids.filter((id) => (dishStats[id]?.cooked?.by ?? []).some((b) => b.profile_id === p.id && b.count > 0)).length;
      return { p, i, cooked };
    })
    .filter((x) => x.cooked > 0)
    .sort((a, b) => (a.p.role === 'learner' ? 0 : 1) - (b.p.role === 'learner' ? 0 : 1) || b.cooked - a.cooked || a.i - b.i)
    .map(({ p, cooked }) => ({ profileId: p.id, name: p.name, cooked }));
  return { total: ids.length, people };
}

/** The header line, or null when there is nothing to say (no counted dishes, nobody has cooked one). */
export function mirrorLine({ total, people }: CookMirror): string | null {
  if (!total || !people.length) return null;
  const all = total === 2 ? 'both' : `all ${total}`;
  const [first, ...rest] = people;
  const lead =
    total === 1
      ? `${first.name} can cook your recipe.`
      : first.cooked >= total
        ? `${first.name} can cook ${all} of yours.`
        : `${first.name} can cook ${first.cooked} of your ${total}.`;
  const more = rest.map((p) => (total === 1 ? `${p.name} too.` : `${p.name}, ${p.cooked >= total ? all : p.cooked}.`));
  return [lead, ...more].join(' ');
}

// ---------------------------------------------------------------------------------------------
// "I made it" milestones: they change the SuccessBurst title.

export type Milestone =
  | { kind: 'first' | 'five' | 'ten'; title: string; dishes: number }
  | { kind: 'keeper'; title: string; cookId: string; cookName: string };

const COUNT_TITLES: Record<number, { kind: 'first' | 'five' | 'ten'; title: string }> = {
  1: { kind: 'first', title: 'Your first family dish' },
  5: { kind: 'five', title: '5 family dishes' },
  10: { kind: 'ten', title: '10 family dishes' },
};

/**
 * The milestone this "I made it" reaches, from my stats BEFORE it was counted. Only a first cook of
 * a counted family dish can reach one: the 1st, 5th or 10th distinct family dish, or the last dish
 * of a cook's set ("Keeper of Grandma's kitchen"). Completing a set of 2 or more outranks the count;
 * a one-dish set only shows when the count has nothing to say.
 */
export function madeItMilestone({
  entries,
  profiles,
  meId,
  before,
  recipeId,
}: {
  entries: LibraryEntry[];
  profiles: Person[];
  meId: string | null | undefined;
  before: CookedById;
  recipeId: string;
}): Milestone | null {
  const entry = entries.find((e) => e.id === recipeId);
  const cook = entry ? kitchenCookOf(entry, profiles, meId) : null;
  if (!entry || !cook || (before[recipeId]?.cooked ?? 0) > 0) return null;

  const counts = kitchenCounts(entries, profiles, before, meId);
  const dishes = counts.reduce((n, k) => n + k.cooked, 0) + 1;
  const mine = counts.find((k) => k.cookId === cook.id);
  const completes = !!mine && mine.cooked + 1 === mine.total;
  const keeper: Milestone = { kind: 'keeper', title: `Keeper of ${cook.name}’s kitchen`, cookId: cook.id, cookName: cook.name };

  if (completes && mine.total >= 2) return keeper;
  const count = COUNT_TITLES[dishes];
  if (count) return { ...count, dishes };
  return completes ? keeper : null;
}

/**
 * The SuccessBurst title after "I made it": the milestone's only when the server saved the `cooked`
 * event (lib/messaging cooked() eventSaved). Offline, nothing was counted: "Your first family dish"
 * would claim what didn't happen (the header still says 6 of 7) and come back on the next cook.
 */
export function madeItTitle(milestone: Pick<Milestone, 'title'> | null, eventSaved: boolean, usual: string): string {
  return milestone && eventSaved ? milestone.title : usual;
}
