// Phase 4's signed tokens, shared with Convex through one secret, LINK_JOIN_SECRET:
// - the join ticket (V2-LINKING.md §2.4): Convex vouches that someone opened a dish card's link
//   (convex/lib/joinTicket.ts signs it). POST /auth/apple|google take it as `link_ticket`, and joinLinks.ts
//   makes the new person (docs/build/JOIN-SIMPLE.md §3);
// - the "moved" receipt (JOIN-SIMPLE.md §4): the other way round, Supabase's word that someone moved from
//   family A to family B, which Convex's links.moved checks before re-homing a solo family's recipes.
//
// Both are base64url(JSON) + "." + base64url(HMAC-SHA256(secret, base64url(JSON))).
// One join per card side: each join is logged in `signups` as share_token "link:<card>:<side>"
// (shareTokenFor), and migration 20261029090000's unique index refuses a second.

export type JoinSide = "kid" | "cook";
export type JoinPayload = {
  v: 1;
  fam: string; // the Supabase family id
  card: string; // which card (24 hex characters), without a Convex id leaving Convex
  side: JoinSide;
  name: string | null; // the name to prefill; the app may send its own
  exp: number; // ms since epoch
  jti: string;
};

/** Convex's MovedReceipt (convex/lib/joinTicket.ts), field for field and in the same order. */
export type MovedReceipt = {
  v: 1;
  kind: "moved";
  fromProfile: string;
  fromFamily: string;
  toProfile: string;
  toFamily: string;
  /** Nobody else signs in to the old family, so its recipes (and the phone-less `faces`) come along. */
  solo: boolean;
  /** The phone-less people moved with them (Supabase profile ids). */
  faces: string[];
  exp: number; // ms since epoch
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD = /^[0-9a-f]{24}$/;
const JTI = /^[0-9A-Za-z]{16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TICKET = 1000;

export const LINK_USED = "This link already brought someone in. Ask them for an invite.";
export const BAD_TICKET = "This link didn't work. Open it again.";

const enc = new TextEncoder();

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

/** The payload when the signature holds, the shape is exact and it hasn't expired; null otherwise. */
export async function verifyTicket(secret: string, ticket: string, now: number): Promise<JoinPayload | null> {
  if (ticket.length > MAX_TICKET) return null;
  const [body, sig, extra] = ticket.split(".");
  if (!body || !sig || extra !== undefined || !B64URL.test(body) || !B64URL.test(sig)) return null;
  if (!sameText(sig, await hmac(secret, body))) return null;
  const text = fromB64url(body);
  if (text === null) return null;
  let p: Partial<JoinPayload> | null;
  try {
    p = JSON.parse(text);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const ok =
    p.v === 1 &&
    typeof p.fam === "string" && UUID.test(p.fam) &&
    typeof p.card === "string" && CARD.test(p.card) &&
    (p.side === "kid" || p.side === "cook") &&
    (p.name === null || typeof p.name === "string") &&
    typeof p.exp === "number" && Number.isFinite(p.exp) &&
    typeof p.jti === "string" && JTI.test(p.jti);
  if (!ok || p.exp! <= now) return null;
  return p as JoinPayload;
}

/** The receipt for Convex's links.moved, its fields in Convex's order. */
export async function signMoved(secret: string, r: MovedReceipt): Promise<string> {
  const { v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp } = r;
  const body = b64url(enc.encode(JSON.stringify({ v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp })));
  return `${body}.${await hmac(secret, body)}`;
}

export const roleFor = (side: JoinSide): "cook" | "learner" => (side === "kid" ? "learner" : "cook");
export const shareTokenFor = (card: string, side: JoinSide) => `link:${card}:${side}`;
