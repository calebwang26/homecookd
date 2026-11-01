// The Sunday table and Month in the kitchen on the server: what loads the rows for table.ts and recap.ts (pure, and Supabase's own files), and the two pushes that
// go out on their own. table_activity and PostgREST's paging were there to dodge a 1000-row cap, which is gone, so these are plain queries with a limit.
//
// Supabase's 60-second per-isolate cache of old rows is dropped: the api keeps no state in memory, and no measurement asks for one (SYSTEM-DESIGN.md).
//
// SQL, with its index:
//   Events                             recipe_events_family_recent
//   Messages                           messages_family_recent
//   Delivered recordings               pending_sends_family_delivered
//   Hearts                             favorites_recent, limited to the family's people
import * as Sentry from "@sentry/node";
import type { FastifyRequest } from "fastify";
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { ApiError } from "../../errors.js";
import { enqueue } from "../../outbox.js";
import type { Trace } from "../dish/budget.js";
import { everyoneIn, membersByIds, signedOutDevices, type Member } from "../people/family.js";
import { answersFor } from "./answers.js";
import * as data from "./data.js";
import { iso } from "./data.js";
import { dishesOf, library, type RecipeDetails } from "./library.js";
import { hasLivePhone, queuePush } from "./push.js";
import * as pushData from "./pushData.js";
import { dueProfiles } from "./pushRules.js";
import { computeRecap, isMonth, recapPush, type Photo, type Recap, type RecapEvent, type RecapFavorite, type RecapMessage, type RecipeInfo, type Slide } from "./recap.js";
import { type Activity, computeTable, familyPairs, nudgeCandidates, nudgePush, type PairStreak, pickNudgeQuote, weekStart } from "./table.js";
import { DEFAULT_TZ, localMonthKey, localParts, monthBounds, QUIET_FROM_HOUR, RECAP_AT, validTz, zoneOf } from "./time.js";
import { bad, norm } from "./values.js";
import { readLinks } from "./views.js";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** A family member as table.ts and recap.ts read one. A tombstone counts as gone. Their word for a kid is "learner". */
export type FamilyProfile = { id: string; family_id: string; name: string; role: "cook" | "learner"; tz: string | null; memorial: boolean; removed_at: string | null };

export const toProfile = (p: Member): FamilyProfile => ({
  id: p.id,
  family_id: p.family_id,
  name: p.name,
  role: p.role === "cook" ? "cook" : "learner",
  tz: p.tz,
  memorial: p.memorial,
  removed_at: p.removed_at ?? p.deleted_at,
});

// ---------------------------------------------------------------------------------------------
// The Sunday table's rows (tablePr.ts)

export const HISTORY_WEEKS = 53;
export const MAX_HISTORY_WEEKS = 265;
export const QUOTE_ROTATION_DAYS = 15;
/** More than any family's year; hitting it says something is wrong, and the row goes to Sentry rather than silently undercounting. */
const ACTIVITY_LIMIT = 50_000;

export type ActivityRow = {
  at: string;
  actor_id: string;
  kind: "cooked" | "heard" | "message" | "published";
  target_cook_id?: string | null;
  target_kid_id?: string | null;
  thread_with?: string | null;
  duration_s?: number | string | null;
  library_id?: string | null;
};

/**
 * What table_activity returned, as a query: cooked and heard (>= 3 s) events, messages except system notes with the other person of a pair, and delivered recordings
 * per recipient. Repeats of the same thing within a 15-minute slot collapse: every zone's offset is a whole number of quarter hours, so a slot never straddles a
 * local midnight.
 */
