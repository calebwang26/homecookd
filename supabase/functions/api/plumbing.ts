// Retention plumbing for the api function (docs/build/RETENTION-HANDOFF.md section 2, PR 1): the caps
// on pushes homecookd sends on its own, the Expo push sender, push copy for new messages, `notify()`,
// the routes for push tokens and the hourly cron, and what the later routes read (the family with tz
// & memorial, the library, the /dish-stats shape, the recipe-event kinds). Wiring steps:
// docs/build/RETENTION-WIRING.md.
//
// Where it sits (no import cycles; supabase/tests/retention_wiring_test.ts checks the graph):
//   time.ts                      imports nothing
//   table.ts, recap.ts           import time.ts
//   plumbing.ts (this file)      imports time.ts (+ types from table.ts & recap.ts)
//   cooking.ts, hearts.ts,       import this file (+ time / table / recap), never retention.ts
//   tablePr.ts, recapPr.ts
//   retention.ts                 imports all of the above: re-exports them and composes their routes
//                                and cron jobs in one makeRetention(deps)
//   index.ts                     imports retention.ts only
//
// This file never imports index.ts. Whatever it needs from there (the service-role client,
// HttpError, requireMe, rateLimit, dbFail, clientIp) comes in through `makePlumbing(deps)`, which
// retention.ts's makeRetention() calls; index.ts never calls makePlumbing() itself.
//
// Rules that hold here (handoff section 5):
// - Push copy only ever quotes what someone actually sent. Nothing is said in the cook's voice.
// - Copy never assumes anyone's gender and uses no guilt words.
// - Caps & quiet hours apply only to pushes homecookd sends on its own (`appInitiated`). A push
//   caused by a person (a message, a recipe) is never capped, but its dedupe key still stops doubles.
// - A push must never fail or slow the request that caused it: notify() never throws, and callers
//   hand it to runInBackground().
//
// Tables (supabase/migrations/20261018100000_retention_plumbing.sql): push_tokens, notification_log,
// cooking_now, profiles.tz / share_cooking / memorial, recipe_events.cook_id / duration_s /
// clip_start_s, messages 'reaction' / photo_path / rating. The hourly call and its secret:
// 20261018100100_retention_cron.sql.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  inQuietHours,
  localDateKey,
  localParts,
  monthStartUtc,
  NUDGE_AT,
  RECAP_AT,
  validTz,
  weekStartUtc,
  zoneOf,
} from "./time.ts";
import type { RecipeInfo } from "./recap.ts";
import type { NudgeRecipe } from "./table.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------------------------
// Caps (guardrail 3). Pure, so every branch is unit-tested.

export type CapRole = "cook" | "learner";
/** notification_log.skipped_reason (its check lists exactly these). */
export const CAP_REASONS = ["quiet", "daily", "weekly", "monthly"] as const;
export type CapReason = (typeof CAP_REASONS)[number];
export type CapInput = {
  role: CapRole;
  appInitiated: boolean;
  now: Date;
  tz: string;
  /** This person's recent pushes that were really sent (skipped ones left out). */
  recent: { sent_at: string; app_initiated: boolean }[];
};

/** Kid: 1 a local day & 3 a local week (Mon-Sun). Cook: 1 a local month. Duolingo-style sign-off to raise. */
export const CAPS = { learnerPerDay: 1, learnerPerWeek: 3, cookPerMonth: 1 } as const;

export function capCheck(i: CapInput): { ok: true } | { ok: false; reason: CapReason } {
  if (!i.appInitiated) return { ok: true };
  const tz = zoneOf(i.tz);
  if (inQuietHours(i.now, tz)) return { ok: false, reason: "quiet" };
  const times = i.recent
    .filter((r) => r.app_initiated)
    .map((r) => Date.parse(r.sent_at))
    .filter((t) => Number.isFinite(t))
    .map((t) => new Date(t));
  if (i.role === "learner") {
    const today = localDateKey(i.now, tz);
    if (times.filter((t) => localDateKey(t, tz) === today).length >= CAPS.learnerPerDay) {
      return { ok: false, reason: "daily" };
    }
    const week = weekStartUtc(i.now, tz).getTime();
    if (times.filter((t) => weekStartUtc(t, tz).getTime() === week).length >= CAPS.learnerPerWeek) {
      return { ok: false, reason: "weekly" };
    }
    return { ok: true };
  }
  const month = monthStartUtc(i.now, tz).getTime();
  if (times.filter((t) => monthStartUtc(t, tz).getTime() === month).length >= CAPS.cookPerMonth) {
    return { ok: false, reason: "monthly" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Expo push sender. One message per token (so tickets map back by index), batches of <= 100.

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_BATCH = 100;

export type ExpoMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
  channelId?: string;
  ttl?: number;
};
export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string; expoPushToken?: string } };
export type SendOpts = {
  fetch?: typeof fetch;
  /** Only needed if Enhanced Push Security is turned on for the Expo project. */
  accessToken?: string | null;
  /** Per batch; 0 = no timeout (tests). */
  timeoutMs?: number;
};

