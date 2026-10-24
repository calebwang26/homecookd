// The words and faces for Hearts & kitchen (RETENTION-HANDOFF 3.5 + 3.6, PR 4). Pure functions with no
// React Native imports, so scripts/test-hearts.mjs runs them under Node. The components in
// components/hearts draw what these return.
//
//   dishStatsParts(stat)              "♥ 4 · cooked 3 times" (each zero part hidden; null = show nothing)
//   statFaces(stat, profiles)         who cooked or hearted it, newest first (the cook's "faces row")
//   dishStatsLabel(stat, profiles)    the card line read aloud, with who
//   facesThatFit(room, total)         how many faces fit beside the card line's words (it never wraps)
//   cardActivityLine(activity, …)     the card's activity line above it: "✓ Leo cooked it" unless the faces
//                                     drawn already show everyone who cooked it, then who opened it
//   heartNames(stat, profiles)        "♥ 4 · Leo, Maya, Dad" on the cook's own recipe page
//   kitchenLine(count)                "You can cook 4 of Grandma’s 7" / "Keeper of Grandma’s kitchen"
//   heartUpdates(recent, …)           "Leo hearted your Sunday Chili" rows for the updates card
//   mixInHearts(rows, hearts, isAsk)  where they go among the card's rows: by time, never above a question
//
// Real data only: a count or a face appears only when the server has a row for it, and people who
// left the family (not in `profiles`) never show. These lines are only ever shown to the dish's cook
// (the server answers only her): never compared across cooks, never a ranking.
import type { Profile, RecipeActivity } from './api';
import type { HeartRecent } from './dishStatsApi';
import { listNames } from './format';
import type { DishStat } from './kitchenCounts';

type Person = Pick<Profile, 'id' | 'name'>;
export type MadeVerb = 'cooked' | 'baked';

/** "once", "twice", "3 times" (the same words as components/parent/kitchen.ts times()). */
export function timesWord(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

export type DishStatsParts = {
  /** The heart count, or null when nobody has hearted it. */
  hearts: number | null;
  /** "cooked 3 times" / "baked once", or null when nobody has made it. */
  made: string | null;
  /** For the screen reader: "4 hearts, cooked 3 times". */
  label: string;
};

/** The card line's parts; null when both are zero (the line hides). */
export function dishStatsParts(stat: DishStat | null | undefined, verb: MadeVerb = 'cooked'): DishStatsParts | null {
  const hearts = Math.max(0, stat?.hearts?.count ?? 0);
  const made = Math.max(0, stat?.cooked?.count ?? 0);
  if (!hearts && !made) return null;
  const madeText = made ? `${verb} ${timesWord(made)}` : null;
  const label = [hearts ? `${hearts} ${hearts === 1 ? 'heart' : 'hearts'}` : null, madeText].filter(Boolean).join(', ');
  return { hearts: hearts || null, made: madeText, label };
}

/** The same line as plain text, "♥ 4 · cooked 3 times" (tests, logs, a fallback). */
export function dishStatsText(stat: DishStat | null | undefined, verb: MadeVerb = 'cooked'): string | null {
  const p = dishStatsParts(stat, verb);
  if (!p) return null;
  return [p.hearts ? `♥ ${p.hearts}` : null, p.made].filter(Boolean).join(' · ');
}

/**
 * Everyone who cooked or hearted the dish, newest first (a person's latest of the two), each once.
 * People not in `profiles` (removed since) are left out. `shown` is at most `max`; `more` counts the rest.
 */
export function statFaces<P extends Person>(stat: DishStat | null | undefined, profiles: readonly P[], max = 4): { shown: P[]; more: number } {
  const latest = new Map<string, number>();
  const note = (id: string, at: string) => {
    const t = Date.parse(at) || 0;
    if (!latest.has(id) || t > latest.get(id)!) latest.set(id, t);
  };
  for (const c of stat?.cooked?.by ?? []) if (c.count > 0) note(c.profile_id, c.last_at);
  for (const h of stat?.hearts?.by ?? []) note(h.profile_id, h.at);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const people = [...latest]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => byId.get(id))
    .filter((p): p is P => !!p);
  const cap = Math.max(0, max);
  return { shown: people.slice(0, cap), more: Math.max(0, people.length - cap) };
}

