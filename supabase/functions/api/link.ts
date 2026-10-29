// POST /auth/link: someone new joins a family from a dish card's link (docs/build/V2-LINKING.md §2.4).
// Convex vouches for the join with a signed ticket (convex/lib/joinTicket.ts); this file checks it with
// the same secret and makes a NEW person in the ticket's family, with this phone's own key.
//
//   POST /auth/link { ticket, name?, device_label? }
//     -> { existing: false, needs_name: false, joined: true, device_key, family_name, profile_id }
//   503 no LINK_JOIN_SECRET · 400 no ticket / a bad name · 403 a bad, forged or expired ticket
//   404 the ticket's family is gone · 409 that card side already brought someone in, or the name is taken
//
// Rules that hold here:
// - The family comes only from the ticket. A family_id (or anything else) in the body is ignored.
// - One join per card side, ever. Each join is logged in `signups` as share_token "link:<card>:<side>";
//   a side already logged is refused, which also covers a reused ticket (jti).
// - Only ever a new profile, with the role from the side (kid -> learner, cook -> cook). It never signs
//   into, claims or changes anyone already in the family, not even an invited person with the same name.
// - Passive safety, as a family invite: the phone's key is `via: "invite"`, and the family chat gets a note.
//
// Same deps-injection style as hearts.ts: index.ts passes its helpers in and registers the route, so
// supabase/tests/link_test.ts runs with a fake db and no network.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD = /^[0-9a-f]{24}$/;
const JTI = /^[0-9A-Za-z]{16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TICKET = 1000;
/** index.ts's MAX_NAME, and the signups table's name check. */
const MAX_NAME = 40;
/** index.ts's PROFILE_COLS: what addProfile() reads from the people already here. */
const PROFILE_COLS = "id, family_id, name, role, relation, avatar_key, sort";

export const LINK_USED = "This link already brought someone in. Ask them for an invite.";
const BAD_TICKET = "This link didn't work. Open it again.";

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

export const roleFor = (side: JoinSide): "cook" | "learner" => (side === "kid" ? "learner" : "cook");
export const shareTokenFor = (card: string, side: JoinSide) => `link:${card}:${side}`;

type Member = { id: string; name: string; sort: number };

/** index.ts's helpers. Methods, so index.ts's wider signatures (ProfileRow, Via) fit as they are. */
export type LinkDeps = {
  db: SupabaseClient;
  HttpError: new (status: number, message: string, extra?: Record<string, unknown>) => Error;
  dbFail(context: string, error: { message?: string; code?: string } | null): never;
  rateLimit(kind: string, value: string, max: number, windowMin: number): Promise<void>;
  str(v: unknown, field: string, opts: { max: number; required?: boolean }): string | null;
  deviceLabel(b: Record<string, unknown>): string | null;
  addProfile(familyId: string, existing: Member[], p: { name: string; role: "cook" | "learner" }): Promise<Member>;
  createDevice(familyId: string, profileId: string | null, via: "invite", label: string | null): Promise<{ id: string; key: string }>;
  quietNote(familyId: string, profileId: string, body: string): Promise<void>;
  /** LINK_JOIN_SECRET, read on every call. Tests pass their own. */
  secret?: () => string | undefined;
  now?: () => number;
};

export async function linkJoin(deps: LinkDeps, b: Record<string, unknown>, ip: string) {
  const { db, HttpError } = deps;
  const secret = (deps.secret ?? (() => Deno.env.get("LINK_JOIN_SECRET")))();
  if (!secret) throw new HttpError(503, "Links aren't set up yet.");
  await deps.rateLimit("linkjoin-ip", ip, 20, 10);

  const ticket = typeof b.ticket === "string" ? b.ticket.trim() : "";
  if (!ticket) throw new HttpError(400, "ticket is required");
  const t = await verifyTicket(secret, ticket, (deps.now ?? Date.now)());
  if (!t) throw new HttpError(403, BAD_TICKET);
  const name = deps.str(b.name, "name", { max: MAX_NAME }) ?? deps.str(t.name, "name", { max: MAX_NAME, required: true })!;
  const label = deps.deviceLabel(b);

  const { data: fam, error } = await db.from("families").select("id, name").eq("id", t.fam).maybeSingle();
  if (error) deps.dbFail("link family", error);
  if (!fam) throw new HttpError(404, "That family isn't on homecookd anymore.");

  const token = shareTokenFor(t.card, t.side);
  const used = await db.from("signups").select("id").eq("share_token", token).limit(1);
  if (used.error) deps.dbFail("link used", used.error);
  if (used.data?.length) throw new HttpError(409, LINK_USED);

  const { data: members, error: mErr } = await db.from("profiles").select(PROFILE_COLS)
    .eq("family_id", fam.id).is("removed_at", null).order("sort");
  if (mErr) deps.dbFail("link family profiles", mErr);

  // Claim the side before making anyone, so a lost log can never leave it open. The unique index
  // signups_link_share_token (migration 20261029090000) refuses a second claim for the side; before that
  // migration is applied, of two joins at once the earliest row wins and the other backs out.
  const claim = await db.from("signups").insert({ name, email: "", share_token: token, family_id: fam.id })
    .select("id").single();
  if (claim.error?.code === "23505") throw new HttpError(409, LINK_USED);
  if (claim.error) deps.dbFail("link claim", claim.error);
  const claimId = claim.data.id as string;
  const unclaim = async () => {
    const del = await db.from("signups").delete().eq("id", claimId);
    if (del.error) console.error("link unclaim:", del.error.message);
  };
  const first = await db.from("signups").select("id").eq("share_token", token)
    .order("created_at").order("id").limit(1);
  if (first.error || first.data?.[0]?.id !== claimId) {
    await unclaim();
    if (first.error) deps.dbFail("link first", first.error);
    throw new HttpError(409, LINK_USED);
  }

  let p: Member;
  try {
    p = await deps.addProfile(fam.id as string, (members ?? []) as Member[], { name, role: roleFor(t.side) });
  } catch (e) {
    await unclaim(); // e.g. the name is taken: they can try another one
    throw e;
  }
  let dev: { id: string; key: string };
  try {
    dev = await deps.createDevice(fam.id as string, p.id, "invite", label);
  } catch (e) {
    const del = await db.from("profiles").delete().eq("id", p.id);
    if (del.error) console.error("link profile undo:", del.error.message);
    await unclaim();
    throw e;
  }
  // The card's other side isn't in the ticket, so the note can't say whose link it was.
  await deps.quietNote(fam.id as string, p.id, `${p.name} joined from a link`);
  return {
    existing: false,
    needs_name: false,
    joined: true,
    device_key: dev.key,
    family_name: fam.name as string,
    profile_id: p.id,
  };
}
