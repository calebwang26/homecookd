// A join ticket: Convex vouching that whoever holds a dish card's link may join the card's family, as that
// side of the card (docs/build/V2-LINKING.md §2.4). Supabase's POST /auth/link checks it with the same secret
// (supabase/functions/api/link.ts) and makes the new profile; membership lives there, not here.
//   ticket = base64url(JSON payload) + "." + base64url(HMAC-SHA256(LINK_JOIN_SECRET, base64url(JSON payload)))
// Both sides test against the same vectors (joinTicket.test.ts, supabase/tests/link_test.ts).

export type JoinSide = "kid" | "cook";
export type JoinPayload = {
  v: 1;
  fam: string; // the Supabase family id
  card: string; // cardRef(dishAskId): which card, without a Convex id leaving Convex
  side: JoinSide; // kid joins as a learner, cook as a cook
  name: string | null; // the name to prefill; the app may send its own
  exp: number; // ms since epoch
  jti: string;
};

export const TICKET_MS = 10 * 60_000;

const enc = new TextEncoder();
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url back to text (UTF-8, so a name like "आजी" survives). */
function fromB64url(text: string): string | null {
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** Compares in time that doesn't depend on where the strings differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 16 random base62 characters. */
export function newJti(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => BASE62[b % 62]).join("");
}

/** The card's name in a ticket: the first 24 hex characters of sha256("card:" + id). */
export async function cardRef(dishAskId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`card:${dishAskId}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function signTicket(secret: string, payload: JoinPayload): Promise<string> {
  // A fixed key order, so the same payload always makes the same ticket.
  const { v, fam, card, side, name, exp, jti } = payload;
  const body = b64url(enc.encode(JSON.stringify({ v, fam, card, side, name, exp, jti })));
  return `${body}.${await hmac(secret, body)}`;
}

/** The JSON inside a signed token (ticket or receipt) when its signature holds; null otherwise. */
async function openSigned(secret: string, token: string): Promise<Record<string, unknown> | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 2000) return null;
  if (!sameText(sig, await hmac(secret, body))) return null;
  const text = fromB64url(body);
  if (text === null) return null;
  try {
    const p: unknown = JSON.parse(text);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The payload when the signature holds and it hasn't expired; null otherwise. Supabase has its own copy. */
export async function verifyTicket(secret: string, ticket: string, now: number): Promise<JoinPayload | null> {
  if (ticket.length > 1000) return null;
  const p = (await openSigned(secret, ticket)) as Partial<JoinPayload> | null;
  if (!p) return null;
  const ok =
    p.v === 1 &&
    typeof p.fam === "string" &&
    typeof p.card === "string" &&
    (p.side === "kid" || p.side === "cook") &&
    (p.name === null || typeof p.name === "string") &&
    typeof p.exp === "number" &&
    typeof p.jti === "string";
  if (!ok || p.exp! <= now) return null;
  return p as JoinPayload;
}

/**
 * Supabase's word that someone moved from family A to family B on one Apple identity (docs/build/JOIN-SIMPLE.md
 * §4), signed with the same secret, the other way round. `solo`: nobody else signs in to A, so their recipes (and
 * the phone-less `faces`, Supabase profile ids) come along.
 */
export type MovedReceipt = {
  v: 1;
  kind: "moved";
  fromProfile: string;
  fromFamily: string;
  toProfile: string;
  toFamily: string;
  solo: boolean;
  faces: string[];
  exp: number;
};

/** Supabase signs these (functions/api/joinLinks.ts); this twin is for the tests. */
export async function signMoved(secret: string, r: MovedReceipt): Promise<string> {
  const { v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp } = r;
  const body = b64url(enc.encode(JSON.stringify({ v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyMoved(secret: string, receipt: string, now: number): Promise<MovedReceipt | null> {
  const p = (await openSigned(secret, receipt)) as Partial<MovedReceipt> | null;
  if (!p) return null;
  const ok =
    p.v === 1 &&
    p.kind === "moved" &&
    typeof p.fromProfile === "string" &&
    typeof p.fromFamily === "string" &&
    typeof p.toProfile === "string" &&
    typeof p.toFamily === "string" &&
    typeof p.solo === "boolean" &&
    Array.isArray(p.faces) &&
    p.faces.length <= 50 &&
    p.faces.every((f) => typeof f === "string") &&
    typeof p.exp === "number";
  if (!ok || p.exp! <= now) return null;
  return p as MovedReceipt;
}
