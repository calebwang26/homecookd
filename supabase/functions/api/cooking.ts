// "Leo is cooking your chili" (docs/build/RETENTION-HANDOFF.md 3.1, retention PR 2): who is in cook
// mode on whose dish right now, the one push the dish's cook gets when a kid starts it, the kid's
// one-time consent, and the push rules for reactions (a cook's heart mid-cook, "Just like mine").
//
// Same shape as plumbing.ts: this file imports plumbing.ts & time.ts, never retention.ts or index.ts,
// and whatever it needs from index.ts comes in through makeCooking(deps). retention.ts's
// makeRetention() builds it when PR 2 is on (deps.prs) and tags its routes PR 2; index.ts registers
// them with the rest (RETENTION-WIRING.md, "PR 2 wiring").
//
// Routes (all signed in, all need a person):
//   POST /cooking {recipe_id, cook_id, step, total}  -> {ok, shared, consent, memorial?, started_at, new_session}
//   POST /cooking/end {recipe_id?}                   -> {ok}
//   GET  /cooking                                    -> LiveCooking[] (dishes where I am the cook)
//   GET  /profile/share-cooking                      -> {share_cooking: true | false | null}
//   POST /profile/share-cooking {share}              -> {ok, share_cooking}
//
// Rules that hold here (handoff section 5):
// - Consent for presence (guardrail 6): profiles.share_cooking null = not asked yet, false = never.
//   Until it is true, POST /cooking writes nothing, logs nothing and pushes nothing; it answers
//   consent 'unasked' so the app shows the question once. Answering false also ends a live session.
// - Memorial (guardrail 2): cooking a memorial cook's dish writes nothing, logs nothing and pushes
//   nothing (shared false), so no pair data accrues. It is checked before consent and answers consent
//   'no' + memorial true whatever the kid's stored answer (left as it is): nobody can see that session,
//   so there is nothing to ask, and the app never shows "Let Grandma see…" about someone who can't.
//   The app's Profile has no memorial flag yet, so this answer is what keeps the question away.
// - Whose dish: a new session checks the dish's cook in recipe.json (the app's cookProfile name rule),
//   so nobody can make a cook get "Leo is making your <someone else's dish>". An unreachable bucket
//   lets it through (the push then says "your recipe"). A step naming another cook than the session's
//   is checked the same way (a new session or a 400), and a step never rewrites the row's cook_id.
//   A family cook's sample dishes count as theirs: every family dish is a sample today (PR 2
//   departure; TODO(caleb): skip dish.sample here and in the app once real recordings exist).
// - started_at always goes out in one spelling (isoOf), whichever path answers.
// - Live rows are shown only to the dish's cook (tighter than the handoff's "my family": the consent
//   question names that cook), and only while fresh (45 min since the last step).
// - The started push is caused by a person, so it is never capped, but its dedupe key sends at most
//   one per kid, dish & kid-local day. Hearts never push (in-app only).
// - Copy never speaks for the cook, never assumes a gender, has no guilt words.
// - Tables: cooking_now, profiles.share_cooking, recipe_events kind 'started' + cook_id, messages kind
//   'reaction', all in 20261018100000_retention_plumbing.sql (PR 1). PR 2 adds no migration of its own.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  type HttpErrorCtor,
  messagePush,
  type NotifyResult,
  type PushCopy,
  type PushInput,
  type RetentionCtx,
  type RetentionProfile,
  runInBackground,
  truncate,
} from "./plumbing.ts";
import { localDateKey, zoneOf } from "./time.ts";

const MINUTE = 60_000;

/** A session is live while its last step is newer than this; after it, the next call starts anew. */
export const COOKING_FRESH_MS = 45 * MINUTE;
/** cooking_now_step_check: 1 <= step <= total <= 200. */
export const MAX_STEPS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

// ---------------------------------------------------------------------------------------------
// Copy (pure)

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const named = (s: string) => truncate(s, 40);

/**
 * One spelling for a stored time: PostgREST answers "2026-10-18T17:00:00.123+00:00" where the first
 * call of a session answered the edge clock's "2026-10-18T17:00:00.123Z". The app keys a session's
 * heart feed (and the cook's live row) on started_at, so it must not change spelling mid-session.
 */
export const isoOf = (v: string): string => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
};

