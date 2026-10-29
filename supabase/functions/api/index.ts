// homecookd API: one edge function for family profiles, sign-in (invite links, Apple, Google, and
// the older email / family-code paths), the family circle, messages, questions (circle and 1:1),
// recipe notes, voice notes, photos of a dish someone made, share links, sign-ups, pending sends, recipe activity, favorites,
// per-person recipe stats and the lander's visit log. Contract: docs/build/API.md.
//
// Auth: deployed with verify_jwt=false on purpose. The app has no Supabase users. Each phone has
// its own device key (`x-device-key`, 32 random bytes; only its sha256 is stored in `devices`), so
// one phone can be signed out without touching the others. Older builds, the pipeline and the web
// send the family code (`x-family-code`) instead. Both are looked up by sha256 in a unique index,
// so there is no string comparison to time. `x-profile-id` names the acting profile and must be
// someone still in that family. Someone with their own phone (a live key that is theirs) can only be
// acted as from that phone: anyone else gets 403 "<Name> uses their own phone.", reads included. A
// phone's person is set once: who signed in on it, who it added (POST /profiles/self), who it was let
// in as (an approved move request), or for a family-code swap the first phone-less person it writes
// as; it never moves on its own. A family-invite phone with no person writes as nobody ("Add
// yourself first."). The function uses the service role; all tables have RLS on with no policies,
// so client keys can read nothing directly.
//
// People are removed softly (`profiles.removed_at`), and only ever by themselves: they leave every
// list and their phones are signed out, but their old messages, 1:1 chats and recipe notes keep
// their name and face. Letting someone in on a new phone takes a settled member (a day in).
//
// Email sign-in (POST /auth/email, old builds only) hands a known email its family code, so the code
// is also kept AES-GCM encrypted in `families.code_enc` (key derived here from EDIBLE_CODE_KEY, else
// the service role key; AAD = family id). Families made before that column existed get it the next
// time any device calls with the plain code. A family join link's token is kept the same way in
// `join_links.token_enc` (its own derived key; AAD = the link's id), so POST /join-links can show the
// same link all week (joinLinks.ts).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from "npm:jose@5.9.6";
import {
  dishName,
  HEARD_MIN_S,
  isReaction,
  makeLibrary,
  makeRetention,
  memorialIds,
  messagePush,
  postcardKey,
  postcardPush,
  reactionPush,
  type RecapFamily,
  RECIPE_EVENT_KINDS,
  type RecipeEventKind,
  runInBackground,
  STAT_EVENT_KINDS,
  syncTz,
} from "./retention.ts";
import {
  familyJoinLink,
  hasLink,
  INVITE_GONE,
  type JoinDeps,
  JOIN_TOKEN,
  peekJoinLink,
  refuseJoinLinkAccept,
  revokeJoinLinks,
  signInByLink,
} from "./joinLinks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_URL = (Deno.env.get("EDIBLE_BUCKET_URL") ??
  "https://storage.googleapis.com/edible-media-379797517579").replace(/\/+$/, "");
const WEB_URL = (Deno.env.get("EDIBLE_WEB_URL") ?? "https://homecookd.app").replace(/\/+$/, "");
const VOICE_BUCKET = "voice";
const PHOTO_BUCKET = "photos";

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------------------------
// HTTP helpers

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "content-type, x-device-key, x-family-code, x-profile-id, x-tz, authorization, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

/** `extra` adds fields next to `error` in the JSON body (e.g. an invite's `status` on a 410). */
class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const MAX_BODY_BYTES = 64 * 1024;
const TOO_LARGE = "Request body is too large";

/** The body's bytes, refusing past `max` without buffering the rest (public routes take anyone's POST). */
async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new HttpError(413, TOO_LARGE);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, TOO_LARGE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readCapped(req, MAX_BODY_BYTES));
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function dbFail(context: string, error: { message?: string; code?: string } | null): never {
  console.error(`db error (${context}):`, error?.code, error?.message);
  throw new HttpError(500, "Something went wrong on our side. Please try again.");
}

// ---------------------------------------------------------------------------------------------
// Validation helpers

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const TOKEN = /^[0-9A-Za-z]{10}$/;
// Printable ASCII only, so JS toLowerCase() and Postgres lower() always agree (the DB check).
const EMAIL = /^[\x21-\x3f\x41-\x7e]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const VOICE_EXT: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};
const MAX_VOICE_S = 300;
const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_BODY_CHARS = 2000;
const MAX_NAME = 40;

function str(v: unknown, field: string, opts: { max: number; required?: boolean; min?: number }): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > opts.max) throw new HttpError(400, `${field} must be at most ${opts.max} characters`);
  if (opts.min && s.length < opts.min) throw new HttpError(400, `${field} must be at least ${opts.min} characters`);
  return s;
}

function num(v: unknown, field: string, opts: { min?: number; max?: number; int?: boolean; required?: boolean }) {
  if (v === undefined || v === null) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number`);
  if (opts.int && !Number.isInteger(v)) throw new HttpError(400, `${field} must be a whole number`);
  if (opts.min !== undefined && v < opts.min) throw new HttpError(400, `${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new HttpError(400, `${field} must be <= ${opts.max}`);
  return v;
}

function recipeId(v: unknown, field = "recipe_id", required = true): string | null {
  const s = str(v, field, { max: 100, required });
  if (s !== null && !RECIPE_ID.test(s)) throw new HttpError(400, `${field} is not a valid recipe id`);
  return s;
}

function photoPathFor(familyId: string, path: unknown, field: string): string | null {
  const s = str(path, field, { max: 200 });
  if (s === null) return null;
  const re = new RegExp(`^${familyId}/[0-9a-f-]{36}\\.(jpg|png|heic|webp)$`);
  if (!re.test(s)) throw new HttpError(400, `${field} must be a path returned by /photo-upload`);
  return s;
}

function voicePathFor(familyId: string, path: unknown, field: string, required: boolean): string | null {
  const s = str(path, field, { max: 200, required });
  if (s === null) return null;
  const re = new RegExp(`^${familyId}/[0-9a-f-]{36}\\.(m4a|aac|mp3|webm|wav|ogg)$`);
  if (!re.test(s)) throw new HttpError(400, `${field} must be a path returned by /voice-upload`);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Crypto helpers

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Codes are compared case-insensitively and without surrounding spaces. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Uniform random string from `alphabet` using rejection sampling (no modulo bias). */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const newToken = () => randomString(BASE62, 10);
const newFamilyCode = () => `${randomString(CODE_ALPHABET, 4)}-${randomString(CODE_ALPHABET, 4)}`;

/** A phone's key: 32 random bytes as base64url (43 characters). Handed out once; only its hash is kept. */
function newDeviceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

// Invites: a 16-character link token and a 6-letter code someone can type, both single-use.
const newInviteToken = () => randomString(BASE62, 16);
const newInviteCode = () => randomString(CODE_ALPHABET, 6);
const INVITE_TOKEN = /^[0-9A-Za-z]{16}$/;
const INVITE_CODE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

// Recoverable secrets: family codes (for email sign-in) and family join links' tokens.
// 'v1:' + base64(iv) + '.' + base64(ciphertext), AES-GCM with a key derived per purpose (`salt`).
const CODE_SALT = "homecookd-family-code-v1";
const JOIN_LINK_SALT = "homecookd-join-link-v1";
const aesKeys = new Map<string, Promise<CryptoKey>>();
function aesKey(salt: string): Promise<CryptoKey> {
  let key = aesKeys.get(salt);
  if (!key) {
    key = (async () => {
      const secret = Deno.env.get("EDIBLE_CODE_KEY") || SERVICE_KEY;
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(salt), info: new Uint8Array() },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    aesKeys.set(salt, key);
  }
  return key;
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(salt: string, aad: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    await aesKey(salt),
    new TextEncoder().encode(text),
  );
  return `v1:${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function unseal(salt: string, aad: string, sealed: string | null): Promise<string | null> {
  if (!sealed?.startsWith("v1:")) return null;
  try {
    const [iv, ct] = sealed.slice(3).split(".");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(aad) },
      await aesKey(salt),
      unb64(ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // wrong key (e.g. rotated) or damaged: the next call with the plain code re-seals it
  }
}

const sealCode = (familyId: string, code: string) => seal(CODE_SALT, familyId, normalizeCode(code));
const openCode = (familyId: string, sealed: string | null) => unseal(CODE_SALT, familyId, sealed);

// ---------------------------------------------------------------------------------------------
// Rate limits, kept in Postgres (`hit_rate`, migration 20261016160000) because edge isolates don't
// share memory. Keys hold a keyed hash (HMAC) of the IP / email, never the raw value, so a stored
// key can't be turned back into an IP by hashing every address.

let rateKey: Promise<CryptoKey> | null = null;
function getRateKey(): Promise<CryptoKey> {
  return (rateKey ??= (async () => {
    const secret = Deno.env.get("EDIBLE_CODE_KEY") || SERVICE_KEY;
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("homecookd-rate-limit-v1"), info: new Uint8Array() },
      base,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );
  })());
}

async function rateLimit(
  kind: string,
  value: string,
  max: number,
  windowMin: number,
  message = "Too many attempts. Please wait a few minutes.",
): Promise<void> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await getRateKey(), new TextEncoder().encode(value)));
  const key = `${kind}:${[...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const { data, error } = await db.rpc("hit_rate", { p_key: key, p_max: max, p_window: `${windowMin} minutes` });
  if (error) dbFail("rate limit", error);
  if (data !== true) throw new HttpError(429, message);
}

/**
 * The caller's IP as the edge saw it. Cloudflare sets cf-connecting-ip and the Supabase gateway
 * x-real-ip; the first x-forwarded-for entry is whatever the client typed, so only the last hop
 * is ever used.
 */
function clientIp(req: Request): string {
  const h = req.headers;
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return h.get("cf-connecting-ip")?.trim() || h.get("x-real-ip")?.trim() || xff[xff.length - 1] || "unknown";
}

// ---------------------------------------------------------------------------------------------
// Data shapes

type ProfileRow = {
  id: string;
  family_id: string;
  name: string;
  role: "cook" | "learner";
  relation: string | null;
  avatar_key: string | null;
  sort: number;
  removed_at?: string | null;
  /** When they were added to the family (read by authenticate(): the no-backlog cutoff for open
   *  questions, and who is settled). */
  created_at?: string;
};
type Profile = { id: string; name: string; role: string; relation: string | null; avatar_key: string | null };

const toProfile = (p: ProfileRow): Profile => ({
  id: p.id,
  name: p.name,
  role: p.role,
  relation: p.relation,
  avatar_key: p.avatar_key,
});

type MessageRow = {
  id: string;
  family_id: string;
  thread_id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  recipe_id: string | null;
  step_order: number | null;
  audio_path: string | null;
  audio_url: string | null;
  clip_start_s: number | null;
  clip_end_s: number | null;
  duration_s: number | null;
  transcript: string | null;
  reply_to: string | null;
  /** A `cooked` message's photo of the dish, in the private photos bucket (signed on the way out). */
  photo_path?: string | null;
  /** A postcard's "How close to Mom's?" (1-5), on the sender's own `cooked` message (retention PR 3). */
  rating?: number | null;
  created_at: string;
};

const MESSAGE_COLS =
  "id, family_id, thread_id, sender_id, kind, body, recipe_id, step_order, audio_path, audio_url, clip_start_s, clip_end_s, duration_s, transcript, reply_to, photo_path, rating, created_at";

const n = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));

/** Run an `.in()` query in chunks so long id lists never make an over-long URL. */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await run(ids.slice(i, i + 100))));
  return out;
}

/** Fresh 1-hour signed URLs for voice notes (or, with `bucket`, photos) in our private buckets. */
async function signVoice(paths: string[], bucket = VOICE_BUCKET): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const signed = new Map<string, string>();
  if (!unique.length) return signed;
  const { data, error } = await db.storage.from(bucket).createSignedUrls(unique, 3600);
  if (error) console.error(`sign ${bucket} urls:`, error.message);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
  }
  return signed;
}

/**
 * Which messages are questions, and who can answer each one.
 * - Circle: every `question`; any cook other than the asker answers it.
 * - Pair (1:1): a `question`, or a learner's `step` message with words (a step question), is a
 *   question for the other person; only that person answers it.
 * Needs the messages' threads; `threads` may hold more than needed. Roles come from everyone who
 * was ever in the family, so removing someone never reopens a question they asked or answered.
 */
function questionTargets(ctx: Ctx, rows: MessageRow[], threads: Map<string, ThreadRow>): Map<string, { asker: string; answerer: string | null }> {
  const out = new Map<string, { asker: string; answerer: string | null }>();
  const learners = new Set(ctx.everyone.filter((p) => p.role === "learner").map((p) => p.id));
  for (const m of rows) {
    const t = threads.get(m.thread_id);
    if (!t) continue;
    if (t.kind === "circle") {
      if (m.kind === "question") out.set(m.id, { asker: m.sender_id, answerer: null });
    } else if (m.kind === "question" || (m.kind === "step" && m.body && learners.has(m.sender_id))) {
      const other = t.a_profile === m.sender_id ? t.b_profile : t.b_profile === m.sender_id ? t.a_profile : null;
      if (other) out.set(m.id, { asker: m.sender_id, answerer: other });
    }
  }
  return out;
}

/** The threads these messages live in (one small query). */
async function threadsOf(ctx: Ctx, rows: MessageRow[]): Promise<Map<string, ThreadRow>> {
  const ids = [...new Set(rows.map((m) => m.thread_id))];
  const list = await inChunks(ids, async (chunk) => {
    const { data, error } = await db.from("threads").select(THREAD_COLS).eq("family_id", ctx.family.id).in("id", chunk);
    if (error) dbFail("question threads", error);
    return (data ?? []) as ThreadRow[];
  });
  return new Map(list.map((t) => [t.id, t]));
}

/** Can `who` answer `question` (see questionTargets)? */
function canAnswer(ctx: Ctx, target: { asker: string; answerer: string | null }, who: string): boolean {
  if (who === target.asker) return false;
  if (target.answerer) return who === target.answerer;
  return ctx.everyone.some((p) => p.id === who && p.role === "cook");
}

/** When family_circle (the migration that added messages.reply_to) was applied. */
const LEGACY_STEP_BEFORE = Date.parse("2026-10-16T08:35:22Z");

/**
 * Who answered each question first: the earliest reply from someone who can answer it (circle:
 * a cook other than the asker; 1:1: the person asked). Answered is derived (no stored flag), so
 * it can never drift from the messages.
 */
async function answersFor(ctx: Ctx, questions: MessageRow[], known?: Map<string, ThreadRow>): Promise<Map<string, { by: string; at: string }>> {
  const out = new Map<string, { by: string; at: string }>();
  const candidates = questions.filter((m) => m.kind === "question" || (m.kind === "step" && m.body));
  if (!candidates.length) return out;
  const threads = known ?? (await threadsOf(ctx, candidates));
  const targets = questionTargets(ctx, candidates, threads);
  if (!targets.size) return out;
  const replies = await inChunks([...targets.keys()], async (chunk) => {
    const { data, error } = await db.from("messages").select("sender_id, reply_to, created_at")
      .eq("family_id", ctx.family.id).in("reply_to", chunk).neq("kind", "reaction").order("created_at").order("id");
    if (error) dbFail("answers", error);
    return (data ?? []) as { sender_id: string; reply_to: string; created_at: string }[];
  });
  for (const r of replies) {
    if (out.has(r.reply_to) || !canAnswer(ctx, targets.get(r.reply_to)!, r.sender_id)) continue;
    out.set(r.reply_to, { by: r.sender_id, at: r.created_at });
  }

  // Legacy only: a 1:1 step question sent before reply_to existed is also answered by the next
  // message the person asked sends in that chat (not one linked to a different question). Those
  // answers (the demo's included) aren't linked. Newer step questions need a reply_to reply.
  // created_at is always server-set, so no new message can fall before the cutoff. Only a handful
  // of legacy step questions exist, so one exact `limit(1)` query each (no row cap to hit).
  const steps = candidates.filter((m) =>
    m.kind === "step" && targets.get(m.id)?.answerer && Date.parse(m.created_at) < LEGACY_STEP_BEFORE);
  const legacy = await Promise.all(steps.map(async (q) => {
    const { data, error } = await db.from("messages").select("sender_id, created_at")
      .eq("family_id", ctx.family.id).eq("thread_id", q.thread_id).eq("sender_id", targets.get(q.id)!.answerer!)
      .neq("kind", "system").neq("kind", "reaction").gt("created_at", q.created_at).or(`reply_to.is.null,reply_to.eq.${q.id}`)
      .order("created_at").order("id").limit(1);
    if (error) dbFail("step answers", error);
    return { q, next: (data ?? [])[0] as { sender_id: string; created_at: string } | undefined };
  }));
  for (const { q, next } of legacy) {
    const linked = out.get(q.id);
    if (next && (!linked || Date.parse(next.created_at) < Date.parse(linked.at))) {
      out.set(q.id, { by: next.sender_id, at: next.created_at });
    }
  }
  return out;
}

/**
 * Public message shape. Voice notes stored in our bucket get a fresh 1-hour signed URL, and so does
 * a `cooked` message's photo (`photo_url`, null without one); `rating` is a postcard's 1-5 (else null).
 * Added for the circle: `reply_to`, `answered_by` / `answered_at` (questions only) and
 * `saved_to_recipe` / `note_id` (the recipe note made from this message, for "Undo").
 */
