// The join ticket and the "moved" receipt (convex/lib/joinTicket.ts and supabase/functions/api/link.ts, one file now). They were signed so Convex and Supabase
// could trust each other; both go through this api here, but old tickets and receipts in flight at a switch must still open, and the format is unchanged:
//   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(LINK_JOIN_SECRET, base64url(JSON payload)))
// A ticket expires in 10 minutes and names no family it can't prove, and "one join per card side" is the signups row, so a replay gets the same 409.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { UUID } from "./values.js";

export type JoinSide = "kid" | "cook";
export type JoinPayload = {
  v: 1;
  fam: string; // the family's id as phones know it (its Supabase uuid on a merged row)
  card: string; // cardRef(dishAskId)
  side: JoinSide;
  name: string | null;
  exp: number; // ms since epoch
  jti: string;
};
export type MovedReceipt = {
  v: 1;
  kind: "moved";
  fromProfile: string;
  fromFamily: string;
  toProfile: string;
  toFamily: string;
  solo: boolean; // nobody else signs in to the old family, so its recipes and phone-less `faces` come along
  faces: string[];
  exp: number;
};

const CARD = /^[0-9a-f]{24}$/;
const JTI = /^[0-9A-Za-z]{16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TICKET = 1000;
const MAX_RECEIPT = 2000;

export const joinSecret = () => process.env.LINK_JOIN_SECRET?.trim() || undefined;

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

/** The JSON inside a signed token when its signature holds; null otherwise. Nothing is parsed before the signature is checked. */
function openSigned(secret: string, token: string, max: number): Record<string, unknown> | null {
  if (token.length > max) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || !B64URL.test(body) || !B64URL.test(sig)) return null;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(body, "base64url")));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The card's name in a ticket: no card id leaves the api. */
export const cardRef = (dishAskId: string) => createHash("sha256").update(`card:${dishAskId}`).digest("hex").slice(0, 24);

export function signTicket(secret: string, p: JoinPayload): string {
  // A fixed key order, so the same payload always makes the same ticket (the shared vectors).
  const body = b64({ v: p.v, fam: p.fam, card: p.card, side: p.side, name: p.name, exp: p.exp, jti: p.jti });
  return `${body}.${sign(secret, body)}`;
}

/** Supabase's strict check, the side that actually made a person: Convex's own copy didn't check the shape of `fam`, `card` or `jti`. */
export function verifyTicket(secret: string, ticket: string, now: number): JoinPayload | null {
  const p = openSigned(secret, ticket, MAX_TICKET) as Partial<JoinPayload> | null;
  if (!p) return null;
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

export function signMoved(secret: string, r: MovedReceipt): string {
  const { v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp } = r;
  const body = b64({ v, kind, fromProfile, fromFamily, toProfile, toFamily, solo, faces, exp });
  return `${body}.${sign(secret, body)}`;
}

export function verifyMoved(secret: string, receipt: string, now: number): MovedReceipt | null {
  const p = openSigned(secret, receipt, MAX_RECEIPT) as Partial<MovedReceipt> | null;
  if (!p) return null;
  const ok =
    p.v === 1 &&
    p.kind === "moved" &&
    typeof p.fromProfile === "string" &&
    typeof p.fromFamily === "string" &&
    typeof p.toProfile === "string" &&
    typeof p.toFamily === "string" &&
    typeof p.solo === "boolean" &&
    Array.isArray(p.faces) && p.faces.length <= 50 && p.faces.every((f) => typeof f === "string") &&
    typeof p.exp === "number" && Number.isFinite(p.exp);
  if (!ok || p.exp! <= now) return null;
  return p as MovedReceipt;
}

export const roleForSide = (side: JoinSide): "cook" | "kid" => (side === "kid" ? "kid" : "cook");
export const shareTokenForSide = (card: string, side: JoinSide) => `link:${card}:${side}`;
