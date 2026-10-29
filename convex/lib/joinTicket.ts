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

/** The payload when the signature holds and it hasn't expired; null otherwise. Supabase has its own copy. */
export async function verifyTicket(secret: string, ticket: string, now: number): Promise<JoinPayload | null> {
  const [body, sig, extra] = ticket.split(".");
  if (!body || !sig || extra !== undefined || ticket.length > 1000) return null;
  if (!sameText(sig, await hmac(secret, body))) return null;
  const text = fromB64url(body);
  if (text === null) return null;
  let p: Partial<JoinPayload>;
  try {
    p = JSON.parse(text);
  } catch {
    return null;
  }
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
