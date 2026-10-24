// Kid Home recommendation: which real family recipe to make right now, the heading that says so,
// and the one line that says why. Pure functions (no React Native imports) so
// scripts/test-recommend.mjs runs them under plain Node.
//
// FAMILY FIRST, strictly: only dishes whose cook is a family profile are considered. Other cooks
// (YouTube creators, relatives outside the app) are used only when the family has no recipes yet;
// inside the family, dishes repeat before a stranger's dish is ever shown.
// The day is planned as a whole (pure: same inputs, same plan), then shown one window at a time:
//   1. Dinner: a holiday in the next 3 weeks (lib/holidays.ts) that a family recipe fits wins it (on
//      a weeknight before the day, only a dish that can be cooked tonight: a practice run).
//   2. Each meal's few best options are scored: meal words in the title/tags, total_time (quick for
//      breakfast, lunch and late night; long and slow for weekend dinners; never more than 2.5 hrs
//      on a weeknight or an overnight dish "now"), the season, the day's own name ("Sunday Chili" on
//      a Sunday; on other days it scores much lower). Family kitchens rank up, a dish sent to me
//      this week up, one I cooked in the last 3 days down. Near-equal dishes take turns by date.
//      Dishes that only fit with relaxed limits (late night up to 90 min) are options, scored lower.
//   3. Every assignment of options to meals is tried; repeats cost points: a family dish repeats at
//      two windows that are apart (breakfast and dinner) before a meal gets a less practical dish,
//      and two windows in a row repeat only when nothing else fits.
//   Breakfast and lunch never move within the day. A weeknight dinner after 5 pm is re-checked in
//   half-hour steps so it still finishes by about 9 pm (now + total_time); late night avoids both
//   the 5 pm and the 8:30 pm dinner.
// Meal windows: breakfast 5:00-10:30, lunch 10:30-15:00, dinner 15:00-21:00, late night
// 21:00-5:00 (1 am still belongs to the evening before).
//
// heroHeading(): "Tonight’s dinner", "For lunch today", "Breakfast idea", "A late-night bite",
// "Sunday dinner" (weekends), "For Halloween" (holiday picks), "To make tonight" (nothing fits).
// heroWords(): the chip (the cook, or whoever just sent it) and one line from real signals only.
// Family-voice signals (their kitchen, "recorded this", their quote) are for family cooks only; a
// stranger's dish is credited plainly ("Recipe by Gordon Ramsay on YouTube").
import { daysAgo, relativeDay, totalTimeLabel } from './format';
import { upcomingHolidays, type Holiday } from './holidays';
import type { LibraryEntry, Recipe } from './types';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'late';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';

const MEAL_WORDS: Record<Meal, string[]> = {
  breakfast: ['breakfast', 'brunch', 'egg', 'pancake', 'waffle', 'toast', 'congee', 'porridge', 'oatmeal', 'omelet', 'omelette', 'bagel', 'muffin', 'granola', 'jianbing', 'bao', 'baozi', 'youtiao', 'scramble'],
  lunch: ['lunch', 'noodle', 'soup', 'sandwich', 'salad', 'stir fry', 'fried rice', 'rice', 'dumpling', 'wrap', 'taco', 'ramen', 'pho', 'bowl', 'chili', 'pasta', 'gnocchi', 'quick'],
  dinner: ['dinner', 'main course', 'chili', 'fish', 'seafood', 'steak', 'braise', 'biryani', 'curry', 'roast', 'pork', 'chicken', 'beef', 'lamb', 'salmon', 'stew', 'grill', 'one pot', 'pasta', 'gnocchi', 'stir fry'],
  late: ['late night', 'snack', 'street food', 'noodle', 'ramen', 'soup', 'congee', 'dumpling', 'dessert', 'cheesecake', 'cake', 'cookie', 'ice cream', 'toast'],
};

const SEASON_WORDS: Record<Season, string[]> = {
  spring: ['spring', 'pea', 'asparagus', 'greens', 'herb', 'strawberry'],
  summer: ['summer', 'grill', 'salad', 'fish', 'seafood', 'cold noodle', 'ice cream', 'berry', 'tomato'],
  fall: ['fall', 'autumn', 'soup', 'stew', 'chili', 'braise', 'pumpkin', 'squash', 'apple', 'one pot', 'comfort'],
  winter: ['winter', 'soup', 'stew', 'braise', 'hot pot', 'dumpling', 'noodle soup', 'roast', 'comfort', 'one pot'],
};