export async function activityRows(q: Queryable, familyId: string, since: Date): Promise<ActivityRow[]> {
  const { rows } = await q.query(
    `with raw as (
       select e.created_at as at, e.person_id as actor_id, e.kind, e.cook_id as target_cook_id, null::text as target_kid_id, null::text as thread_with,
              case when e.kind = 'heard' then e.duration_s end as duration_s, case when e.cook_id is null then e.library_id end as library_id
         from recipe_events e
        where e.family_id = $1 and e.created_at >= $2 and (e.kind = 'cooked' or (e.kind = 'heard' and e.duration_s >= 3))
       union all
       select m.created_at, m.sender_id, 'message', null, null,
              case when t.kind = 'pair' then case when t.a_person_id = m.sender_id then t.b_person_id else t.a_person_id end end, null, null
         from messages m join threads t on t.id = m.thread_id
        where m.family_id = $1 and m.created_at >= $2 and m.kind <> 'system'
       union all
       select s.delivered_at, s.sender_id, 'published', null, r.kid, null, null, s.library_id
         from pending_sends s left join lateral unnest(s.recipient_ids) as r(kid) on true
        where s.family_id = $1 and s.delivered_at is not null and s.delivered_at >= $2
     )
     select ${iso("min(at)")} as at, actor_id, kind, target_cook_id, target_kid_id, thread_with, max(duration_s) as duration_s, library_id
       from raw
      group by actor_id, kind, target_cook_id, target_kid_id, thread_with, library_id, floor(extract(epoch from at) / 900)
      order by min(at)
      limit $3`,
    [familyId, since, ACTIVITY_LIMIT],
  );
  if (rows.length === ACTIVITY_LIMIT) Sentry.captureMessage("A family's table activity hit its limit");
  return rows;
}

/**
 * Rows to table.ts's Activity, finding a dish's cook from the library: its cook_name matched case-insensitively to a CURRENT family cook's name. A removed same-named
 * person or a kid never takes the match. Every row here already belongs to this family, so the name rule can't reach another family's cook.
 * A published row goes to the dish's cook, so the cook whose recording went out lights even when a kid filmed it. No match, or no library: the sender.
 */
export function toActivity(rows: ActivityRow[], profiles: Pick<FamilyProfile, "id" | "name" | "role" | "removed_at">[], index: ReadonlyMap<string, RecipeInfo> | null): Activity[] {
  const cookByName = new Map<string, string>();
  for (const p of profiles) {
    const n = norm(p.name);
    if (p.role === "cook" && !p.removed_at && n && !cookByName.has(n)) cookByName.set(n, p.id);
  }
  const cookOf = (id: string | null | undefined) => (id && index ? cookByName.get(norm(index.get(id)?.cook_name)) ?? null : null);
  return rows.map((r) => {
    let cook = r.target_cook_id ?? null;
    if (!cook && (r.kind === "cooked" || r.kind === "heard")) cook = cookOf(r.library_id);
    return {
      at: r.at,
      actor_id: r.kind === "published" ? cookOf(r.library_id) ?? r.actor_id : r.actor_id,
      kind: r.kind,
      target_cook_id: cook,
      target_kid_id: r.target_kid_id ?? null,
      thread_with: r.thread_with ?? null,
      duration_s: r.duration_s ?? null,
    };
  });
}

const needsLibrary = (r: ActivityRow) => !!r.library_id && (r.kind === "published" || ((r.kind === "cooked" || r.kind === "heard") && !r.target_cook_id));

/** Could a streak reach back past the start of the loaded window? */
export function needsMoreHistory(pairs: Pick<PairStreak, "kept">[], weeks: number): boolean {
  const slack = Math.ceil(weeks / 4) + 2;
  return pairs.some((p) => p.kept > 0 && p.kept + slack >= weeks);
}

/** The zone a viewer's table is framed in: a kid's own; a cook with exactly one kid, that kid's, so their week turns together; any other cook's own. */
export function viewerTz(me: FamilyProfile | null, profiles: FamilyProfile[], headerTz: string | null): string {
  if (!me) return headerTz ?? DEFAULT_TZ;
  if (me.role === "learner") return zoneOf(me.tz);
  const kids = profiles.filter((p) => p.role === "learner" && !p.removed_at && !p.memorial);
  return kids.length === 1 ? zoneOf(kids[0].tz) : zoneOf(me.tz);
}

async function loadActivity(familyId: string, now: Date, profiles: FamilyProfile[], index?: ReadonlyMap<string, RecipeInfo> | null): Promise<Activity[]> {
  let lib = index ?? null;
  let weeks = HISTORY_WEEKS;
  for (;;) {
    // A week more than the window, so its first week is whole in every zone.
    const rows = await activityRows(db(), familyId, new Date(now.getTime() - (weeks + 1) * 7 * DAY_MS));
    if (!lib && rows.some(needsLibrary)) lib = await library().libraryIndex();
    const activity = toActivity(rows, profiles, lib);
    if (weeks >= MAX_HISTORY_WEEKS || !needsMoreHistory(familyPairs({ now, profiles, activity }), weeks)) return activity;
    weeks = Math.min(weeks * 2, MAX_HISTORY_WEEKS);
  }
}