/**
 * Sends and returns one ticket per message, in order, plus the tokens Expo says are no longer
 * registered (delete them). Never throws: a failed batch becomes error tickets and a log line.
 * TODO: Expo reports most DeviceNotRegistered errors in receipts (~15 min later), not tickets;
 * checking receipts from the hourly cron would prune the rest.
 */
export async function sendExpoPush(
  messages: ExpoMessage[],
  opts: SendOpts = {},
): Promise<{ tickets: ExpoTicket[]; deadTokens: string[] }> {
  const doFetch = opts.fetch ?? fetch;
  const tickets: ExpoTicket[] = [];
  const dead = new Set<string>();
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    const failAll = (message: string) => batch.forEach(() => tickets.push({ status: "error", message }));
    try {
      const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
      if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`;
      const timeout = opts.timeoutMs ?? 5000;
      const res = await doFetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
        signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
      });
      const out = (await res.json().catch(() => null)) as { data?: unknown; errors?: { code?: string }[] } | null;
      if (!res.ok || !Array.isArray(out?.data)) {
        console.error("push send failed:", res.status, (out?.errors ?? []).map((e) => e.code).join(","));
        failAll(`HTTP ${res.status}`);
        continue;
      }
      const data = out.data as ExpoTicket[];
      batch.forEach((m, k) => {
        const t = data[k];
        if (!t || typeof t !== "object") {
          tickets.push({ status: "error", message: "No ticket" });
          return;
        }
        tickets.push(t);
        if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.add(m.to);
      });
    } catch (e) {
      console.error("push send error:", String(e));
      failAll(String(e));
    }
  }
  return { tickets, deadTokens: [...dead] };
}

// ---------------------------------------------------------------------------------------------
// Push copy for new messages (handoff 2.5 rows 1-4, plus the "Just like mine" stamp). Pure. The
// server resolves the dish name; null when it can't. `url` is an app path the tap opens.

/** notification_log.kind (its check lists exactly these, in this order). */
export const PUSH_KINDS = ["message", "question", "recipe", "started", "postcard", "reaction", "table_nudge", "recap"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushCopy = { kind: PushKind; title: string; body: string; url: string };

/** The fields of a stored message the copy needs. */
export type MessageLike = {
  kind: string;
  thread_id: string;
  body?: string | null;
  recipe_id?: string | null;
  step_order?: number | null;
  duration_s?: number | string | null;
  audio_path?: string | null;
  audio_url?: string | null;
};

export const PUSH_TEXT_MAX = 90;

/** One line, at most `max` characters, ending in "…" when cut. Never splits an emoji. */
export function truncate(s: string, max = PUSH_TEXT_MAX): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/** 38 -> "0:38", 125 -> "2:05". */
export function mmss(seconds: number | string | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const chatUrl = (threadId: string) => `/chat/${threadId}`;
export const recipeUrl = (recipeId: string) => `/recipe/${recipeId}`;

const named = (s: string) => truncate(s, 40);
const isSpoken = (m: MessageLike) => !!(m.audio_path || m.audio_url);

/** A text or a "Will you teach me…" request: the sender's name, then their words. */
export function textPush(m: MessageLike, sender: string): PushCopy | null {
  const text = (m.body ?? "").trim();
  if (!text) return null;
  return { kind: "message", title: named(sender), body: truncate(text), url: chatUrl(m.thread_id) };
}

/** A voice note: "Sent a voice note · 0:38". A clip of a recipe's audio says which dish it's from. */
export function voicePush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  const len = mmss(m.duration_s);
  const body = m.audio_path || !m.audio_url
    ? `Sent a voice note · ${len}`
    : dish ? truncate(`Sent a clip from ${dish} · ${len}`) : `Sent a clip · ${len}`;
  return { kind: "message", title: named(sender), body, url: chatUrl(m.thread_id) };
}

/** A question (typed or spoken), or a step question: "Leo asked about Sunday Chili" / "Leo asked you". */
export function questionPush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  const text = (m.body ?? "").trim();
  const body = text
    ? truncate(text)
    : isSpoken(m) ? `Sent a voice question · ${mmss(m.duration_s)}` : "Sent a question";
  const title = dish ? truncate(`${named(sender)} asked about ${dish}`) : `${named(sender)} asked you`;
  return { kind: "question", title, body, url: chatUrl(m.thread_id) };
}

/** A recipe sent or published to someone: "Just in from Dad", then the dish. */
export function recipePush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  return {
    kind: "recipe",
    title: `Just in from ${named(sender)}`,
    body: dish ? truncate(dish) : "A new recipe",
    url: m.recipe_id ? recipeUrl(m.recipe_id) : chatUrl(m.thread_id),
  };
}

/**
 * The push for a message someone just sent, or null when that kind sends none (a dish someone
 * made, a system note, a heart; the postcard push comes with PR 3). Callers pick the recipients
 * (never the sender).
 */
export function messagePush(m: MessageLike, sender: string, dish: string | null): PushCopy | null {
  switch (m.kind) {
    case "text":
    case "request":
      return textPush(m, sender);
    case "voice":
      return voicePush(m, sender, dish);
    case "question":
      return questionPush(m, sender, dish);
    case "step": {
      // A learner's step message with words is a step question; without, it just shares the step.
      if ((m.body ?? "").trim() || isSpoken(m)) return questionPush(m, sender, dish);
      const step = m.step_order ? `step ${m.step_order}` : "a step";
      return {
        kind: "message",
        title: named(sender),
        body: truncate(dish ? `Sent ${step} of ${dish}` : `Sent ${step}`),
        url: chatUrl(m.thread_id),
      };
    }
    case "recipe":
      return recipePush(m, sender, dish);
    case "reaction":
      // Hearts are in-app only (handoff 2.5). "Just like mine" answers a dish someone made.
      if (m.body !== "just_like_mine") return null;
      return {
        kind: "reaction",
        title: named(sender),
        body: dish ? truncate(`“Just like mine.” on your ${dish}`) : "“Just like mine.”",
        url: chatUrl(m.thread_id),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Background work. The edge runtime keeps the isolate alive for EdgeRuntime.waitUntil promises;
// plain Deno (tests) has no EdgeRuntime, so those are tracked and awaitable instead.

const pending = new Set<Promise<void>>();

/** Run `task` after the response without ever failing the request. */
export function runInBackground(task: Promise<unknown>): void {
  const safe = task.then(() => {}, (e) => console.error("background task failed:", String(e)));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === "function") {
    rt.waitUntil(safe);
    return;
  }
  pending.add(safe);
  safe.finally(() => pending.delete(safe));
}

/** Resolves once every tracked background task has finished (tests). */
export async function backgroundIdle(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

// ---------------------------------------------------------------------------------------------
// notify(): the one way a push goes out.

export type PushInput = {
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  /** true = homecookd sent it on its own (a nudge, a recap): capped, and skipped in quiet hours. */
  appInitiated: boolean;
  /** Same (person, key) twice = the second is skipped, e.g. 'started:<kid>:<recipe>:<yyyy-mm-dd>'. */
  dedupeKey?: string | null;
  /** For quote rotation, e.g. '<recipe_id>#step-3'. */
  quoteKey?: string | null;
};
export type NotifyDeps = {
  db: SupabaseClient;
  fetch?: typeof fetch;
  expoAccessToken?: string | null;
  /** Override the clock (the cron's `now`, tests). */
  now?: Date;
};
/**
 * sent: logged and Expo took it for at least one phone. failed: logged, but every phone's ticket
 * was an error. none: no live phone has push on. skipped: removed, memorial or unknown person.
 * dup: already sent under that dedupe key. quiet/daily/weekly/monthly: capped (logged as skipped).
 * error: something broke (logged to the console).
 */
export type NotifyResult = "sent" | "failed" | "none" | "skipped" | "dup" | CapReason | "error";

type TokenRow = { token: string; device_id: string | null };
type DbError = { code?: string; message?: string } | null;

const fail = (context: string, error: DbError): never => {
  throw new Error(`${context}: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
};

/** This person's tokens, minus (and deleting) any on a phone that was signed out. */
async function liveTokens(db: SupabaseClient, profileId: string): Promise<TokenRow[]> {
  const { data, error } = await db.from("push_tokens").select("token, device_id").eq("profile_id", profileId);
  if (error) fail("push tokens", error);
  const rows = (data ?? []) as TokenRow[];
  const deviceIds = [...new Set(rows.map((r) => r.device_id).filter((d): d is string => !!d))];
  if (!deviceIds.length) return rows;
  const { data: devs, error: dErr } = await db.from("devices").select("id, revoked_at").in("id", deviceIds);
  if (dErr) fail("push devices", dErr);
  const live = new Set(((devs ?? []) as { id: string; revoked_at: string | null }[])
    .filter((d) => !d.revoked_at).map((d) => d.id));
  const stale = rows.filter((r) => r.device_id && !live.has(r.device_id)).map((r) => r.token);
  if (stale.length) {
    const del = await db.from("push_tokens").delete().in("token", stale);
    if (del.error) console.error("prune signed-out push tokens:", del.error.message);
  }
  return rows.filter((r) => !stale.includes(r.token));
}

/** Insert a log row; 'dup' when the (profile, dedupe key) pair is already there. */
async function logPush(db: SupabaseClient, row: Record<string, unknown>): Promise<"ok" | "dup"> {
  const { error } = await db.from("notification_log").insert(row);
  if (!error) return "ok";
  if (error.code === "23505") return "dup";
  return fail("notification log", error);
}

/**
 * Send `p` to every live phone of `profileId`: skip removed & memorial people and phones that
 * were signed out, check the caps for app-initiated pushes, log it (the unique (profile_id,
 * dedupe_key) stops doubles), send, and delete tokens Expo no longer knows. Never throws.
 */
export async function notify(deps: NotifyDeps, profileId: string, p: PushInput): Promise<NotifyResult> {
  try {
    return await notifyOnce(deps, profileId, p);
  } catch (e) {
    console.error(`notify (${p.kind}):`, String(e));
    return "error";
  }
}

async function notifyOnce(deps: NotifyDeps, profileId: string, p: PushInput): Promise<NotifyResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const { data: who, error } = await db.from("profiles")
    .select("id, family_id, role, tz, memorial, removed_at").eq("id", profileId).maybeSingle();
  if (error) fail("notify profile", error);
  if (!who || who.removed_at || who.memorial) return "skipped";

  const tokens = await liveTokens(db, profileId);
  if (!tokens.length) return "none";

  const dedupeKey = p.dedupeKey ?? null;
  if (dedupeKey) {
    const { data: seen, error: sErr } = await db.from("notification_log").select("id")
      .eq("profile_id", profileId).eq("dedupe_key", dedupeKey).limit(1);
    if (sErr) fail("notify dedupe", sErr);
    if (seen?.length) return "dup";
  }

  const row = {
    family_id: who.family_id,
    profile_id: profileId,
    kind: p.kind,
    app_initiated: p.appInitiated,
    dedupe_key: dedupeKey,
    quote_key: p.quoteKey ?? null,
    sent_at: now.toISOString(),
  };

  if (p.appInitiated) {
    // 40 days covers the longest window (a local calendar month) with room for DST.
    const { data: recent, error: rErr } = await db.from("notification_log").select("sent_at, app_initiated")
      .eq("profile_id", profileId).eq("app_initiated", true).is("skipped_reason", null)
      .gt("sent_at", new Date(now.getTime() - 40 * DAY).toISOString())
      .order("sent_at", { ascending: false }).limit(50);
    if (rErr) fail("notify caps", rErr);
    const verdict = capCheck({
      role: who.role === "cook" ? "cook" : "learner",
      appInitiated: true,
      now,
      tz: zoneOf(who.tz),
      recent: (recent ?? []) as CapInput["recent"],
    });
    if (!verdict.ok) {
      const logged = await logPush(db, { ...row, skipped_reason: verdict.reason });
      if (logged === "dup") return "dup";
      console.log(`push skipped (${p.kind}): ${verdict.reason}`);
      return verdict.reason;
    }
  }

  if ((await logPush(db, row)) === "dup") return "dup";

  const { tickets, deadTokens } = await sendExpoPush(
    tokens.map((t) => ({
      to: t.token,
      title: p.title,
      body: p.body,
      // profile_id: on a shared phone the tap must not open someone else's chat.
      data: { url: p.url, kind: p.kind, profile_id: profileId },
      sound: "default",
      priority: "high",
      channelId: "default",
    })),
    { fetch: deps.fetch, accessToken: deps.expoAccessToken },
  );
  if (deadTokens.length) {
    const del = await db.from("push_tokens").delete().in("token", deadTokens).eq("profile_id", profileId);
    if (del.error) console.error("prune dead push tokens:", del.error.message);
  }
  return tickets.some((t) => t.status === "ok") ? "sent" : "failed";
}