async function toMessages(ctx: Ctx, rows: MessageRow[]) {
  const ids = rows.filter((m) => NOTE_KINDS.has(m.kind)).map((m) => m.id);
  const [signed, photos, answers, saved] = await Promise.all([
    signVoice(rows.filter((m) => m.audio_path).map((m) => m.audio_path!)),
    signVoice(rows.filter((m) => m.photo_path).map((m) => m.photo_path!), PHOTO_BUCKET),
    answersFor(ctx, rows),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db.from("recipe_notes").select("id, answer_message_id").in("answer_message_id", chunk);
      if (error) dbFail("saved notes", error);
      return (data ?? []) as { id: string; answer_message_id: string }[];
    }).then((list) => new Map(list.map((r) => [r.answer_message_id, r.id]))),
  ]);
  return rows.map((m) => ({
    id: m.id,
    thread_id: m.thread_id,
    sender_id: m.sender_id,
    kind: m.kind,
    body: m.body,
    recipe_id: m.recipe_id,
    step_order: m.step_order,
    audio_url: m.audio_path ? signed.get(m.audio_path) ?? null : m.audio_url,
    duration_s: n(m.duration_s),
    clip_start_s: n(m.clip_start_s),
    clip_end_s: n(m.clip_end_s),
    transcript: m.transcript,
    created_at: m.created_at,
    reply_to: m.reply_to,
    photo_url: m.photo_path ? photos.get(m.photo_path) ?? null : null,
    rating: m.rating ?? null,
    answered_by: answers.get(m.id)?.by ?? null,
    answered_at: answers.get(m.id)?.at ?? null,
    saved_to_recipe: saved.has(m.id),
    note_id: saved.get(m.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------------------------
// Auth context

type Ctx = {
  family: { id: string; name: string };
  /** The people in the family now (removed people left out). Every list comes from this. */
  profiles: ProfileRow[];
  /** Everyone ever in the family, removed people included: for names and roles on old messages. */
  everyone: ProfileRow[];
  me: ProfileRow | null;
  /**
   * The calling phone, when it sent `x-device-key` (null for the family code). `profile_id` is its
   * person, set once: who signed in on it, who it added or was let in as (a family invite), or for a
   * family-code swap (`via: 'code'`) the first phone-less person it wrote as. Null until then.
   */
  device: { id: string; profile_id: string | null; via: Via } | null;
  /** People in this family with a live phone of their own (one query per request; also `has_phone`). */
  phones: Set<string>;
};

/** The exact 401 for a revoked or unknown device key. The app keys on this text. */
const SIGNED_OUT = "This phone was signed out.";

/** Which family a device key opens. Bumps `last_seen_at` at most every 10 minutes. */
async function familyForDevice(key: string, ip: string): Promise<{ family: Ctx["family"]; device: NonNullable<Ctx["device"]> }> {
  const { data: row, error } = DEVICE_KEY.test(key)
    ? await db.from("devices").select("id, family_id, profile_id, via, last_seen_at, revoked_at, families(name)")
      .eq("key_hash", await sha256Hex(key)).maybeSingle()
    : { data: null, error: null };
  if (error) dbFail("device auth", error);
  if (!row) {
    await rateLimit("badcode", ip, 20, 10); // same budget as wrong family codes
    throw new HttpError(401, SIGNED_OUT);
  }
  if (row.revoked_at) throw new HttpError(401, SIGNED_OUT);
  if (Date.now() - Date.parse(row.last_seen_at) > 10 * 60_000) {
    const up = await db.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", row.id);
    if (up.error) console.error("device seen:", up.error.message); // best effort
  }
  // deno-lint-ignore no-explicit-any
  const fam = row.families as any;
  return {
    family: { id: row.family_id as string, name: fam?.name as string },
    device: { id: row.id as string, profile_id: (row.profile_id as string | null) ?? null, via: row.via as Via },
  };
}

async function familyForCode(raw: string, ip: string): Promise<Ctx["family"]> {
  if (raw.length > 100) throw new HttpError(401, "Family code not recognised");
  const code = normalizeCode(raw);
  const hash = await sha256Hex(code);
  const { data: row, error } = await db.from("families").select("id, name, code_enc").eq("code_hash", hash).maybeSingle();
  if (error) dbFail("auth", error);
  if (!row) {
    await rateLimit("badcode", ip, 20, 10);
    throw new HttpError(401, "Family code not recognised");
  }
  const family = { id: row.id as string, name: row.name as string };
  // Keep the recoverable copy of the code current (older families, or a rotated key).
  if ((await openCode(family.id, row.code_enc)) !== code) {
    const up = await db.from("families").update({ code_enc: await sealCode(family.id, code) }).eq("id", family.id);
    if (up.error) console.error("seal code:", up.error.message);
  }
  return family;
}

/** The 403 for acting as someone from a phone that isn't theirs. */
const ownPhone = (p: ProfileRow) => new HttpError(403, `${p.name} uses their own phone.`);

/**
 * `x-device-key` when present, else `x-family-code` (old builds, the pipeline, the web).
 * `lenientMe`: a removed or locked `x-profile-id` is ignored instead of refused, so a phone that
 * remembers that person can still load the family and pick someone else (GET /family).
 * `ignoreMe`: `x-profile-id` isn't read at all (POST /profiles/self, where the phone has no person).
 * `keepOwner`: this write never makes a phone with no person theirs (POST /profiles/:id/remove: a
 * shared phone removing someone phone-less mustn't become theirs and then be signed out with them).
 */
async function authenticate(req: Request, opts: AuthOpts = {}): Promise<Ctx> {
  const ip = clientIp(req);
  const key = req.headers.get("x-device-key")?.trim();
  const raw = req.headers.get("x-family-code");
  let family: Ctx["family"];
  let device: Ctx["device"] = null;
  if (key) {
    ({ family, device } = await familyForDevice(key, ip));
  } else if (raw && raw.trim()) {
    family = await familyForCode(raw, ip);
  } else {
    throw new HttpError(401, "Missing family code (x-family-code header)");
  }
  const [{ data: profiles, error: pErr }, { data: live, error: dErr }] = await Promise.all([
    db.from("profiles").select(`${PROFILE_COLS}, removed_at, created_at`).eq("family_id", family.id).order("sort").order("created_at"),
    db.from("devices").select("profile_id").eq("family_id", family.id).is("revoked_at", null).not("profile_id", "is", null),
  ]);
  if (pErr) dbFail("profiles", pErr);
  if (dErr) dbFail("phones", dErr);
  const everyone = (profiles ?? []) as ProfileRow[];
  const list = everyone.filter((p) => !p.removed_at);
  const phones = new Set((live ?? []).map((r) => r.profile_id as string));
  // Removal revokes that person's phones; this only catches a request racing the removal.
  const owner = device?.profile_id;
  if (owner && !list.some((p) => p.id === owner)) throw new HttpError(401, SIGNED_OUT);

  let me: ProfileRow | null = null;
  const pid = opts.ignoreMe ? undefined : req.headers.get("x-profile-id")?.trim();
  if (pid) {
    if (!UUID.test(pid)) throw new HttpError(400, "x-profile-id must be a profile id");
    const id = pid.toLowerCase();
    me = list.find((p) => p.id === id) ?? null;
    if (!me) {
      const removed = everyone.some((p) => p.id === id);
      if (!removed) throw new HttpError(403, "That profile isn't part of this family");
      if (!opts.lenientMe) throw new HttpError(403, "That person was removed from this family. Pick who you are.");
    }
  }
  // A phone that joined through a family invite says who it is before it writes: it adds itself
  // (POST /profiles/self) or asks to move in as someone (POST /move-requests, which someone else
  // approves). Writing as an existing face never makes it theirs, so whoever opened a forwarded link
  // can't become Dad. Reads as phone-less faces stay fine. Once it has its person it can write as
  // other phone-less people (lending) like any phone.
  if (me && req.method !== "GET" && device?.via === "invite" && !device.profile_id) {
    throw new HttpError(403, "Add yourself first.");
  }
  // Someone with their own phone is only ever them from that phone: another phone, or the family
  // code (old builds), gets 403, reads included, so their messages stay theirs.
  if (me && phones.has(me.id) && device?.profile_id !== me.id) {
    if (!opts.lenientMe) throw ownPhone(me);
    me = null;
  }
  // Nobody writes as someone only invited: until Dad taps his own link, a message "from Dad" would
  // really be from whoever's phone this is. Reads are fine (the Profiles screen reads everyone's
  // lines as each person). This phone's own person is never "only invited".
  if (me && req.method !== "GET" && device?.profile_id !== me.id && (await invitedOnly(me.id))) {
    throw new HttpError(403, `${me.name} hasn't joined yet. Pick your own face.`);
  }
  // A family-code swap with no person yet (`via: 'code'`; a family invite was refused above) becomes
  // the phone of the first person it writes as. Set once: the conditional update never moves an
  // owner, so later writes as other phone-less people (Grandma on Mom's iPad) leave it alone. Reads
  // never set it. Me is phone-less here (else locked above, since this phone has no person).
  if (device && !device.profile_id && device.via !== "invite" && me && req.method !== "GET" && !opts.keepOwner) {
    const up = await db.from("devices").update({ profile_id: me.id })
      .eq("id", device.id).is("profile_id", null).is("revoked_at", null).select("profile_id");
    if (up.error) console.error("device owner:", up.error.message); // best effort
    else if (up.data?.length) {
      device.profile_id = me.id;
      phones.add(me.id);
    }
  }
  return { family, profiles: list, everyone, me, device, phones };
}

function requireMe(ctx: Ctx): ProfileRow {
  if (!ctx.me) throw new HttpError(400, "x-profile-id header is required for this request");
  return ctx.me;
}

function profileIn(ctx: Ctx, id: unknown, field: string): ProfileRow {
  if (typeof id !== "string" || !UUID.test(id)) throw new HttpError(400, `${field} must be a profile id`);
  const p = ctx.profiles.find((x) => x.id === id.toLowerCase());
  if (!p) throw new HttpError(404, `${field}: no such person in this family`);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Recipes live in the public media bucket. Check they exist before sharing or messaging about one.

const recipeSeen = new Map<string, { ok: boolean; at: number }>();
async function assertRecipe(id: string): Promise<void> {
  const cached = recipeSeen.get(id);
  if (cached && Date.now() - cached.at < 10 * 60_000) {
    if (!cached.ok) throw new HttpError(404, "No recipe with that id");
    return;
  }
  let ok = true;
  try {
    const res = await fetch(`${BUCKET_URL}/${id}/recipe.json`, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
    });
    ok = res.status !== 404;
  } catch (e) {
    console.warn("recipe check skipped:", (e as Error).message); // bucket unreachable: don't block
    return;
  }
  recipeSeen.set(id, { ok, at: Date.now() });
  if (!ok) throw new HttpError(404, "No recipe with that id");
}

/**
 * library.json & each recipe.json from the public bucket, 10-minute cache (retention plumbing.ts):
 * dish titles for push copy, and whose dish it is.
 */
const library = makeLibrary({ bucketUrl: BUCKET_URL });

/** Whose dish it is: `cook.name` from the recipe's recipe.json (cached 10 min; null if unknown). */
async function recipeCook(id: string): Promise<string | null> {
  return (await library.recipeInfo(id))?.cook_name?.trim() || null;
}

// ---------------------------------------------------------------------------------------------
// Threads & messages
//
// A thread is either a 'pair' (two people, a_profile < b_profile) or the family 'circle' (every
// profile in the family, a_profile = b_profile = null, at most one per family).

type ThreadRow = {
  id: string;
  family_id: string;
  kind: "pair" | "circle";
  a_profile: string | null;
  b_profile: string | null;
  last_message_at: string | null;
};
const THREAD_COLS = "id, family_id, kind, a_profile, b_profile, last_message_at";

async function getOrCreateThread(familyId: string, x: string, y: string): Promise<ThreadRow> {
  if (x === y) throw new HttpError(400, "You can't start a conversation with yourself");
  const [a, b] = x < y ? [x, y] : [y, x];
  const find = () =>
    db.from("threads").select(THREAD_COLS)
      .eq("family_id", familyId).eq("kind", "pair").eq("a_profile", a).eq("b_profile", b).maybeSingle();
  const found = await find();
  if (found.error) dbFail("thread find", found.error);
  if (found.data) return found.data as ThreadRow;
  const ins = await db.from("threads").insert({ family_id: familyId, kind: "pair", a_profile: a, b_profile: b })
    .select(THREAD_COLS).single();
  if (ins.error) {
    if (ins.error.code !== "23505") dbFail("thread insert", ins.error);
    const again = await find(); // lost a race; the other insert won
    if (again.error || !again.data) dbFail("thread refind", again.error);
    return again.data as ThreadRow;
  }
  return ins.data as ThreadRow;
}

/** The family circle thread, created on first use (the migration backfilled existing families). */
async function getOrCreateCircle(familyId: string): Promise<ThreadRow> {
  const find = () => db.from("threads").select(THREAD_COLS).eq("family_id", familyId).eq("kind", "circle").maybeSingle();
  const found = await find();
  if (found.error) dbFail("circle find", found.error);
  if (found.data) return found.data as ThreadRow;
  const ins = await db.from("threads").insert({ family_id: familyId, kind: "circle" }).select(THREAD_COLS).single();
  if (ins.error) {
    if (ins.error.code !== "23505") dbFail("circle insert", ins.error);
    const again = await find();
    if (again.error || !again.data) dbFail("circle refind", again.error);
    return again.data as ThreadRow;
  }
  return ins.data as ThreadRow;
}

const inThread = (t: ThreadRow, profileId: string) =>
  t.kind === "circle" || t.a_profile === profileId || t.b_profile === profileId;

async function threadFor(ctx: Ctx, me: ProfileRow, id: string): Promise<ThreadRow> {
  if (!UUID.test(id)) throw new HttpError(404, "No such conversation");
  const { data, error } = await db.from("threads").select(THREAD_COLS)
    .eq("id", id.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
  if (error) dbFail("thread", error);
  if (!data || !inThread(data as ThreadRow, me.id)) throw new HttpError(404, "No such conversation");
  return data as ThreadRow;
}

/**
 * Everyone in a thread, in family order. The circle is the people in the family now; a 1:1 keeps
 * both people even after one was removed, so the chat's history still shows who it was with.
 */
function membersOf(ctx: Ctx, t: ThreadRow): ProfileRow[] {
  return t.kind === "circle" ? ctx.profiles : ctx.everyone.filter((p) => p.id === t.a_profile || p.id === t.b_profile);
}

/** A 1:1 with someone who was removed: its history stays readable, but nothing new goes to them. */
function removedOther(ctx: Ctx, t: ThreadRow, me: ProfileRow): ProfileRow | null {
  if (t.kind !== "pair") return null;
  const otherId = t.a_profile === me.id ? t.b_profile : t.a_profile;
  return ctx.everyone.find((p) => p.id === otherId && p.removed_at) ?? null;
}

/**
 * `ThreadSummary.other` stays a Profile for older app code. For the circle it is this stand-in
 * (not a real profile id); new code reads `kind` and `members` instead.
 */
const CIRCLE_OTHER: Profile = { id: "family", name: "Family", role: "cook", relation: null, avatar_key: null };

type NewMessage = {
  kind: string;
  body?: string | null;
  recipe_id?: string | null;
  step_order?: number | null;
  audio_path?: string | null;
  audio_url?: string | null;
  clip_start_s?: number | null;
  clip_end_s?: number | null;
  duration_s?: number | null;
  transcript?: string | null;
  reply_to?: string | null;
  photo_path?: string | null;
  created_at?: string;
};

async function insertMessage(thread: ThreadRow, senderId: string, m: NewMessage): Promise<MessageRow> {
  const createdAt = m.created_at ?? new Date().toISOString();
  const { data, error } = await db.from("messages").insert({
    family_id: thread.family_id,
    thread_id: thread.id,
    sender_id: senderId,
    kind: m.kind,
    body: m.body ?? null,
    recipe_id: m.recipe_id ?? null,
    step_order: m.step_order ?? null,
    audio_path: m.audio_path ?? null,
    audio_url: m.audio_url ?? null,
    clip_start_s: m.clip_start_s ?? null,
    clip_end_s: m.clip_end_s ?? null,
    duration_s: m.duration_s ?? null,
    transcript: m.transcript ?? null,
    reply_to: m.reply_to ?? null,
    ...(m.photo_path ? { photo_path: m.photo_path } : {}),
    created_at: createdAt,
  }).select(MESSAGE_COLS).single();
  if (error) dbFail("message insert", error);
  // A reaction (a heart from Home, "Just like mine") is a stamp under a message: it never moves the
  // thread up the inbox and never marks it read, since its sender may not have opened the chat.
  if (m.kind === "reaction") return data as MessageRow;
  const up = await db.from("threads").update({ last_message_at: createdAt }).eq("id", thread.id);
  if (up.error) dbFail("thread touch", up.error);
  // The sender has read their own thread up to now. Not for system notes: their "sender" is the
  // person they are about ("Sam signed in on a new phone"), who has read nothing.
  if (m.kind !== "system") await markRead(thread.id, senderId, createdAt);
  return data as MessageRow;
}

async function markRead(threadId: string, profileId: string, at = new Date().toISOString()) {
  const { error } = await db.from("thread_reads")
    .upsert({ thread_id: threadId, profile_id: profileId, last_read_at: at }, { onConflict: "thread_id,profile_id" });
  if (error) dbFail("mark read", error);
}

async function voiceExists(path: string, bucket = VOICE_BUCKET): Promise<boolean> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
  return !error && !!data?.signedUrl;
}

/** The voice fields of a voice message (or a spoken question). */
async function parseVoice(ctx: Ctx, body: Record<string, unknown>, m: NewMessage): Promise<void> {
  const duration = num(body.duration_s, "duration_s", { min: 0, max: MAX_VOICE_S, required: true });
  if (duration === 0) throw new HttpError(400, "duration_s must be more than 0");
  const path = voicePathFor(ctx.family.id, body.audio_path, "audio_path", false);
  const external = str(body.audio_url, "audio_url", { max: 1000 });
  if (path) {
    if (!(await voiceExists(path))) throw new HttpError(400, "Upload the voice note before sending it");
    m.audio_path = path;
  } else if (external) {
    // A clip of a cook's recorded voice from the public recipe bucket (e.g. "Hear Dad").
    if (!external.startsWith(`${BUCKET_URL}/`)) throw new HttpError(400, "audio_url must point at a recipe's audio");
    m.audio_url = external;
  } else {
    throw new HttpError(400, "audio_path is required for a voice message");
  }
  m.duration_s = duration;
}

const KINDS = "text, voice, step, recipe, cooked, request, question, reaction";

/** Validate a POST /threads/:id/messages body into a NewMessage. */
async function parseMessage(ctx: Ctx, thread: ThreadRow, body: Record<string, unknown>): Promise<{ m: NewMessage; replyTo: MessageRow | null }> {
  const kind = str(body.kind, "kind", { max: 20, required: true })!;
  const text = str(body.body, "body", { max: MAX_BODY_CHARS });
  const rid = recipeId(body.recipe_id, "recipe_id", false);
  const step = num(body.step_order, "step_order", { int: true, min: 1, max: 200 });
  const clipStart = num(body.clip_start_s, "clip_start_s", { min: 0, max: 86400 });
  const clipEnd = num(body.clip_end_s, "clip_end_s", { min: 0, max: 86400 });
  if (clipStart !== null && clipEnd !== null && clipEnd <= clipStart) {
    throw new HttpError(400, "clip_end_s must be after clip_start_s");
  }
  const transcript = str(body.transcript, "transcript", { max: 5000 });
  const m: NewMessage = { kind, body: text, recipe_id: rid, step_order: step, clip_start_s: clipStart, clip_end_s: clipEnd };
  const spoken = (body.audio_path !== undefined && body.audio_path !== null) ||
    (body.audio_url !== undefined && body.audio_url !== null);

  switch (kind) {
    case "text":
      if (!text) throw new HttpError(400, "body is required for a text message");
      break;
    case "request":
      if (!text) throw new HttpError(400, "body is required for a request");
      break;
    case "recipe":
    case "cooked":
      if (!rid) throw new HttpError(400, `recipe_id is required for a ${kind} message`);
      if (kind === "cooked" && body.photo_path !== undefined && body.photo_path !== null) {
        // "Show Grandma yours": a photo of the dish they made, uploaded first via /photo-upload.
        const photo = photoPathFor(ctx.family.id, body.photo_path, "photo_path")!;
        if (!(await voiceExists(photo, PHOTO_BUCKET))) throw new HttpError(400, "Upload the photo before sending it");
        m.photo_path = photo;
      }
      break;
    case "step":
      if (!rid || step === null) throw new HttpError(400, "recipe_id and step_order are required for a step message");
      break;
    case "voice":
      await parseVoice(ctx, body, m);
      m.transcript = transcript;
      break;
    case "question":
      // Typed (`body`) or spoken (voice fields); optionally about a recipe and one of its steps.
      if (spoken) {
        await parseVoice(ctx, body, m);
        m.transcript = transcript;
      } else if (!text) {
        throw new HttpError(400, "body is required for a question");
      }
      if (step !== null && !rid) throw new HttpError(400, "step_order needs a recipe_id");
      break;
    case "reaction":
      // A cook's heart mid-cook, or "Just like mine" on a dish someone made (retention handoff 3.1, 3.4).
      if (!isReaction(text)) throw new HttpError(400, "body must be heart or just_like_mine");
      break;
    case "system":
      throw new HttpError(400, "System notes are written by homecookd, not sent");
    default:
      throw new HttpError(400, `kind must be one of ${KINDS}`);
  }
  if (kind !== "voice" && kind !== "question" && body.audio_path) {
    throw new HttpError(400, "audio_path is only for voice messages and questions");
  }
  if (kind !== "cooked" && body.photo_path) throw new HttpError(400, "photo_path is only for cooked messages");

  let replyTo: MessageRow | null = null;
  if (body.reply_to !== undefined && body.reply_to !== null) {
    if (typeof body.reply_to !== "string" || !UUID.test(body.reply_to)) throw new HttpError(400, "reply_to must be a message id");
    const { data, error } = await db.from("messages").select(MESSAGE_COLS)
      .eq("id", body.reply_to.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
    if (error) dbFail("reply_to", error);
    if (!data || data.thread_id !== thread.id) throw new HttpError(400, "reply_to must be a message in this conversation");
    replyTo = data as MessageRow;
    m.reply_to = replyTo.id;
  }
  if (kind === "reaction") {
    // A reaction answers a dish someone else made, or nothing (a heart mid-cook); never a question.
    const madeByOther = replyTo && replyTo.kind === "cooked" && replyTo.sender_id !== ctx.me?.id;
    if ((replyTo && !madeByOther) || (text === "just_like_mine" && !replyTo)) {
      throw new HttpError(400, "A reaction answers a dish someone made");
    }
  }
  if (rid) await assertRecipe(rid);
  return { m, replyTo };
}

// ---------------------------------------------------------------------------------------------
// Recipe notes: a cook's answer, saved into the shared family recipe (and step)

type NoteRow = {
  id: string;
  recipe_id: string;
  step_order: number | null;
  question_message_id: string | null;
  question: string | null;
  asked_by: string | null;
  answer_message_id: string;
  answer_text: string | null;
  answer_audio_path: string | null;
  answer_audio_url: string | null;
  answer_duration_s: number | null;
  answered_by: string;
  created_at: string;
};
const NOTE_COLS =
  "id, recipe_id, step_order, question_message_id, question, asked_by, answer_message_id, answer_text, answer_audio_path, answer_audio_url, answer_duration_s, answered_by, created_at";

/** Kinds whose content can become a note, and the question kinds a note can quote. */
const NOTE_KINDS = new Set(["text", "voice", "step", "recipe", "cooked"]);
const QUESTION_KINDS = new Set(["question", "step"]);

/** Save `answer` as a note (idempotent: one note per answer message). Returns null if it has no content. */
async function saveNote(ctx: Ctx, answer: MessageRow, question: MessageRow | null): Promise<NoteRow | null> {
  const q = question && QUESTION_KINDS.has(question.kind) ? question : null;
  let rid = answer.recipe_id;
  let step = answer.step_order;
  if (!rid && q?.recipe_id) {
    rid = q.recipe_id;
    step = q.step_order;
  } else if (rid && step === null && q?.recipe_id === rid) {
    step = q.step_order;
  }
  if (!rid) throw new HttpError(400, "That message isn't about a recipe");
  const text = answer.body ?? answer.transcript;
  if (!text && !answer.audio_path && !answer.audio_url) return null;
  const ins = await db.from("recipe_notes").upsert({
    family_id: ctx.family.id,
    recipe_id: rid,
    step_order: step,
    question_message_id: q?.id ?? null,
    question: q ? (q.body ?? q.transcript) : null,
    asked_by: q?.sender_id ?? null,
    answer_message_id: answer.id,
    answer_text: text,
    answer_audio_path: answer.audio_path,
    answer_audio_url: answer.audio_path ? null : answer.audio_url,
    answer_duration_s: answer.duration_s,
    answered_by: answer.sender_id,
  }, { onConflict: "answer_message_id", ignoreDuplicates: true }).select(NOTE_COLS);
  if (ins.error) dbFail("note insert", ins.error);
  if (ins.data?.length) return ins.data[0] as NoteRow;
  const { data, error } = await db.from("recipe_notes").select(NOTE_COLS).eq("answer_message_id", answer.id).single();
  if (error) dbFail("note find", error);
  return data as NoteRow;
}

async function toNotes(ctx: Ctx, rows: NoteRow[]) {
  // Spoken questions: their voice, so the step screen can play the question in the asker's words.
  const qIds = [...new Set(rows.map((r) => r.question_message_id).filter((id): id is string => !!id))];
  const questions = new Map((await inChunks(qIds, async (chunk) => {
    const { data, error } = await db.from("messages").select("id, audio_path, audio_url, duration_s")
      .eq("family_id", ctx.family.id).in("id", chunk);
    if (error) dbFail("note questions", error);
    return (data ?? []) as Pick<MessageRow, "id" | "audio_path" | "audio_url" | "duration_s">[];
  })).map((q) => [q.id, q]));
  const signed = await signVoice([
    ...rows.filter((r) => r.answer_audio_path).map((r) => r.answer_audio_path!),
    ...[...questions.values()].filter((q) => q.audio_path).map((q) => q.audio_path!),
  ]);
  // Removed people included: a note keeps its author's name and face.
  const byId = new Map(ctx.everyone.map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const author = byId.get(r.answered_by);
    if (!author) return [];
    const asker = r.asked_by ? byId.get(r.asked_by) : undefined;
    const q = r.question_message_id ? questions.get(r.question_message_id) : undefined;
    const qAudio = q ? (q.audio_path ? signed.get(q.audio_path) ?? null : q.audio_url) : null;
    return [{
      id: r.id,
      recipe_id: r.recipe_id,
      step_order: r.step_order,
      question: r.question,
      question_message_id: r.question_message_id,
      question_audio_url: qAudio,
      question_duration_s: qAudio ? n(q!.duration_s) : null,
      asker: asker ? toProfile(asker) : null,
      answer_text: r.answer_text,
      answer_audio_url: r.answer_audio_path ? signed.get(r.answer_audio_path) ?? null : r.answer_audio_url,
      answer_duration_s: n(r.answer_duration_s),
      answer_message_id: r.answer_message_id,
      author: toProfile(author),
      created_at: r.created_at,
    }];
  });
}

// ---------------------------------------------------------------------------------------------
// Thread summaries (inbox) and unread counts

/** The circle (always, first) then my pair threads with messages, newest first. */
async function summaries(ctx: Ctx, me: ProfileRow) {
  const circle = await getOrCreateCircle(ctx.family.id);
  const { data: threads, error } = await db.from("threads").select(THREAD_COLS)
    .eq("family_id", ctx.family.id)
    .eq("kind", "pair")
    .or(`a_profile.eq.${me.id},b_profile.eq.${me.id}`)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false });
  if (error) dbFail("threads", error);
  const list = [circle, ...((threads ?? []) as ThreadRow[])];
  const ids = list.map((t) => t.id);

  const [{ data: reads, error: rErr }, { data: msgs, error: mErr }] = await Promise.all([
    db.from("thread_reads").select("thread_id, last_read_at").eq("profile_id", me.id).in("thread_id", ids),
    // TODO: fine for family-sized threads; move to a SQL view if a family ever has thousands of messages.
    db.from("messages").select(MESSAGE_COLS).in("thread_id", ids)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5000),
  ]);
  if (rErr) dbFail("reads", rErr);
  if (mErr) dbFail("messages", mErr);
  const readAt = new Map((reads ?? []).map((r) => [r.thread_id, Date.parse(r.last_read_at)]));
  const byThread = new Map<string, MessageRow[]>();
  for (const m of (msgs ?? []) as MessageRow[]) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id)!.push(m);
  }
  return list.flatMap((t) => {
    // Reactions are stamps under a message: never the headline, never unread, never a thread alone.
    const rows = (byThread.get(t.id) ?? []).filter((m) => m.kind !== "reaction");
    let other: Profile & { removed?: true };
    if (t.kind === "circle") {
      other = CIRCLE_OTHER;
    } else {
      if (!rows.length) return [];
      const otherId = t.a_profile === me.id ? t.b_profile : t.a_profile;
      // Removed people included: the chat and its history stay (marked `removed`).
      const p = ctx.everyone.find((x) => x.id === otherId);
      if (!p) return [];
      other = p.removed_at ? { ...toProfile(p), removed: true } : toProfile(p);
    }
    const seen = readAt.get(t.id) ?? 0;
    // System notes ("Sam signed in on a new phone") never count as unread.
    const unread = rows.filter((m) => m.sender_id !== me.id && m.kind !== "system" && Date.parse(m.created_at) > seen).length;
    return [{
      thread: t,
      other,
      members: membersOf(ctx, t),
      // A system note is never the headline while the thread has a real message.
      last: rows.find((m) => m.kind !== "system") ?? rows[0] ?? null,
      unread,
      recipe_id: rows.find((m) => m.recipe_id)?.recipe_id ?? null,
      // Postcards (retention PR 3) change a `cooked` card in place, never `last`: this count tells a
      // cook's Home to fetch the thread again when one lands on an older card.
      postcards: rows.filter((m) => m.kind === "cooked" && m.photo_path).length,
    }];
  });
}

