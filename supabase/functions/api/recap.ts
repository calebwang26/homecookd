// Month in the kitchen (docs/build/RETENTION-HANDOFF.md 3.7): the story slides for one person's month.
// Pure: index.ts (PR6) fetches the family's recipe_events, messages & favorites for that month, the
// library lookup and, for a cook, answersFor()'s Map over the questions that month's messages reply to
// (they may be older), then calls computeRecap() for GET /recap and recapPush() for the 1st-of-month
// push in the hourly cron. GET /recap checks `month` with isMonth() first & answers 400; computeRecap()
// itself never throws and treats a malformed month as empty.
//
// Honest numbers only: every number counts rows inside the month in the recipient's time zone, a slide
// appears only when it has data, and nothing is rounded up (minutes of voices round down).
// A "family dish" is a dish whose cook is another profile in the family with role cook: the row's
// recipe_events.cook_id when it has one (no library needed, so a dish since dropped from library.json
// still counts, as it does in the database), else the library's cook_name matched case-insensitively to
// a profile name (the app's cookProfile rule; messages & favorites carry no cook_id, so they always need
// the library). Sample dishes count (3.7 counts what people did, and a kid who cooked a sample really
// did) except as minutes of family voices: a sample's audio isn't the cook's voice (guardrail 1, D7),
// and a dish the library doesn't list can't be checked, so it never counts as her voice either. Most
// made & most loved need the dish's title from the library; without one there's no such slide.
// table.ts lights flames by the same rule, so a lit week & the month's "family dishes" agree.
// TODO(caleb): 3.6's kitchen counts skip samples; say if the recap should too (every family dish in the
// live & test libraries is a sample today, so that would leave most recaps empty).
//
// Library outage: libraryIndex() returns an empty Map when the bucket is unreachable. GET /recap can
// still answer (rows with cook_id count), but the month comes out smaller (no hearts, postcards, voices
// or titles), so the 1st-of-month cron must tell "library unreachable" apart from an empty month: when
// the Map is empty it skips that profile without a notification_log row instead of sending a short push
// or treating the month as empty. TODO(PR6): that only helps if a later hour can still send, so let the
// recap job run on any hour of the local 1st from 10:00 until quiet hours (the dedupe key
// 'recap:<YYYY-MM>' keeps it to one), not 10:xx alone.
//
// Kid slides: cover · cooked (with postcards) · most made (>= 2 times) · minutes of family voices
// (>= 1 minute, with the most-played clip) · hearts left on family dishes · then & now (>= 2 postcards)
// · close. Cook slides: cover · her dishes cooked (with the kids' faces) · most loved (hearts) ·
// postcards she got · questions she answered · close. The faces come in the order each kid first cooked
// one of her dishes that month, with no count per kid: never ranked by how often (guardrail 4).
//
// Memorial (guardrail 2): a memorial profile gets no recap and is never shown acting this month (no
// face, postcard or heart from them). A kid's own cooking or listening with a memorial cook's dish
// still counts; it's the kid's month and names her dish, not her. The close slide has no cookbook
// offer until printing exists (TODO(caleb) #4).

import { localMonthKey, zoneOf } from "./time.ts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type RecapProfile = {
  id: string;
  name: string;
  role: "cook" | "learner";
  memorial?: boolean | null;
  removed_at?: string | null;
};

/** A recipe_events row (kinds viewed | cooked | started | heard). */
export type RecapEvent = {
  profile_id: string;
  recipe_id: string;
  kind: string;
  cook_id?: string | null;
  duration_s?: number | string | null;
  clip_start_s?: number | string | null;
  created_at: string;
};

/** A messages row, with `thread_with` = the other member of a 1:1 thread (null for the circle). */
export type RecapMessage = {
  id: string;
  sender_id: string;
  kind: string;
  recipe_id?: string | null;
  photo_path?: string | null;
  thread_with?: string | null;
  created_at: string;
};

export type RecapFavorite = { profile_id: string; recipe_id: string; created_at: string };

export type RecipeInfo = { title: string; cook_name?: string | null; sample?: boolean | null };

/** libraryIndex()'s Map fits as is. */
export type RecipeLookup = { get(id: string): RecipeInfo | undefined };

/**
 * Question id -> its first valid answer: answersFor()'s Map in index.ts, as is. It owns the rule (a
 * circle `question`, or a learner's 1:1 `step` with words; the earliest reply from someone who can
 * answer it; legacy step answers too), so the count here matches the "answered" the app shows.
 */