// ---------------------------------------------------------------------------------------------
// x-tz: the app sends its zone on every call; the acting person's profile keeps it.

const tzSeen = new Map<string, string>();

/** Store a valid `x-tz` on the profile, at most once per isolate per change. Never throws. */
export async function syncTz(db: SupabaseClient, profileId: string | null | undefined, header: string | null): Promise<void> {
  try {
    const tz = validTz(header);
    if (!profileId || !tz || tzSeen.get(profileId) === tz) return;
    const { error } = await db.from("profiles").update({ tz }).eq("id", profileId);
    if (error) console.error("store tz:", error.message);
    else tzSeen.set(profileId, tz);
  } catch (e) {
    console.error("store tz:", String(e));
  }
}

// ---------------------------------------------------------------------------------------------
// What the later routes read (PR 2-6): the recipe-event kinds, the family with tz & memorial, the
// library (dish -> title, cook, sample, step quotes) and the /dish-stats shape. table.ts & recap.ts
// take these as they are.

/**
 * recipe_events kinds (recipe_events_kind_check, 20261018100000_retention_plumbing.sql). index.ts's
 * POST /events takes all four; the stats the app already shows (/me/recipe-stats,
 * /recipes/:id/activity) count STAT_EVENT_KINDS only, or 'heard' & 'started' rows push cooks out of
 * their row caps. Every query on recipe_events names its kinds.
 */