// ---------------------------------------------------------------------------------------------
// Pending sends: deliver a recorded recipe (+ optional hello voice note) once the worker publishes it

type PendingRow = {
  job_id: string;
  family_id: string;
  sender_id: string;
  recipient_ids: string[];
  hello_path: string | null;
  hello_duration_s: number | null;
  delivered_at: string | null;
  recipe_id: string | null;
};

async function deliverPending(familyId: string, jobId: string, rid: string): Promise<{ delivered: number; already?: boolean }> {
  // Claim atomically so two calls (worker retry + app) can never deliver twice.
  const { data: claimed, error } = await db.from("pending_sends")
    .update({ delivered_at: new Date().toISOString(), recipe_id: rid })
    .eq("job_id", jobId).eq("family_id", familyId).is("delivered_at", null)
    .select("job_id, family_id, sender_id, recipient_ids, hello_path, hello_duration_s, delivered_at, recipe_id");
  if (error) dbFail("claim pending", error);
  const row = (claimed ?? [])[0] as PendingRow | undefined;
  if (!row) {
    const { data: existing } = await db.from("pending_sends").select("delivered_at")
      .eq("job_id", jobId).eq("family_id", familyId).maybeSingle();
    return existing ? { delivered: 0, already: true } : { delivered: 0 };
  }
  try {
    const { data: members, error: pErr } = await db.from("profiles").select("id")
      .eq("family_id", familyId).in("id", row.recipient_ids).is("removed_at", null);
    if (pErr) dbFail("recipients", pErr);
    const recipients = (members ?? []).map((p) => p.id).filter((id) => id !== row.sender_id);
    const sent: SentRecipe[] = [];
    for (const to of recipients) {
      const thread = await getOrCreateThread(familyId, row.sender_id, to);
      const at = new Date();
      const m = await insertMessage(thread, row.sender_id, { kind: "recipe", recipe_id: rid, created_at: at.toISOString() });
      sent.push({ profile_id: to, thread_id: thread.id, message_id: m.id });
      if (row.hello_path) {
        await insertMessage(thread, row.sender_id, {
          kind: "voice",
          recipe_id: rid,
          audio_path: row.hello_path,
          duration_s: row.hello_duration_s,
          created_at: new Date(at.getTime() + 1).toISOString(),
        });
      }
    }
    // "Just in from Dad" (handoff 2.5 row 4). runInBackground never throws, so a push can never
    // release the claim below.
    runInBackground((async () => {
      const { data: who } = await db.from("profiles").select("name").eq("id", row.sender_id).maybeSingle();
      await pushRecipes(who?.name ?? "your family", rid, sent);
    })());
    return { delivered: recipients.length };
  } catch (e) {
    // Release the claim so the worker's next call can retry.
    await db.from("pending_sends").update({ delivered_at: null }).eq("job_id", jobId).eq("family_id", familyId);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Routes

// A handler returns a value to send as JSON, or a ready Response (e.g. a 204).
type AuthOpts = { lenientMe?: boolean; ignoreMe?: boolean; keepOwner?: boolean };
type Route = { method: string; pattern: string[]; handler: (a: Args) => Promise<unknown>; auth: AuthOpts };
type Args = { req: Request; ctx: Ctx; params: Record<string, string>; url: URL; body: () => Promise<Record<string, unknown>> };
type PublicArgs = Omit<Args, "ctx">;

const routes: Route[] = [];
const publicRoutes: { method: string; pattern: string[]; handler: (a: PublicArgs) => Promise<unknown> }[] = [];
const on = (method: string, path: string, handler: Route["handler"], auth: Route["auth"] = {}) =>
  routes.push({ method, pattern: path.split("/").filter(Boolean), handler, auth });
const onPublic = (method: string, path: string, handler: (a: PublicArgs) => Promise<unknown>) =>
  publicRoutes.push({ method, pattern: path.split("/").filter(Boolean), handler });

function match(pattern: string[], segs: string[]): Record<string, string> | null {
  if (pattern.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(":")) {
      try {
        params[pattern[i].slice(1)] = decodeURIComponent(segs[i]);
      } catch {
        return null; // malformed %-escape
      }
    } else if (pattern[i] !== segs[i]) return null;
  }
  return params;
}

// --- family & profiles

/** Whether someone can't be acted as from this caller: they have a phone, and it isn't this one. */
const lockedFor = (ctx: Ctx, profileId: string) => ctx.phones.has(profileId) && ctx.device?.profile_id !== profileId;

/**
 * `invited`: has a live invite and hasn't joined (signed in, or sent a message or an invite). `has_phone`: a phone is signed in as them,
 * so removing them signs it out (false for someone who only ever used the shared family code).
 * `locked`: they have their own phone and this isn't it, so nothing can be done as them from here.
 * `former_profiles`: people who were removed, only so old messages can still show their name and
 * face (never list them). `device_profile_id`: this phone's person (who signed in on it, who it
 * added or was let in as, or the first phone-less person a code-swapped phone wrote as; null for the
 * plain family code or a key with no person yet). `device_needs_profile`: this phone came in through
 * a family invite and hasn't said who it is yet (POST /profiles/self, or a move request someone
 * approves). `move_requests_pending`: how many asks to move in this caller can answer (0 unless on
 * their own phone). `can_manage`: the caller (x-profile-id, else this phone's own person) may answer
 * asks to move in: settled (see settledIds) and on their own phone. `memorial` (retention, guardrail
 * 2): remembered, not here (set by SQL in v1). A count or flag that can't be read is 0 / false: it
 * must never stop the family from loading. The one exception is `memorial`, which is left out
 * instead, because false would let the app address a memorial person as present.
 */
on("GET", "/family", async ({ ctx }) => {
  const who = ctx.me ? (onOwnPhone(ctx) ? ctx.me : null) : ctx.profiles.find((p) => p.id === ctx.device?.profile_id) ?? null;
  const [invited, moves, manage, memorial] = await Promise.all([
    invitedIds(ctx.family.id),
    answerableMoves(ctx).then((r) => r.length).catch(() => 0),
    who ? settledIds(ctx, [who.id]).then((s) => s.has(who.id)).catch(() => false) : false,
    // Retention guardrail 2: unreadable (no column yet) leaves the flag out, which the app reads as
    // "unknown" and so never addresses anyone as present on it.
    memorialIds(db, ctx.family.id).catch(() => null),
  ]);
  return {
    family: { id: ctx.family.id, name: ctx.family.name },
    profiles: ctx.profiles.map((p) => ({
      ...toProfile(p),
      invited: invited.has(p.id),
      has_phone: ctx.phones.has(p.id),
      locked: lockedFor(ctx, p.id),
      ...(memorial ? { memorial: memorial.has(p.id) } : {}),
    })),
    former_profiles: ctx.everyone.filter((p) => p.removed_at).map(toProfile),
    device_profile_id: ctx.device?.profile_id ?? null,
    device_needs_profile: ctx.device?.via === "invite" && !ctx.device.profile_id,
    move_requests_pending: moves,
    can_manage: manage,
  };
}, { lenientMe: true });

const MAX_PROFILES = 30;
const PROFILE_COLS = "id, family_id, name, role, relation, avatar_key, sort";

/** Of these profiles, the ones who have signed in: a linked Apple/Google account or a live phone. */
async function signedInIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [idn, dev] = await Promise.all([
    db.from("identities").select("profile_id").in("profile_id", ids),
    db.from("devices").select("profile_id").in("profile_id", ids).is("revoked_at", null),
  ]);
  if (idn.error) dbFail("signed in identities", idn.error);
  if (dev.error) dbFail("signed in devices", dev.error);
  return new Set([...(idn.data ?? []), ...(dev.data ?? [])].map((r) => r.profile_id as string));
}

/** This person has a pending, unexpired invite (sent and not used yet). */
async function hasLiveInvite(profileId: string): Promise<boolean> {
  const { count, error } = await db.from("invites").select("id", { count: "exact", head: true })
    .eq("profile_id", profileId).eq("status", "pending").gt("expires_at", new Date().toISOString());
  if (error) dbFail("live invite", error);
  return !!count;
}

/**
 * Of these profiles, the ones already at home in the family: they sent a message (not a system
 * note) or an invite. Mom, used from a shared phone, who then got a link of her own, is one of the
 * family, not "Hasn't joined yet". One small look per person (only people with a pending invite).
 */
async function actedIds(ids: string[]): Promise<Set<string>> {
  const acted = await Promise.all(ids.map(async (id) => {
    const [msg, inv] = await Promise.all([
      db.from("messages").select("id").eq("sender_id", id).neq("kind", "system").limit(1),
      db.from("invites").select("id").eq("inviter_id", id).limit(1),
    ]);
    if (msg.error) dbFail("acted messages", msg.error);
    if (inv.error) dbFail("acted invites", inv.error);
    return msg.data?.length || inv.data?.length ? id : null;
  }));
  return new Set(acted.filter((id): id is string => !!id));
}

/** Joined: signed in (Apple/Google or a live phone), or already acted in the family (actedIds). */
async function joinedIds(ids: string[]): Promise<Set<string>> {
  const [signed, acted] = await Promise.all([signedInIds(ids), actedIds(ids)]);
  return new Set([...signed, ...acted]);
}

/** Invited and not joined: a live invite, never signed in anywhere, and never acted here. */
async function invitedOnly(profileId: string): Promise<boolean> {
  return (await hasLiveInvite(profileId)) && !(await joinedIds([profileId])).has(profileId);
}

/** People with a pending, unexpired invite who haven't joined (joinedIds). Family invites name nobody. */
async function invitedIds(familyId: string): Promise<Set<string>> {
  const { data, error } = await db.from("invites").select("profile_id")
    .eq("family_id", familyId).eq("status", "pending").gt("expires_at", new Date().toISOString())
    .not("profile_id", "is", null);
  if (error) dbFail("invited", error);
  const ids = [...new Set((data ?? []).map((r) => r.profile_id as string).filter(Boolean))];
  const joined = await joinedIds(ids);
  return new Set(ids.filter((id) => !joined.has(id)));
}

// --- devices: one key per phone

type Via = "invite" | "apple" | "google" | "code" | "share";

/** The phone's name from the body ("iPhone"); `label` is accepted too. Display only. */
const deviceLabel = (b: Record<string, unknown>) => str(b.device_label ?? b.label, "device_label", { max: 40 });

async function createDevice(familyId: string, profileId: string | null, via: Via, label: string | null) {
  const key = newDeviceKey();
  const { data, error } = await db.from("devices")
    .insert({ family_id: familyId, profile_id: profileId, key_hash: await sha256Hex(key), label, via })
    .select("id").single();
  if (error) dbFail("device insert", error);
  return { id: data.id as string, key };
}

/**
 * Swap a saved family code for this phone's own key (`via: 'code'`). Its person is the first
 * phone-less person it then writes as (x-profile-id on a POST; see authenticate()), for good. Not
 * from a key: a second key would belong to nobody, so removing the person wouldn't sign it out.
 */
on("POST", "/devices", async ({ ctx, body }) => {
  if (ctx.device) throw new HttpError(400, "This phone already has its own key.");
  const b = await body();
  await rateLimit("devices", ctx.family.id, 30, 60);
  const dev = await createDevice(ctx.family.id, null, "code", deviceLabel(b));
  return { device_key: dev.key };
});