/** The dishes this family's recordings became: the only real recordings the nudge may quote or open, because the library's cook names are shared by every family. */
async function familyRecordings(familyId: string): Promise<Set<string>> {
  const { rows } = await db().query(
    `select library_id from pending_sends where family_id = $1 and delivered_at is not null and library_id is not null limit 1000`,
    [familyId],
  );
  return new Set(rows.map((r) => r.library_id));
}

/** Every current face's flame this week, only the pairs that include me, and the dishes this family's own recordings became. Computed on read. */
export async function getTable(signed: Signed, req: FastifyRequest) {
  const now = new Date();
  const header = req.headers["x-tz"];
  const headerTz = validTz(typeof header === "string" ? header : null);
  // This request's zone wins over the stored one, so the very first call already counts the week in their own time.
  const profiles = (await everyoneIn(db(), signed.familyId)).map(toProfile).map((p) => (headerTz && p.id === signed.personId ? { ...p, tz: headerTz } : p));
  const me = profiles.find((p) => p.id === signed.personId && !p.removed_at) ?? null;
  const [activity, own] = await Promise.all([loadActivity(signed.familyId, now, profiles), familyRecordings(signed.familyId)]);
  const table = computeTable({ now, kidTz: viewerTz(me, profiles, headerTz), profiles, activity, me: me?.id ?? null });
  return { ...table, recordings: [...own].sort() };
}

/**
 * The Sunday nudge for one family: each kid in their local Sunday 17:xx gets the one pair worth a note, in the cook's own words when a quote is left, only from
 * recordings this family published. Caps, quiet hours and dedupe stay in queuePush. A repeat is a dedupe no-op.
 */
