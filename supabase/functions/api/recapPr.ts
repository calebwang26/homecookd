// Month in the kitchen, the server half (docs/build/RETENTION-HANDOFF.md 3.7, PR 6): GET /recap and the
// 1st-of-month push. recap.ts builds the slides from rows (pure); this file loads those rows for one
// local month, answers the route, and gives the hourly cron its "recap" job.
//
// retention.ts's makeRetention() builds it when PR 6 is on (deps.prs), tags GET /recap PR 6 and
// registers the `recap` job on the hourly cron. This file imports recap.ts, plumbing.ts & time.ts, never
// retention.ts or index.ts; what it needs from index.ts comes in through makeRetention's deps:
//
//   library,                                     // index.ts's makeLibrary(...)
//   answersFor: (fam, rows) => answersFor(familyCtx(fam), rows as unknown as MessageRow[]),
//   signPhotos: (paths) => signVoice(paths, PHOTO_BUCKET), // qa-cook's signer; leave out until it lands
//
// where familyCtx(fam) is a Ctx for answersFor() with no caller behind it (it reads only family.id and
// everyone's roles):
//   ({ family: { id: fam.id, name: "" }, profiles: fam.profiles, everyone: fam.profiles, me: null,
//      device: null, phones: new Set() }) as unknown as Ctx
//
// GET /recap?month=YYYY-MM (signed in, a person): `{empty: true}` or `{month, role, slides}`.
// - month: missing = last month on my clock; not YYYY-MM = 400 "month must be YYYY-MM". A month before
//   the first edition (FIRST_MONTH, November 2026) or after this one is empty without a query.
// - 503 when the library can't be reached: without titles & cooks the numbers would be too small, and
//   the app would mark a wrong month opened. The app shows "try again" and keeps the Home card.
// - Every number counts rows inside that month in my time zone (recap.ts). Postcards come back with a
//   fresh 1-hour `photo_url` instead of their storage path; a photo that can't be signed is left out,
//   and a Then & now without both photos is dropped (an empty month if nothing else is left).
//
// The cron job (handoff 2.5 last row): on the local 1st from 10:00 until quiet hours, anyone with push
// on & a non-empty last month (FIRST_MONTH or later) gets one push: "Your November in the kitchen", a real line from the
// slides (recapPush), opening /recap?month=YYYY-MM. App-initiated, so notify() applies the caps; the
// dedupe key 'recap:YYYY-MM' keeps it to one. Running every hour of that window (not 10:xx alone, as
// plumbing.ts's dueProfiles picks) lets a later hour send when the library was unreachable at 10:00:
// with no library the job sends nothing & logs nothing, because the month would come out smaller
// (recap.ts header). Memorial & removed people get nothing. The push reads the month as the route will
// show it (recapPushFor): until signPhotos is passed, a month of Then & now alone sends nothing.
//
// PostgREST's 1000-row cap: each list pages through `.range()` 1000 rows at a time in a stable order,
// so a chatty family's month is never cut short (no RPC or migration needed). Only what the slides read
// is loaded: recipe_events 'cooked' & 'heard', 'cooked' messages that carry a photo, hearts, and for a
// cook the replies they sent that month (to find the questions they answered). PAGE must not exceed
// the project's max_rows (Supabase's default is 1000), or a full page would read as the last one.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  computeRecap,
  isMonth,
  type Photo,
  type Recap,
  type RecapAnswers,
  type RecapEvent,
  type RecapFavorite,
  type RecapMessage,
  recapPush,
  type RecipeLookup,
  type Slide,
} from "./recap.ts";
import {
  dishesOf,
  FAMILY_PROFILE_COLS,
  familyProfiles,
  type CronJob,
  type FamilyProfile,
  type HttpErrorCtor,
  type Library,
} from "./plumbing.ts";
import { localMonthKey, localParts, monthBounds, QUIET_FROM_HOUR, RECAP_AT, zoneOf } from "./time.ts";