/**
 * Sign this phone out: its key stops working (later calls with it get the signed-out 401).
 * x-profile-id isn't read, so a phone can always sign itself out, whoever it remembers.
 */
on("POST", "/devices/revoke", async ({ ctx }) => {
  if (!ctx.device) throw new HttpError(400, "Send this phone's x-device-key to sign it out.");
  const { error } = await db.from("devices").update({ revoked_at: new Date().toISOString() })
    .eq("id", ctx.device.id).is("revoked_at", null);
  if (error) dbFail("device revoke", error);
  return { ok: true };
}, { ignoreMe: true });

function emailOf(v: unknown, required: boolean): string | null {
  const s = str(v, "email", { max: 254, required });
  if (s === null) return null;
  const email = s.toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "That email doesn't look right");
  return email;
}

async function profileByEmail(email: string): Promise<(ProfileRow & { families: { name: string; code_enc: string | null } }) | null> {
  const { data, error } = await db.from("profiles")
    .select(`${PROFILE_COLS}, families(name, code_enc)`).eq("email", email).is("removed_at", null).maybeSingle();
  if (error) dbFail("profile by email", error);
  // deno-lint-ignore no-explicit-any
  return (data as any) ?? null;
}

const EMAIL_TAKEN = "That email is already in a family";

/**
 * Emails are only for old builds' email sign-in, which hands back the family code. Those builds
 * hold the code already; a phone with its own key must not be able to trade an email for it.
 */
function assertCanSetEmail(ctx: Ctx): void {
  if (ctx.device) throw new HttpError(403, "Emails can't be added in this version. Send an invite instead.");
}

/**
 * Add a person to a family. Names are unique per family (ignoring case), emails across all
 * families. New people start with the circle read up to now, so its history isn't "new" for them.
 */
async function addProfile(
  familyId: string,
  existing: ProfileRow[],
  p: { name: string; role: "cook" | "learner"; relation?: string | null; email?: string | null },
  taken = (name: string) => `${name} is already in this family`,
): Promise<ProfileRow> {
  if (existing.length >= MAX_PROFILES) throw new HttpError(400, `This family already has ${MAX_PROFILES} people`);
  const same = existing.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (same) throw new HttpError(409, taken(same.name));
  if (p.email && (await profileByEmail(p.email))) throw new HttpError(409, EMAIL_TAKEN);
  const sort = existing.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
  const { data, error } = await db.from("profiles")
    .insert({ family_id: familyId, name: p.name, role: p.role, relation: p.relation ?? null, avatar_key: null, sort, email: p.email ?? null })
    .select(PROFILE_COLS).single();
  if (error) {
    if (error.code === "23505") {
      throw new HttpError(409, error.message?.includes("email") ? EMAIL_TAKEN : taken(p.name));
    }
    dbFail("profile insert", error);
  }
  const circle = await getOrCreateCircle(familyId);
  await markRead(circle.id, (data as ProfileRow).id);
  return data as ProfileRow;
}

on("POST", "/profiles", async ({ ctx, body }) => {
  const b = await body();
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const role = str(b.role, "role", { max: 10, required: true });
  if (role !== "cook" && role !== "learner") throw new HttpError(400, "role must be cook or learner");
  const relation = str(b.relation, "relation", { max: MAX_NAME });
  const email = emailOf(b.email, false);
  if (email) assertCanSetEmail(ctx);
  return toProfile(await addProfile(ctx.family.id, ctx.profiles, { name, role, relation, email }));
});

/**
 * "This is me": a phone with no person yet (it came in through a family invite, or swapped the
 * family code) adds its own person, `{ name, role }`, with POST /profiles' rules, and becomes their
 * phone for good. Posts "<Name> joined." in the circle. x-profile-id isn't needed (and is ignored).
 */
on("POST", "/profiles/self", async ({ ctx, body }) => {
  const device = ctx.device;
  if (!device) throw new HttpError(400, "Send this phone's x-device-key to add yourself.");
  const belongsTo = (name: string | undefined) =>
    new HttpError(409, `This phone already belongs to ${name ?? "someone in this family"}.`);
  if (device.profile_id) throw belongsTo(ctx.everyone.find((p) => p.id === device.profile_id)?.name);
  const b = await body();
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const role = str(b.role, "role", { max: 10, required: true });
  if (role !== "cook" && role !== "learner") throw new HttpError(400, "role must be cook or learner");
  await rateLimit("profiles-self", ctx.family.id, 30, 60);
  const p = await addProfile(ctx.family.id, ctx.profiles, { name, role },
    (n) => `${n} is already in this family. Pick another name or tap your face.`);

  // Set once, atomically: if another tap gave this phone its person a moment ago, undo this one.
  const { data: owned, error } = await db.from("devices").update({ profile_id: p.id })
    .eq("id", device.id).is("profile_id", null).is("revoked_at", null).select("id");
  if (error || !owned?.length) {
    const del = await db.from("profiles").delete().eq("id", p.id);
    if (del.error) console.error("self undo:", del.error.message);
    if (error) dbFail("self owner", error);
    const { data: now, error: nErr } = await db.from("devices").select("revoked_at, profiles(name)")
      .eq("id", device.id).maybeSingle();
    if (nErr) dbFail("self owner find", nErr);
    if (!now || now.revoked_at) throw new HttpError(401, SIGNED_OUT);
    // deno-lint-ignore no-explicit-any
    throw belongsTo((now.profiles as any)?.name);
  }
  await quietNote(ctx.family.id, p.id, `${p.name} joined.`);
  return { ...toProfile(p), invited: false, has_phone: true, locked: false };
}, { ignoreMe: true });

/** Give someone already in the family an email, so they can sign in with it on a new phone (old builds). */
on("POST", "/profiles/:id/email", async ({ ctx, params, body }) => {
  assertCanSetEmail(ctx);
  const p = profileIn(ctx, params.id, "id");
  const b = await body();
  const email = emailOf(b.email, true)!;
  const taken = await profileByEmail(email);
  if (taken && taken.id !== p.id) throw new HttpError(409, EMAIL_TAKEN);
  const { data, error } = await db.from("profiles").update({ email })
    .eq("id", p.id).eq("family_id", ctx.family.id).select(PROFILE_COLS).single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, EMAIL_TAKEN);
    dbFail("profile email", error);
  }
  return toProfile(data as ProfileRow);
});

/**
 * Leave the family. Nobody removes anyone else: the person must be the one acting (x-profile-id),
 * either on their own phone (which signs that phone out) or with no phone of their own (Grandma,
 * acted as on Mom's phone or a shared one, which stays signed in). Anyone else gets 403 "Only <Name>
 * can remove themselves.". Their phones are signed out, their invites and Apple/Google link stop
 * working, and they leave every list; their old messages and notes keep their name and face. No
 * circle note. Removing someone already removed is fine (a repeated tap).
 */
on("POST", "/profiles/:id/remove", async ({ ctx, params }) => {
  const me = requireMe(ctx);
  const id = params.id.toLowerCase();
  if (ctx.everyone.some((p) => p.id === id && p.removed_at)) return { ok: true };
  const p = profileIn(ctx, id, "id");
  // authenticate() already refused acting as someone whose own phone this isn't.
  const self = p.id === me.id && (ctx.device?.profile_id === me.id || !ctx.phones.has(me.id));
  if (!self) throw new HttpError(403, `Only ${p.name} can remove themselves.`);
  await removeProfile(ctx.family.id, p.id);
  return { ok: true };
}, { keepOwner: true });

/**
 * Someone leaves `familyId` softly: "Leave the family" above, and a move to another family by a link
 * (joinLinks.ts). Their phones are signed out, their invites and Apple/Google link stop working, and
 * they leave every list; their old messages and notes keep their name and face.
 */
async function removeProfile(familyId: string, profileId: string): Promise<void> {
  const now = new Date().toISOString();
  // Sign out first, so a failure part-way never leaves a removed person with a working phone.
  const dev = await db.from("devices").update({ revoked_at: now }).eq("profile_id", profileId).is("revoked_at", null);
  if (dev.error) dbFail("remove devices", dev.error);
  await revokeInvites(profileId);
  // A family invite they sent lets anyone in, them included, so those stop working too. (A link
  // they sent naming someone else stays: it can only become that person, who can use it.)
  const sent = await db.from("invites").update({ status: "revoked" })
    .eq("inviter_id", profileId).is("profile_id", null).eq("status", "pending");
  if (sent.error) dbFail("remove family invites", sent.error);
  const idn = await db.from("identities").delete().eq("profile_id", profileId);
  if (idn.error) dbFail("remove identities", idn.error);
  // Their email goes too: old builds sign in with it (POST /auth/email).
  const up = await db.from("profiles").update({ removed_at: now, email: null })
    .eq("id", profileId).eq("family_id", familyId).is("removed_at", null);
  if (up.error) dbFail("remove profile", up.error);
  // A phone asking to move in as them stops waiting (its /move-requests/mine reads declined). Best
  // effort: the lists already leave out asks for someone removed.
  const moves = await db.from("move_requests").update({ status: "declined", decided_at: now })
    .eq("profile_id", profileId).eq("family_id", familyId).eq("status", "pending");
  if (moves.error) console.error("remove move requests:", moves.error.message);
}

// --- invites: a link texted from the sender's own Messages; one tap on Join and they're in.
// A family invite (the usual one) names nobody: whoever opens it adds themselves (POST
// /profiles/self). The older kind names one person (Mom invites Dad), whose face exists already.

const INVITE_DAYS = 14;
const INVITE_COLS = "id, family_id, inviter_id, profile_id, phone, status, expires_at, used_at, created_at";
type InviteRow = {
  id: string;
  family_id: string;
  inviter_id: string | null;
  /** The person invited; null for a family invite. */
  profile_id: string | null;
  phone: string | null;
  status: "pending" | "used" | "revoked";
  expires_at: string;
  used_at: string | null;
  created_at: string;
};
type InviteStatus = "pending" | "used" | "expired" | "revoked";

const inviteStatus = (r: InviteRow): InviteStatus =>
  r.status === "pending" && Date.parse(r.expires_at) <= Date.now() ? "expired" : r.status;

// INVITE_GONE (the 410 sentences) is joinLinks.ts's, which also uses up an old invite at sign-in.

/** Contact digits for display ("+15551234567"). Anything unreadable is dropped, never refused. */
function phoneOf(v: unknown): string | null {
  const s = str(v, "phone", { max: 40 });
  const digits = (s ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /^\+?\d{3,15}$/.test(digits) ? digits : null;
}

/** Turn off someone's pending invites (all but `keep`). */
async function revokeInvites(profileId: string, keep?: string): Promise<void> {
  let q = db.from("invites").update({ status: "revoked" }).eq("profile_id", profileId).eq("status", "pending");
  if (keep) q = q.neq("id", keep);
  const { error } = await q;
  if (error) dbFail("invite revoke", error);
}

async function createInvite(familyId: string, inviterId: string, profileId: string | null, phone: string | null) {
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  for (let i = 0; i < 5; i++) {
    const token = newInviteToken();
    const code = newInviteCode();
    const ins = await db.from("invites").insert({
      family_id: familyId,
      inviter_id: inviterId,
      profile_id: profileId,
      token_hash: await sha256Hex(token),
      code_hash: await sha256Hex(code),
      phone,
      expires_at: expiresAt,
    }).select("id, expires_at").single();
    if (!ins.error) {
      return {
        id: ins.data.id as string,
        // The code rides along so the web /i page can show it (only hashes are kept here).
        url: `${WEB_URL}/i?t=${token}&c=${code}`,
        code,
        expires_at: ins.data.expires_at as string,
        profile_id: profileId,
        phone,
      };
    }
    if (ins.error.code !== "23505") dbFail("invite insert", ins.error); // else a code collision: draw again
  }
  throw new HttpError(500, "Couldn't make an invite. Please try again.");
}

/**
 * `{}`: a family invite, for whoever opens it (no profile is made; they add themselves after Join).
 * Each opening of the app's invite sheet makes one. Older shapes still work: invite someone new
 * (`{ name, role, relation?, phone? }`: their profile is made now, so their face shows right away)
 * or send a fresh link to someone who hasn't joined (`{ profile_id, phone? }`; their older links stop
 * working). The app puts `url` in a text from the sender's own Messages (or any app).
 */
on("POST", "/invites", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  const b = await body();
  let phone = phoneOf(b.phone);
  const given = (v: unknown) => v !== undefined && v !== null;
  if (!given(b.name) && !given(b.profile_id)) {
    await rateLimit("invites", ctx.family.id, 50, 24 * 60, "That's a lot of invites for one day. Try again tomorrow.");
    return { invite: await createInvite(ctx.family.id, me.id, null, phone), profile: null };
  }
  let p: ProfileRow;
  if (given(b.profile_id)) {
    p = profileIn(ctx, b.profile_id, "profile_id");
    if (p.id === me.id) throw new HttpError(400, "You're already in.");
    if ((await signedInIds([p.id])).has(p.id)) throw new HttpError(409, `${p.name} already joined.`);
    await rateLimit("invites", ctx.family.id, 50, 24 * 60, "That's a lot of invites for one day. Try again tomorrow.");
    if (!phone) {
      // Keep the number picked last time, so "Send again" opens the same chat.
      const { data, error } = await db.from("invites").select("phone").eq("profile_id", p.id)
        .not("phone", "is", null).order("created_at", { ascending: false }).limit(1);
      if (error) dbFail("invite phone", error);
      phone = (data?.[0]?.phone as string | undefined) ?? null;
    }
    await revokeInvites(p.id);
  } else {
    const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
    const role = str(b.role, "role", { max: 10, required: true });
    if (role !== "cook" && role !== "learner") throw new HttpError(400, "role must be cook or learner");
    const relation = str(b.relation, "relation", { max: MAX_NAME });
    await rateLimit("invites", ctx.family.id, 50, 24 * 60, "That's a lot of invites for one day. Try again tomorrow.");
    p = await addProfile(ctx.family.id, ctx.profiles, { name, role, relation });
  }
  const invite = await createInvite(ctx.family.id, me.id, p.id, phone);
  return { invite, profile: { ...toProfile(p), invited: true } };
});

// --- the family's join link (joinLinks.ts, JOIN-SIMPLE.md §3): anyone may join by it for a week. It
// replaces the invites above in 1.1; they stay for 1.0 phones.

/** `{}` -> `{ url, expires_at }`: the family's live link (the same one all week), else a new one. */
on("POST", "/join-links", async ({ ctx }) => {
  const me = requireMe(ctx);
  await rateLimit("joinlinks", ctx.family.id, 50, 24 * 60, "That's a lot of invites for one day. Try again tomorrow.");
  return await familyJoinLink(joinDeps, ctx.family.id, me.id);
});

/** Turns the family's join link off (a link with no expiry, the TEST family's, is an operator's). */
on("POST", "/join-links/revoke", async ({ ctx }) => {
  requireMe(ctx);
  return await revokeJoinLinks(joinDeps, ctx.family.id);
});

/** Where a `{ token }` or `{ code }` body points. `hash` is null when it can't be an invite at all. */
async function inviteLookup(b: Record<string, unknown>) {
  const token = str(b.token, "token", { max: 100 });
  const code = str(b.code, "code", { max: 20 });
  if (token) {
    return { by: "token" as const, col: "token_hash", hash: INVITE_TOKEN.test(token) ? await sha256Hex(token) : null };
  }
  if (code) {
    const c = code.toUpperCase().replace(/[\s-]/g, "");
    return { by: "code" as const, col: "code_hash", hash: INVITE_CODE.test(c) ? await sha256Hex(c) : null };
  }
  throw new HttpError(400, "token or code is required");
}

async function findInvite(col: string, hash: string): Promise<InviteRow | null> {
  const { data, error } = await db.from("invites").select(INVITE_COLS).eq(col, hash).maybeSingle();
  if (error) dbFail("invite find", error);
  return (data as InviteRow | null) ?? null;
}

/** Misses count against the IP, on top of each route's own limit. */
async function inviteNotFound(ip: string, by: "token" | "code"): Promise<never> {
  await rateLimit("badinvite", ip, 20, 10);
  throw new HttpError(404, by === "code" ? "That invite code doesn't work." : "That invite link doesn't work.");
}

/**
 * A 6-letter code (32^6) could be guessed, unlike a link's 16-character token. So every typed code
 * is counted before it's looked up: per IP, and across the whole service, so many IPs together
 * can't sweep the codes. Links are never slowed by this.
 */
async function limitCodeTries(ip: string): Promise<void> {
  await rateLimit("invitecode-ip", ip, 20, 10, "Too many tries. Wait a few minutes, or tap the invite link instead.");
  try {
    await rateLimit("invitecode-all", "all", 100, 10, "Invite codes are busy right now. Tap the invite link instead.");
  } catch (e) {
    // Someone may be guessing codes. Shows in the function logs; links still work.
    if (e instanceof HttpError && e.status === 429) console.error("ALERT invite codes: the service-wide limit was hit");
    throw e;
  }
}

/**
 * Whether the phone sending `x-device-key` is already in this family (so the app says "You're
 * already in." instead of offering Join). Reads only: no last_seen bump, and a bad or signed-out
 * key is simply false. Without the header: undefined (left out of the answer).
 */
async function sameFamily(req: Request, familyId: string): Promise<boolean | undefined> {
  const key = req.headers.get("x-device-key")?.trim();
  if (!key) return undefined;
  if (!DEVICE_KEY.test(key)) return false;
  const { data, error } = await db.from("devices").select("family_id")
    .eq("key_hash", await sha256Hex(key)).is("revoked_at", null).maybeSingle();
  if (error) dbFail("peek device", error);
  return data?.family_id === familyId;
}

/**
 * What the invite page shows before anyone taps Join. Reads only: opening or previewing never joins.
 * `invitee` is null for a family invite (it names nobody). A family join link's 22-character token
 * answers from join_links, with `kind: "link"` (joinLinks.ts).
 */