export type RecapAnswers = ReadonlyMap<string, { by: string; at: string }>;

export type Photo = { message_id: string; photo_path: string; recipe_id: string | null; at: string };
/** A kid on the cook's "dishes cooked" slide: who, never how often (no sibling rankings). */
export type Face = { profile_id: string };

export type Slide =
  | { type: "cover"; title: string }
  | { type: "cooked"; title: string; value: number; photos: Photo[] }
  | { type: "most_made"; title: string; value: number; recipe_id: string; cook_id: string }
  | {
    type: "voices";
    title: string;
    value: number; // whole minutes, rounded down
    seconds: number;
    clip: { recipe_id: string; cook_id: string; start_s: number | null; plays: number };
  }
  | { type: "hearts_left"; title: string; value: number }
  | { type: "then_now"; title: string; photos: [Photo, Photo] }
  | { type: "dishes_cooked"; title: string; value: number; faces: Face[] }
  | { type: "most_loved"; title: string; value: number; recipe_id: string }
  | { type: "postcards"; title: string; value: number; photos: Photo[] }
  | { type: "answered"; title: string; value: number }
  | { type: "close"; title: string };

export type Recap = { empty: true } | { month: string; role: "cook" | "learner"; slides: Slide[] };

export type RecapInput = {
  month: string; // 'YYYY-MM'
  tz: string; // the recipient's IANA zone
  role: "cook" | "learner";
  me: string; // profile id
  profiles: RecapProfile[];
  events: RecapEvent[];
  messages: RecapMessage[];
  favorites: RecapFavorite[];
  recipes: RecipeLookup;
  answers: RecapAnswers; // only a cook's recap reads it; a kid's can pass an empty Map
};

export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
const nextMonthName = (month: string) => MONTHS[Number(month.slice(5, 7)) % 12];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const seconds = (v: number | string | null | undefined) => {
  const s = Number(v);
  return Number.isFinite(s) && s > 0 ? s : 0;
};

// --- local month ------------------------------------------------------------------------------

/** 'YYYY-MM' of `at` on the wall calendar in `tz` (time.ts), or null for a bad timestamp. */
function localMonth(at: string, tz: string): string | null {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : localMonthKey(d, tz);
}

const byTime = <T extends { created_at: string }>(a: T, b: T) => Date.parse(a.created_at) - Date.parse(b.created_at);
const photoOf = (m: RecapMessage): Photo => ({
  message_id: m.id,
  photo_path: m.photo_path!,
  recipe_id: m.recipe_id ?? null,
  at: m.created_at,
});

type Tally<T> = { key: string; n: number; last: number; rows: T[] };

/** Rows grouped by key with a count & the latest time, best first: most rows, then latest, then key. */
function tally<T extends { created_at: string }>(rows: T[], keyOf: (r: T) => string): Tally<T>[] {
  const groups = new Map<string, Tally<T>>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? { key, n: 0, last: 0, rows: [] };
    g.n += 1;
    g.last = Math.max(g.last, Date.parse(r.created_at));
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last || (a.key < b.key ? -1 : 1));
}

// --- the recap --------------------------------------------------------------------------------

type Ctx = {
  me: RecapProfile;
  input: RecapInput;
  inMonth: (at: string) => boolean;
  /** Someone in the family who can be shown acting this month (not memorial). */
  present: (id: string) => boolean;
  /** The family cook of a dish (sample or not), from recipe_events.cook_id or the library, or null. */
  cookOf: (recipeId: string | null | undefined, cookId?: string | null) => RecapProfile | null;
};