/**
 * The card line read aloud: "2 hearts, cooked 3 times. Maya, Leo, Grandma" (three names, then "and 2
 * more"). The names never depend on how many faces fit on screen. null when the line hides.
 */
export function dishStatsLabel(stat: DishStat | null | undefined, profiles: readonly Person[], verb: MadeVerb = 'cooked', maxNames = 3): string | null {
  const p = dishStatsParts(stat, verb);
  if (!p) return null;
  const f = statFaces(stat, profiles, maxNames);
  if (!f.shown.length) return p.label;
  return `${p.label}. ${f.shown.map((x) => x.name).join(', ')}${f.more ? ` and ${f.more} more` : ''}`;
}

/** The faces beside a Recipes card's line: at most 3, 20 pt (FacesRow overlaps them by 30%). */
export const CARD_FACES = { max: 3, size: 20 } as const;

/**
 * How many of `total` faces fit in `room` pt beside the card line's words, which stay on one line and
 * whole: at most `max`, each `size` wide and overlapping by 30% (FacesRow), plus room for its "+N"
 * when some aren't drawn. 0 when not even one face and its "+N" fit: no partial row, and the line's
 * screen-reader label still names who.
 */
export function facesThatFit(room: number, total: number, size: number = CARD_FACES.size, max: number = CARD_FACES.max): number {
  const overlap = Math.round(size * 0.3);
  // FacesRow's "+N": 6 pt margin, then a 13 pt caption (about 9 pt a character, rounded up).
  const plus = (n: number) => (n > 0 ? 6 + 9 * (String(n).length + 1) : 0);
  for (let k = Math.min(max, total); k > 0; k--) {
    if (size + (k - 1) * (size - overlap) + plus(total - k) <= room) return k;
  }
  return 0;
}

/**
 * The family's activity on one of her dishes, for its Recipes card (the line above the stat line):
 * "✓ Leo and Maya cooked it" (newest two), else "Sam opened it 3 times" (the learner who opened it
 * most). Her own cooking and opening aren't news to her, so she never counts. The cooked line is left
 * out only when the stat line already says it was cooked (`statCooked` > 0) AND its faces drawn on
 * screen (`faceIds`, from DishStatsLine's onFacesShown) include everyone who cooked it; a narrow card
 * with no room for faces keeps saying who. Someone who cooked it is never shown as only having opened
 * it. null when there's no family activity (the card then says sent / the recipe's facts).
 */
export function cardActivityLine(
  a: Pick<RecipeActivity, 'cooked' | 'viewed'>,
  opts: { meId: string | null; verb?: MadeVerb; statCooked?: number; faceIds?: readonly string[] },
): { text: string; done?: boolean } | null {
  const { meId, verb = 'cooked', statCooked = 0, faceIds = [] } = opts;
  const cooked = a.cooked.filter((c) => c.profile.id !== meId);
  const drawn = new Set(faceIds);
  const facesSayWho = statCooked > 0 && cooked.length > 0 && cooked.every((c) => drawn.has(c.profile.id));
  if (cooked.length && !facesSayWho) {
    const names = [...cooked].sort((x, y) => (x.at < y.at ? 1 : -1)).map((c) => c.profile.name);
    return { text: `${listNames([...new Set(names)].slice(0, 2))} ${verb} it`, done: true };
  }
  const cookedIds = new Set(a.cooked.map((c) => c.profile.id));
  const top = a.viewed
    .filter((v) => v.profile.id !== meId && v.profile.role === 'learner' && !cookedIds.has(v.profile.id) && v.count > 0)
    .sort((x, y) => y.count - x.count)[0];
  return top ? { text: `${top.profile.name} opened it ${timesWord(top.count)}` } : null;
}

/**
 * "♥ 4 · Leo, Maya, Dad" for the cook's own recipe page (near "Who cooked it"): the heart count and
 * who left them, newest first, three names then "+2". null when nobody has hearted it.
 */