onPublic("POST", "/invites/peek", async ({ req, body }) => {
  const ip = clientIp(req);
  await rateLimit("invitepeek-ip", ip, 60, 10);
  const b = await body();
  const raw = typeof b.token === "string" ? b.token.trim() : "";
  if (JOIN_TOKEN.test(raw)) {
    return (await peekJoinLink(joinDeps, raw, (familyId) => sameFamily(req, familyId))) ?? inviteNotFound(ip, "token");
  }
  const look = await inviteLookup(b);
  if (look.by === "code" && look.hash) await limitCodeTries(ip);
  const inv = look.hash ? await findInvite(look.col, look.hash) : null;
  if (!inv) return inviteNotFound(ip, look.by);
  const ids = [inv.profile_id, inv.inviter_id].filter((id): id is string => !!id);
  const [fam, people] = await Promise.all([
    db.from("families").select("name").eq("id", inv.family_id).single(),
    ids.length
      ? db.from("profiles").select("id, name, role, relation, avatar_key, removed_at").in("id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (fam.error) dbFail("invite family", fam.error);
  if (people.error) dbFail("invite people", people.error);
  const byId = new Map((people.data ?? []).map((p) => [p.id as string, p]));
  const invitee = inv.profile_id ? byId.get(inv.profile_id) : null;
  const inviter = inv.inviter_id ? byId.get(inv.inviter_id) : undefined;
  if (invitee === undefined) return inviteNotFound(ip, look.by); // names someone who no longer exists
  const status = inviteStatus(inv) === "pending" && invitee?.removed_at ? "revoked" : inviteStatus(inv);
  return {
    status,
    family_name: fam.data.name,
    inviter: inviter ? { name: inviter.name, relation: inviter.relation, avatar_key: inviter.avatar_key } : null,
    invitee: invitee ? { name: invitee.name, role: invitee.role, avatar_key: invitee.avatar_key } : null,
    expires_at: inv.expires_at,
    same_family: await sameFamily(req, inv.family_id),
  };
});

/**
 * The Join tap: uses the invite up and hands this phone its key. A named invite signs it in as that
 * person; a family invite makes a phone with no person yet (`profile_id: null`), which then adds
 * itself (POST /profiles/self) or asks to move in as someone already here (POST /move-requests).
 * A 1.1 family join link (22 characters) needs 1.1's Sign in with Apple: 426.
 */
onPublic("POST", "/invites/accept", async ({ req, body }) => {
  const ip = clientIp(req);
  await rateLimit("inviteaccept-ip", ip, 20, 10);
  const b = await body();
  refuseJoinLinkAccept(HttpError, b.token);
  const look = await inviteLookup(b);
  const label = deviceLabel(b);
  if (!look.hash) return inviteNotFound(ip, look.by);
  if (look.by === "code") await limitCodeTries(ip);

  // One conditional UPDATE … RETURNING: of two taps at once, exactly one gets the row.
  const now = new Date().toISOString();
  const { data: claimed, error } = await db.from("invites").update({ status: "used", used_at: now })
    .eq(look.col, look.hash).eq("status", "pending").gt("expires_at", now).select(INVITE_COLS);
  if (error) dbFail("invite claim", error);
  const inv = (claimed ?? [])[0] as InviteRow | undefined;
  if (!inv) {
    const row = await findInvite(look.col, look.hash);
    if (!row) return inviteNotFound(ip, look.by);
    const status = inviteStatus(row);
    // Still pending: another tap's claim was just released. The next tap will work.
    if (status === "pending") throw new HttpError(409, "Please tap Join again.");
    throw new HttpError(410, INVITE_GONE[status], { status });
  }

  let joined: { device: { id: string; key: string }; person: ProfileRow | null; familyName: string };
  try {
    const [p, fam] = await Promise.all([
      inv.profile_id
        ? db.from("profiles").select(`${PROFILE_COLS}, removed_at`).eq("id", inv.profile_id).single()
        : Promise.resolve({ data: null, error: null }),
      db.from("families").select("name").eq("id", inv.family_id).single(),
    ]);
    if (p.error) dbFail("invitee", p.error);
    if (fam.error) dbFail("invite family", fam.error);
    const person = (p.data as ProfileRow | null) ?? null;
    if (person?.removed_at) {
      await db.from("invites").update({ status: "revoked" }).eq("id", inv.id);
      throw new HttpError(410, INVITE_GONE.revoked, { status: "revoked" });
    }
    joined = { device: await createDevice(inv.family_id, person?.id ?? null, "invite", label), person, familyName: fam.data.name };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 410)) {
      // Nothing was handed out: put the invite back so the next tap works.
      await db.from("invites").update({ status: "pending", used_at: null })
        .eq("id", inv.id).eq("status", "used").is("used_device_id", null);
    }
    throw e;
  }

  // The key exists now; everything after it is best effort so the key always reaches the phone.
  // A family invite posts no note yet: "<Name> joined." comes when the phone says who it is.
  const { device, person, familyName } = joined;
  try {
    const up = await db.from("invites").update({ used_device_id: device.id }).eq("id", inv.id);
    if (up.error) console.error("invite device:", up.error.message);
    if (person) {
      await revokeInvites(person.id, inv.id);
      await insertMessage(await getOrCreateCircle(inv.family_id), person.id, { kind: "system", body: `${person.name} joined.` });
    }
  } catch (e) {
    console.error("invite accepted; follow-up failed:", (e as Error).message);
  }
  return { device_key: device.key, family_name: familyName, profile_id: person?.id ?? null };
});

// --- moving to a new phone. Dad lost his phone and joined again through a family link, so his new
// phone has a key with no person. It asks to be Dad; someone else settled, on their own phone, lets
// him in, which makes the new phone his and signs his other phones out. A request lives 7 days.

const MOVE_DAYS = 7;
const MOVE_COLS = "id, family_id, profile_id, device_id, status, created_at, decided_at, decided_by";
type MoveRow = {
  id: string;
  family_id: string;
  /** The person the phone asks to be. */
  profile_id: string;
  /** The asking phone: a family-invite key with no person yet. */
  device_id: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};
type MoveStatus = MoveRow["status"] | "expired";

const ALREADY_HANDLED = "Already handled.";
const MOVE_EXPIRED = "That request expired.";

/** Requests made at or before this are expired. */
const moveCutoff = () => new Date(Date.now() - MOVE_DAYS * 86_400_000).toISOString();
/** Expired is computed, never stored: a pending request older than 7 days. */
const moveStatus = (r: MoveRow): MoveStatus =>
  r.status === "pending" && Date.parse(r.created_at) <= Date.parse(moveCutoff()) ? "expired" : r.status;

/** On their own phone: this key's person is the acting person (not lent to Grandma, not the family code). */
const onOwnPhone = (ctx: Ctx) => !!ctx.me && !!ctx.device && ctx.device.profile_id === ctx.me.id;

/** Someone whose first phone joined longer ago than this is settled. */
const SETTLED_MS = 24 * 3_600_000;
const NOT_SETTLED = "You can do this after your first day here.";

/**
 * Of these people, the settled ones: their first phone joined over a day ago (their earliest key,
 * signed out or not; with no key ever, when they were added), or they're the family's first person
 * (the earliest added, removed people included: when the founder leaves, nobody inherits it, so it
 * can't fall to whoever joined a minute ago). Only settled people answer asks to move in, so
 * someone who opened a forwarded invite a minute ago can't let a stranger in as Grandma.
 */
async function settledIds(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db.from("devices").select("profile_id, created_at")
    .eq("family_id", ctx.family.id).in("profile_id", ids);
  if (error) dbFail("settled", error);
  const firstPhone = new Map<string, number>();
  for (const d of data ?? []) {
    const at = Date.parse(d.created_at as string);
    firstPhone.set(d.profile_id as string, Math.min(at, firstPhone.get(d.profile_id as string) ?? at));
  }
  const added = (p: ProfileRow) => Date.parse(p.created_at ?? "");
  const first = [...ctx.everyone].sort((a, b) => added(a) - added(b) || a.sort - b.sort)[0]?.id;
  const cutoff = Date.now() - SETTLED_MS;
  return new Set(ids.filter((id) => {
    if (id === first) return true;
    const p = ctx.profiles.find((x) => x.id === id);
    return (firstPhone.get(id) ?? (p ? added(p) : NaN)) <= cutoff;
  }));
}

function requireOwnPhone(ctx: Ctx): ProfileRow {
  const me = requireMe(ctx);
  if (!onOwnPhone(ctx)) throw new HttpError(403, "Only someone on their own phone can let people in.");
  return me;
}

/** Someone who may answer asks: on their own phone (403 otherwise) and settled (403 otherwise). */
async function requireAnswerer(ctx: Ctx): Promise<ProfileRow> {
  const me = requireOwnPhone(ctx);
  if (!(await settledIds(ctx, [me.id])).has(me.id)) throw new HttpError(403, NOT_SETTLED);
  return me;
}

/**
 * The asks this caller can answer: pending and unexpired, in my family, not to be me, for someone
 * still in the family, from a phone still waiting (not signed out, no person yet). Newest first.
 * Nobody but someone settled, on their own phone, answers anything.
 */
async function answerableMoves(ctx: Ctx): Promise<MoveRow[]> {
  if (!onOwnPhone(ctx) || !(await settledIds(ctx, [ctx.me!.id])).has(ctx.me!.id)) return [];
  const { data, error } = await db.from("move_requests").select(MOVE_COLS)
    .eq("family_id", ctx.family.id).eq("status", "pending").gt("created_at", moveCutoff())
    .neq("profile_id", ctx.me!.id).order("created_at", { ascending: false }).limit(50);
  if (error) dbFail("move requests", error);
  const rows = ((data ?? []) as MoveRow[]).filter((r) => ctx.profiles.some((p) => p.id === r.profile_id));
  if (!rows.length) return rows;
  const { data: devs, error: dErr } = await db.from("devices").select("id")
    .in("id", [...new Set(rows.map((r) => r.device_id))]).is("profile_id", null).is("revoked_at", null);
  if (dErr) dbFail("move phones", dErr);
  const waiting = new Set((devs ?? []).map((d) => d.id as string));
  return rows.filter((r) => waiting.has(r.device_id));
}

async function moveIn(ctx: Ctx, id: string): Promise<MoveRow> {
  if (!UUID.test(id)) throw new HttpError(404, "No such request.");
  const { data, error } = await db.from("move_requests").select(MOVE_COLS)
    .eq("id", id.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
  if (error) dbFail("move request", error);
  if (!data) throw new HttpError(404, "No such request.");
  return data as MoveRow;
}

/** 409 once approved or declined, 410 once expired. */
function assertOpen(r: MoveRow): void {
  const s = moveStatus(r);
  if (s === "expired") throw new HttpError(410, MOVE_EXPIRED);
  if (s !== "pending") throw new HttpError(409, ALREADY_HANDLED);
}

/**
 * pending -> `to`, in one conditional update (still pending, not expired), so of two answers at once
 * exactly one lands. The other gets 409 (or 410 if it expired in between).
 */
async function decideMove(ctx: Ctx, r: MoveRow, to: "approved" | "declined", by: string): Promise<void> {
  const { data, error } = await db.from("move_requests")
    .update({ status: to, decided_at: new Date().toISOString(), decided_by: by })
    .eq("id", r.id).eq("status", "pending").gt("created_at", moveCutoff()).select("id");
  if (error) dbFail("move decide", error);
  if (data?.length) return;
  assertOpen(await moveIn(ctx, r.id));
  throw new HttpError(409, ALREADY_HANDLED);
}

const asked = (r: MoveRow) => ({ id: r.id, profile_id: r.profile_id, status: "pending" as const, created_at: r.created_at });

/**
 * `{ profile_id }`: this phone (a family-invite key with no person) asks to be someone in the
 * family. One pending ask per phone: the same person again returns it; someone else replaces it
 * (the old one is declined); an expired one is declined and a new one made. No circle note: moving
 * in is seamless. x-profile-id isn't read.
 */
on("POST", "/move-requests", async ({ ctx, body }) => {
  const device = ctx.device;
  if (!device || device.via !== "invite" || device.profile_id) {
    throw new HttpError(400, "Only a phone that just joined can ask to move in.");
  }
  const b = await body();
  // TODO(caleb): anyone still in the family can be asked for, phone-less faces and people only
  // invited included (approval is the check). Narrow it here if that's too open.
  const target = profileIn(ctx, b.profile_id, "profile_id");
  await rateLimit("move-requests", ctx.family.id, 30, 60, "That's a lot of asks for one hour. Try again later.");

  const { data: open, error } = await db.from("move_requests").select(MOVE_COLS)
    .eq("device_id", device.id).eq("status", "pending");
  if (error) dbFail("move find", error);
  for (const r of (open ?? []) as MoveRow[]) {
    if (moveStatus(r) === "pending" && r.profile_id === target.id) return asked(r); // a repeat tap
    // Expired, or for someone else: this ask replaces it.
    const up = await db.from("move_requests").update({ status: "declined", decided_at: new Date().toISOString() })
      .eq("id", r.id).eq("status", "pending");
    if (up.error) dbFail("move replace", up.error);
  }
  const ins = await db.from("move_requests")
    .insert({ family_id: ctx.family.id, profile_id: target.id, device_id: device.id })
    .select(MOVE_COLS).single();
  if (ins.error) {
    if (ins.error.code !== "23505") dbFail("move insert", ins.error);
    // Another tap made one a moment ago (one pending per phone): if it's for the same person, it stands.
    const { data: won, error: wErr } = await db.from("move_requests").select(MOVE_COLS)
      .eq("device_id", device.id).eq("status", "pending").maybeSingle();
    if (wErr) dbFail("move refind", wErr);
    if (won && (won as MoveRow).profile_id === target.id) return asked(won as MoveRow);
    throw new HttpError(409, "Please try again.");
  }
  return asked(ins.data as MoveRow);
}, { ignoreMe: true });

/** How many people a waiting phone names ("Waiting for Mom or Dad"). */
const ASKED_MAX = 3;

/**
 * This phone's latest ask, `{ id, profile_id, status, asked, let_in_by }` (status may read
 * `expired`), or null. `asked`: while pending, the names of up to 3 people who can let them in
 * (settled, on their own phone, not the person asked for), in family order, so the waiting phone
 * can say who and offer to text them. `let_in_by`: who approved it (else null).
 */
on("GET", "/move-requests/mine", async ({ ctx }) => {
  if (!ctx.device) return null;
  const { data, error } = await db.from("move_requests").select(MOVE_COLS)
    .eq("device_id", ctx.device.id).order("created_at", { ascending: false }).limit(1);
  if (error) dbFail("my move", error);
  const r = (data ?? [])[0] as MoveRow | undefined;
  if (!r) return null;
  const status = moveStatus(r);
  let asked: string[] = [];
  if (status === "pending") {
    const can = ctx.profiles.filter((p) => p.id !== r.profile_id && ctx.phones.has(p.id));
    const settled = await settledIds(ctx, can.map((p) => p.id));
    asked = can.filter((p) => settled.has(p.id)).slice(0, ASKED_MAX).map((p) => p.name);
  }
  const by = status === "approved" ? ctx.everyone.find((p) => p.id === r.decided_by) : undefined;
  return { id: r.id, profile_id: r.profile_id, status, asked, let_in_by: by?.name ?? null };
}, { ignoreMe: true });

/** The asks I can answer (see answerableMoves); `[]` unless I'm settled and on my own phone. */
on("GET", "/move-requests", async ({ ctx }) => {
  const rows = await answerableMoves(ctx);
  const byId = new Map(ctx.profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ id: r.id, profile: toProfile(byId.get(r.profile_id)!), created_at: r.created_at }));
});

/** Put a request back to pending after a failure part-way, so the next tap can try again. */
async function reopenMove(r: MoveRow): Promise<void> {
  const { error } = await db.from("move_requests").update({ status: "pending", decided_at: null, decided_by: null })
    .eq("id", r.id).eq("status", "approved");
  if (error) console.error("move reopen:", error.message);
}

/**
 * Let them in: the asking phone becomes theirs and their other phones are signed out. First answer
 * wins. No circle note.
 */
on("POST", "/move-requests/:id/approve", async ({ ctx, params }) => {
  const me = await requireAnswerer(ctx);
  const r = await moveIn(ctx, params.id);
  if (r.profile_id === me.id) throw new HttpError(400, "You can't let yourself in.");
  assertOpen(r);
  const target = ctx.profiles.find((p) => p.id === r.profile_id);
  if (!target) {
    // Removed since they asked (removal closes these; this is a request racing it).
    await decideMove(ctx, r, "declined", me.id);
    throw new HttpError(409, ALREADY_HANDLED);
  }
  await decideMove(ctx, r, "approved", me.id);

  // The asking phone becomes theirs, only while it still waits: not signed out, no person yet.
  const { data: moved, error } = await db.from("devices").update({ profile_id: target.id })
    .eq("id", r.device_id).eq("family_id", ctx.family.id).is("profile_id", null).is("revoked_at", null).select("id");
  if (error) {
    await reopenMove(r);
    dbFail("move phone", error);
  }
  if (!moved?.length) {
    const up = await db.from("move_requests").update({ status: "declined" }).eq("id", r.id).eq("status", "approved");
    if (up.error) console.error("move not waiting:", up.error.message);
    throw new HttpError(409, "That phone isn't waiting anymore.");
  }
  // Their other phones are signed out: the lost one, and any other key that was theirs.
  const out = await db.from("devices").update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", target.id).is("revoked_at", null).neq("id", r.device_id);
  if (out.error) {
    // Undo the move so a retry does the whole thing (a key signed out already stays out: safe).
    const back = await db.from("devices").update({ profile_id: null }).eq("id", r.device_id).eq("profile_id", target.id);
    if (back.error) console.error("move undo:", back.error.message);
    await reopenMove(r);
    dbFail("move sign out", out.error);
  }
  // They're in on this phone: links sent to them earlier stop working.
  await revokeInvites(target.id).catch((e) => console.error("move invites:", e.message));
  return { ok: true };
});

/** Say no: pending -> declined. No note. The phone can ask again. */
on("POST", "/move-requests/:id/decline", async ({ ctx, params }) => {
  const me = await requireAnswerer(ctx);
  const r = await moveIn(ctx, params.id);
  assertOpen(r);
  await decideMove(ctx, r, "declined", me.id);
  return { ok: true };
});

// --- threads (the circle comes first) and the family circle

on("GET", "/threads", async ({ ctx }) => {
  const me = requireMe(ctx);
  const list = await summaries(ctx, me);
  const withLast = list.filter((s) => s.last);
  const lasts = new Map((await toMessages(ctx, withLast.map((s) => s.last!))).map((m) => [m.id, m]));
  return list.map((s) => ({
    id: s.thread.id,
    kind: s.thread.kind,
    other: s.other,
    members: s.members.map(toProfile),
    last: s.last ? lasts.get(s.last.id) ?? null : null,
    unread: s.unread,
    recipe_id: s.recipe_id,
    postcards: s.postcards,
  }));
});

on("POST", "/threads", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  const b = await body();
  const other = profileIn(ctx, b.other_id, "other_id");
  const t = await getOrCreateThread(ctx.family.id, me.id, other.id);
  return { id: t.id, other: toProfile(other) };
});

on("GET", "/circle", async ({ ctx }) => {
  const t = await getOrCreateCircle(ctx.family.id);
  return { id: t.id, kind: "circle", members: ctx.profiles.map(toProfile) };
});

on("GET", "/threads/:id/messages", async ({ ctx, params, url }) => {
  const me = requireMe(ctx);
  const t = await threadFor(ctx, me, params.id);
  let q = db.from("messages").select(MESSAGE_COLS).eq("thread_id", t.id);
  // A raw "+00:00" offset arrives as a space when the client forgets to URL-encode it.
  const after = url.searchParams.get("after")?.trim().replace(" ", "+");
  if (after) {
    const ms = Date.parse(after);
    if (Number.isNaN(ms) || after.length > 40) throw new HttpError(400, "after must be an ISO timestamp");
    q = q.gt("created_at", after); // pass the server's own string through: keeps microsecond precision
  }
  // Newest 500, returned oldest first.
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (error) dbFail("messages", error);
  return toMessages(ctx, ((data ?? []) as MessageRow[]).reverse());
});

on("POST", "/threads/:id/messages", async ({ ctx, params, body }) => {
  const me = requireMe(ctx);
  const t = await threadFor(ctx, me, params.id);
  const gone = removedOther(ctx, t, me);
  if (gone) throw new HttpError(403, `${gone.name} isn't in the family anymore.`);
  const { m, replyTo } = await parseMessage(ctx, t, await body());
  if (m.kind === "reaction" && m.reply_to) {
    // Tapping "Just like mine" twice sends one.
    const { data: same, error } = await db.from("messages").select(MESSAGE_COLS)
      .eq("thread_id", t.id).eq("sender_id", me.id).eq("kind", "reaction").eq("reply_to", m.reply_to).eq("body", m.body!)
      .limit(1);
    if (error) dbFail("reaction find", error);
    if (same?.length) return (await toMessages(ctx, same as MessageRow[]))[0];
  }
  const row = await insertMessage(t, me.id, m);
  // A cook answering a question about a recipe (any question in the circle; in a 1:1 chat, one
  // asked of them) answers it, and the answer is kept in the recipe for the whole family.
  const target = replyTo ? questionTargets(ctx, [replyTo], new Map([[t.id, t]])).get(replyTo.id) : undefined;
  if (
    target && replyTo!.recipe_id && me.role === "cook" && canAnswer(ctx, target, me.id) &&
    (row.kind === "text" || row.kind === "voice")
  ) {
    await saveNote(ctx, row, replyTo);
  }
  // The other person's phone (handoff 2.5 rows 1-3), after the response; never the sender.
  runInBackground(pushMessage(ctx, me, t, row, replyTo));
  return (await toMessages(ctx, [row]))[0];
});