export const RECIPE_EVENT_KINDS = ["viewed", "cooked", "started", "heard"] as const;
export type RecipeEventKind = (typeof RECIPE_EVENT_KINDS)[number];
export const STAT_EVENT_KINDS = ["viewed", "cooked"] as const satisfies readonly RecipeEventKind[];
/** A 'heard' event is a play of a cook's voice of at least this many seconds (the app, POST /events, table_activity). */
export const HEARD_MIN_S = 3;

/**
 * A family member with the columns the retention features need. index.ts's ctx.profiles come from
 * authenticate(), whose select has no tz or memorial (and the QA branches edit that line), so a route
 * that needs them loads the family again with familyProfiles(). Fits table.ts's TableProfile,
 * recap.ts's RecapProfile and the cron's CronProfile as it is.
 */
export type FamilyProfile = {
  id: string;
  family_id: string;
  name: string;
  role: "cook" | "learner";
  tz: string | null;
  memorial: boolean;
  removed_at: string | null;
};
export const FAMILY_PROFILE_COLS = "id, family_id, name, role, tz, memorial, removed_at";

/** Everyone in one family, removed people included (table.ts & recap.ts leave them out themselves). */
export async function familyProfiles(db: SupabaseClient, familyId: string): Promise<FamilyProfile[]> {
  const { data, error } = await db.from("profiles").select(FAMILY_PROFILE_COLS).eq("family_id", familyId);
  if (error) fail("family profiles", error);
  return ((data ?? []) as FamilyProfile[]).map((p) => ({
    ...p,
    tz: p.tz ?? null,
    memorial: p.memorial === true,
    removed_at: p.removed_at ?? null,
  }));
}