const HOUR = 60 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The first month with an edition: the first card & push go out on Dec 1, for November (handoff 3.7,
 * "First edition"; it covers Thanksgiving). Earlier months are empty without a query. recipe_events
 * began on Oct 15, 2026, but October's 'heard' minutes & postcards only count once PRs 1 & 3 deploy,
 * so October's numbers would come out smaller than what happened. Keep app/src/lib/recapApi.ts's
 * FIRST_MONTH the same.
 * TODO(caleb): an October edition (card & push on Nov 1) is possible: set both to '2026-10'. That
 * push adds notification volume (handoff 5.3) and uses each cook's one app-initiated push for November.
 */
export const FIRST_MONTH = "2026-11";

// ---------------------------------------------------------------------------------------------
// Months & who is due (pure)

/** The local month before the one `now` falls in, 'YYYY-MM'. */
export function previousMonth(now: Date, tz: string): string {
  const p = localParts(now, zoneOf(tz));
  return p.month === 1 ? `${p.year - 1}-12` : `${p.year}-${pad(p.month - 1)}`;
}

/** ?month= as sent: null when missing or blank (= last month), else the month, or the 400. */
export function monthParam(raw: string | null): { ok: true; month: string | null } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, month: null };
  return isMonth(s) ? { ok: true, month: s } : { ok: false, error: "month must be YYYY-MM" };
}

/**
 * The month to build (null = last month on this clock) and whether it can hold anything: false for a
 * month before `first` (FIRST_MONTH) or after the current local month.
 */
export function resolveMonth(
  month: string | null,
  now: Date,
  tz: string,
  first: string = FIRST_MONTH,
): { month: string; live: boolean } {
  const m = month ?? previousMonth(now, tz);
  return { month: m, live: m >= first && m <= localMonthKey(now, zoneOf(tz)) };
}

/**
 * Whether it could be the 1st anywhere on Earth right now (UTC-12 to UTC+14, any minute offset). The
 * job looks at no one otherwise, so 28 days a month it costs nothing.
 */
export function maybeLocalFirst(now: Date): boolean {
  for (let h = -12; h <= 14; h++) if (new Date(now.getTime() + h * HOUR).getUTCDate() === RECAP_AT.day) return true;
  return false;
}

/** People whose local clock says the 1st, from 10:00 until quiet hours start (21:00). */
export function recapDue<P extends Pick<FamilyProfile, "tz" | "memorial" | "removed_at">>(people: P[], now: Date): P[] {
  return people.filter((p) => {
    if (p.removed_at || p.memorial) return false;
    const at = localParts(now, zoneOf(p.tz));
    return at.day === RECAP_AT.day && at.hour >= RECAP_AT.hour && at.hour < QUIET_FROM_HOUR;
  });
}

/** The recap push's dedupe key & url for a month. */
export const recapDedupeKey = (month: string) => `recap:${month}`;
export const recapUrl = (month: string) => `/recap?month=${month}`;

// ---------------------------------------------------------------------------------------------
// The response: storage paths swapped for signed URLs

/** A postcard photo as the app gets it: a 1-hour signed URL, never the storage path. */
export type RecapPhoto = { message_id: string; photo_url: string; recipe_id: string | null; at: string };
type Signed<S> = S extends { type: "then_now"; photos: [Photo, Photo] } ? Omit<S, "photos"> & { photos: [RecapPhoto, RecapPhoto] }
  : S extends { photos: Photo[] } ? Omit<S, "photos"> & { photos: RecapPhoto[] }
  : S;
/** recap.ts's Slide with photos signed (distributes over the union). */
export type RecapSlide = Signed<Slide>;
export type RecapResponse = { empty: true } | { month: string; role: "cook" | "learner"; slides: RecapSlide[] };

const isContent = (s: { type: string }) => s.type !== "cover" && s.type !== "close";

/**
 * Swaps each photo's path for its signed URL (`urls`: path -> URL). Unsigned photos are left out; a
 * Then & now without both is dropped; a recap with no content slide left is empty.
 */