on("POST", "/threads/:id/read", async ({ ctx, params }) => {
  const me = requireMe(ctx);
  const t = await threadFor(ctx, me, params.id);
  await markRead(t.id, me.id);
  return { ok: true };
});

on("GET", "/unread", async ({ ctx }) => {
  const me = requireMe(ctx);
  const list = await summaries(ctx, me);
  return { total: list.reduce((s, x) => s + x.unread, 0) };
});

// --- questions and recipe notes

/**
 * Open questions for "Waiting for your answer": the circle's (not my own, and none asked before I
 * joined the family: a newcomer starts with no backlog), plus, for a cook, the 1:1 questions asked
 * of me. Newest first, at most 50.
 */
on("GET", "/questions/open", async ({ ctx }) => {
  const circle = await getOrCreateCircle(ctx.family.id);
  const me = ctx.me;
  const { data, error } = await db.from("messages").select(MESSAGE_COLS)
    .eq("thread_id", circle.id).eq("kind", "question")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) dbFail("open questions", error);
  const threads = new Map<string, ThreadRow>([[circle.id, circle]]);
  const joined = me?.created_at ? Date.parse(me.created_at) : NaN;
  let rows = ((data ?? []) as MessageRow[])
    .filter((m) => m.sender_id !== me?.id && !(Date.parse(m.created_at) < joined));

  if (me?.role === "cook") {
    const { data: pairs, error: tErr } = await db.from("threads").select(THREAD_COLS)
      .eq("family_id", ctx.family.id).eq("kind", "pair")
      .or(`a_profile.eq.${me.id},b_profile.eq.${me.id}`).not("last_message_at", "is", null);
    if (tErr) dbFail("question pairs", tErr);
    for (const t of (pairs ?? []) as ThreadRow[]) threads.set(t.id, t);
    const pairIds = ((pairs ?? []) as ThreadRow[]).map((t) => t.id);
    const asked = await inChunks(pairIds, async (chunk) => {
      const { data: d, error: e } = await db.from("messages").select(MESSAGE_COLS)
        .in("thread_id", chunk).in("kind", ["question", "step"]).neq("sender_id", me.id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
      if (e) dbFail("open pair questions", e);
      return (d ?? []) as MessageRow[];
    });
    const targets = questionTargets(ctx, asked, threads);
    rows = [...rows, ...asked.filter((m) => targets.get(m.id)?.answerer === me.id)]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1));
  }

  const answers = await answersFor(ctx, rows, threads);
  const open = rows.filter((m) => !answers.has(m.id)).slice(0, 50);
  const byId = new Map(ctx.profiles.map((p) => [p.id, p]));
  const messages = await toMessages(ctx, open);
  return messages.flatMap((m) => {
    const asker = byId.get(m.sender_id);
    const kind = threads.get(m.thread_id)?.kind ?? "circle";
    return asker ? [{ message: m, asker: toProfile(asker), thread_kind: kind }] : [];
  });
});

on("POST", "/recipe-notes", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  if (me.role !== "cook") throw new HttpError(403, "Only cooks can save to a recipe");
  const b = await body();
  if (typeof b.message_id !== "string" || !UUID.test(b.message_id)) throw new HttpError(400, "message_id must be a message id");
  const { data, error } = await db.from("messages").select(MESSAGE_COLS)
    .eq("id", b.message_id.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
  if (error) dbFail("note message", error);
  if (!data) throw new HttpError(404, "No such message");
  const msg = data as MessageRow;
  if (msg.sender_id !== me.id) throw new HttpError(403, "You can only save your own messages");
  if (!NOTE_KINDS.has(msg.kind)) throw new HttpError(400, "That message can't be saved to a recipe");
  let question: MessageRow | null = null;
  if (msg.reply_to) {
    const r = await db.from("messages").select(MESSAGE_COLS).eq("id", msg.reply_to).eq("family_id", ctx.family.id).maybeSingle();
    if (r.error) dbFail("note question", r.error);
    question = (r.data as MessageRow | null) ?? null;
  }
  const note = await saveNote(ctx, msg, question);
  if (!note) throw new HttpError(400, "There's nothing in that message to save");
  return (await toNotes(ctx, [note]))[0];
});

/**
 * Take a saved answer back out of the recipe (one saved by mistake). The answer's author, the person
 * who asked, or the dish's cook (by name, from its recipe.json) may. The note goes, and the answer
 * message no longer replies to the question, so the question is open again unless someone else
 * answered it too. The message itself stays in the chat.
 */
on("POST", "/recipe-notes/:id/remove", async ({ ctx, params }) => {
  const me = requireMe(ctx);
  if (!UUID.test(params.id)) throw new HttpError(404, "That answer isn't in the recipe anymore.");
  const { data, error } = await db.from("recipe_notes").select(NOTE_COLS)
    .eq("id", params.id.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
  if (error) dbFail("note", error);
  if (!data) throw new HttpError(404, "That answer isn't in the recipe anymore.");
  const note = data as NoteRow;
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  const mine = note.answered_by === me.id || note.asked_by === me.id ||
    (!!norm(me.name) && norm(await recipeCook(note.recipe_id)) === norm(me.name));
  if (!mine) throw new HttpError(403, "Only the person who answered, the person who asked, or the cook can take this out.");
  const del = await db.from("recipe_notes").delete().eq("id", note.id).eq("family_id", ctx.family.id);
  if (del.error) dbFail("note delete", del.error);
  const up = await db.from("messages").update({ reply_to: null })
    .eq("id", note.answer_message_id).eq("family_id", ctx.family.id);
  if (up.error) dbFail("note unlink", up.error);
  return { ok: true, answer_message_id: note.answer_message_id, question_message_id: note.question_message_id };
});

on("GET", "/recipes/:id/notes", async ({ ctx, params }) => {
  const rid = recipeId(params.id, "recipe id")!;
  const { data, error } = await db.from("recipe_notes").select(NOTE_COLS)
    .eq("family_id", ctx.family.id).eq("recipe_id", rid)
    .order("step_order", { ascending: true, nullsFirst: false }).order("created_at").limit(500);
  if (error) dbFail("notes", error);
  return toNotes(ctx, (data ?? []) as NoteRow[]);
});

/**
 * The open questions about one dish, for cook mode's "waiting" line under a step's Ask: the
 * circle's (everyone in the family sees those) plus, with `x-profile-id`, the ones I asked in a
 * 1:1. Other people's 1:1 questions stay private. Newest first, at most 50. `waiting_for` is the
 * person a 1:1 question was asked of (null in the circle: any cook can answer). A question whose
 * asker, or the person asked, has left the family is dropped (nobody is waiting on it).
 */
on("GET", "/recipes/:id/questions", async ({ ctx, params }) => {
  const rid = recipeId(params.id, "recipe id")!;
  const me = ctx.me;
  const { data, error } = await db.from("messages").select(MESSAGE_COLS)
    .eq("family_id", ctx.family.id).eq("recipe_id", rid).in("kind", ["question", "step"])
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) dbFail("recipe questions", error);
  const rows = (data ?? []) as MessageRow[];
  const threads = await threadsOf(ctx, rows);
  const targets = questionTargets(ctx, rows, threads);
  const visible = rows.filter((m) => {
    const t = targets.get(m.id);
    return !!t && (t.answerer === null || (!!me && m.sender_id === me.id));
  });
  const answers = await answersFor(ctx, visible, threads);
  const byId = new Map(ctx.profiles.map((p) => [p.id, p]));
  return visible.filter((m) => !answers.has(m.id)).flatMap((m) => {
    const asker = byId.get(m.sender_id);
    const to = targets.get(m.id)!.answerer;
    const waiting = to ? byId.get(to) : null;
    if (!asker || waiting === undefined) return [];
    return [{
      id: m.id,
      thread_id: m.thread_id,
      thread_kind: threads.get(m.thread_id)?.kind ?? "circle",
      step_order: m.step_order,
      body: m.body ?? m.transcript,
      created_at: m.created_at,
      asker: toProfile(asker),
      mine: !!me && m.sender_id === me.id,
      waiting_for: waiting ? toProfile(waiting) : null,
    }];
  }).slice(0, 50);
});

// --- voice notes

on("POST", "/voice-upload", async ({ ctx, body }) => {
  requireMe(ctx);
  const b = await body();
  const type = (str(b.content_type, "content_type", { max: 40 }) ?? "audio/m4a").toLowerCase();
  const ext = VOICE_EXT[type];
  if (!ext) throw new HttpError(400, `content_type must be one of ${Object.keys(VOICE_EXT).join(", ")}`);
  const path = `${ctx.family.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db.storage.from(VOICE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) dbFail("signed upload", error as { message?: string });
  return {
    path,
    upload_url: data.signedUrl,
    method: "PUT",
    headers: { "content-type": type },
    max_bytes: 10 * 1024 * 1024,
    expires_in_s: 7200,
  };
});

// --- photos ("I made it": a photo of the dish someone made, for the cook)

on("POST", "/photo-upload", async ({ ctx, body }) => {
  requireMe(ctx);
  const b = await body();
  const type = (str(b.content_type, "content_type", { max: 40 }) ?? "image/jpeg").toLowerCase();
  const ext = PHOTO_EXT[type];
  if (!ext) throw new HttpError(400, `content_type must be one of ${Object.keys(PHOTO_EXT).join(", ")}`);
  const path = `${ctx.family.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) dbFail("signed photo upload", error as { message?: string });
  return {
    path,
    upload_url: data.signedUrl,
    method: "PUT",
    headers: { "content-type": type === "image/jpg" ? "image/jpeg" : type },
    max_bytes: MAX_PHOTO_BYTES,
    expires_in_s: 7200,
  };
});

/** A postcard's optional "How close to Mom's?": a whole number of pots, 1-5 (null = not rated). */
function postcardRating(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
    throw new HttpError(400, "rating must be a whole number from 1 to 5");
  }
  return v;
}

/**
 * "Send it home" (retention PR 3, RETENTION-HANDOFF 3.4): the photo postcard goes on the `cooked`
 * message "I made it" already sent, so the cook's chat and Home keep one card per dish made. Only its
 * sender may; the photo was PUT through /photo-upload first (qa-cook's bucket & path rule). Posting
 * again replaces the photo and the rating (a retry, "Take another"); the dish's cook is pushed once per
 * message ("Leo made your Sunday Chili" / "Sent you a postcard."), after the response.
 */
on("POST", "/messages/:id/postcard", async ({ ctx, params, body }) => {
  const me = requireMe(ctx);
  if (!UUID.test(params.id)) throw new HttpError(404, "No such message");
  const b = await body();
  const { data, error } = await db.from("messages").select(MESSAGE_COLS)
    .eq("id", params.id.toLowerCase()).eq("family_id", ctx.family.id).maybeSingle();
  if (error) dbFail("postcard message", error);
  if (!data) throw new HttpError(404, "No such message");
  const row = data as MessageRow;
  if (row.sender_id !== me.id) throw new HttpError(403, "Only whoever made the dish can send its postcard");
  if (row.kind !== "cooked") throw new HttpError(400, "A postcard goes on a dish you made");
  const t = await threadFor(ctx, me, row.thread_id);
  const gone = removedOther(ctx, t, me);
  if (gone) throw new HttpError(403, `${gone.name} isn't in the family anymore.`);
  const photo = photoPathFor(ctx.family.id, b.photo_path, "photo_path");
  if (!photo) throw new HttpError(400, "photo_path is required");
  const rating = postcardRating(b.rating);
  await rateLimit("postcard", me.id, 60, 60);
  if (!(await voiceExists(photo, PHOTO_BUCKET))) throw new HttpError(400, "Upload the photo before sending it");
  const { data: up, error: upErr } = await db.from("messages").update({ photo_path: photo, rating })
    .eq("id", row.id).eq("family_id", ctx.family.id).select(MESSAGE_COLS).single();
  if (upErr) dbFail("postcard", upErr);
  const saved = up as MessageRow;
  runInBackground(pushPostcard(ctx, me, t, saved));
  return (await toMessages(ctx, [saved]))[0];
});

// --- sending recipes inside the family

on("POST", "/send-recipe", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  const note = str(b.note, "note", { max: MAX_BODY_CHARS });
  let targets: ProfileRow[];
  if (b.to === "everyone") {
    targets = ctx.profiles.filter((p) => p.id !== me.id);
  } else if (Array.isArray(b.to) && b.to.length > 0 && b.to.length <= 30) {
    const ids = [...new Set(b.to.map((x) => String(x).toLowerCase()))];
    targets = ids.map((id) => profileIn(ctx, id, "to")).filter((p) => p.id !== me.id);
  } else {
    throw new HttpError(400, "to must be a non-empty list of profile ids, or \"everyone\"");
  }
  if (!targets.length) throw new HttpError(400, "Pick someone other than yourself");
  await assertRecipe(rid);
  const sent = [];
  for (const p of targets) {
    const t = await getOrCreateThread(ctx.family.id, me.id, p.id);
    const m = await insertMessage(t, me.id, { kind: "recipe", recipe_id: rid, body: note });
    sent.push({ profile_id: p.id, thread_id: t.id, message_id: m.id });
  }
  runInBackground(pushRecipes(me.name, rid, sent));
  return { sent };
});

// --- public share links

on("POST", "/shares", async ({ ctx, body }) => {
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  await assertRecipe(rid);
  const sender = ctx.me?.id ?? null;
  // One stable link per (family, recipe, sender), so re-opening the share sheet reuses it, until
  // it is full (MAX_JOINS_PER_LINK people joined through it): then a fresh one.
  let q = db.from("shares").select("token").eq("family_id", ctx.family.id).eq("recipe_id", rid);
  q = sender ? q.eq("sender_id", sender) : q.is("sender_id", null);
  const { data: existing, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) dbFail("share find", error);
  let token = existing?.[0]?.token as string | undefined;
  if (token && (await joinsVia(token, ctx.family.id)) >= MAX_JOINS_PER_LINK) token = undefined;
  for (let i = 0; !token && i < 5; i++) {
    const candidate = newToken();
    const ins = await db.from("shares").insert({ token: candidate, family_id: ctx.family.id, recipe_id: rid, sender_id: sender });
    if (!ins.error) token = candidate;
    else if (ins.error.code !== "23505") dbFail("share insert", ins.error);
  }
  if (!token) throw new HttpError(500, "Couldn't make a link. Please try again.");
  return { token, url: `${WEB_URL}/r?s=${token}` };
});

onPublic("GET", "/shares/:token", async ({ params }) => {
  const token = params.token;
  if (!TOKEN.test(token)) throw new HttpError(404, "This link doesn't work anymore");
  const { data, error } = await db.from("shares")
    .select("token, recipe_id, sender_id, family_id, families(name), profiles(name, relation, avatar_key)")
    .eq("token", token).maybeSingle();
  if (error) dbFail("share", error);
  if (!data) throw new HttpError(404, "This link doesn't work anymore");
  const { error: rpcErr } = await db.rpc("share_opened", { p_token: token });
  if (rpcErr) console.error("share_opened:", rpcErr.message);
  // deno-lint-ignore no-explicit-any
  const fam = data.families as any;
  // deno-lint-ignore no-explicit-any
  const sender = data.profiles as any;
  return {
    token: data.token,
    recipe_id: data.recipe_id,
    recipe_url: `${BUCKET_URL}/${data.recipe_id}/recipe.json`,
    sender: sender ? { name: sender.name, relation: sender.relation, avatar_key: sender.avatar_key } : null,
    family_name: fam?.name ?? null,
  };
});

// --- sign-up and email sign-in

/** A share token that names a real link, or null. */
async function validShare(v: unknown): Promise<{ token: string; family_id: string; sender_id: string | null } | null> {
  const token = str(v, "share_token", { max: 10 });
  if (!token || !TOKEN.test(token)) return null;
  const { data, error } = await db.from("shares").select("token, family_id, sender_id").eq("token", token).maybeSingle();
  if (error) dbFail("share check", error);
  return data ?? null;
}

/**
 * How many people have joined a family through one link (from the sign-up log). A leaked link
 * stops working after MAX_JOINS_PER_LINK; POST /shares then hands out a fresh one.
 */
const MAX_JOINS_PER_LINK = 5;
async function joinsVia(token: string, familyId: string): Promise<number> {
  const { count, error } = await db.from("signups").select("id", { count: "exact", head: true })
    .eq("share_token", token).eq("family_id", familyId);
  if (error) dbFail("link joins", error);
  return count ?? 0;
}

/** A share-link sign-in typed the name of someone they can't become. */
const nameTaken = (name: string) => new HttpError(409, `${name} is already in this family. Try another name.`);

/**
 * Can a share-link sign-in become `p`, the family member with the name they typed? Only someone
 * still waiting to join: never the link's sender, anyone with an email (an old build's sign-in), or
 * anyone signed in on a phone or with Apple/Google. Apple/Google also need a live invite (the "+ Add
 * family" case), because an old build's family-code member leaves no other mark of having joined.
 * The email path (old builds, whose "+ Add family" made people without invites) doesn't.
 */
async function canClaim(p: ProfileRow & { email?: string | null }, share: { sender_id: string | null }, needInvite: boolean): Promise<boolean> {
  if (p.id === share.sender_id || p.email) return false;
  if ((await signedInIds([p.id])).has(p.id)) return false;
  return !needInvite || hasLiveInvite(p.id);
}

/** A new family with a fresh code (hash for lookups, sealed copy for email sign-in) and its circle. */
async function createFamily(name: string): Promise<{ id: string; code: string }> {
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomUUID();
    const code = newFamilyCode();
    const ins = await db.from("families")
      .insert({ id, name, code_hash: await sha256Hex(normalizeCode(code)), code_enc: await sealCode(id, code) });
    if (!ins.error) {
      await getOrCreateCircle(id);
      return { id, code };
    }
    if (ins.error.code !== "23505") dbFail("family insert", ins.error);
  }
  throw new HttpError(500, "Couldn't create your family. Please try again.");
}

onPublic("POST", "/signup", async ({ req, body }) => {
  await rateLimit("signup", clientIp(req), 5, 60);
  const b = await body();
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const email = emailOf(b.email, true)!;
  const share = await validShare(b.share_token);
  const familyName = `${name}'s family`.slice(0, 60);
  const fam = await createFamily(familyName);
  const prof = await db.from("profiles").insert({ family_id: fam.id, name, role: "learner", sort: 1 });
  if (prof.error) dbFail("signup profile", prof.error);
  const su = await db.from("signups").insert({ name, email, share_token: share?.token ?? null, family_id: fam.id });
  if (su.error) dbFail("signup", su.error);
  return { family_code: fam.code, family_name: familyName };
});