/**
 * Who in this family is a memorial profile (guardrail 2), for GET /family's `memorial` flags. Its own
 * select, so authenticate()'s line and PROFILE_COLS stay as they are (a database without the column
 * fails only this, never the request). Throws on a database error; the caller leaves the flags out.
 */
export async function memorialIds(db: SupabaseClient, familyId: string): Promise<Set<string>> {
  const { data, error } = await db.from("profiles").select("id, memorial").eq("family_id", familyId);
  if (error) fail("memorial profiles", error);
  return new Set(((data ?? []) as { id: string; memorial: boolean | null }[]).filter((p) => p.memorial === true).map((p) => p.id));
}

/**
 * A dish as the server reads its recipe.json: title, whose it is, sample or not, and the cook's step
 * quotes verbatim. Fits table.ts's NudgeRecipe (pickNudgeQuote) as it is.
 */
export type RecipeDetails = NudgeRecipe & {
  id: string;
  title: string;
  cook_name: string | null;
  sample: boolean;
  steps: { order: number; quote: string | null }[];
};
export type Library = {
  /** library.json as id -> {title, cook_name, sample} (recap.ts's RecipeLookup). Empty Map = unreachable. */
  libraryIndex(): Promise<Map<string, RecipeInfo>>;
  /** One dish's recipe.json, or null when it's missing or the bucket is unreachable. */
  recipeInfo(id: string): Promise<RecipeDetails | null>;
};

const LIBRARY_TTL_MS = 10 * MINUTE;
const RECIPE_CACHE_MAX = 500;
const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The public bucket's library.json & recipe.json files, cached 10 min per isolate (the same bucket &
 * 10-minute rule as assertRecipe() and qa-chat's recipeCook(), which can wrap recipeInfo()). Never
 * throws; a failed fetch isn't cached, so the next call tries again.
 */