export function computeRecap(input: RecapInput): Recap {
  if (!isMonth(input.month)) return { empty: true }; // the route answers 400 before this (see the header)
  const tz = zoneOf(input.tz);
  const family = new Map(input.profiles.filter((p) => !p.removed_at).map((p) => [p.id, p]));
  const me = family.get(input.me);
  if (!me || me.memorial) return { empty: true };

  const byName = new Map<string, RecapProfile>();
  for (const p of family.values()) if (!byName.has(norm(p.name))) byName.set(norm(p.name), p);

  const ctx: Ctx = {
    me,
    input,
    inMonth: (at) => localMonth(at, tz) === input.month,
    present: (id) => !!family.get(id) && !family.get(id)!.memorial,
    cookOf: (recipeId, cookId) => {
      // recipe_events.cook_id is the server's own record of whose dish it was: no library needed.
      if (cookId) {
        const p = family.get(cookId);
        return p && p.role === "cook" ? p : null;
      }
      const info = recipeId ? input.recipes.get(recipeId) : undefined;
      const p = info ? byName.get(norm(info.cook_name)) : undefined;
      return p && p.role === "cook" ? p : null;
    },
  };

  const slides = input.role === "cook" ? cookSlides(ctx) : kidSlides(ctx);
  if (!slides.length) return { empty: true };
  return {
    month: input.month,
    role: input.role,
    slides: [
      { type: "cover", title: `Your ${monthName(input.month)} in the kitchen` },
      ...slides,
      // TODO(caleb) #4: the cookbook offer goes here once printing exists.
      { type: "close", title: `See you at the table in ${nextMonthName(input.month)}.` },
    ],
  };
}

function kidSlides({ me, input, inMonth, cookOf }: Ctx): Slide[] {
  const slides: Slide[] = [];
  const familyCook = (recipeId: string | null | undefined, cookId?: string | null) => {
    const c = cookOf(recipeId, cookId);
    return c && c.id !== me.id ? c : null;
  };
  const mine = input.events.filter((e) => e.profile_id === me.id && inMonth(e.created_at));
  const cooked = mine.filter((e) => e.kind === "cooked" && familyCook(e.recipe_id, e.cook_id));
  // Her voice only: a sample's audio isn't the cook's, so samples count everywhere but here. A dish the
  // library doesn't list (bucket unreachable, or since removed) can't be checked, so it isn't counted.
  const isHerVoice = (recipeId: string) => {
    const info = input.recipes.get(recipeId);
    return !!info && info.sample !== true;
  };
  const heard = mine.filter((e) =>
    e.kind === "heard" && seconds(e.duration_s) >= 3 && isHerVoice(e.recipe_id) && familyCook(e.recipe_id, e.cook_id)
  );
  const postcards = input.messages
    .filter((m) =>
      m.sender_id === me.id && m.kind === "cooked" && m.photo_path && inMonth(m.created_at) &&
      familyCook(m.recipe_id)
    )
    .sort(byTime)
    .map(photoOf);

  if (cooked.length) {
    const n = cooked.length;
    const title = `You cooked ${plural(n, "family dish", "family dishes")}`;
    slides.push({ type: "cooked", title, value: n, photos: postcards });
    const most = tally(cooked, (e) => e.recipe_id)[0];
    const dish = input.recipes.get(most.key)?.title;
    // No title (the library didn't list it): no slide, rather than a dish named some other way.
    if (most.n >= 2 && dish) {
      const cook = familyCook(most.key, most.rows[0].cook_id)!;
      const made = `Most made: ${cook.name}'s ${dish}, ${times(most.n)}`;
      slides.push({ type: "most_made", title: made, value: most.n, recipe_id: most.key, cook_id: cook.id });
    }
  }

  const total = heard.reduce((s, e) => s + seconds(e.duration_s), 0);
  const minutes = Math.floor(total / 60);
  if (minutes >= 1) {
    const startOf = (e: RecapEvent) => (e.clip_start_s == null ? null : Number(e.clip_start_s));
    const secsOf = (t: Tally<RecapEvent>) => t.rows.reduce((s, e) => s + seconds(e.duration_s), 0);
    // Most plays, then the most time listened, then the latest (tally's order breaks the last ties).
    const clip = tally(heard, (e) => `${e.recipe_id}#${startOf(e) ?? ""}`)
      .sort((a, b) => b.n - a.n || secsOf(b) - secsOf(a))[0];
    const e = clip.rows[0];
    const cookId = familyCook(e.recipe_id, e.cook_id)!.id;
    slides.push({
      type: "voices",
      title: `${plural(minutes, "minute", "minutes")} of family voices`,
      value: minutes,
      seconds: Math.floor(total),
      clip: { recipe_id: e.recipe_id, cook_id: cookId, start_s: startOf(e), plays: clip.n },
    });
  }

  const hearts = input.favorites.filter((f) =>
    f.profile_id === me.id && inMonth(f.created_at) && familyCook(f.recipe_id)
  );
  if (hearts.length) {
    slides.push({ type: "hearts_left", title: `Hearts you left: ${hearts.length}`, value: hearts.length });
  }

  if (postcards.length >= 2) {
    slides.push({ type: "then_now", title: "Then & now", photos: [postcards[0], postcards[postcards.length - 1]] });
  }
  return slides;
}