export function signSlides(recap: Recap, urls: ReadonlyMap<string, string>): RecapResponse {
  if ("empty" in recap) return { empty: true };
  const signed = (photos: Photo[]): RecapPhoto[] =>
    photos.flatMap((p) => {
      const photo_url = urls.get(p.photo_path);
      return photo_url ? [{ message_id: p.message_id, photo_url, recipe_id: p.recipe_id, at: p.at }] : [];
    });
  const slides: RecapSlide[] = [];
  for (const s of recap.slides) {
    switch (s.type) {
      case "then_now": {
        const [first, last] = signed(s.photos);
        if (first && last) slides.push({ ...s, photos: [first, last] });
        break;
      }
      case "cooked":
      case "postcards":
        slides.push({ ...s, photos: signed(s.photos) });
        break;
      default:
        slides.push(s);
    }
  }
  if (!slides.some(isContent)) return { empty: true };
  return { month: recap.month, role: recap.role, slides };
}

/** Every photo path in a recap's slides, once each. */
export function photoPaths(recap: Recap): string[] {
  if ("empty" in recap) return [];
  const paths = recap.slides.flatMap((s) => ("photos" in s ? s.photos.map((p) => p.photo_path) : []));
  return [...new Set(paths)];
}

/**
 * The 1st-of-month push for a recap as GET /recap will show it, or null when the route would answer an
 * empty month. It runs signSlides' own rule: with a signer every photo counts as signed; without one
 * (until P4 passes signPhotos) a Then & now is dropped, so a month whose only slide is Then & now gets
 * no push that would open on an empty month. A single photo failing to sign at open time can't be known
 * an hour early; that rare case still shows the rest of the month.
 */
export function recapPushFor(recap: Recap, canSign: boolean): { title: string; body: string } | null {
  if ("empty" in recap) return null;
  const urls = new Map<string, string>(canSign ? photoPaths(recap).map((p) => [p, p]) : []);
  const shown = signSlides(recap, urls);
  if ("empty" in shown) return null;
  const kept = new Set(shown.slides.map((s) => s.type));
  return recapPush({ ...recap, slides: recap.slides.filter((s) => kept.has(s.type)) });
}

// ---------------------------------------------------------------------------------------------
// Routes & the cron job

type DbError = { code?: string; message?: string } | null;

/** The parts of index.ts's Ctx this file reads. */
export type RecapCtx = { family: { id: string } };

/** One family as the loaders & answersFor() see it: everyone in it, removed people included. */
export type RecapFamily = { id: string; profiles: FamilyProfile[] };

/** A message row answersFor() needs (index.ts's MessageRow has more columns; it reads only these). */
export type QuestionRow = {
  id: string;
  family_id: string;
  thread_id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  recipe_id: string | null;
  step_order: number | null;
  reply_to: string | null;
  created_at: string;
};
export const QUESTION_COLS = "id, family_id, thread_id, sender_id, kind, body, recipe_id, step_order, reply_to, created_at";

export type RecapDeps<C extends RecapCtx> = {
  db: SupabaseClient;
  HttpError: HttpErrorCtor;
  requireMe: (ctx: C) => { id: string };
  dbFail: (context: string, error: DbError) => never;
  /** PR 1's makeLibrary(): dish -> title, cook, sample. An empty Map = the bucket is unreachable. */
  library: Pick<Library, "libraryIndex">;
  /**
   * index.ts's answersFor() over these questions: question id -> its first valid answer. It owns the
   * rule, so "Questions you answered" matches the "answered" the app shows.
   */
  answersFor: (family: RecapFamily, questions: QuestionRow[]) => Promise<RecapAnswers>;
  /** Fresh 1-hour signed URLs for paths in the private photos bucket. Without it, postcards show no photo. */
  signPhotos?: (paths: string[]) => Promise<Map<string, string>>;
  /** Override the clock (tests). The cron job uses the run's `now`. */
  clock?: () => Date;
  /** Override FIRST_MONTH (tests whose made-up family cooked in October). index.ts never passes it. */
  firstMonth?: string;
};

/**
 * Whose rows to load. A learner's month reads only their own rows; a cook's reads others' cooks of the
 * family, postcards, hearts on their dishes (`dishes`) and their own replies; the cron reads the whole
 * family once for everyone due in it.
 */
type Scope =
  | { kind: "family" }
  | { kind: "learner"; id: string }
  | { kind: "cook"; id: string; dishes: string[] };

export type MonthRows = {
  events: RecapEvent[];
  messages: RecapMessage[];
  favorites: RecapFavorite[];
  answers: RecapAnswers;
};

