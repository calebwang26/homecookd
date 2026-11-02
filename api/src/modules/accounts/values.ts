// What sign-in, invites and deletion share: the switch, the codes and sentences phones read, tokens and the input checks. The sentences are the old routes' own
// (supabase/functions/api/index.ts, convex/lib/auth.ts), now the English `message` beside a code (docs/build/contracts/ERROR-CODES.md).
import { randomBytes } from "node:crypto";
import { ApiError, invalid } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";

export { hashToken as sha256Hex } from "../../auth.js";

// ---------------------------------------------------------------------------------------------
// The switch

/**
 * Off until this area moves (Caleb's separate OK, docs/build/ACCOUNTS-MIGRATION.md). `families` and `people` belong to the temporary one-way sync until then
 * (SCHEMA.md, M1; the claude/aws-sync draft), and two writers would fight. Off, nothing here writes either table; the one exception is a deletion the sync
 * itself passes on (deletion.ts), because SCHEMA.md M1 says a deletion reaches the copy within minutes, not on the next sync.
 */
export const ownsPeople = () => process.env.ACCOUNTS_OWNS_PEOPLE?.trim() === "1";

export function assertOwnsPeople(): void {
  if (!ownsPeople()) throw new ApiError(503, "accounts_not_moved");
}

// ---------------------------------------------------------------------------------------------
// Answers

/** `{error: <code>, message: <the old sentence>, ...extra}`, as on every route. */
export { refused as refuse } from "../../errors.js";

/** With 401 `signed_out`: a revoked or unknown device key. */
export const SIGNED_OUT = "This phone was signed out.";
/** With 403 `account_deleted`: sessions.start for someone who deleted their account. */
export const ACCOUNT_DELETED = "This account was deleted.";
export const NOT_IN_THIS_FAMILY = "That person isn't in this family anymore.";

export const UPDATE_TO_JOIN = "Update homecookd to join this family.";
export const INVITE_GONE = {
  used: "This invite was already used.",
  expired: "This invite expired.",
  revoked: "This invite was turned off.",
} as const;
export const LINK_GONE = { expired: "This link expired.", revoked: "This link was turned off." } as const;
export const NOT_IN_FAMILY = "That person isn't in this family.";
export const ALREADY_ON = "That person is already on homecookd.";
export const LINK_USED = "This link already brought someone in. Ask them for an invite.";
export const BAD_TICKET = "This link didn't work. Open it again.";
export const DEAD_LINK = "This link doesn't work anymore.";
export const BAD_INVITE_LINK = "That invite link doesn't work.";
export const BAD_INVITE_CODE = "That invite code doesn't work.";
export const ALREADY_HANDLED = "Already handled.";
export const MOVE_EXPIRED = "That request expired.";
export const NOT_SETTLED = "You can do this after your first day here.";
export const TOO_MANY_INVITES = "That's a lot of invites for one day. Try again tomorrow.";
const TOO_MANY = "Too many attempts. Please wait a few minutes.";

// ---------------------------------------------------------------------------------------------
// Limits on how much

export const MAX_NAME = 40;
export const MAX_PEOPLE = 30;
export const SESSION_DAYS = 30;
export const JOIN_LINK_DAYS = 7; // TODO(caleb): how long a family's join link works
export const INVITE_DAYS = 14;
export const MOVE_DAYS = 7;
export const JOIN_WINDOW_DAYS = 30; // TODO(caleb): how long after the ask (or Mom's answer) a card can still bring someone into the family
export const TICKET_MS = 10 * 60_000;
export const RECEIPT_MS = 60 * 60_000;
export const SETTLED_MS = 24 * 3_600_000;
export const MAX_JOINS_PER_SHARE = 5;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Shapes

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;
export const JOIN_TOKEN = /^[0-9A-Za-z]{22}$/;
export const INVITE_TOKEN = /^[0-9A-Za-z]{16}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const INVITE_CODE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);
const SHARE_TOKEN = /^[0-9A-Za-z]{10}$/;
// Printable ASCII only, so JS toLowerCase() and Postgres lower() always agree (the check on people.email).
const EMAIL = /^[\x21-\x3f\x41-\x7e]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ---------------------------------------------------------------------------------------------
// Tokens

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Uniform random characters, by rejection sampling, so there's no modulo bias. */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

/** A phone's key or a session token: 32 random bytes, base64url (43 characters). Handed out once; only its hash is kept. */
export const newSecret = () => randomBytes(32).toString("base64url");
export const newInviteToken = () => randomString(BASE62, 16);
export const newInviteCode = () => randomString(CODE_ALPHABET, 6);
export const newJoinToken = () => randomString(BASE62, 22);
export const newJti = () => randomString(BASE62, 16);
export const newFamilyCode = () => `${randomString(CODE_ALPHABET, 4)}-${randomString(CODE_ALPHABET, 4)}`;
/** Codes are compared without regard to case or surrounding spaces. */
export const normalizeCode = (code: string) => code.trim().toUpperCase();

// ---------------------------------------------------------------------------------------------
// Reading a body

export type Body = Record<string, unknown>;

export const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

export function str(v: unknown, field: string, opts: { max: number; required?: boolean }): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (opts.required) throw invalid(field, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw invalid(field, `${field} must be a string`);
  const s = v.trim();
  if (s.length > opts.max) throw invalid(field, `${field} must be at most ${opts.max} characters`);
  return s;
}

export function emailOf(v: unknown): string | null {
  const s = str(v, "email", { max: 254 });
  if (s === null) return null;
  const email = s.toLowerCase();
  if (!EMAIL.test(email)) throw invalid("email", "That email doesn't look right");
  return email;
}

/** Contact digits for display ("+15551234567"). Anything unreadable is dropped, never refused. */
export function phoneOf(v: unknown): string | null {
  const digits = (str(v, "phone", { max: 40 }) ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /^\+?\d{3,15}$/.test(digits) ? digits : null;
}

export const shareTokenOf = (v: unknown): string | null => {
  const token = str(v, "share_token", { max: 10 });
  return token && SHARE_TOKEN.test(token) ? token : null;
};

/** The phone's name from the body ("iPhone"); `label` is accepted too. Display only. */
export const deviceLabel = (b: Body) => str(b.device_label ?? b.label, "device_label", { max: 40 });

export type Role = "cook" | "kid";
/** Old builds say learner; the schema says kid. */
export const roleIn = (raw: string | null): Role | null => (raw === "learner" ? "kid" : raw === "cook" ? "cook" : null);
export const roleOut = (role: string) => (role === "kid" ? "learner" : role);

export function roleOf(v: unknown, required = false): Role | null {
  const raw = str(v, "role", { max: 10, required });
  if (raw !== null && raw !== "cook" && raw !== "learner") throw invalid("role", "role must be cook or learner");
  return roleIn(raw);
}

/** A name as peek and claims compare it: trimmed, one space between words, lowercase ('' for no name). */
export const nameKey = (raw: unknown) => (typeof raw === "string" && raw.length <= 200 ? raw.trim().replace(/\s+/g, " ").toLowerCase() : "");

// ---------------------------------------------------------------------------------------------
// Rate limits (rateLimit.ts): 429 `rate_limited` and its retry-after, with the old routes' sentence

export async function limit(kind: string, value: string, max: number, windowMin: number, sentence = TOO_MANY): Promise<void> {
  try {
    await hit(subjectKey(value), [{ bucket: kind, max, windowS: windowMin * 60 }]);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 429) throw new ApiError(429, "rate_limited", error.headers, sentence);
    throw error;
  }
}