// TODO(security): emails are NOT verified yet (no email provider is configured). Anyone who types
// a known email gets that family's code, and anyone holding a /r link can join that family with any
// unused email (up to MAX_JOINS_PER_LINK people per link). Before launch, send a one-time code by
// email and require it here before returning a family code to a new device. Until then the family's
// signals are the circle system notes ("Sam signed in on a new phone", "Sam joined from Dad's
// link") and the rate limits below.
// TODO(caleb): while this route exists, anyone with a /r link can get the family code here, and the
// code can't be changed, so removing someone can't keep out a person who has it. Retire this route
// (or add family-code rotation) once old builds are gone.
onPublic("POST", "/auth/email", async ({ req, body }) => {
  const ip = clientIp(req);
  await rateLimit("authemail-ip", ip, 20, 10);
  const b = await body();
  const email = emailOf(b.email, true)!;
  await rateLimit("authemail-email", email, 5, 60);
  const client = str(b.client, "client", { max: 10 });
  if (client !== null && client !== "app" && client !== "web") throw new HttpError(400, "client must be app or web");

  // Known email: hand back its family, and tell the family a new device joined.
  const known = await profileByEmail(email);
  if (known) {
    const code = await openCode(known.family_id, known.families?.code_enc ?? null);
    if (!code) throw new HttpError(409, "Sign in with your family code this time.");
    // Skip the note when this email signed itself up a moment ago (a repeated Continue tap, or a
    // retry after a lost response): that's the same device, not a new one.
    const { count, error } = await db.from("signups").select("id", { count: "exact", head: true })
      .eq("email", email).gt("created_at", new Date(Date.now() - 2 * 60_000).toISOString());
    if (error) dbFail("recent signup", error);
    if (!count) {
      await insertMessage(await getOrCreateCircle(known.family_id), known.id, {
        kind: "system",
        body: client === "web" ? `${known.name} signed in on the web` : `${known.name} signed in on a new phone`,
      });
    }
    return {
      existing: true,
      needs_name: false,
      joined: false,
      family_code: code,
      family_name: known.families.name,
      profile_id: known.id,
    };
  }

  // New email: we need a name before creating anything.
  const name = str(b.name, "name", { max: MAX_NAME });
  if (!name) return { existing: false, needs_name: true };
  const roleRaw = str(b.role, "role", { max: 10 });
  if (roleRaw !== null && roleRaw !== "cook" && roleRaw !== "learner") throw new HttpError(400, "role must be cook or learner");
  const role = (roleRaw ?? "learner") as "cook" | "learner";

  // Came from a share link: join the sender's family circle.
  const share = await validShare(b.share_token);
  if (share) {
    const { data: fam, error } = await db.from("families").select("id, name, code_enc").eq("id", share.family_id).single();
    if (error) dbFail("share family", error);
    const code = await openCode(fam.id, fam.code_enc);
    // Only a family no device has used since the upgrade lacks the sealed code (it heals on the next call).
    if (!code) throw new HttpError(503, "We couldn't add you to that family just now. Please try again soon.");
    if ((await joinsVia(share.token, fam.id)) >= MAX_JOINS_PER_LINK) {
      throw new HttpError(403, "This link is full. Ask your family for a new one.");
    }
    const { data: members, error: mErr } = await db.from("profiles").select(`${PROFILE_COLS}, email`).eq("family_id", fam.id)
      .is("removed_at", null).order("sort");
    if (mErr) dbFail("share family profiles", mErr);
    const list = (members ?? []) as (ProfileRow & { email: string | null })[];
    // Already added by "+ Add family" and not joined yet? Then this is them: give that profile the email.
    const same = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    let p: ProfileRow;
    if (same) {
      if (!(await canClaim(same, share, false))) throw nameTaken(same.name);
      const { data: claimed, error: cErr } = await db.from("profiles").update({ email })
        .eq("id", same.id).is("email", null).select(PROFILE_COLS);
      if (cErr) {
        if (cErr.code === "23505") throw new HttpError(409, EMAIL_TAKEN);
        dbFail("claim profile", cErr);
      }
      if (!claimed?.length) throw nameTaken(same.name);
      p = claimed[0] as ProfileRow;
      // They're in: their invite link stops working.
      await revokeInvites(p.id).catch((e) => console.error("claim invites:", e.message));
    } else {
      p = await addProfile(fam.id, list, { name, role, email });
    }
    const su = await db.from("signups").insert({ name, email, share_token: share.token, family_id: fam.id });
    if (su.error) console.error("signup log:", su.error.message);
    const sender = share.sender_id ? list.find((x) => x.id === share.sender_id) : undefined;
    await insertMessage(await getOrCreateCircle(fam.id), p.id, {
      kind: "system",
      body: sender ? `${p.name} joined from ${sender.name}'s link` : `${p.name} joined from a shared link`,
    });
    return { existing: false, needs_name: false, joined: true, family_code: code, family_name: fam.name, profile_id: p.id };
  }

  await rateLimit("signup", ip, 5, 60);
  const familyName = `${name}'s family`.slice(0, 60);
  const fam = await createFamily(familyName);
  let p: ProfileRow;
  try {
    p = await addProfile(fam.id, [], { name, role, email });
  } catch (e) {
    await db.from("families").delete().eq("id", fam.id); // don't leave an empty family behind
    throw e;
  }
  const su = await db.from("signups").insert({ name, email, share_token: null, family_id: fam.id });
  if (su.error) console.error("signup log:", su.error.message);
  return { existing: false, needs_name: false, joined: false, family_code: fam.code, family_name: familyName, profile_id: p.id };
});

// --- Sign in with Apple / Google: the id token's `sub` is the person; each sign-in gets a device key

// TODO(caleb): the app's iOS bundle id. It isn't in the repo yet (the TestFlight build was made
// elsewhere); until it's here or in APPLE_AUDIENCES, only Expo Go's Apple tokens are accepted, and
// Apple sign-in in a TestFlight / App Store build answers 503 "isn't set up". Set it before any
// store build (the function logs the audience it refused).
const APP_BUNDLE_ID = "com.salik.homecookd";
// TODO(security): once the bundle id is set, drop host.exp.Exponent. Any Expo Go project can get
// Apple tokens for that audience, so a hostile one could replay its users' tokens here.
const EXPO_GO_BUNDLE_ID = "host.exp.Exponent";

function envList(name: string, fallback: string[]): string[] {
  const list = (Deno.env.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

type Provider = "apple" | "google";
type Role = "cook" | "learner";

// The key sets are fetched on first use and cached here (jose refetches when a key id is new).
const PROVIDERS: Record<Provider, { label: string; issuer: string[]; audience: string[]; keys: ReturnType<typeof createRemoteJWKSet> }> = {
  apple: {
    label: "Apple",
    issuer: ["https://appleid.apple.com"],
    audience: envList("APPLE_AUDIENCES", [EXPO_GO_BUNDLE_ID, APP_BUNDLE_ID].filter(Boolean)),
    keys: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), { timeoutDuration: 5000 }),
  },
  google: {
    label: "Google",
    issuer: ["accounts.google.com", "https://accounts.google.com"],
    // The web client id (the app's webClientId, which Google puts in `aud`), plus any others.
    audience: envList("GOOGLE_CLIENT_IDS", []),
    keys: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5000 }),
  },
};

type Who = { provider: Provider; sub: string; email: string | null; givenName: string | null };

/**
 * Check the token's signature, issuer, audience and expiry. Bad token: 401. Can't get the provider's
 * keys (timeout, non-200, bad JSON): 503. A real token for an app id we don't list (a store build
 * before APPLE_AUDIENCES has its bundle id): 503 "not set up", since trying again can't help.
 */
async function verifyIdToken(provider: Provider, idToken: string): Promise<Who> {
  const p = PROVIDERS[provider];
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, p.keys, {
      issuer: p.issuer,
      audience: p.audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp"],
    }));
  } catch (e) {
    if (e instanceof joseErrors.JWTClaimValidationFailed && e.claim === "aud") {
      // The audience is an app id (not a secret): it's what to add to the env list.
      console.error(`${provider}: token audience not allowed:`, JSON.stringify(e.payload.aud));
      throw new HttpError(503, `${p.label} sign-in isn't set up for this version yet. Try an invite link.`);
    }
    // A bare JOSEError is jose's "the key set didn't come back as 200 JSON".
    const keysDown = !(e instanceof joseErrors.JOSEError) || e.constructor === joseErrors.JOSEError ||
      e instanceof joseErrors.JWKSTimeout || e instanceof joseErrors.JWKSInvalid;
    if (!keysDown) throw new HttpError(401, `That ${p.label} sign-in didn't work. Please try again.`);
    console.error(`${provider} keys:`, (e as Error).message);
    throw new HttpError(503, `We couldn't reach ${p.label} just now. Please try again.`);
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub || sub.length > 255) throw new HttpError(401, `That ${p.label} sign-in didn't work. Please try again.`);
  const email = typeof payload.email === "string" && payload.email.length <= 254 ? payload.email.toLowerCase() : null;
  const given = typeof payload.given_name === "string" ? payload.given_name.trim().slice(0, MAX_NAME) : "";
  return { provider, sub, email, givenName: given || null };
}

type Known = { profile: ProfileRow; familyName: string; email: string | null };

/** The profile this account signs in as. A removed person's old link is dropped: they count as new. */
async function knownIdentity(who: Who): Promise<Known | null> {
  const { data, error } = await db.from("identities")
    .select(`email, profiles(${PROFILE_COLS}, removed_at, families(name))`)
    .eq("provider", who.provider).eq("subject", who.sub).maybeSingle();
  if (error) dbFail("identity", error);
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const p = data.profiles as any;
  if (!p || p.removed_at) {
    const del = await db.from("identities").delete().eq("provider", who.provider).eq("subject", who.sub);
    if (del.error) dbFail("identity unlink", del.error);
    return null;
  }
  return { profile: p as ProfileRow, familyName: p.families?.name ?? "", email: (data.email as string | null) ?? null };
}

/** Link the account to a profile. False when another tap linked it a moment ago. */
async function linkIdentity(who: Who, profileId: string): Promise<boolean> {
  const { error } = await db.from("identities")
    .insert({ provider: who.provider, subject: who.sub, profile_id: profileId, email: who.email });
  if (!error) return true;
  if (error.code === "23505") return false;
  dbFail("identity insert", error);
}

/** A circle note that must never cost the caller their device key. */
async function quietNote(familyId: string, profileId: string, body: string): Promise<void> {
  try {
    await insertMessage(await getOrCreateCircle(familyId), profileId, { kind: "system", body });
  } catch (e) {
    console.error("circle note:", (e as Error).message);
  }
}

/** A known person on a new phone. */
async function signInKnown(who: Who, known: Known, label: string | null) {
  const p = known.profile;
  // A repeated tap (or a retry after a lost response) is the same phone: no second note.
  const { count, error } = await db.from("devices").select("id", { count: "exact", head: true })
    .eq("profile_id", p.id).eq("via", who.provider).gt("created_at", new Date(Date.now() - 2 * 60_000).toISOString());
  if (error) dbFail("recent device", error);
  const dev = await createDevice(p.family_id, p.id, who.provider, label);
  if (!count) await quietNote(p.family_id, p.id, `${p.name} signed in on a new phone`);
  if (who.email && who.email !== known.email) {
    const up = await db.from("identities").update({ email: who.email }).eq("provider", who.provider).eq("subject", who.sub);
    if (up.error) console.error("identity email:", up.error.message);
  }
  return { existing: true, needs_name: false, joined: false, device_key: dev.key, family_name: known.familyName, profile_id: p.id };
}

/** Another tap linked this account first: undo what this one made, then sign in as that one did. */
async function afterLostLink(who: Who, made: { familyId?: string; profileId?: string }, label: string | null) {
  if (made.familyId) await db.from("families").delete().eq("id", made.familyId);
  else if (made.profileId) await db.from("profiles").delete().eq("id", made.profileId);
  const known = await knownIdentity(who);
  if (!known) throw new HttpError(409, "Please try again.");
  return signInKnown(who, known, label);
}

/** A new person from a recipe link: joins that family (as the email flow does). */
async function joinByShare(
  who: Who,
  share: { token: string; family_id: string; sender_id: string | null },
  name: string,
  role: Role,
  label: string | null,
) {
  const { data: fam, error } = await db.from("families").select("id, name").eq("id", share.family_id).single();
  if (error) dbFail("share family", error);
  if ((await joinsVia(share.token, fam.id)) >= MAX_JOINS_PER_LINK) {
    throw new HttpError(403, "This link is full. Ask your family for a new one.");
  }
  const { data: members, error: mErr } = await db.from("profiles").select(`${PROFILE_COLS}, email`)
    .eq("family_id", fam.id).is("removed_at", null).order("sort");
  if (mErr) dbFail("share family profiles", mErr);
  const list = (members ?? []) as (ProfileRow & { email: string | null })[];
  // Invited by "+ Add family" and not joined yet? Then this is them.
  const same = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (same && !(await canClaim(same, share, true))) throw nameTaken(same.name);
  const p = same ?? (await addProfile(fam.id, list, { name, role }));
  if (!(await linkIdentity(who, p.id))) return afterLostLink(who, { profileId: same ? undefined : p.id }, label);
  const dev = await createDevice(fam.id, p.id, who.provider, label);

  // Counts toward MAX_JOINS_PER_LINK.
  const su = await db.from("signups").insert({ name, email: who.email, share_token: share.token, family_id: fam.id });
  if (su.error) console.error("signup log:", su.error.message);
  if (same) await revokeInvites(same.id).catch((e) => console.error("claim invites:", e.message));
  const sender = share.sender_id ? list.find((x) => x.id === share.sender_id) : undefined;
  await quietNote(fam.id, p.id, sender ? `${p.name} joined from ${sender.name}'s link` : `${p.name} joined from a shared link`);
  return { existing: false, needs_name: false, joined: true, device_key: dev.key, family_name: fam.name as string, profile_id: p.id };
}

/** A new person with no link: their own family, "<Name>'s family". */
async function startFamily(who: Who, name: string, role: Role, label: string | null, ip: string) {
  await rateLimit("signup", ip, 5, 60);
  const familyName = `${name}'s family`.slice(0, 60);
  const fam = await createFamily(familyName);
  let p: ProfileRow;
  let dev: { id: string; key: string };
  try {
    p = await addProfile(fam.id, [], { name, role });
    if (!(await linkIdentity(who, p.id))) return afterLostLink(who, { familyId: fam.id }, label);
    dev = await createDevice(fam.id, p.id, who.provider, label);
  } catch (e) {
    await db.from("families").delete().eq("id", fam.id); // don't leave an empty family behind
    throw e;
  }
  const su = await db.from("signups").insert({ name, email: who.email, share_token: null, family_id: fam.id });
  if (su.error) console.error("signup log:", su.error.message);
  return { existing: false, needs_name: false, joined: false, device_key: dev.key, family_name: familyName, profile_id: p.id };
}

/**
 * `{ id_token, name?, role?, share_token?, device_label? }`. Known account: signs in. New account
 * without `name`: `{ needs_name: true, suggested_name }` and nothing is made; the app asks, then calls
 * again with the same token. With `join_token` (a family join link, or a 1.0 phone's one-use invite)
 * or `link_ticket` (a dish card's ticket), plus `move?`, joinLinks.ts's signInByLink answers.
 */
async function signInWith(provider: Provider, { req, body }: PublicArgs) {
  if (!PROVIDERS[provider].audience.length) throw new HttpError(503, `${PROVIDERS[provider].label} sign-in isn't set up yet.`);
  const ip = clientIp(req);
  await rateLimit("authid-ip", ip, 30, 10);
  const b = await body();
  const idToken = str(b.id_token, "id_token", { max: 8000, required: true })!;
  const label = deviceLabel(b);
  const name = str(b.name, "name", { max: MAX_NAME });
  const roleRaw = str(b.role, "role", { max: 10 });
  if (roleRaw !== null && roleRaw !== "cook" && roleRaw !== "learner") throw new HttpError(400, "role must be cook or learner");
  const who = await verifyIdToken(provider, idToken);
  if (hasLink(b)) return signInByLink(joinDeps, who, b, { name, role: roleRaw as Role | null, label, ip });

  const known = await knownIdentity(who);
  if (known) return signInKnown(who, known, label);
  if (!name) return { existing: false, needs_name: true, suggested_name: who.givenName };
  const share = await validShare(b.share_token);
  if (share) return joinByShare(who, share, name, (roleRaw ?? "learner") as Role, label);
  // A recipe link that no longer works still means a learner; with no link at all the app asks.
  const hadLink = typeof b.share_token === "string" && b.share_token.trim() !== "";
  const role = (roleRaw ?? (hadLink ? "learner" : null)) as Role | null;
  if (!role) throw new HttpError(400, "role must be cook or learner");
  return startFamily(who, name, role, label, ip);
}

onPublic("POST", "/auth/apple", (a) => signInWith("apple", a));
onPublic("POST", "/auth/google", (a) => signInWith("google", a));

// Joining by a link at sign-in, and the family's join link (joinLinks.ts, JOIN-SIMPLE.md §3-§4).
const joinDeps: JoinDeps = {
  db,
  HttpError,
  dbFail,
  rateLimit,
  sha256Hex,
  newToken: () => randomString(BASE62, 22),
  seal: (aad, text) => seal(JOIN_LINK_SALT, aad, text),
  open: (aad, sealed) => unseal(JOIN_LINK_SALT, aad, sealed),
  webUrl: WEB_URL,
  addProfile,
  createDevice,
  quietNote,
  knownIdentity,
  linkIdentity,
  signInKnown,
  afterLostLink,
  removeProfile,
};

// --- recordings on their way: the app registers who gets them, the worker says when it's published

on("POST", "/pending-sends", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  const b = await body();
  const jobId = str(b.job_id, "job_id", { max: 100, required: true })!;
  if (!RECIPE_ID.test(jobId)) throw new HttpError(400, "job_id is not a valid job id");
  if (!Array.isArray(b.recipient_ids) || !b.recipient_ids.length || b.recipient_ids.length > 30) {
    throw new HttpError(400, "recipient_ids must be a non-empty list of profile ids");
  }
  const recipients = [...new Set(b.recipient_ids.map((id) => profileIn(ctx, id, "recipient_ids").id))]
    .filter((id) => id !== me.id);
  if (!recipients.length) throw new HttpError(400, "Pick someone other than yourself");
  const helloPath = voicePathFor(ctx.family.id, b.hello_path, "hello_path", false);
  const helloDuration = num(b.hello_duration_s, "hello_duration_s", { min: 0, max: MAX_VOICE_S });
  if (helloPath && !(await voiceExists(helloPath))) throw new HttpError(400, "Upload the hello before sending it");

  const { data: existing, error } = await db.from("pending_sends").select("family_id, delivered_at")
    .eq("job_id", jobId).maybeSingle();
  if (error) dbFail("pending find", error);
  if (existing && existing.family_id !== ctx.family.id) throw new HttpError(409, "That job belongs to someone else");
  if (existing?.delivered_at) throw new HttpError(409, "That recipe was already delivered");
  const up = await db.from("pending_sends").upsert({
    job_id: jobId,
    family_id: ctx.family.id,
    sender_id: me.id,
    recipient_ids: recipients,
    hello_path: helloPath,
    hello_duration_s: helloDuration,
  }, { onConflict: "job_id" });
  if (up.error) dbFail("pending upsert", up.error);

  // If the worker already published this job (fast pipeline, slow phone), deliver right away.
  try {
    const res = await fetch(`${BUCKET_URL}/jobs/${jobId}.json`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const job = await res.json();
      if (job?.status === "published" && typeof job.recipe_id === "string" && RECIPE_ID.test(job.recipe_id)) {
        const r = await deliverPending(ctx.family.id, jobId, job.recipe_id);
        return { ok: true, delivered: r.delivered };
      }
    }
  } catch (e) {
    console.warn("job status check skipped:", (e as Error).message);
  }
  return { ok: true };
});

on("POST", "/jobs/:job_id/published", async ({ ctx, params, body }) => {
  const jobId = params.job_id;
  if (!RECIPE_ID.test(jobId)) throw new HttpError(400, "job_id is not a valid job id");
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  return await deliverPending(ctx.family.id, jobId, rid);
});

// --- POST /events: the app's recipe activity (signed in) and the lander's visit log (public)