export async function nudgeFamily(familyId: string, now: Date): Promise<number> {
  const members = await everyoneIn(db(), familyId);
  const profiles = members.map(toProfile);
  const withTokens = new Set<string>();
  for (const p of profiles) if (!p.removed_at && (await hasLivePhone(db(), p.id))) withTokens.add(p.id);
  const due = new Set(dueProfiles(profiles.filter((p) => withTokens.has(p.id)), now).nudge.map((p) => p.id));
  if (due.size === 0) return 0;
  const index = await library().libraryIndex();
  const activity = await loadActivity(familyId, now, profiles, index);
  const pairs = familyPairs({ now, profiles, activity });
  let own: Set<string> | null = null;
  let queued = 0;
  for (const n of nudgeCandidates({ now, profiles, pairs })) {
    if (!due.has(n.kid_id)) continue;
    const kid = profiles.find((p) => p.id === n.kid_id);
    const cook = profiles.find((p) => p.id === n.cook_id);
    if (!kid || !cook) continue;
    const week = weekStart(now, zoneOf(kid.tz));
    own ??= await familyRecordings(familyId);
    const recordings: Set<string> = own;
    const dishes = dishesOf(index, cook.name);
    const real = (await Promise.all(dishes.filter((id) => recordings.has(id) && index.get(id)?.sample === false).map((id) => library().recipeInfo(id)))).filter(
      (r): r is RecipeDetails => r !== null,
    );
    const quote = pickNudgeQuote({
      cookRecipes: real,
      usedQuoteKeys: await pushData.usedQuoteKeys(db(), kid.id, now, QUOTE_ROTATION_DAYS),
      seed: Number(week.replaceAll("-", "")),
    });
    const { title, body } = nudgePush(cook.name, quote);
    const first = dishes.find((id) => recordings.has(id)) ?? dishes.find((id) => index.get(id)?.sample === true);
    const result = await tx((c) =>
      queuePush(
        c,
        {
          personId: kid.id,
          kind: "table_nudge",
          title,
          body,
          url: quote ? `/recipe/${quote.quoteKey.split("#")[0]}` : first ? `/recipe/${first}` : "/kid/home",
          appInitiated: true,
          dedupeKey: `table_nudge:${kid.id}:${week}`,
          quoteKey: quote?.quoteKey ?? null,
        },
        now,
      ),
    );
    if (result === "queued") queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------------------------
// Month in the kitchen (recapPr.ts)

/** The first month with an edition. app/src/lib/recapApi.ts holds the same. */
export const FIRST_MONTH = "2026-11";

export function previousMonth(now: Date, tz: string): string {
  const p = localParts(now, zoneOf(tz));
  return p.month === 1 ? `${p.year - 1}-12` : `${p.year}-${pad(p.month - 1)}`;
}

/** The month to build (null = last month on this clock) and whether it can hold anything: false before `first` or after the current local month. */
export function resolveMonth(month: string | null, now: Date, tz: string, first: string = FIRST_MONTH): { month: string; live: boolean } {
  const m = month ?? previousMonth(now, tz);
  return { month: m, live: m >= first && m <= localMonthKey(now, zoneOf(tz)) };
}

/** Whether it could be the 1st anywhere on Earth right now. The job looks at no one otherwise, so 28 days a month it costs nothing. */
export function maybeLocalFirst(now: Date): boolean {
  for (let h = -12; h <= 14; h += 1) if (new Date(now.getTime() + h * 3_600_000).getUTCDate() === RECAP_AT.day) return true;
  return false;
}

/** People whose local clock says the 1st, from 10:00 until quiet hours start. */
export function recapDue<P extends Pick<FamilyProfile, "tz" | "memorial" | "removed_at">>(people: P[], now: Date): P[] {
  return people.filter((p) => {
    if (p.removed_at || p.memorial) return false;
    const at = localParts(now, zoneOf(p.tz));
    return at.day === RECAP_AT.day && at.hour >= RECAP_AT.hour && at.hour < QUIET_FROM_HOUR;
  });
}

export const recapDedupeKey = (month: string) => `recap:${month}`;
export const recapUrl = (month: string) => `/recap?month=${month}`;

export type RecapPhoto = { message_id: string; photo_url: string; recipe_id: string | null; at: string };

const isContent = (s: { type: string }) => s.type !== "cover" && s.type !== "close";

/** Swaps each photo's key for its read link. Unsigned photos are left out; a Then & now without both is dropped; a recap with no content slide left is empty. */
export function signSlides(recap: Recap, urls: ReadonlyMap<string, string | null>) {
  if ("empty" in recap) return { empty: true as const };
  const signed = (photos: Photo[]): RecapPhoto[] =>
    photos.flatMap((p) => {
      const photo_url = urls.get(p.photo_path);
      return photo_url ? [{ message_id: p.message_id, photo_url, recipe_id: p.recipe_id, at: p.at }] : [];
    });
  const slides: unknown[] = [];
  for (const s of recap.slides) {
    if (s.type === "then_now") {
      const [first, last] = signed(s.photos);
      if (first && last) slides.push({ ...s, photos: [first, last] });
    } else if (s.type === "cooked" || s.type === "postcards") {
      slides.push({ ...s, photos: signed(s.photos) });
    } else slides.push(s);
  }
  if (!(slides as { type: string }[]).some(isContent)) return { empty: true as const };
  return { month: recap.month, role: recap.role, slides };
}

export function photoPaths(recap: Recap): string[] {
  if ("empty" in recap) return [];
  const paths = (recap.slides as Slide[]).flatMap((s) => ("photos" in s ? (s.photos as Photo[]).map((p) => p.photo_path) : []));
  return [...new Set(paths)];
}

/** The 1st-of-month push for a recap as the route will show it, or null when the route would answer an empty month. */
export function recapPushFor(recap: Recap): { title: string; body: string } | null {
  if ("empty" in recap) return null;
  return recapPush(recap);
}

type MonthRows = { events: RecapEvent[]; messages: RecapMessage[]; favorites: RecapFavorite[]; answers: Awaited<ReturnType<typeof answersFor>> };
type Scope = { kind: "family" } | { kind: "learner"; id: string } | { kind: "cook"; id: string; dishes: string[] };
const MONTH_LIMIT = 50_000;

async function loadMonth(familyId: string, members: Member[], window: { start: Date; end: Date }, scope: Scope): Promise<MonthRows> {
  const from = window.start;
  const to = window.end;
  const learner = scope.kind === "learner" ? scope.id : null;
  const cook = scope.kind === "cook" ? scope.id : null;
  const events = await db().query(
    `select person_id as profile_id, library_id as recipe_id, kind, cook_id, duration_s, clip_start_s, ${iso("created_at")} as created_at from recipe_events
      where family_id = $1 and recipe_events.created_at >= $2 and recipe_events.created_at < $3
        and ${cook ? "kind = 'cooked' and person_id <> $5" : "kind in ('cooked', 'heard')"}
        ${learner ? "and person_id = $5" : ""}
      order by recipe_events.created_at, id limit $4`,
    learner || cook ? [familyId, from, to, MONTH_LIMIT, learner ?? cook] : [familyId, from, to, MONTH_LIMIT],
  );
  const cards = await db().query(
    `select m.id, m.sender_id, m.kind, m.library_id as recipe_id, m.photo_key as photo_path, ${iso("m.created_at")} as created_at,
            case when t.kind = 'pair' then case when t.a_person_id = m.sender_id then t.b_person_id when t.b_person_id = m.sender_id then t.a_person_id end end as thread_with
       from messages m join threads t on t.id = m.thread_id
      where m.family_id = $1 and m.kind = 'cooked' and m.photo_key is not null and m.created_at >= $2 and m.created_at < $3 ${learner ? "and m.sender_id = $5" : ""}
      order by m.created_at, m.id limit $4`,
    learner ? [familyId, from, to, MONTH_LIMIT, learner] : [familyId, from, to, MONTH_LIMIT],
  );
  const everyone = members.map((p) => p.id);
  const favorites =
    scope.kind === "cook" && scope.dishes.length === 0
      ? { rows: [] }
      : await db().query(
          `select person_id as profile_id, library_id as recipe_id, ${iso("created_at")} as created_at from favorites
            where favorites.created_at >= $1 and favorites.created_at < $2 and person_id = any($3::text[]) ${scope.kind === "cook" ? "and library_id = any($5::text[])" : ""}
            order by favorites.created_at, person_id, library_id limit $4`,
          scope.kind === "cook" ? [from, to, learner ? [learner] : everyone, MONTH_LIMIT, scope.dishes] : [from, to, learner ? [learner] : everyone, MONTH_LIMIT],
        );
  const answerers = learner ? [] : cook ? [cook] : members.filter((p) => p.role === "cook" && !p.removed_at && !p.deleted_at).map((p) => p.id);
  let answers: MonthRows["answers"] = new Map();
  if (answerers.length) {
    const replies = await db().query(
      `select distinct reply_to from messages
        where family_id = $1 and sender_id = any($2::text[]) and reply_to is not null and kind <> 'reaction' and created_at >= $3 and created_at < $4 limit $5`,
      [familyId, answerers, from, to, MONTH_LIMIT],
    );
    const questions = await data.messagesByIds(db(), replies.rows.map((r) => r.reply_to), familyId);
    answers = await answersFor(familyId, members, questions);
  }
  return { events: events.rows, messages: cards.rows, favorites: favorites.rows, answers };
}

const build = (members: Member[], who: FamilyProfile, month: string, rows: MonthRows, recipes: ReadonlyMap<string, RecipeInfo>): Recap =>
  computeRecap({
    month,
    tz: zoneOf(who.tz),
    role: who.role,
    me: who.id,
    profiles: members.map(toProfile),
    events: rows.events,
    messages: rows.messages,
    favorites: rows.favorites,
    recipes,
    answers: rows.answers,
  });

export async function getRecap(signed: Signed, query: Record<string, unknown>, now = new Date(), first = FIRST_MONTH) {
  const raw = String(query.month ?? "").trim();
  if (raw && !isMonth(raw)) throw bad("bad_month");
  const members = await everyoneIn(db(), signed.familyId);
  const me = members.find((p) => p.id === signed.personId);
  if (!me || me.removed_at || me.deleted_at || me.memorial) return { empty: true };
  const who = toProfile(me);
  const tz = zoneOf(who.tz);
  const { month, live } = resolveMonth(raw || null, now, tz, first);
  if (!live) return { empty: true };
  const index = await library().libraryIndex();
  // No library means no titles, cooks or sample flags: the month would come out smaller than the database says. A 503 lets the app say "try again" and keep the Home card.
  if (index.size === 0) throw new ApiError(503, "library_unreachable");
  const scope: Scope = who.role === "cook" ? { kind: "cook", id: who.id, dishes: dishesOf(index, who.name) } : { kind: "learner", id: who.id };
  const rows = await loadMonth(signed.familyId, members, monthBounds(month, tz)!, scope);
  const recap = build(members, who, month, rows, index);
  return signSlides(recap, await readLinks(photoPaths(recap)));
}

/** The recap push for everyone due in one family, in the slides' own words. App-initiated, so the caps apply; 'recap:YYYY-MM' keeps it to one. */
export async function recapFamily(familyId: string, now: Date, first = FIRST_MONTH): Promise<number> {
  const members = await everyoneIn(db(), familyId);
  const profiles = members.map(toProfile);
  const withTokens: FamilyProfile[] = [];
  for (const p of profiles) if (!p.removed_at && (await hasLivePhone(db(), p.id))) withTokens.push(p);
  const due = recapDue(withTokens, now).filter((p) => previousMonth(now, zoneOf(p.tz)) >= first);
  if (due.length === 0) return 0;
  const index = await library().libraryIndex();
  // Nothing is sent or logged, and a later hour on the 1st tries again.
  if (index.size === 0) throw new Error("recap: the library is unreachable");
  const monthOf = new Map(due.map((p) => [p.id, previousMonth(now, zoneOf(p.tz))]));
  const spans = due.map((p) => monthBounds(monthOf.get(p.id)!, zoneOf(p.tz))!);
  const rows = await loadMonth(familyId, members, {
    start: new Date(Math.min(...spans.map((s) => s.start.getTime()))),
    end: new Date(Math.max(...spans.map((s) => s.end.getTime()))),
  }, { kind: "family" });
  let queued = 0;
  for (const p of due) {
    const month = monthOf.get(p.id)!;
    if ((await pushData.peopleWithKey(db(), [p.id], recapDedupeKey(month))).size) continue;
    const push = recapPushFor(build(members, p, month, rows, index));
    if (!push) continue; // an empty month: no push, no log row
    const out = await tx((c) => queuePush(c, { personId: p.id, kind: "recap", ...push, url: recapUrl(month), appInitiated: true, dedupeKey: recapDedupeKey(month) }, now));
    if (out === "queued") queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------------------------
// The hourly job: who is in their local target hour

const TOKEN_PAGE = 500;

/**
 * An EventBridge schedule starts this. It only finds families with someone due and queues one message for each, so one family's trouble can't hold up the others
 * and a failed family is retried on its own. A repeat finds the same people, and their dedupe keys make it a no-op.
 */
export async function hourly(now: Date, trace: Trace): Promise<void> {
  const nudge = new Set<string>();
  const recap = new Set<string>();
  const recapPossible = maybeLocalFirst(now) && previousMonth(now, "Pacific/Kiritimati") >= FIRST_MONTH;
  for (let after = ""; ; ) {
    const tokens = await pushData.tokenPage(db(), after, TOKEN_PAGE);
    if (tokens.length === 0) break;
    after = tokens.at(-1)!.token;
    const signedOut = await signedOutDevices(db(), [...new Set(tokens.flatMap((t) => (t.device_id ? [t.device_id] : [])))]);
    const ids = [...new Set(tokens.filter((t) => !t.device_id || !signedOut.has(t.device_id)).map((t) => t.person_id))];
    const people = (await membersByIds(db(), ids)).filter((p) => !p.deleted_at).map(toProfile);
    for (const p of dueProfiles(people, now).nudge) nudge.add(p.family_id);
    if (recapPossible) for (const p of recapDue(people, now)) recap.add(p.family_id);
    if (tokens.length < TOKEN_PAGE) break;
  }
  await tx(async (c) => {
    for (const familyId of nudge) await enqueue(c, { queue: "scheduled", payload: { task: "messages.nudge_family", familyId, nowMs: now.getTime() }, requestId: trace.requestId });
    for (const familyId of recap) await enqueue(c, { queue: "scheduled", payload: { task: "messages.recap_family", familyId, nowMs: now.getTime() }, requestId: trace.requestId });
  });
}