const PAGE = 1000;
const MAX_PAGES = 50;
type PageResult = PromiseLike<{ data: unknown; error: DbError }>;
type Thread = { id: string; a_profile: string | null; b_profile: string | null };

export function makeRecap<C extends RecapCtx>(deps: RecapDeps<C>) {
  const { db, HttpError, requireMe, dbFail, library } = deps;
  const clock = deps.clock ?? (() => new Date());
  const first = deps.firstMonth ?? FIRST_MONTH;

  /** Every row of a query, PAGE at a time (`run(from, to)` must order the rows stably). */
  async function pages<T>(label: string, run: (from: number, to: number) => PageResult): Promise<T[]> {
    const out: T[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const { data, error } = await run(p * PAGE, p * PAGE + PAGE - 1);
      if (error) dbFail(label, error);
      const rows = (Array.isArray(data) ? data : []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
    console.error(`${label}: stopped after ${MAX_PAGES * PAGE} rows`);
    return out;
  }

  /** The questions these people answered (replies they sent in the window), with their first answers. */
  async function loadAnswers(fam: RecapFamily, from: string, to: string, senders: string[]): Promise<RecapAnswers> {
    if (!senders.length) return new Map();
    const replies = await pages<{ reply_to: string | null }>("recap replies", (a, b) =>
      db.from("messages").select("reply_to")
        .eq("family_id", fam.id).in("sender_id", senders).not("reply_to", "is", null).neq("kind", "reaction")
        .gte("created_at", from).lt("created_at", to)
        .order("created_at").order("id").range(a, b));
    const ids = [...new Set(replies.map((r) => r.reply_to).filter((id): id is string => !!id))];
    if (!ids.length) return new Map();
    const questions: QuestionRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db.from("messages").select(QUESTION_COLS)
        .eq("family_id", fam.id).in("id", ids.slice(i, i + 100));
      if (error) dbFail("recap questions", error);
      questions.push(...((data ?? []) as QuestionRow[]));
    }
    return await deps.answersFor(fam, questions);
  }

  /** The rows recap.ts reads, created in [start, end). */
  async function loadMonth(fam: RecapFamily, window: { start: Date; end: Date }, scope: Scope): Promise<MonthRows> {
    const from = window.start.toISOString();
    const to = window.end.toISOString();
    const learner = scope.kind === "learner" ? scope.id : null;
    const cook = scope.kind === "cook" ? scope.id : null;

    const events = pages<RecapEvent>("recap events", (a, b) => {
      let q = db.from("recipe_events").select("profile_id, recipe_id, kind, cook_id, duration_s, clip_start_s, created_at")
        .eq("family_id", fam.id).gte("created_at", from).lt("created_at", to);
      q = cook ? q.eq("kind", "cooked").neq("profile_id", cook) : q.in("kind", ["cooked", "heard"]);
      if (learner) q = q.eq("profile_id", learner);
      return q.order("created_at").order("id").range(a, b);
    });

    const cards = pages<Omit<RecapMessage, "thread_with"> & { thread_id: string }>("recap postcards", (a, b) => {
      let q = db.from("messages").select("id, thread_id, sender_id, kind, recipe_id, photo_path, created_at")
        .eq("family_id", fam.id).eq("kind", "cooked").not("photo_path", "is", null)
        .gte("created_at", from).lt("created_at", to);
      if (learner) q = q.eq("sender_id", learner);
      return q.order("created_at").order("id").range(a, b);
    });

    // A cook's postcards are the ones in their own 1:1 threads, so messages need the other member.
    // A learner's need no thread.
    const threads = learner ? Promise.resolve([] as Thread[]) : pages<Thread>("recap threads", (a, b) =>
      db.from("threads").select("id, a_profile, b_profile")
        .eq("family_id", fam.id).eq("kind", "pair").order("id").range(a, b));

    const favorites = (() => {
      if (cook && scope.kind === "cook" && !scope.dishes.length) return Promise.resolve([] as RecapFavorite[]);
      return pages<RecapFavorite>("recap hearts", (a, b) => {
        let q = db.from("favorites").select("profile_id, recipe_id, created_at").gte("created_at", from).lt("created_at", to);
        q = learner ? q.eq("profile_id", learner) : q.in("profile_id", fam.profiles.map((p) => p.id));
        if (scope.kind === "cook") q = q.in("recipe_id", scope.dishes);
        return q.order("created_at").order("profile_id").order("recipe_id").range(a, b);
      });
    })();

    const answerers = learner ? [] : cook ? [cook] : fam.profiles.filter((p) => p.role === "cook" && !p.removed_at).map((p) => p.id);
    const answers = loadAnswers(fam, from, to, answerers);

    const [ev, cs, th, fav, ans] = await Promise.all([events, cards, threads, favorites, answers]);
    const pairs = new Map(th.map((t) => [t.id, t]));
    const messages: RecapMessage[] = cs.map(({ thread_id, ...m }) => {
      const t = pairs.get(thread_id);
      const thread_with = !t ? null : t.a_profile === m.sender_id ? t.b_profile : t.b_profile === m.sender_id ? t.a_profile : null;
      return { ...m, thread_with };
    });
    return { events: ev, messages, favorites: fav, answers: ans };
  }

  const build = (fam: RecapFamily, who: FamilyProfile, month: string, rows: MonthRows, recipes: RecipeLookup): Recap =>
    computeRecap({
      month,
      tz: zoneOf(who.tz),
      role: who.role,
      me: who.id,
      profiles: fam.profiles,
      events: rows.events,
      messages: rows.messages,
      favorites: rows.favorites,
      recipes,
      answers: rows.answers,
    });

  // GET /recap?month=YYYY-MM -> {empty: true} | {month, role, slides}
  async function getRecap({ ctx, url }: { ctx: C; url: URL }): Promise<RecapResponse> {
    const meId = requireMe(ctx).id;
    const asked = monthParam(url.searchParams.get("month"));
    if (!asked.ok) throw new HttpError(400, asked.error);
    const fam: RecapFamily = { id: ctx.family.id, profiles: await familyProfiles(db, ctx.family.id) };
    const me = fam.profiles.find((p) => p.id === meId);
    if (!me || me.removed_at || me.memorial) return { empty: true };
    const tz = zoneOf(me.tz);
    const { month, live } = resolveMonth(asked.month, clock(), tz, first);
    if (!live) return { empty: true };
    const index = await library.libraryIndex();
    // No library = no titles, cooks or sample flags: the month would come out smaller than the
    // database says (recap.ts header). A 503 lets the app say "try again" and keep the Home card,
    // instead of marking a wrong month opened.
    if (!index.size) throw new HttpError(503, "Can’t reach the family recipes right now. Try again.");
    const scope: Scope = me.role === "cook"
      ? { kind: "cook", id: me.id, dishes: dishesOf(index, me.name) }
      : { kind: "learner", id: me.id };
    const rows = await loadMonth(fam, monthBounds(month, tz)!, scope);
    const recap = build(fam, me, month, rows, index);
    const paths = photoPaths(recap);
    let urls = new Map<string, string>();
    if (paths.length && deps.signPhotos) {
      try {
        urls = await deps.signPhotos(paths);
      } catch (e) {
        console.error("sign recap photos:", String(e)); // the slides still show, without photos
      }
    }
    return signSlides(recap, urls);
  }

  /**
   * Everyone with push on (the cron's audience), with tz & memorial. A token on a signed-out phone
   * doesn't count (notify() would answer "none" without a log row, so that family would be rebuilt
   * every hour of the 1st). The same rule as notify()'s liveTokens: a token with no device_id counts,
   * one whose device is revoked or gone doesn't.
   */
  async function peopleWithPush(): Promise<FamilyProfile[]> {
    const tokens = await pages<{ profile_id: string; device_id: string | null }>("recap push tokens", (a, b) =>
      db.from("push_tokens").select("profile_id, device_id").order("token").range(a, b));
    const deviceIds = [...new Set(tokens.map((t) => t.device_id).filter((d): d is string => !!d))];
    const live = new Set<string>();
    for (let i = 0; i < deviceIds.length; i += 100) {
      const { data, error } = await db.from("devices").select("id, revoked_at").in("id", deviceIds.slice(i, i + 100));
      if (error) dbFail("recap push devices", error);
      for (const d of (data ?? []) as { id: string; revoked_at: string | null }[]) if (!d.revoked_at) live.add(d.id);
    }
    const ids = [...new Set(tokens.filter((t) => !t.device_id || live.has(t.device_id)).map((t) => t.profile_id))];
    const people: FamilyProfile[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db.from("profiles").select(FAMILY_PROFILE_COLS).in("id", ids.slice(i, i + 100));
      if (error) dbFail("recap people", error);
      people.push(...((data ?? []) as FamilyProfile[]));
    }
    return people;
  }

  /** Who already has this month's recap row (sent, or skipped by a cap): no need to build theirs. */
  async function alreadyLogged(keyOf: Map<string, string>): Promise<Set<string>> {
    const done = new Set<string>();
    const ids = [...keyOf.keys()];
    const keys = [...new Set(keyOf.values())];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db.from("notification_log").select("profile_id, dedupe_key")
        .eq("kind", "recap").in("profile_id", ids.slice(i, i + 100)).in("dedupe_key", keys);
      if (error) dbFail("recap log", error);
      for (const r of (data ?? []) as { profile_id: string; dedupe_key: string }[]) {
        if (keyOf.get(r.profile_id) === r.dedupe_key) done.add(r.profile_id);
      }
    }
    return done;
  }

  const cronJob: CronJob = {
    name: "recap",
    run: async ({ now, notify }) => {
      if (!maybeLocalFirst(now)) return 0;
      // Whose last month has an edition (FIRST_MONTH on). Until it's the 1st after FIRST_MONTH even in
      // the furthest-ahead zone (UTC+14), nobody's does: no query at all.
      if (previousMonth(now, "Pacific/Kiritimati") < first) return 0;
      const due = recapDue(await peopleWithPush(), now).filter((p) => previousMonth(now, zoneOf(p.tz)) >= first);
      if (!due.length) return 0;
      const index = await library.libraryIndex();
      if (!index.size) {
        console.error("recap: library unreachable; the next hour tries again");
        return 0;
      }
      const monthOf = new Map(due.map((p) => [p.id, previousMonth(now, zoneOf(p.tz))]));
      const done = await alreadyLogged(new Map([...monthOf].map(([id, m]) => [id, recapDedupeKey(m)])));
      const byFamily = new Map<string, FamilyProfile[]>();
      for (const p of due) {
        if (done.has(p.id)) continue;
        byFamily.set(p.family_id, [...(byFamily.get(p.family_id) ?? []), p]);
      }

      let sent = 0;
      for (const [familyId, people] of byFamily) {
        try {
          const fam: RecapFamily = { id: familyId, profiles: await familyProfiles(db, familyId) };
          // One load covers every month due in this family (each person's month in their own zone).
          const spans = people.map((p) => monthBounds(monthOf.get(p.id)!, zoneOf(p.tz))!);
          const window = {
            start: new Date(Math.min(...spans.map((s) => s.start.getTime()))),
            end: new Date(Math.max(...spans.map((s) => s.end.getTime()))),
          };
          const rows = await loadMonth(fam, window, { kind: "family" });
          for (const p of people) {
            const who = fam.profiles.find((x) => x.id === p.id);
            if (!who || who.removed_at || who.memorial) continue;
            const month = monthOf.get(p.id)!;
            // The month as GET /recap will show it (no signer = no Then & now), so the push never
            // opens on an empty month.
            const push = recapPushFor(build(fam, who, month, rows, index), !!deps.signPhotos);
            if (!push) continue; // an empty month: no push, no log row
            const out = await notify(p.id, {
              kind: "recap",
              ...push,
              url: recapUrl(month),
              appInitiated: true,
              dedupeKey: recapDedupeKey(month),
            });
            if (out === "sent") sent += 1;
          }
        } catch (e) {
          console.error("recap job (one family):", String(e)); // the other families still go
        }
      }
      return sent;
    },
  };

  return {
    getRecap,
    loadMonth,
    cronJob,
    routes: [{ method: "GET", path: "/recap", handler: getRecap, auth: {} }],
  };
}