function cookSlides({ me, input, inMonth, present, cookOf }: Ctx): Slide[] {
  const slides: Slide[] = [];
  const mineDish = (recipeId: string | null | undefined, cookId?: string | null) =>
    cookOf(recipeId, cookId)?.id === me.id;
  // Everyone else still at the table. Removed members are left out on purpose (they've left the family,
  // so their rows can make this lower than a raw count of the month), and so are memorial profiles,
  // who are never shown acting (guardrail 2).
  const fromOthers = (id: string) => id !== me.id && present(id);
  const isKid = (id: string) => input.profiles.some((p) => p.id === id && p.role === "learner");

  const cooked = input.events.filter((e) =>
    e.kind === "cooked" && inMonth(e.created_at) && fromOthers(e.profile_id) && mineDish(e.recipe_id, e.cook_id)
  );
  if (cooked.length) {
    // The count is everyone else (another cook making her dish counts, as on her Recipes card); the
    // faces are the kids' only, as 3.7 asks. TODO(caleb): show other cooks' faces too?
    // Each kid once, in the order they first cooked one of her dishes this month, and no count per kid:
    // faces sorted by how often would rank the siblings (guardrail 4).
    const kids = [...new Set(cooked.filter((e) => isKid(e.profile_id)).sort(byTime).map((e) => e.profile_id))];
    slides.push({
      type: "dishes_cooked",
      title: `Your dishes were cooked ${times(cooked.length)}`,
      value: cooked.length,
      faces: kids.map((profile_id) => ({ profile_id })),
    });
  }

  const hearts = input.favorites.filter((f) =>
    inMonth(f.created_at) && fromOthers(f.profile_id) && mineDish(f.recipe_id)
  );
  const loved = tally(hearts, (f) => f.recipe_id)[0];
  const dish = loved && input.recipes.get(loved.key)?.title;
  if (loved && dish) {
    const title = `Most loved: ${dish} (\u2665 ${loved.n})`;
    slides.push({ type: "most_loved", title, value: loved.n, recipe_id: loved.key });
  }

  const postcards = input.messages
    .filter((m) =>
      m.kind === "cooked" && m.photo_path && m.thread_with === me.id && fromOthers(m.sender_id) &&
      inMonth(m.created_at) && mineDish(m.recipe_id)
    )
    .sort(byTime)
    .map(photoOf);
  if (postcards.length) {
    const n = postcards.length;
    slides.push({ type: "postcards", title: `Postcards you got: ${n}`, value: n, photos: postcards });
  }

  // Questions whose first answer was mine, given this month (the question may be older). Replies alone
  // never count: a reply to a question someone else answered first, or to a step shared without words,
  // isn't an answer (see RecapAnswers).
  let answered = 0;
  for (const a of input.answers.values()) if (a.by === me.id && inMonth(a.at)) answered += 1;
  if (answered) {
    slides.push({ type: "answered", title: `Questions you answered: ${answered}`, value: answered });
  }
  return slides;
}

/**
 * The 1st-of-month push (2.5), or null for an empty month: "Your October in the kitchen" and a real line
 * from the slides, e.g. "3 dishes & 40 minutes of family voices." A kid's line names dishes & minutes;
 * without either it's the first slide's own title ("Hearts you left: 2.", never "2 hearts left", which
 * reads like a countdown), and a month of postcards alone says what the Then & now slide shows.
 */
export function recapPush(recap: Recap): { title: string; body: string } | null {
  if ("empty" in recap) return null;
  const content = recap.slides.filter((s) => s.type !== "cover" && s.type !== "close");
  if (!content.length) return null;
  const parts: string[] = [];
  if (recap.role === "learner") {
    for (const s of content) {
      if (s.type === "cooked") parts.push(plural(s.value, "dish", "dishes"));
      if (s.type === "voices") parts.push(`${plural(s.value, "minute", "minutes")} of family voices`);
    }
  }
  const first = content[0];
  const line = first.type === "then_now" ? "Your first postcard beside your latest" : first.title;
  return {
    title: `Your ${monthName(recap.month)} in the kitchen`,
    body: `${parts.length ? parts.slice(0, 2).join(" & ") : line}.`,
  };
}