export function makeLibrary(
  { bucketUrl, fetch: doFetch = fetch, ttlMs = LIBRARY_TTL_MS, clock = Date.now }: {
    bucketUrl: string;
    fetch?: typeof fetch;
    ttlMs?: number;
    clock?: () => number;
  },
): Library {
  const base = bucketUrl.replace(/\/+$/, "");
  let index: { at: number; map: Map<string, RecipeInfo> } | null = null;
  const recipes = new Map<string, { at: number; value: RecipeDetails | null }>();

  const getJson = async (url: string): Promise<{ ok: true; body: unknown } | { ok: false; missing: boolean }> => {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, missing: res.status === 404 || res.status === 403 };
      }
      return { ok: true, body: await res.json() };
    } catch (e) {
      console.error("library fetch:", String(e));
      return { ok: false, missing: false };
    }
  };

  async function libraryIndex(): Promise<Map<string, RecipeInfo>> {
    if (index && clock() - index.at < ttlMs) return index.map;
    const got = await getJson(`${base}/library.json`);
    if (!got.ok || !Array.isArray(got.body)) return new Map();
    const map = new Map<string, RecipeInfo>();
    for (const e of got.body as Record<string, unknown>[]) {
      const id = str(e?.id);
      if (!id) continue;
      map.set(id, { title: str(e.title) ?? "", cook_name: str(e.cook_name), sample: e.sample === true });
    }
    index = { at: clock(), map };
    return map;
  }

  async function recipeInfo(id: string): Promise<RecipeDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) return null;
    const hit = recipes.get(id);
    if (hit && clock() - hit.at < ttlMs) return hit.value;
    const got = await getJson(`${base}/${id}/recipe.json`);
    if (!got.ok && !got.missing) return null; // unreachable: try again next time
    let value: RecipeDetails | null = null;
    if (got.ok && got.body && typeof got.body === "object") {
      const r = got.body as Record<string, unknown>;
      const cook = (r.cook ?? {}) as Record<string, unknown>;
      const steps = Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : [];
      value = {
        id,
        title: str(r.title) ?? "",
        cook_name: str(cook.name),
        sample: r.sample === true,
        steps: steps
          .filter((st) => Number.isFinite(Number(st?.order)))
          .map((st) => ({ order: Number(st.order), quote: str(st.quote) })),
      };
    }
    if (recipes.size >= RECIPE_CACHE_MAX) recipes.clear();
    recipes.set(id, { at: clock(), value });
    return value;
  }

  return { libraryIndex, recipeInfo };
}

/**
 * The ids of one person's dishes: library entries whose cook_name is their name, case-insensitively
 * (the app's cookProfile() rule). Samples included; callers that quote her words drop them.
 */
export function dishesOf(index: ReadonlyMap<string, RecipeInfo>, name: string | null | undefined): string[] {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return [];
  return [...index].filter(([, d]) => (d.cook_name ?? "").trim().toLowerCase() === n).map(([id]) => id);
}

/**
 * GET /dish-stats?ids=a,b (handoff 2.2), exactly: per dish, hearts & cooks from my family, me
 * excluded. app/src/lib/kitchenCounts.ts (cookMirror) reads `cooked.by[].profile_id/count`.
 */
export type DishStat = {
  hearts: { count: number; by: { profile_id: string; at: string }[] };
  cooked: { count: number; by: { profile_id: string; count: number; last_at: string }[] };
};
export type DishStats = Record<string, DishStat>;
/** GET /hearts/recent: new hearts on my dishes, newest first. */
export type HeartRecent = { profile_id: string; recipe_id: string; at: string };

/**
 * Builds DishStats from rows the route already limited to my family minus me (favorites by
 * profile_id, recipe_events kind 'cooked') and to `ids` (my dishes). Every id gets an entry, zeros
 * included (the app hides the zero parts). Newest first; ties by profile id, so it's stable.
 */