/**
 * `{ recipe_id, kind, cook_id?, duration_s?, start_s? }` from a person in the family. `cook_id` is
 * whose dish it is (the app resolves it by name; it must be someone in this family); `heard` is a
 * clip of a cook's voice that played for `duration_s` >= 3 s from `start_s` (retention handoff 2.3).
 * The kinds and the 3 s floor are plumbing.ts's, the same lists the migration's check uses.
 */
async function recipeEvent(ctx: Ctx, body: () => Promise<Record<string, unknown>>) {
  const me = requireMe(ctx);
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  const kind = str(b.kind, "kind", { max: 10, required: true }) as RecipeEventKind;
  if (!RECIPE_EVENT_KINDS.includes(kind)) throw new HttpError(400, "kind must be viewed, cooked, started or heard");
  let cookId: string | null = null;
  if (b.cook_id !== undefined && b.cook_id !== null) {
    const id = typeof b.cook_id === "string" ? b.cook_id.toLowerCase() : "";
    if (!ctx.everyone.some((p) => p.id === id)) throw new HttpError(400, "cook_id must be someone in your family");
    cookId = id;
  }
  const duration = num(b.duration_s, "duration_s", { min: 0, max: 3600 });
  if (kind === "heard" && (duration === null || duration < HEARD_MIN_S)) {
    throw new HttpError(400, `duration_s must be at least ${HEARD_MIN_S} for heard`);
  }
  const start = num(b.start_s, "start_s", { min: 0, max: 86400 });
  await assertRecipe(rid);
  // Re-opening within 30 min, a double-tapped "I made it" or a second cook-mode open within a minute
  // counts once; a clip counts again unless it's the same clip within 5 s (a double flush).
  const windowMs = kind === "viewed" ? 30 * 60_000 : kind === "heard" ? 5_000 : 60_000;
  let q = db.from("recipe_events").select("id")
    .eq("profile_id", me.id).eq("recipe_id", rid).eq("kind", kind)
    .gt("created_at", new Date(Date.now() - windowMs).toISOString());
  if (kind === "heard") q = start === null ? q.is("clip_start_s", null) : q.eq("clip_start_s", start);
  const { data: recent, error } = await q.limit(1);
  if (error) dbFail("events find", error);
  if (recent?.length) return { ok: true, counted: false };
  const ins = await db.from("recipe_events").insert({
    family_id: ctx.family.id,
    profile_id: me.id,
    recipe_id: rid,
    kind,
    cook_id: cookId,
    duration_s: duration,
    clip_start_s: kind === "heard" ? start : null,
  });
  if (ins.error) dbFail("event insert", ins.error);
  return { ok: true, counted: true };
}

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], required = false): T | null {
  const s = str(v, field, { max: 20, required });
  if (s !== null && !allowed.includes(s as T)) throw new HttpError(400, `${field} must be one of ${allowed.join(", ")}`);
  return s as T | null;
}

const LANDER_SIGNALS = ["aud", "saved", "snapchat", "link", "default", "switch"] as const;

/**
 * Which lander page someone saw and why (`event` land | switch, `aud` parent | kid), plus `tap` on
 * the hero's two buttons (`ui` cta | see; the lander session's audience-route.ts sends it). JSON sent
 * as application/json or as text/plain (sendBeacon). Nothing about the person is stored. 204, no body.
 */
async function landerEvent({ req, body }: PublicArgs): Promise<Response> {
  await rateLimit("events-ip", clientIp(req), 120, 10);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/json" && type !== "text/plain") throw new HttpError(400, "Body must be JSON");
  const b = await body();
  // An app's recipe event without its key or code: answer as before.
  if (b.event === undefined && (b.kind !== undefined || b.recipe_id !== undefined)) {
    throw new HttpError(401, "Missing family code (x-family-code header)");
  }
  const short = (v: unknown, field: string) => str(v, field, { max: 100 });
  const row = {
    event: oneOf(b.event, "event", ["land", "switch", "tap"], true),
    aud: oneOf(b.aud, "aud", ["parent", "kid"], true),
    signal: oneOf(b.signal, "signal", LANDER_SIGNALS),
    app: short(b.app, "app"),
    utm_source: short(b.utm_source, "utm_source"),
    utm_campaign: short(b.utm_campaign, "utm_campaign"),
    path: short(b.path, "path"),
    ui: str(b.ui, "ui", { max: 20 }),
    host: str(b.host, "host", { max: 60 }),
  };
  const { error } = await db.from("lander_events").insert(row);
  if (error) dbFail("lander event", error);
  return new Response(null, { status: 204, headers: CORS });
}

// The lander's own route (FEEDBACK-OCT16c A5). Public, never authenticated.
onPublic("POST", "/web-events", landerEvent);

// With a device key or family code it's the app's recipe activity; without, a lander visit (kept so
// an early lander beacon to /events still lands; new clients use /web-events).
onPublic("POST", "/events", async (a) => {
  if (!(a.req.headers.get("x-device-key")?.trim() || a.req.headers.get("x-family-code")?.trim())) return landerEvent(a);
  const ctx = await authenticate(a.req);
  runInBackground(syncTz(db, ctx.me?.id, a.req.headers.get("x-tz")));
  return recipeEvent(ctx, a.body);
});

// --- favorites (hearts) and my own history with each dish, for the kid app's Home and Recipes

async function favoriteIds(profileId: string): Promise<string[]> {
  const { data, error } = await db.from("favorites").select("recipe_id")
    .eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1000);
  if (error) dbFail("favorites", error);
  return ((data ?? []) as { recipe_id: string }[]).map((r) => r.recipe_id);
}

on("GET", "/favorites", async ({ ctx }) => {
  const me = requireMe(ctx);
  return { recipe_ids: await favoriteIds(me.id) };
});

/** Heart (`on: true`) or un-heart a dish. Idempotent either way; returns my favorites, newest first. */
on("POST", "/favorites", async ({ ctx, body }) => {
  const me = requireMe(ctx);
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  if (typeof b.on !== "boolean") throw new HttpError(400, "on must be true or false");
  if (b.on) {
    await assertRecipe(rid);
    const { error } = await db.from("favorites")
      .upsert({ profile_id: me.id, recipe_id: rid }, { onConflict: "profile_id,recipe_id", ignoreDuplicates: true });
    if (error) dbFail("favorite add", error);
  } else {
    const { error } = await db.from("favorites").delete().eq("profile_id", me.id).eq("recipe_id", rid);
    if (error) dbFail("favorite remove", error);
  }
  return { ok: true, recipe_id: rid, on: b.on, recipe_ids: await favoriteIds(me.id) };
});

type RecipeStat = {
  recipe_id: string;
  views: number;
  last_viewed_at: string | null;
  cooked: number;
  last_cooked_at: string | null;
  favorited: boolean;
  favorited_at: string | null;
  sent_to_me_at: string | null;
};

/**
 * One row per dish I have any history with: my views and cooks (recipe_events), my heart, and the
 * newest time someone else sent it to me (a `recipe` message from someone else in one of my 1:1
 * chats or the family circle). Most recent activity first.
 */
on("GET", "/me/recipe-stats", async ({ ctx }) => {
  const me = requireMe(ctx);
  const circle = await getOrCreateCircle(ctx.family.id);
  // TODO: 1000 is PostgREST's max_rows, so past 1000 events/sends the counts undercount. Before real
  // use, move them into SQL (a view or RPC: count(*) filter (where kind='viewed') / max(created_at),
  // grouped by recipe_id).
  const [{ data: events, error: eErr }, { data: favs, error: fErr }, { data: pairs, error: tErr }] = await Promise.all([
    // Views & cooks only: heard & started rows would fill the row cap (retention plumbing.ts).
    db.from("recipe_events").select("recipe_id, kind, created_at")
      .eq("profile_id", me.id).in("kind", STAT_EVENT_KINDS).order("created_at", { ascending: false }).limit(1000),
    db.from("favorites").select("recipe_id, created_at").eq("profile_id", me.id).limit(1000),
    db.from("threads").select("id").eq("family_id", ctx.family.id).eq("kind", "pair")
      .or(`a_profile.eq.${me.id},b_profile.eq.${me.id}`).not("last_message_at", "is", null),
  ]);
  if (eErr) dbFail("stats events", eErr);
  if (fErr) dbFail("stats favorites", fErr);
  if (tErr) dbFail("stats threads", tErr);
  const threadIds = [circle.id, ...((pairs ?? []) as { id: string }[]).map((t) => t.id)];
  const sent = await inChunks(threadIds, async (chunk) => {
    const { data, error } = await db.from("messages").select("recipe_id, created_at")
      .in("thread_id", chunk).eq("kind", "recipe").neq("sender_id", me.id)
      .order("created_at", { ascending: false }).limit(1000);
    if (error) dbFail("stats sent", error);
    return (data ?? []) as { recipe_id: string | null; created_at: string }[];
  });

  const stats = new Map<string, RecipeStat>();
  const row = (rid: string) => {
    let s = stats.get(rid);
    if (!s) {
      s = { recipe_id: rid, views: 0, last_viewed_at: null, cooked: 0, last_cooked_at: null, favorited: false, favorited_at: null, sent_to_me_at: null };
      stats.set(rid, s);
    }
    return s;
  };
  const later = (a: string | null, b: string) => (a && Date.parse(a) >= Date.parse(b) ? a : b);
  for (const e of events ?? []) {
    const s = row(e.recipe_id);
    if (e.kind === "viewed") {
      s.views++;
      s.last_viewed_at = later(s.last_viewed_at, e.created_at);
    } else if (e.kind === "cooked") {
      s.cooked++;
      s.last_cooked_at = later(s.last_cooked_at, e.created_at);
    }
  }
  for (const f of favs ?? []) {
    const s = row(f.recipe_id);
    s.favorited = true;
    s.favorited_at = f.created_at;
  }
  for (const m of sent) {
    if (!m.recipe_id) continue;
    const s = row(m.recipe_id);
    s.sent_to_me_at = later(s.sent_to_me_at, m.created_at);
  }
  const lastOf = (s: RecipeStat) =>
    Math.max(...[s.last_viewed_at, s.last_cooked_at, s.favorited_at, s.sent_to_me_at].map((t) => (t ? Date.parse(t) : 0)));
  return [...stats.values()].sort((a, b) => lastOf(b) - lastOf(a) || (a.recipe_id < b.recipe_id ? -1 : 1));
});

on("GET", "/recipes/:id/activity", async ({ ctx, params }) => {
  const rid = recipeId(params.id, "recipe id")!;
  const [{ data: events, error }, { data: sent, error: sErr }, { data: notes, error: nErr }] = await Promise.all([
    db.from("recipe_events").select("profile_id, kind, created_at")
      .eq("family_id", ctx.family.id).eq("recipe_id", rid).in("kind", STAT_EVENT_KINDS)
      .order("created_at", { ascending: false }).limit(5000),
    db.from("messages").select("created_at").eq("family_id", ctx.family.id).eq("recipe_id", rid)
      .eq("kind", "recipe").order("created_at", { ascending: false }).limit(1),
    db.from("messages").select("sender_id, body, created_at").eq("family_id", ctx.family.id).eq("recipe_id", rid)
      .eq("kind", "cooked").order("created_at", { ascending: false }).limit(200),
  ]);
  if (error) dbFail("activity", error);
  if (sErr) dbFail("activity sent", sErr);
  if (nErr) dbFail("activity notes", nErr);
  const byId = new Map(ctx.profiles.map((p) => [p.id, p]));
  const cooked = new Map<string, { profile: Profile; at: string; note: string | null }>();
  const viewed = new Map<string, { profile: Profile; count: number }>();
  for (const e of events ?? []) {
    const p = byId.get(e.profile_id);
    if (!p) continue;
    if (e.kind === "cooked" && !cooked.has(p.id)) {
      const note = (notes ?? []).find((m) => m.sender_id === p.id && m.body)?.body ?? null;
      cooked.set(p.id, { profile: toProfile(p), at: e.created_at, note });
    }
    if (e.kind === "viewed") {
      const v = viewed.get(p.id) ?? { profile: toProfile(p), count: 0 };
      v.count++;
      viewed.set(p.id, v);
    }
  }
  return {
    cooked: [...cooked.values()],
    viewed: [...viewed.values()].sort((a, b) => b.count - a.count),
    last_sent_at: sent?.[0]?.created_at ?? null,
  };
});

// ---------------------------------------------------------------------------------------------
// --- push & cron (retention PR 1: docs/build/RETENTION-HANDOFF.md 2.4-2.5, RETENTION-WIRING.md)

/**
 * answersFor() for a whole family with no caller behind it (PR 6's "Questions you answered" & the 1st's
 * push). answersFor() reads only `family.id` and `everyone` (roles), so a Ctx of the family's people is
 * enough; if it ever reads more, revisit this (the count must keep matching the app's "answered").
 */
const familyCtx = (fam: RecapFamily) =>
  ({ family: { id: fam.id, name: "" }, profiles: fam.profiles, everyone: fam.profiles, me: null, device: null, phones: new Set() }) as unknown as Ctx;

/**
 * Every retention route & cron job (retention.ts). Each later PR turns itself on by adding its number
 * to `prs` (and its deps, if any): RETENTION-WIRING.md, "Integration" and the PR sections.
 */
const retention = makeRetention<Ctx>({
  prs: [1, 2, 4, 5, 6],
  db,
  HttpError,
  requireMe,
  rateLimit,
  dbFail,
  clientIp,
  library,
  assertRecipe, // PR 2: checks a dish once per cook-mode session
  // PR 4 (GET /dish-stats, GET /hearts/recent) needs only `library`: whose dish is whose.
  // PR 5 (GET /table + the Sunday `table_nudge` cron job, registered by makeRetention itself) needs
  // only `library` too, plus the public.table_activity RPC (migration 20261018100300, applied first).
  // PR 6 (GET /recap + the 1st-of-month `recap` cron job, registered by makeRetention itself):
  answersFor: (fam, rows) => answersFor(familyCtx(fam), rows as unknown as MessageRow[]),
  signPhotos: (paths) => signVoice(paths, PHOTO_BUCKET), // postcards (qa-cook's private photos bucket)
  expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null,
});
for (const r of retention.routes) on(r.method, r.path, r.handler, r.auth);
for (const r of retention.publicRoutes) onPublic(r.method, r.path, r.handler);

const dishTitle = async (rid: string | null) => (rid ? (await library.recipeInfo(rid))?.title || null : null);

/**
 * The push for a message someone just sent (handoff 2.5 rows 1-3 & "Just like mine"), to everyone
 * else in the thread who is still in the family. A question goes only to whoever can answer it (the
 * person asked; in the circle, every cook but the asker); "Just like mine" only to whoever made the
 * dish (its "your" is theirs alone, even in the circle). Never the sender, never a system note (the
 * copy is null for those, for a dish someone made and for a heart). Run in the background.
 */
async function pushMessage(
  ctx: Ctx,
  me: ProfileRow,
  t: ThreadRow,
  row: MessageRow,
  replyTo: MessageRow | null,
): Promise<void> {
  if (row.kind === "system") return;
  if (row.kind === "reaction") {
    // Hearts never push; "Just like mine" pushes only whoever made the dish it answers, once, with
    // the dish as people say it ("on your Sunday Chili", not "on your Dad's Sunday Chili").
    const info = row.recipe_id ? await library.recipeInfo(row.recipe_id) : null;
    const p = reactionPush(row, me, replyTo, info ? dishName(info.title, info.cook_name) : null);
    const stillHere = !!p && membersOf(ctx, t).some((m) => m.id === p.to && !m.removed_at);
    if (p && stillHere) await retention.notify(p.to, { ...p.copy, appInitiated: false, dedupeKey: p.dedupeKey });
    return;
  }
  const copy = messagePush(row, me.name, await dishTitle(row.recipe_id));
  if (!copy) return;
  let to = membersOf(ctx, t).filter((p) => p.id !== me.id && !p.removed_at);
  if (copy.kind === "question") {
    const target = questionTargets(ctx, [row], new Map([[t.id, t]])).get(row.id);
    if (target?.answerer) to = to.filter((p) => p.id === target.answerer);
    else if (t.kind === "circle") to = to.filter((p) => p.role === "cook");
  }
  const dedupeKey = `message:${row.id}`;
  for (const p of to) await retention.notify(p.id, { ...copy, appInitiated: false, dedupeKey });
}

/**
 * The postcard push (retention PR 3; handoff 2.5): to the dish's cook only, once per cooked message
 * (postcardKey), however often the photo is replaced. The dish's cook is the family member named on
 * it (recipe.json `cook.name`, the app's cookProfile rule), never me; in a 1:1 it must also be the
 * other person, so a card sent to someone else never tells them "your". With the bucket unreachable,
 * a 1:1's other person if they're a cook ("Leo made your recipe"). notify() skips removed & memorial.
 */
async function pushPostcard(ctx: Ctx, me: ProfileRow, t: ThreadRow, row: MessageRow): Promise<void> {
  const info = row.recipe_id ? await library.recipeInfo(row.recipe_id) : null;
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const other = t.kind === "pair" ? (t.a_profile === me.id ? t.b_profile : t.a_profile) : null;
  const named = info?.cook_name ? ctx.profiles.filter((p) => norm(p.name) === norm(info.cook_name) && p.id !== me.id) : [];
  const to = info
    ? (other ? named.find((p) => p.id === other) : named.find((p) => p.role === "cook") ?? named[0])
    : ctx.profiles.find((p) => p.id === other && p.role === "cook");
  if (!to || to.id === me.id || to.removed_at) return;
  await retention.notify(to.id, { ...postcardPush(me.name, info), appInitiated: false, dedupeKey: postcardKey(row.id) });
}

type SentRecipe = { profile_id: string; thread_id: string; message_id: string };

/** "Just in from Dad" for each recipe message just sent (POST /send-recipe, deliverPending). */
async function pushRecipes(senderName: string, rid: string, sent: SentRecipe[]): Promise<void> {
  const dish = await dishTitle(rid);
  for (const x of sent) {
    const copy = messagePush({ kind: "recipe", thread_id: x.thread_id, recipe_id: rid }, senderName, dish);
    if (copy) await retention.notify(x.profile_id, { ...copy, appInitiated: false, dedupeKey: `message:${x.message_id}` });
  }
}

// ---------------------------------------------------------------------------------------------
// Server

/** Path segments after the function name, whether called as /functions/v1/api/... or /api/... */
function segmentsOf(url: URL): string[] {
  const segs = url.pathname.split("/").filter(Boolean);
  const i = segs.indexOf("api");
  return i >= 0 ? segs.slice(i + 1) : segs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const segs = segmentsOf(url);
  let bodyCache: Promise<Record<string, unknown>> | null = null;
  const body = () => (bodyCache ??= readBody(req));
  try {
    const send = (out: unknown) => (out instanceof Response ? out : json(out));
    for (const r of publicRoutes) {
      const params = match(r.pattern, segs);
      if (params && r.method === req.method) return send(await r.handler({ req, params, url, body }));
    }
    let methodMismatch = false;
    for (const r of routes) {
      const params = match(r.pattern, segs);
      if (!params) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      const ctx = await authenticate(req, r.auth);
      // The acting person's zone (x-tz): quiet hours, Sunday weeks, the 1st's recap. Never awaited.
      runInBackground(syncTz(db, ctx.me?.id, req.headers.get("x-tz")));
      return send(await r.handler({ req, ctx, params, url, body }));
    }
    if (methodMismatch || publicRoutes.some((r) => match(r.pattern, segs))) {
      return json({ error: "Method not allowed" }, 405);
    }
    return json({ error: `No route for ${req.method} /${segs.join("/")}` }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error("unhandled:", e);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
});