/**
 * The dish as people say it, the app's dishName() rule (components/parent/kitchen.ts): "Mom's Sunday
 * Chili" -> "Sunday Chili" when the possessive is the cook (or a short name), a long title cut at
 * "with / and / in / on", and "recipe" when there is no title. Keep the two in step.
 */
export function dishName(title: string | null | undefined, cook?: string | null): string {
  let t = (title ?? "").trim();
  if (!t) return "recipe";
  const m = /^(.+?)['’]s\s+(.+)$/.exec(t);
  if (m && (!cook || norm(m[1]) === norm(cook) || m[1].split(/\s+/).length <= 2)) t = m[2];
  if (t.length > 22) {
    const short = t.split(/\s+(?:with|and|in|on)\s+/i)[0];
    if (short.length >= 4) t = short;
  }
  return t;
}

/** "Leo is making your Sunday Chili" / "Right now, step 1 of 8.", opening the cook's Home. */
export function startedPush(
  kidName: string,
  dish: { title: string; cook_name: string | null } | null,
  step: number,
  total: number,
): PushCopy {
  return {
    kind: "started",
    title: truncate(`${named(kidName)} is making your ${dishName(dish?.title, dish?.cook_name)}`),
    body: `Right now, step ${step} of ${total}.`,
    url: "/parent/home",
  };
}

/** The dedupe key for the started push: one per kid, dish & the kid's local day. */
export const startedKey = (kidId: string, recipeId: string, now: Date, kidTz: string | null | undefined) =>
  `started:${kidId}:${recipeId}:${localDateKey(now, zoneOf(kidTz))}`;

/**
 * The postcard push (handoff 2.5 & 3.4, PR 3): "Leo made your Sunday Chili" / "Sent you a postcard.",
 * to the dish's cook, opening their Home. Never "He sent you…" (no pronoun data). Here, next to the
 * started push, so PR 3's route in index.ts reuses the dish rule instead of rebuilding the copy.
 */
export function postcardPush(kidName: string, dish: { title: string; cook_name: string | null } | null): PushCopy {
  return {
    kind: "postcard",
    title: truncate(`${named(kidName)} made your ${dishName(dish?.title, dish?.cook_name)}`),
    body: "Sent you a postcard.",
    url: "/parent/home",
  };
}

/** One postcard push per cooked message, however often the photo is re-sent. */
export const postcardKey = (messageId: string) => `postcard:${messageId}`;

// ---------------------------------------------------------------------------------------------
// Reactions (pure): what a reaction message may be, and who it pushes.

export const REACTIONS = ["heart", "just_like_mine"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is Reaction => typeof v === "string" && (REACTIONS as readonly string[]).includes(v);

/** The message a reaction answers (its reply_to), as far as the push rule needs it. */
export type ReactionTarget = { id: string; kind: string; sender_id: string };

/**
 * Who a just-sent reaction pushes, with what copy and dedupe key (handoff 2.5):
 * - a heart never pushes, mid-cook or anywhere else (the kid is in the app; hearts are in-app only);
 * - "Just like mine" pushes the kid whose dish it answers ("Mom" / "“Just like mine.” on your Sunday
 *   Chili", opening the chat), once per dish message, and only when it answers a `cooked` message
 *   someone other than the sender made.
 * Anything else is null. index.ts's message push can call this for kind 'reaction'.
 */
export function reactionPush(
  reaction: { body: string | null; thread_id: string; reply_to: string | null },
  sender: { id: string; name: string },
  answered: ReactionTarget | null,
  dish: string | null,
): { to: string; copy: PushCopy; dedupeKey: string } | null {
  if (reaction.body !== "just_like_mine") return null;
  if (!answered || answered.id !== reaction.reply_to || answered.kind !== "cooked") return null;
  if (answered.sender_id === sender.id) return null;
  const copy = messagePush({ kind: "reaction", body: reaction.body, thread_id: reaction.thread_id }, sender.name, dish);
  if (!copy) return null;
  return { to: answered.sender_id, copy, dedupeKey: `reaction:${answered.id}:just_like_mine` };
}

// ---------------------------------------------------------------------------------------------
// Routes

export type CookingConsent = "yes" | "no" | "unasked";
/** null = not asked yet (read as no), true = yes, false = never. */
export const consentOf = (share: unknown): CookingConsent => (share === true ? "yes" : share === false ? "no" : "unasked");

export type CookingStart = {
  ok: true;
  /** true when the row was written (the kid said yes); false: nothing was stored or sent. */
  shared: boolean;
  /** 'unasked' tells the app to ask the consent question once. Always 'no' for a memorial cook. */
  consent: CookingConsent;
  /** Set (true) for a memorial cook's dish: nothing is stored or sent, and nothing is asked. */
  memorial?: true;
  /** The session's start (server clock), for "a heart newer than the session start"; null unless shared. */
  started_at: string | null;
  /** true for the first call of a session (the one that logs 'started' and pushes the cook). */
  new_session: boolean;
};

/** One row of GET /cooking: a kid in cook mode on one of my dishes. */
export type LiveCooking = {
  profile: { id: string; name: string; role: string; relation: string | null; avatar_key: string | null };
  recipe_id: string;
  cook_id: string;
  step: number;
  total: number;
  started_at: string;
  updated_at: string;
};

/** index.ts's ProfileRow and Ctx fit these as they are (RetentionProfile carries relation & avatar_key). */
export type CookingProfile = RetentionProfile;
export type CookingCtx = RetentionCtx;

type DbError = { code?: string; message?: string } | null;
export type CookingDeps<C extends CookingCtx> = {
  db: SupabaseClient;
  HttpError: HttpErrorCtor;
  requireMe: (ctx: C) => { id: string; name: string };
  rateLimit: (kind: string, value: string, max: number, windowMin: number, message?: string) => Promise<void>;
  dbFail: (context: string, error: DbError) => never;
  /** makePlumbing().notify (wired by makeRetention): caps, dedupe, the Expo sender. Called after the response. */
  notify: (profileId: string, p: PushInput) => Promise<NotifyResult>;
  /** library.recipeInfo (makeLibrary): the dish's title & cook (push copy, whose dish); null when unknown. */
  library: { recipeInfo(id: string): Promise<{ title: string; cook_name: string | null } | null> };
  /** index.ts's assertRecipe (cached HEAD of recipe.json). Checked once per session, not per step. */
  assertRecipe?: (recipeId: string) => Promise<void>;
  /** The clock (tests). */
  now?: () => Date;
  /** Where the push runs; runInBackground by default (never awaited by the request). */
  background?: (task: Promise<unknown>) => void;
};

type Body = () => Promise<Record<string, unknown>>;
type Args<C> = { req: Request; ctx: C; body: Body };

type CookingRow = {
  profile_id: string;
  family_id: string;
  recipe_id: string;
  cook_id: string | null;
  step: number;
  total: number;
  started_at: string;
  updated_at: string;
};
const COOKING_COLS = "profile_id, family_id, recipe_id, cook_id, step, total, started_at, updated_at";

export function makeCooking<C extends CookingCtx>(deps: CookingDeps<C>) {
  const { db, HttpError, requireMe, rateLimit, dbFail } = deps;
  const clock = deps.now ?? (() => new Date());
  const background = deps.background ?? runInBackground;

  const bad = (message: string): never => {
    throw new HttpError(400, message);
  };

  function parseRecipe(v: unknown, required: boolean): string | null {
    if (v === undefined || v === null || v === "") return required ? bad("recipe_id is required") : null;
    if (typeof v !== "string" || !RECIPE_ID.test(v.trim())) return bad("recipe_id is not a valid recipe id");
    return v.trim();
  }

  function whole(v: unknown, field: string): number {
    if (v === undefined || v === null) return bad(`${field} is required`);
    if (typeof v !== "number" || !Number.isInteger(v)) return bad(`${field} must be a whole number`);
    if (v < 1 || v > MAX_STEPS) return bad(`${field} must be between 1 and ${MAX_STEPS}`);
    return v;
  }

  /** The dish's cook: a cook in the family now, and not me. */
  function parseCook(ctx: C, meId: string, v: unknown): CookingProfile {
    const id = typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
    if (id && id === meId) return bad("cook_id must be someone else in your family");
    const cook = id ? ctx.profiles.find((p) => p.id === id && !p.removed_at) : undefined;
    if (!cook || cook.role !== "cook") return bad("cook_id must be a cook in your family");
    return cook;
  }

  async function myShare(meId: string): Promise<{ share_cooking: boolean | null; tz: string | null }> {
    const { data, error } = await db.from("profiles").select("share_cooking, tz").eq("id", meId).maybeSingle();
    if (error) dbFail("share cooking", error);
    return { share_cooking: (data?.share_cooking ?? null) as boolean | null, tz: (data?.tz ?? null) as string | null };
  }

  /** My answer & zone, and whether the cook is a memorial profile (ctx.profiles has no memorial). One select. */
  async function shareAndCook(meId: string, cookId: string) {
    const { data, error } = await db.from("profiles").select("id, share_cooking, tz, memorial").in("id", [meId, cookId]);
    if (error) dbFail("share cooking", error);
    type Row = { id: string; share_cooking: boolean | null; tz: string | null; memorial: boolean | null };
    const rows = (data ?? []) as Row[];
    const mine = rows.find((r) => r.id === meId);
    return {
      share_cooking: mine?.share_cooking ?? null,
      tz: mine?.tz ?? null,
      cookMemorial: rows.find((r) => r.id === cookId)?.memorial === true,
    };
  }

  async function endMine(meId: string, recipeId: string | null) {
    let q = db.from("cooking_now").delete().eq("profile_id", meId);
    if (recipeId) q = q.eq("recipe_id", recipeId);
    const { error } = await q;
    if (error) dbFail("cooking end", error);
  }

  // POST /cooking {recipe_id, cook_id, step, total}. Every step change (the app debounces 2 s).
  async function start({ ctx, body }: Args<C>): Promise<CookingStart> {
    const me = requireMe(ctx);
    const b = await body();
    const rid = parseRecipe(b.recipe_id, true)!;
    const cook = parseCook(ctx, me.id, b.cook_id);
    const step = whole(b.step, "step");
    const total = whole(b.total, "total");
    if (step > total) bad("step must be at most total");
    // A step every 15 s for an hour, with room to spare.
    await rateLimit("cooking", me.id, 240, 60);

    const mine = await shareAndCook(me.id, cook.id);
    // Memorial first: never 'unasked' for them (see the header).
    if (mine.cookMemorial) return { ok: true, shared: false, consent: "no", memorial: true, started_at: null, new_session: false };
    const consent = consentOf(mine.share_cooking);
    if (consent !== "yes") return { ok: true, shared: false, consent, started_at: null, new_session: false };

    const now = clock();
    const nowIso = now.toISOString();
    const { data: rows, error } = await db.from("cooking_now").select(COOKING_COLS).eq("profile_id", me.id).limit(1);
    if (error) dbFail("cooking", error);
    const live = (rows?.[0] ?? null) as CookingRow | null;
    // A step never touches cook_id: the row keeps the cook checked when the session started.
    const move = { step, total, updated_at: nowIso };

    // The same dish & cook, still fresh: just the step.
    if (
      live && live.recipe_id === rid && live.cook_id === cook.id &&
      now.getTime() - Date.parse(live.updated_at) < COOKING_FRESH_MS
    ) {
      const up = await db.from("cooking_now").update(move).eq("profile_id", me.id);
      if (up.error) dbFail("cooking step", up.error);
      return { ok: true, shared: true, consent, started_at: isoOf(live.started_at), new_session: false };
    }

    // A new session: no row, a stale one, another dish, or another cook named for this dish (checked
    // again below, so a step can't hand Mom's dish to Dad).
    if (deps.assertRecipe) await deps.assertRecipe(rid);
    // The dish must be this cook's (cached recipe.json; null when the bucket can't be reached).
    const dish = await deps.library.recipeInfo(rid).catch(() => null);
    if (dish?.cook_name && norm(dish.cook_name) !== norm(cook.name)) bad("cook_id must be the dish's cook");
    if (live) {
      const del = await db.from("cooking_now").delete().eq("profile_id", me.id);
      if (del.error) dbFail("cooking replace", del.error);
    }
    const ins = await db.from("cooking_now").insert({
      profile_id: me.id,
      family_id: ctx.family.id,
      recipe_id: rid,
      cook_id: cook.id,
      started_at: nowIso,
      ...move,
    });
    if (ins.error?.code === "23505") {
      // A racing first call already started it: this one is just a step.
      const up = await db.from("cooking_now").update(move).eq("profile_id", me.id);
      if (up.error) dbFail("cooking step", up.error);
      const { data: again } = await db.from("cooking_now").select("started_at").eq("profile_id", me.id).limit(1);
      const raced = again?.[0]?.started_at as string | undefined;
      return { ok: true, shared: true, consent, started_at: raced ? isoOf(raced) : nowIso, new_session: false };
    }
    if (ins.error) dbFail("cooking start", ins.error);

    // Best effort: a failed event must not fail the request, or the app's retry would see a fresh
    // row and the push would never go.
    const ev = await db.from("recipe_events").insert({
      family_id: ctx.family.id,
      profile_id: me.id,
      recipe_id: rid,
      kind: "started",
      cook_id: cook.id,
    });
    if (ev.error) console.error("started event:", ev.error.code, ev.error.message);

    const dedupeKey = startedKey(me.id, rid, now, mine.tz);
    background((async () => {
      await deps.notify(cook.id, { ...startedPush(me.name, dish, step, total), appInitiated: false, dedupeKey });
    })());
    return { ok: true, shared: true, consent, started_at: nowIso, new_session: true };
  }

  // POST /cooking/end {recipe_id?}: "I made it", leaving cook mode, or 45 min idle. With a recipe_id
  // it ends only that dish's session (a late end from the last dish never ends the next one).
  async function end({ ctx, body }: Args<C>) {
    const me = requireMe(ctx);
    const b = await body();
    await endMine(me.id, parseRecipe(b.recipe_id, false));
    return { ok: true };
  }

  // GET /cooking: kids cooking my dishes right now, newest step first. Only people in the family
  // now, only fresh rows, only kids who said yes.
  async function live({ ctx }: Args<C>): Promise<LiveCooking[]> {
    const me = requireMe(ctx);
    const since = new Date(clock().getTime() - COOKING_FRESH_MS).toISOString();
    const { data, error } = await db.from("cooking_now").select(COOKING_COLS)
      .eq("family_id", ctx.family.id).eq("cook_id", me.id).gt("updated_at", since)
      .order("updated_at", { ascending: false }).limit(50);
    if (error) dbFail("cooking now", error);
    const rows = ((data ?? []) as CookingRow[]).filter((r) => r.profile_id !== me.id);
    const kids = new Map(ctx.profiles.filter((p) => !p.removed_at).map((p) => [p.id, p]));
    const ids = [...new Set(rows.map((r) => r.profile_id).filter((id) => kids.has(id)))];
    if (!ids.length) return [];
    const { data: shares, error: sErr } = await db.from("profiles").select("id, share_cooking").in("id", ids);
    if (sErr) dbFail("cooking consent", sErr);
    const yes = new Set(((shares ?? []) as { id: string; share_cooking: boolean | null }[])
      .filter((s) => s.share_cooking === true).map((s) => s.id));
    return rows
      .filter((r) => yes.has(r.profile_id))
      .map((r) => {
        const p = kids.get(r.profile_id)!;
        return {
          profile: { id: p.id, name: p.name, role: p.role, relation: p.relation ?? null, avatar_key: p.avatar_key ?? null },
          recipe_id: r.recipe_id,
          cook_id: me.id,
          step: r.step,
          total: r.total,
          started_at: isoOf(r.started_at),
          updated_at: isoOf(r.updated_at),
        };
      });
  }

  // GET /profile/share-cooking: my answer (null = not asked yet), for a settings toggle.
  async function getShare({ ctx }: Args<C>) {
    const me = requireMe(ctx);
    return { share_cooking: (await myShare(me.id)).share_cooking };
  }

  // POST /profile/share-cooking {share: boolean}: the consent answer ("Yes" / "Not now"), or a later
  // change. No also ends my live session at once, so the cook's row goes on the next poll.
  async function setShare({ ctx, body }: Args<C>) {
    const me = requireMe(ctx);
    const b = await body();
    if (typeof b.share !== "boolean") bad("share must be true or false");
    const share = b.share as boolean;
    await rateLimit("share-cooking", me.id, 30, 60);
    const { error } = await db.from("profiles").update({ share_cooking: share }).eq("id", me.id).eq("family_id", ctx.family.id);
    if (error) dbFail("share cooking", error);
    if (!share) await endMine(me.id, null);
    return { ok: true, share_cooking: share };
  }

  return {
    start,
    end,
    live,
    getShare,
    setShare,
    routes: [
      { method: "POST", path: "/cooking", handler: start, auth: {} },
      { method: "POST", path: "/cooking/end", handler: end, auth: {} },
      { method: "GET", path: "/cooking", handler: live, auth: {} },
      { method: "GET", path: "/profile/share-cooking", handler: getShare, auth: {} },
      { method: "POST", path: "/profile/share-cooking", handler: setShare, auth: {} },
    ],
  };
}