export function buildDishStats(
  ids: readonly string[],
  favorites: { profile_id: string; recipe_id: string; created_at: string }[],
  cooked: { profile_id: string; recipe_id: string; created_at: string }[],
): DishStats {
  const out: DishStats = {};
  for (const id of ids) out[id] = { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } };
  const newest = <T extends { profile_id: string }>(at: (x: T) => string) => (a: T, b: T) =>
    Date.parse(at(b)) - Date.parse(at(a)) || (a.profile_id < b.profile_id ? -1 : a.profile_id > b.profile_id ? 1 : 0);
  for (const f of favorites) {
    const s = out[f.recipe_id];
    if (!s || s.hearts.by.some((h) => h.profile_id === f.profile_id)) continue;
    s.hearts.by.push({ profile_id: f.profile_id, at: f.created_at });
  }
  for (const e of cooked) {
    const s = out[e.recipe_id];
    if (!s) continue;
    const who = s.cooked.by.find((c) => c.profile_id === e.profile_id);
    if (!who) s.cooked.by.push({ profile_id: e.profile_id, count: 1, last_at: e.created_at });
    else {
      who.count += 1;
      if (Date.parse(e.created_at) > Date.parse(who.last_at)) who.last_at = e.created_at;
    }
  }
  for (const s of Object.values(out)) {
    s.hearts.by.sort(newest((h) => h.at));
    s.hearts.count = s.hearts.by.length;
    s.cooked.by.sort(newest((c) => c.last_at));
    s.cooked.count = s.cooked.by.reduce((n, c) => n + c.count, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Push tokens

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** ExponentPushToken[...] or ExpoPushToken[...], as getExpoPushTokenAsync returns it. */
export function validPushToken(v: unknown): v is string {
  return typeof v === "string" && EXPO_TOKEN.test(v);
}

/** The body of POST /push-tokens, or the 400 to send back. */
export function parsePushToken(
  body: Record<string, unknown>,
): { ok: true; token: string; platform: Platform } | { ok: false; error: string } {
  const token = typeof body.token === "string" ? body.token.trim() : body.token;
  if (!validPushToken(token)) return { ok: false, error: "token must be an Expo push token" };
  if (!PLATFORMS.includes(body.platform as Platform)) return { ok: false, error: "platform must be ios or android" };
  return { ok: true, token, platform: body.platform as Platform };
}

// ---------------------------------------------------------------------------------------------
// The hourly cron: who is in their local target hour.

// NUDGE_AT & RECAP_AT (the local target hours) are in time.ts.

/** Who the cron considers: the same row familyProfiles() reads. */
export type CronProfile = FamilyProfile;
export type Due = { nudge: CronProfile[]; recap: CronProfile[] };

/** Learners in their local Sunday 17:xx (nudge) and anyone in their local 1st-of-month 10:xx (recap). */
export function dueProfiles(people: CronProfile[], now: Date): Due {
  const due: Due = { nudge: [], recap: [] };
  for (const p of people) {
    if (p.removed_at || p.memorial) continue;
    const at = localParts(now, zoneOf(p.tz));
    if (p.role === "learner" && at.weekday === NUDGE_AT.weekday && at.hour === NUDGE_AT.hour) due.nudge.push(p);
    if (at.day === RECAP_AT.day && at.hour === RECAP_AT.hour) due.recap.push(p);
  }
  return due;
}

// ---------------------------------------------------------------------------------------------
// Routes (makeRetention() in retention.ts tags them PR 1; index.ts registers them)

/**
 * The parts of index.ts's ProfileRow every retention module reads (index's has more). relation &
 * avatar_key are what GET /cooking shows of a kid; optional so a test ctx can leave them out.
 */
export type RetentionProfile = {
  id: string;
  family_id: string;
  name: string;
  role: "cook" | "learner";
  removed_at?: string | null;
  relation?: string | null;
  avatar_key?: string | null;
};
/** The parts of index.ts's Ctx every retention module reads (index's Ctx has more). */
export type RetentionCtx = {
  family: { id: string; name: string };
  profiles: RetentionProfile[];
  me: RetentionProfile | null;
  device: { id: string; profile_id: string | null } | null;
};
export type HttpErrorCtor = new (status: number, message: string, extra?: Record<string, unknown>) => Error;
/** What makePlumbing() needs from index.ts (retention.ts's RetentionDeps adds the later PRs' needs). */
export type PlumbingDeps<C extends RetentionCtx> = {
  db: SupabaseClient;
  HttpError: HttpErrorCtor;
  requireMe: (ctx: C) => { id: string };
  rateLimit: (kind: string, value: string, max: number, windowMin: number, message?: string) => Promise<void>;
  dbFail: (context: string, error: DbError) => never;
  clientIp: (req: Request) => string;
  fetch?: typeof fetch;
  expoAccessToken?: string | null;
};
type Body = () => Promise<Record<string, unknown>>;
/** What index.ts hands a signed-in handler (its Args has params too). Each handler reads a subset. */
export type RouteArgs<C> = { req: Request; ctx: C; url: URL; body: Body };
/** What index.ts hands a public handler. */
export type PublicRouteArgs = { req: Request; url: URL; body: Body };
type SignedInArgs<C> = Pick<RouteArgs<C>, "req" | "ctx" | "body">;
type PublicArgs = Pick<PublicRouteArgs, "req" | "body">;

/**
 * One hourly job (PR 5's Sunday nudge, PR 6's recap). Returns how many pushes it sent. `pr` is the
 * retention PR it belongs to (makeRetention() sets it when it registers the job).
 */
export type CronJob = {
  name: string;
  pr?: number;
  run: (job: { now: Date; due: Due; notify: (profileId: string, p: PushInput) => Promise<NotifyResult> }) => Promise<number>;
};

/**
 * PR 1's routes & the cron runner. Called by retention.ts's makeRetention(), which registers the later
 * PRs' cron jobs in `cronJobs` and tags every route with its PR; index.ts never calls this directly.
 */
export function makePlumbing<C extends RetentionCtx>(deps: PlumbingDeps<C>) {
  const { db, HttpError, requireMe, rateLimit, dbFail, clientIp } = deps;

  const send = (profileId: string, p: PushInput, now?: Date) =>
    notify({ db, fetch: deps.fetch, expoAccessToken: deps.expoAccessToken, now }, profileId, p);
  /** Fire a push after the response (the request never waits on Expo). */
  const notifyLater = (profileId: string, p: PushInput) => runInBackground(send(profileId, p));

  /**
   * Jobs the hourly cron runs, in order, each in its own try, so the handler never changes as PRs
   * land. retention.ts's makeRetention() registers them for the PRs that are on:
   * - PR 5: tablePr.ts's `table_nudge` (kids in their local Sunday 17:xx: `due.nudge`).
   * - PR 6: recapPr.ts's `recap`. It finds its people itself (the local 1st, 10:00 until quiet
   *   hours), so nothing acts on `due.recap` (10:xx only; still reported in the response).
   */
  const cronJobs: CronJob[] = [];

  // POST /push-tokens {token, platform} -> {ok}. Upserts, moving the token to this person & phone.
  async function registerToken({ ctx, body }: SignedInArgs<C>) {
    const parsed = parsePushToken(await body());
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    // The phone's own person, so Grandma acting on Mom's phone doesn't take Mom's pushes; a
    // family-code caller (no device) registers whoever it acts as.
    const owner = ctx.device?.profile_id ?? requireMe(ctx).id;
    await rateLimit("push-tokens", owner, 30, 60);
    const row = {
      family_id: ctx.family.id,
      profile_id: owner,
      device_id: ctx.device?.id ?? null,
      platform: parsed.platform,
      updated_at: new Date().toISOString(),
    };
    const move = async () => {
      const up = await db.from("push_tokens").update(row).eq("token", parsed.token);
      if (up.error) dbFail("move push token", up.error);
    };
    const { data: existing, error } = await db.from("push_tokens").select("token").eq("token", parsed.token).limit(1);
    if (error) dbFail("push token", error);
    if (existing?.length) {
      await move();
    } else {
      const ins = await db.from("push_tokens").insert({ token: parsed.token, ...row });
      if (ins.error?.code === "23505") await move(); // registered by a racing call
      else if (ins.error) dbFail("push token", ins.error);
    }
    return { ok: true };
  }

  // POST /push-tokens/remove {token} -> {ok}. Sign-out; only tokens in this family. Register with
  // auth {lenientMe: true}: it needs no acting person.
  async function removeToken({ ctx, body }: SignedInArgs<C>) {
    const b = await body();
    const token = typeof b.token === "string" ? b.token.trim() : b.token;
    if (!validPushToken(token)) throw new HttpError(400, "token must be an Expo push token");
    const { error } = await db.from("push_tokens").delete().eq("token", token).eq("family_id", ctx.family.id);
    if (error) dbFail("remove push token", error);
    return { ok: true };
  }

  /** Profiles with push on, read for the cron. TODO: page past PostgREST's 1000-row cap. */
  async function findDue(now: Date): Promise<Due> {
    const { data: tok, error } = await db.from("push_tokens").select("profile_id").limit(1000);
    if (error) dbFail("cron tokens", error);
    const ids = [...new Set(((tok ?? []) as { profile_id: string }[]).map((r) => r.profile_id))];
    const people: CronProfile[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: pErr } = await db.from("profiles")
        .select(FAMILY_PROFILE_COLS).in("id", ids.slice(i, i + 100));
      if (pErr) dbFail("cron profiles", pErr);
      people.push(...((data ?? []) as CronProfile[]));
    }
    return dueProfiles(people, now);
  }

  // POST /cron/hourly (public; pg_cron through pg_net, 20261018100100_retention_cron.sql). The
  // x-cron-secret is checked by the database (cron_secret_ok), where it was generated, so it is
  // never in git or the function's env. {now} overrides the clock for tests, only with the secret.
  async function cronHourly({ req, body }: PublicArgs) {
    const secret = req.headers.get("x-cron-secret") ?? "";
    let ok = false;
    if (secret && secret.length <= 256) {
      const { data, error } = await db.rpc("cron_secret_ok", { p_secret: secret });
      if (error) dbFail("cron secret", error);
      ok = data === true;
    }
    if (!ok) {
      await rateLimit("badcron", clientIp(req), 20, 10);
      throw new HttpError(401, "Not allowed");
    }
    const b = await body();
    let now = new Date();
    if (b.now !== undefined && b.now !== null) {
      const t = typeof b.now === "string" ? Date.parse(b.now) : NaN;
      if (!Number.isFinite(t)) throw new HttpError(400, "now must be an ISO time");
      now = new Date(t);
    }
    const due = await findDue(now);
    let sent = 0;
    const jobs: Record<string, number> = {};
    for (const job of cronJobs) {
      try {
        jobs[job.name] = await job.run({ now, due, notify: (id, p) => send(id, p, now) });
        sent += jobs[job.name];
      } catch (e) {
        console.error(`cron job ${job.name}:`, String(e));
        jobs[job.name] = 0;
      }
    }
    return { ok: true, due: { nudge: due.nudge.length, recap: due.recap.length }, sent, jobs };
  }

  return {
    notify: send,
    notifyLater,
    cronJobs,
    registerToken,
    removeToken,
    cronHourly,
    routes: [
      { method: "POST", path: "/push-tokens", handler: registerToken, auth: {} },
      { method: "POST", path: "/push-tokens/remove", handler: removeToken, auth: { lenientMe: true } },
    ],
    publicRoutes: [{ method: "POST", path: "/cron/hourly", handler: cronHourly }],
  };
}