export function heartNames(stat: DishStat | null | undefined, profiles: readonly Person[], maxNames = 3): { count: number; names: string; label: string } | null {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const who = (stat?.hearts?.by ?? []).map((h) => byId.get(h.profile_id)?.name).filter((n): n is string => !!n);
  if (!who.length) return null;
  const count = who.length; // only people still in the family: the names and the number always agree
  const shown = who.slice(0, maxNames);
  const extra = count - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
  const all = who.length <= 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
  return { count, names, label: `${count} ${count === 1 ? 'heart' : 'hearts'}, from ${all}` };
}

/** "Grandma’s", "James’" (the same rule as lib/format possessive()). */
function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/**
 * The kid's Recipes header for one cook (kitchenCounts.ts KitchenCount): "You can cook 4 of
 * Grandma’s 7", "Keeper of Grandma’s kitchen" once every dish is cooked, and before the first one
 * just "Grandma’s 7 dishes" (nothing to count yet, and no nudge in it). null when she has no dishes.
 */
export function kitchenLine(k: { cookName: string; total: number; cooked: number; complete?: boolean } | null | undefined): string | null {
  if (!k || k.total <= 0) return null;
  const her = possessive(k.cookName);
  if (k.complete || k.cooked >= k.total) return `Keeper of ${her} kitchen`;
  if (k.cooked <= 0) return k.total === 1 ? `${her} dish` : `${her} ${k.total} dishes`;
  return `You can cook ${k.cooked} of ${her} ${k.total}`;
}

/** Dots stand for dishes only while they fit; past this the line says it alone (never a made-up scale). */
export const KITCHEN_DOTS_MAX = 12;

// ---------------------------------------------------------------------------------------------
// The updates card: "Leo hearted your Sunday Chili" (no push for hearts: handoff 2.5)

export type HeartUpdate<P extends Person = Person> = {
  /** Stable per heart: hearting again after an un-heart is a new row (a new time). */
  key: string;
  at: string;
  who: P;
  recipeId: string;
};

/**
 * GET /hearts/recent as update rows: only my dishes, only people still in the family, never me,
 * minus the rows this person cleared, newest first, at most `max` (the card shows 3).
 */
export function heartUpdates<P extends Person>(
  recent: readonly HeartRecent[],
  profiles: readonly P[],
  myRecipeIds: Iterable<string>,
  opts: { meId?: string | null; dismissed?: Iterable<string>; max?: number } = {},
): HeartUpdate<P>[] {
  const mine = new Set(myRecipeIds);
  const cleared = new Set(opts.dismissed ?? []);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out: HeartUpdate<P>[] = [];
  const seen = new Set<string>();
  const rows = [...recent].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  for (const h of rows) {
    const who = byId.get(h.profile_id);
    const key = heartUpdateKey(h);
    if (!who || who.id === opts.meId || !mine.has(h.recipe_id) || cleared.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, at: h.at, who, recipeId: h.recipe_id });
  }
  return out.slice(0, Math.max(0, opts.max ?? 3));
}

/**
 * The updates card's rows with the heart rows mixed in, newest first among the rows that need nothing
 * from me ("Leo made your …"), but never above a row that needs an answer (`needsAnswer`: a question,
 * someone on a new phone). A heart is a passive tap: three quick hearts must never push "Leo asked
 * you" behind "See all". `rows` keep their order; hearts go after the last row that needs an answer.
 */
export function mixInHearts<T extends { at: string }>(rows: readonly T[], hearts: readonly T[], needsAnswer: (row: T) => boolean): T[] {
  let last = -1;
  rows.forEach((r, i) => {
    if (needsAnswer(r)) last = i;
  });
  const time = (r: T) => Date.parse(r.at) || 0;
  // A stable sort: rows with the same time keep their order, a heart after the row it ties with.
  const tail = [...rows.slice(last + 1), ...hearts].sort((a, b) => time(b) - time(a));
  return [...rows.slice(0, last + 1), ...tail];
}

export function heartUpdateKey(h: Pick<HeartRecent, 'profile_id' | 'recipe_id' | 'at'>): string {
  return `heart:${h.profile_id}:${h.recipe_id}:${h.at}`;
}

/** "Leo hearted your Sunday Chili" (pass the short dish name: kitchen.ts dishName()). */
export function heartUpdateTitle(who: string, dish: string): string {
  return `${who} hearted your ${dish.trim() || 'recipe'}`;
}