/** Sweets are never "lunch" or "dinner" (late night and holidays only). */
const SWEET_WORDS = ['dessert', 'cheesecake', 'cupcake', 'cookie', 'brownie', 'ice cream', 'mooncake', 'pudding', 'candy', 'chocolate', 'creme brulee', 'tiramisu', 'mochi'];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Minutes since midnight -> meal. */
export function mealAt(d: Date): Meal {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 5 * 60 && m < 10 * 60 + 30) return 'breakfast';
  if (m >= 10 * 60 + 30 && m < 15 * 60) return 'lunch';
  if (m >= 15 * 60 && m < 21 * 60) return 'dinner';
  return 'late';
}

/** The day a moment belongs to: 1 am Saturday is still Friday night. */
export function serviceDay(d: Date): Date {
  const s = new Date(d);
  if (s.getHours() < 5) s.setDate(s.getDate() - 1);
  return s;
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Meteorological seasons. TODO: southern hemisphere families (flip by locale/region). */
export function seasonAt(d: Date): Season {
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'fall';
  return 'winter';
}

/** Lowercase words separated by single spaces, apostrophes dropped ("Mother's" -> "mothers"). */
export function normText(s: string | null | undefined): string {
  return ` ${(s ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** True when any keyword appears as whole words (plural "s"/"es" allowed) in already normalized text. */
export function hasWord(text: string, words: string[]): boolean {
  return words.some((w) => {
    const k = normText(w).trim();
    return !!k && new RegExp(` ${k}(s|es)? `).test(text);
  });
}

/** A recipe's `total_time` in minutes ("~1 hr 15 min" -> 75, "30 minutes" -> 30); null when unknown. */
export function minutesOf(total: string | null | undefined): number | null {
  const t = total ?? '';
  const hrs = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(t);
  const mins = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(t);
  if (!hrs && !mins) return null;
  return Math.round((hrs ? Number(hrs[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0));
}

export type Candidate = {
  entry: LibraryEntry;
  recipe?: Recipe | null;
  /** The cook is a profile in this family (not a relative outside the app or a YouTube creator). */
  family?: boolean;
  /** Someone sent this recipe to me (ISO time of the latest send). */
  sentAt?: string | null;
  /** The last time I tapped "I made it" (recipe stats). */
  cookedAt?: string | null;
};

/** Needs a night's rest somewhere in it ("~2 hrs, plus overnight"): never a pick for right now. */
export function isOvernight(c: Candidate): boolean {
  return /overnight/i.test(c.recipe?.total_time ?? '') || !!c.recipe?.steps.some((s) => /overnight/i.test(s.wait_after ?? ''));
}

/** title 3, tags 2, ingredients 1 (only when `withIngredients`). 0 = no match. */
export function keywordScore(c: Candidate, words: string[], withIngredients: boolean): number {
  const title = hasWord(normText(c.entry.title), words) ? 3 : 0;
  // One tag / ingredient at a time, so "rice cake" never matches the tags ["rice", "cake"].
  const tags = (c.entry.tags ?? []).some((t) => hasWord(normText(t), words)) ? 2 : 0;
  const ingr = withIngredients && c.recipe?.ingredients.some((i) => hasWord(normText(i.name), words)) ? 1 : 0;
  return title + tags + ingr;
}

const isYouTube = (c: Candidate) => /youtube/i.test(`${c.entry.relation} ${c.recipe?.source ?? ''}`);
const within = (iso: string | null | undefined, ref: Date, days: number) => {
  const age = iso ? ref.getTime() - new Date(iso).getTime() : -1;
  return age >= 0 && age < days * 86_400_000;
};

/**
 * Family kitchens first, YouTube creators last, recent sends to me up, what I just cooked down.
 * `ref` is the end of the day being planned, so the answer never moves with the minute hand.
 */
function bias(c: Candidate, ref: Date): number {
  let b = 0;
  if (c.family) b += 2;
  if (isYouTube(c)) b -= 2;
  if (within(c.sentAt, ref, 7)) b += 2;
  if (within(c.cookedAt, ref, 3)) b -= 5; // made it this week: something else, if anything fits
  return b;
}

/** A stable 0..1 tie-break that changes once a day (and per meal), so equal picks take turns. */
function rotate(id: string, key: string): number {
  let h = 2166136261;
  for (const ch of `${id}|${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The longest weeknight dinner: it must be cookable tonight, even when the family has few dishes. */
const WEEKNIGHT_DINNER_MAX = 150;

/**
 * How long a dish takes, judged per meal (0 = no opinion, e.g. unknown time; null = it cannot be
 * made in time: a 2-hour breakfast, a 4-hour weeknight dinner, a 75-minute late-night bite).
 */
function timeFit(meal: Meal, t: number | null, weekend: boolean): number | null {
  if (t == null) return 0;
  switch (meal) {
    case 'breakfast':
      return t <= 30 ? 2 : t <= 45 ? 1 : t <= 90 ? 0 : null;
    case 'lunch':
      return t <= 45 ? 2 : t <= 75 ? 1 : t <= 120 ? 0 : weekend ? -1 : null;
    case 'dinner':
      if (weekend) return t >= 90 ? 2 : 0;
      return t <= 60 ? 1 : t <= WEEKNIGHT_DINNER_MAX ? 0 : null;
    case 'late':
      return t <= 30 ? 2 : t <= 45 ? 1 : t <= 60 ? 0 : null;
  }
}

/** Relaxed limits (minutes) for a family with few dishes. A weeknight dinner is never relaxed. */
function relaxedLimit(meal: Meal, weekend: boolean): number {
  if (meal === 'breakfast') return 120;
  if (meal === 'late') return 90;
  if (weekend) return Infinity;
  return meal === 'lunch' ? 180 : WEEKNIGHT_DINNER_MAX;
}

/**
 * How well a dish fits a meal on a given day. <= 0 = not a fit. `relaxed`: any savory dish within
 * the relaxed time limit fits a little (>= 1), so the family's own dishes fill the day first.
 */
function mealFit(c: Candidate, meal: Meal, day: Date, season: Season, relaxed = false): number {
  const sweet = keywordScore(c, SWEET_WORDS, false) > 0;
  const t = minutesOf(c.recipe?.total_time);
  const time = timeFit(meal, t, isWeekend(day));
  if ((sweet && meal !== 'late') || isOvernight(c)) return 0;
  if (relaxed ? t != null && t > relaxedLimit(meal, isWeekend(day)) : time == null) return 0;
  const words = keywordScore(c, MEAL_WORDS[meal], false);
  const inSeason = words >= 2 && keywordScore(c, SEASON_WORDS[season], false) > 0 ? 1 : 0;
  const today = keywordScore(c, [DAYS[day.getDay()]], false) > 0 ? 3 : 0; // "Sunday Chili" on a Sunday
  const savory = !sweet && (meal === 'lunch' || meal === 'dinner') ? 1 : 0; // any main is a fair lunch or dinner
  const fit = words + inSeason + today + savory + (time ?? -1);
  return relaxed ? Math.max(1, fit) : fit;
}

/** Named for another day ("Sunday Chili" on a Saturday). */
const otherDay = (c: Candidate, day: Date) => DAYS.some((d, i) => i !== day.getDay() && keywordScore(c, [d], false) > 0);

export type Pick =
  | { kind: 'holiday'; entry: LibraryEntry; meal: Meal; heading: string; holiday: Holiday; days: number }
  /** `any`: nothing in the library fits this meal, so the heading only says when. */
  | { kind: 'meal' | 'any'; entry: LibraryEntry; meal: Meal; heading: string };

export type Recommendation = { meal: Meal; season: Season; pick: Pick | null };

type Draft = { kind: 'holiday'; c: Candidate; holiday: Holiday; days: number } | { kind: 'meal' | 'any'; c: Candidate };

const CHRONO: Meal[] = ['breakfast', 'lunch', 'dinner', 'late'];
/** Dinner matters most (the family meal); late night gives way first. */
const MEAL_WEIGHT: Record<Meal, number> = { dinner: 1.15, lunch: 1.1, breakfast: 1.05, late: 0.6 };
/** Dishes per meal the planner considers (6^4 small steps). */
const TOP_K = 6;
// What the planner gives up, in fit points. The order is the policy: a family dish repeats at two
// windows that are apart (breakfast, dinner) before any meal gets a less practical dish, and two
// windows in a row repeat only when nothing else fits at all.
const REPEAT_COST = 2; // the same dish at two windows that are not next to each other
const RELAX_COST = 4; // fits only with relaxed time limits (late night up to 90 min...)
const DAY_COST = 6; // named for another day
const FINISH_COST = 8; // weeknight dinner after 5 pm that would finish after 9 pm if started now
const ADJ_COST = 20; // the same dish two windows in a row
const ADJACENT: [Meal, Meal][] = [
  ['breakfast', 'lunch'],
  ['lunch', 'dinner'],
  ['dinner', 'late'],
];
const APART: [Meal, Meal][] = [
  ['breakfast', 'dinner'],
  ['breakfast', 'late'],
  ['lunch', 'late'],
];
const NINE_PM = 21 * 60;

type PlanOpts = {
  windowDays: number;
  /** Weeknight dinner: when cooking would start (minutes since midnight, after 5 pm). */
  evening?: number | null;
  /** Meals already decided (what was shown earlier today). */
  fixed?: Partial<Record<Meal, Draft>>;
  /** More dishes that count as "the window just before" a meal. */
  avoid?: Partial<Record<Meal, string[]>>;
};

/** Today's four picks, all different when the family's dishes allow. Pure: same inputs, same plan. */
function planDay(now: Date, all: Candidate[], o: PlanOpts): Record<Meal, Draft | null> {
  // Family first, strictly: a stranger's dish only when the family has none.
  const family = all.filter((c) => c.family);
  const candidates = family.length ? family : all;
  const day = serviceDay(now);
  const season = seasonAt(day);
  const key = dayKey(day);
  const weekend = isWeekend(day);
  const ref = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 5); // the end of this day
  const plan: Record<Meal, Draft | null> = { breakfast: null, lunch: null, dinner: null, late: null, ...o.fixed };

  // 1. Dinner: the nearest holiday a family recipe fits. Before the day itself, on a weeknight, only
  // one that can be cooked tonight (a practice run).
  for (const { holiday, days } of plan.dinner ? [] : upcomingHolidays(day, o.windowDays)) {
    let top: { c: Candidate; s: number } | null = null;
    for (const c of candidates) {
      const t = minutesOf(c.recipe?.total_time);
      if (!weekend && days > 0 && (isOvernight(c) || (t != null && t > WEEKNIGHT_DINNER_MAX))) continue;
      const fit = keywordScore(c, holiday.keywords, true) + (holiday.cookRelation?.test(c.entry.relation) ? 3 : 0);
      if (fit <= 0) continue;
      const s = fit + bias(c, ref) + rotate(c.entry.id, `${key}:${holiday.id}`);
      if (!top || s > top.s) top = { c, s };
    }
    if (top) {
      plan.dinner = { kind: 'holiday', c: top.c, holiday, days };
      break;
    }
  }

  // 2. Each meal's few best options: strict fits, then dishes that fit only with relaxed limits.
  // Title and tags only: an egg in a cheesecake is not breakfast.
  const options = new Map<Meal, { c: Candidate; s: number }[]>();
  for (const meal of CHRONO) {
    const list: { c: Candidate; s: number }[] = [];
    for (const c of candidates) {
      const strict = mealFit(c, meal, day, season);
      const loose = strict > 0 ? 0 : mealFit(c, meal, day, season, true);
      if (strict <= 0 && loose <= 0) continue;
      const t = minutesOf(c.recipe?.total_time);
      let s = (strict > 0 ? strict : loose - RELAX_COST) + bias(c, ref) + rotate(c.entry.id, `${key}:${meal}`);
      if (otherDay(c, day)) s -= DAY_COST;
      if (meal === 'dinner' && !weekend && o.evening != null && t != null && o.evening + t > NINE_PM) s -= FINISH_COST;
      list.push({ c, s });
    }
    options.set(meal, list.sort((a, b) => b.s - a.s).slice(0, TOP_K));
  }

  // 3. Try every way to give each open meal one of its options (repeats allowed) and keep the best:
  // the fits, minus what each repeat costs.
  const open = CHRONO.filter((m) => !plan[m]);
  const ids: Partial<Record<Meal, string>> = {};
  for (const m of CHRONO) if (plan[m]) ids[m] = plan[m]!.c.entry.id;
  const cost = () => {
    let x = 0;
    for (const [a, b] of ADJACENT) if (ids[a] && ids[a] === ids[b]) x += ADJ_COST;
    for (const [a, b] of APART) if (ids[a] && ids[a] === ids[b]) x += REPEAT_COST;
    for (const m of CHRONO) if (ids[m] && o.avoid?.[m]?.includes(ids[m]!)) x += ADJ_COST;
    return x;
  };
  const chosen: Partial<Record<Meal, Candidate>> = {};
  let best: { score: number; picks: Partial<Record<Meal, Candidate>> } = { score: -Infinity, picks: {} };
  const search = (i: number, sum: number) => {
    if (i === open.length) {
      const score = sum - cost();
      if (score > best.score) best = { score, picks: { ...chosen } };
      return;
    }
    const m = open[i];
    const opts = options.get(m)!;
    if (!opts.length) return search(i + 1, sum);
    for (const x of opts) {
      chosen[m] = x.c;
      ids[m] = x.c.entry.id;
      search(i + 1, sum + x.s * MEAL_WEIGHT[m]);
    }
    delete chosen[m];
    delete ids[m];
  };
  search(0, 0);
  for (const m of open) if (best.picks[m]) plan[m] = { kind: 'meal', c: best.picks[m]! };

  // 4. A meal nothing fits: any family dish (an unused one, else not the one next to it), so Home is
  // never empty while the family has recipes.
  for (const m of CHRONO) {
    if (plan[m]) continue;
    const used = new Set(CHRONO.map((x) => plan[x]?.c.entry.id));
    const near = [...ADJACENT.flatMap(([a, b]) => (a === m ? [plan[b]] : b === m ? [plan[a]] : [])).map((d) => d?.c.entry.id), ...(o.avoid?.[m] ?? [])];
    const fresh = candidates.filter((c) => !used.has(c.entry.id));
    const apart = candidates.filter((c) => !near.includes(c.entry.id));
    const any = (fresh.length ? fresh : apart.length ? apart : candidates)
      .map((c) => ({ c, s: bias(c, ref) + rotate(c.entry.id, `${key}:${m}:any`) }))
      .reduce<{ c: Candidate; s: number } | null>((a, b) => (!a || b.s > a.s ? b : a), null);
    if (any) plan[m] = { kind: 'any', c: any.c };
  }
  return plan;
}

/** The plain heading above the hero: what this dish is for, right now. */
export function heroHeading(now: Date, meal: Meal, kind: Pick['kind'], holiday?: Holiday): string {
  if (kind === 'holiday' && holiday) return `For ${holiday.name}`;
  if (kind === 'any') return meal === 'dinner' || meal === 'late' ? 'To make tonight' : 'To make today';
  const day = serviceDay(now);
  const weekend = isWeekend(day) ? DAYS[day.getDay()] : null;
  switch (meal) {
    case 'breakfast':
      return weekend ? `${weekend} breakfast` : 'Breakfast idea';
    case 'lunch':
      return weekend ? `${weekend} lunch` : 'For lunch today';
    case 'dinner':
      return weekend ? `${weekend} dinner` : 'Tonight’s dinner';
    case 'late':
      return 'A late-night bite';
  }
}

export function recommend(now: Date, candidates: Candidate[], opts: { windowDays?: number } = {}): Recommendation {
  const meal = mealAt(now);
  const day = serviceDay(now);
  const season = seasonAt(day);
  const windowDays = opts.windowDays ?? 21;
  // The day's plan: breakfast and lunch never move once shown.
  const base = planDay(now, candidates, { windowDays });
  let d = base[meal];
  // A weeknight dinner must still be cookable tonight: after 5 pm, in half-hour steps, a dish that
  // would finish after 9 pm gives way. Late night avoids both the 5 pm and the 8:30 pm dinner.
  if (!isWeekend(day) && base.dinner && base.dinner.kind !== 'holiday' && (meal === 'dinner' || meal === 'late')) {
    const fixed: Partial<Record<Meal, Draft>> = {};
    if (base.breakfast) fixed.breakfast = base.breakfast;
    if (base.lunch) fixed.lunch = base.lunch;
    const mins = now.getHours() * 60 + now.getMinutes();
    if (meal === 'dinner' && mins >= 17 * 60) d = planDay(now, candidates, { windowDays, fixed, evening: Math.floor(mins / 30) * 30 }).dinner;
    if (meal === 'late') d = planDay(now, candidates, { windowDays, fixed, evening: NINE_PM - 30, avoid: { late: [base.dinner.c.entry.id] } }).late;
  }
  if (!d) return { meal, season, pick: null };
  const pick: Pick =
    d.kind === 'holiday'
      ? { kind: 'holiday', entry: d.c.entry, meal, heading: heroHeading(now, meal, 'holiday', d.holiday), holiday: d.holiday, days: d.days }
      : { kind: d.kind, entry: d.c.entry, meal, heading: heroHeading(now, meal, d.kind) };
  return { meal, season, pick };
}

// ---- The hero's words: one line, from real signals only, strongest first.

/** "him" / "her" only when the relation says so ("Dad", "Grandma"); else null (use their name). */
export function pronounFor(who: string): 'him' | 'her' | null {
  const t = normText(who);
  if (hasWord(t, ['dad', 'father', 'papa', 'grandpa', 'grandfather', 'uncle', 'brother', 'son'])) return 'him';
  if (hasWord(t, ['mom', 'mum', 'mother', 'mama', 'grandma', 'grandmother', 'nana', 'aunt', 'auntie', 'sister', 'daughter'])) return 'her';
  return null;
}

const cleanQuote = (t: string) => t.trim().replace(/^[“"]+|[”"]+$/g, '').trim();
const clipText = (t: string, max: number) => {
  const s = t.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
};

export type HeroInput = {
  now: Date;
  pick: Pick;
  /** The cook's name as the family says it ("Grandma"). */
  cook: string;
  /** The cook is a family profile. Only then: "From Grandma’s kitchen", "recorded this", their quote. */
  family?: boolean;
  /** The recipe's own source credit for other cooks ("Gordon Ramsay (YouTube)"). */
  credit?: string | null;
  /** The recipe's own `total_time` ("~4 hrs"), or null. */
  totalTime?: string | null;
  /** The newest time someone else in the family sent me this dish, with their note. */
  sent?: { by: string; relation?: string | null; at: string; note?: string | null } | null;
  /**
   * My history (recipe stats): this dish, and whether I have cooked any family dish yet.
   * null/undefined = unknown (never claim "never made").
   */
  history?: { cooked: number; lastCookedAt: string | null; cookedAny?: boolean } | null;
  /** When the cook recorded it (latest session). */
  recordedAt?: string | null;
  /** The cook's own shortest quote. */
  quote?: string | null;
};

export type HeroSignal = 'sent' | 'holiday' | 'recorded' | 'never-made' | 'last-made' | 'slow-weekend' | 'quick' | 'quote' | 'note';

export type HeroWords = {
  /** The chip on the photo: whose dish it is, or (when it just arrived) who sent it and when. '' = no chip. */
  chip: { from: 'cook' | 'sender'; text: string };
  /** One short line. `quoted` = a family member's own words (shown in quote marks). */
  line: { text: string; quoted: boolean; signal: HeroSignal } | null;
};

/** "today" / "last night" / "Tuesday" for the last week, else null. */
function recentDay(iso: string | null | undefined, now: Date): string | null {
  const ago = daysAgo(iso, now);
  return ago >= 0 && ago <= 6 ? relativeDay(iso, { lower: true, now }) : null;
}

const WHY_NOT: Record<Meal, string> = {
  breakfast: 'Why not this morning?',
  lunch: 'Why not for lunch?',
  dinner: 'Why not tonight?',
  late: 'Why not tonight?',
};

export function heroWords(i: HeroInput): HeroWords {
  const { now, pick } = i;
  const cook = i.cook.trim();
  const day = serviceDay(now);
  // Family: their kitchen. Anyone else: an honest credit ("Recipe by Gordon Ramsay on YouTube"),
  // never "kitchen" or "recorded". No name at all: no chip (never "From ’s kitchen").
  const fam = !!i.family;
  const credit = (i.credit ?? '').trim().replace(/\s*\(\s*youtube\s*\)$/i, ' on YouTube') || cook;
  const cookChip = {
    from: 'cook' as const,
    text: fam ? (cook ? `From ${/s$/i.test(cook) ? `${cook}’` : `${cook}’s`} kitchen` : '') : credit ? `Recipe by ${credit}` : '',
  };
  const line = (text: string, signal: HeroSignal, quoted = false): HeroWords['line'] => ({ text, quoted, signal });
  const words = (l: HeroWords['line']): HeroWords => ({ chip: cookChip, line: l });

  // 1. Sent to me this week and not cooked since: their own note, else a nudge to close the loop.
  const sent = i.sent;
  const by = sent?.by.trim() ?? '';
  const sentDay = sent && by ? recentDay(sent.at, now) : null;
  const cookedSince = !!(sent && i.history?.lastCookedAt && new Date(i.history.lastCookedAt).getTime() > new Date(sent.at).getTime());
  if (sent && sentDay && !cookedSince) {
    const chip = { from: 'sender' as const, text: `${by} sent this ${sentDay}` };
    const note = sent.note ? cleanQuote(sent.note) : '';
    if (note) return { chip, line: line(clipText(note, 90), 'sent', true) };
    const them = pronounFor(`${sent.relation ?? ''} ${by}`) ?? by;
    return { chip, line: line(`Make it and tell ${them} how it went.`, 'sent') };
  }

  // 2. A holiday is coming: practise before the day.
  if (pick.kind === 'holiday' && pick.days >= 1) {
    const when = pick.days === 1 ? 'tomorrow' : pick.days <= 6 ? `this ${DAYS[pick.holiday.date.getDay()]}` : `in ${pick.days} days`;
    return words(line(`It’s ${when}. Try a practice run tonight.`, 'holiday'));
  }

  // 3. Fresh from home: the cook recorded it this week (family only).
  const recDay = fam && cook ? recentDay(i.recordedAt, now) : null;
  if (recDay) return words(line(`${cook} recorded this ${recDay}.`, 'recorded'));

  // 4. My own history (only when it is known). "Not this one yet" only once I cook other dishes: for
  // a beginner it would be true of every dish, so the time it takes or the cook's words say more.
  const h = i.history;
  if (h && h.cooked <= 0 && h.cookedAny) return words(line(`You haven’t made this one yet. ${WHY_NOT[pick.meal]}`, 'never-made'));
  const last = h?.lastCookedAt ? new Date(h.lastCookedAt) : null;
  if (last && !Number.isNaN(last.getTime()) && daysAgo(last, now) >= 30) {
    const when = `${MONTHS[last.getMonth()]}${last.getFullYear() !== now.getFullYear() ? ` ${last.getFullYear()}` : ''}`;
    return words(line(`You last made this in ${when}. It’s been a while.`, 'last-made'));
  }

  // 5. Does it fit the time I have?
  const total = totalTimeLabel(i.totalTime);
  const mins = minutesOf(i.totalTime);
  if (total && mins != null && !/overnight/i.test(total)) {
    if (isWeekend(day) && (pick.meal === 'lunch' || pick.meal === 'dinner') && mins >= 90) {
      return words(line(`Made for a slow ${DAYS[day.getDay()]}: ${total}.`, 'slow-weekend'));
    }
    if (mins <= 45) {
      if (pick.meal === 'dinner' && !isWeekend(day)) return words(line(`Quick enough for a weeknight: ${total}.`, 'quick'));
      if (pick.meal === 'lunch') return words(line(`Quick enough for lunch: ${total}.`, 'quick'));
      if (pick.meal === 'breakfast' || pick.meal === 'late') return words(line(`Ready in ${total}.`, 'quick'));
    }
  }

  // 6. The cook's own words, else an older note sent with the dish (family dishes only: under a
  // stranger's credit, quote marks would read as their words to me).
  if (!fam) return words(null);
  const quote = i.quote ? cleanQuote(i.quote) : '';
  if (quote) return words(line(quote, 'quote', true));
  const older = sent?.note ? cleanQuote(sent.note) : '';
  if (older) return words(line(clipText(older, 90), 'note', true));
  return words(null);
}

// Dev-only clock override for screenshots: `?now=2026-11-20T18:30` on web (local time). Read once,
// at the first call, because the router may rewrite the URL after load.
let override: Date | null | undefined;
export function getNow(): Date {
  if (override === undefined) {
    override = null;
    const g = globalThis as { __DEV__?: boolean; location?: { search?: string } };
    const raw = g.__DEV__ && g.location?.search ? new URLSearchParams(g.location.search).get('now') : null;
    const d = raw ? new Date(raw) : null;
    if (d && !Number.isNaN(d.getTime())) override = d;
  }
  return override ? new Date(override) : new Date();
}
