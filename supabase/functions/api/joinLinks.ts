// Joining a family only by a link (docs/build/JOIN-SIMPLE.md §3, §4, §6).
//
//   POST /join-links (signed in)        -> { url: "<WEB_URL>/i?t=<22 characters>", expires_at }
//   POST /join-links/revoke (signed in) -> { ok: true }
//   POST /invites/peek { token: <22> }  -> { status, family_name, inviter, invitee: null, expires_at, same_family, kind: "link" }
//   POST /invites/accept { token: <22> } -> 426 "Update homecookd to join this family." (1.0 can't join by one)
//   POST /auth/apple|google { id_token, join_token | link_ticket, name?, role?, move?, device_label? } -> signInByLink()
//
// The family's join link works for anyone, any number of times, for JOIN_LINK_DAYS. Only sha256(token) is
// looked up; `token_enc` keeps the token AES-GCM sealed (as families.code_enc, AAD = the link's id) so
// POST /join-links can show the same link all week. A link with no expiry is an operator's (the TEST family's
// for App Review, JOIN-SIMPLE.md §5): the routes never hand it out or turn it off.
//
// signInByLink, after the Apple / Google token checks out:
// - the link: `join_token` is a family join link (22 characters) or an old one-use invite (16, from a 1.0
//   phone), or `link_ticket` is Phase 4's signed ticket (link.ts). It names the family, and the role (a
//   ticket's side; else the body's role, learner by default);
// - a known account in that family signs in; nothing is used up;
// - a known account in another family gets `needs_move` and nothing changes; with `move: true` it moves;
// - a new account: `needs_name` without a name, else a NEW profile in the family (never an existing or
//   invited face), this account, this phone's key, a signups row and "<name> joined".
// A ticket's card side and an old invite are used up before anyone is made, and put back when the join fails.
//
// Same deps-injection style as hearts.ts: index.ts passes its helpers in, so supabase/tests/joinLinks_test.ts
// runs with a fake db and no network.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BAD_TICKET, LINK_USED, roleFor, shareTokenFor, signMoved, verifyTicket } from "./link.ts";

export type Role = "cook" | "learner";
export type Who = { provider: "apple" | "google"; sub: string; email: string | null; givenName: string | null };
type Member = { id: string; family_id: string; name: string; role: string; sort: number };
type Known = { profile: Member; familyName: string };
type SignedIn = { existing: boolean; needs_name: boolean; joined: boolean; device_key: string; family_name: string; profile_id: string };
/** signInByLink's answers: signed in (joined, or moved with Convex's receipt), or a question for the app. */
export type LinkSignIn =
  | SignedIn
  | (SignedIn & { moved: { receipt: string | null } })
  | { existing: true; needs_move: true; from_family: string; to_family: string }
  | { existing: false; needs_name: true; suggested_name: string | null };

/** TODO(caleb): how long a family's join link works. */
export const JOIN_LINK_DAYS = 7;
const DAY_MS = 86_400_000;
/** How long Convex accepts a "moved" receipt. */
const RECEIPT_MS = 60 * 60_000;
export const JOIN_TOKEN = /^[0-9A-Za-z]{22}$/;
/** An old one-use invite's link token (index.ts's INVITE_TOKEN). */
const INVITE_TOKEN = /^[0-9A-Za-z]{16}$/;
/** index.ts's MAX_NAME, MAX_PROFILES and PROFILE_COLS. */
const MAX_NAME = 40;
const MAX_PROFILES = 30;
const PROFILE_COLS = "id, family_id, name, role, relation, avatar_key, sort";
const INVITE_COLS = "id, family_id, status, expires_at";

export const UPDATE_TO_JOIN = "Update homecookd to join this family.";
export const INVITE_GONE: Record<"used" | "expired" | "revoked", string> = {
  used: "This invite was already used.",
  expired: "This invite expired.",
  revoked: "This invite was turned off.",
};
export const LINK_GONE: Record<"expired" | "revoked", string> = {
  expired: "This link expired.",
  revoked: "This link was turned off.",
};

/** index.ts's helpers. Methods, so index.ts's wider signatures (ProfileRow, Via) fit as they are. */
export type JoinDeps = {
  db: SupabaseClient;
  HttpError: new (status: number, message: string, extra?: Record<string, unknown>) => Error;
  dbFail(context: string, error: { message?: string; code?: string } | null): never;
  rateLimit(kind: string, value: string, max: number, windowMin: number, message?: string): Promise<void>;
  sha256Hex(text: string): Promise<string>;
  /** 22 random base62 characters. */
  newToken(): string;
  /** AES-GCM with `aad` (the link's id), as families.code_enc. open() is null when it can't. */
  seal(aad: string, text: string): Promise<string>;
  open(aad: string, sealed: string | null): Promise<string | null>;
  webUrl: string;
  addProfile(familyId: string, existing: Member[], p: { name: string; role: Role }): Promise<Member>;
  createDevice(familyId: string, profileId: string, via: Who["provider"], label: string | null): Promise<{ id: string; key: string }>;
  quietNote(familyId: string, profileId: string, body: string): Promise<void>;
  knownIdentity(who: Who): Promise<Known | null>;
  linkIdentity(who: Who, profileId: string): Promise<boolean>;
  signInKnown(who: Who, known: Known, label: string | null): Promise<SignedIn>;
  /** Another tap linked this account first: deletes `made.profileId`, then signs in as that tap did. */
  afterLostLink(who: Who, made: { profileId?: string }, label: string | null): Promise<SignedIn>;
  /** "Leave the family" (POST /profiles/:id/remove) for someone moving away. */
  removeProfile(familyId: string, profileId: string): Promise<void>;
  /** LINK_JOIN_SECRET, read on every call. Tests pass their own. */
  secret?: () => string | undefined;
  now?: () => number;
};

const nowOf = (deps: JoinDeps) => (deps.now ?? Date.now)();
const secretOf = (deps: JoinDeps) => (deps.secret ?? (() => Deno.env.get("LINK_JOIN_SECRET")))();
const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

type LinkRow = { id: string; family_id: string; inviter_id: string | null; expires_at: string | null; revoked_at: string | null };
type LinkStatus = "pending" | "expired" | "revoked";
const linkStatus = (r: LinkRow, now: number): LinkStatus =>
  r.revoked_at ? "revoked" : r.expires_at !== null && Date.parse(r.expires_at) <= now ? "expired" : "pending";

type InviteRow = { id: string; family_id: string; status: "pending" | "used" | "revoked"; expires_at: string };
const inviteStatus = (r: InviteRow, now: number) =>
  r.status === "pending" && Date.parse(r.expires_at) <= now ? "expired" as const : r.status;

// ---------------------------------------------------------------------------------------------
// The family's link

/**
 * The family's live link while it has more than a day left (so "Invite family" shows the same link all
 * week), else a new one. Never the operator's link with no expiry.
 */
export async function familyJoinLink(deps: JoinDeps, familyId: string, inviterId: string) {
  const { db } = deps;
  const now = nowOf(deps);
  const { data, error } = await db.from("join_links").select("id, token_enc, expires_at")
    .eq("family_id", familyId).is("revoked_at", null).gt("expires_at", new Date(now + DAY_MS).toISOString())
    .order("expires_at", { ascending: false }).limit(5);
  if (error) deps.dbFail("join links", error);
  for (const row of data ?? []) {
    const token = await deps.open(row.id as string, row.token_enc as string | null);
    if (token && JOIN_TOKEN.test(token)) return { url: `${deps.webUrl}/i?t=${token}`, expires_at: row.expires_at as string };
  }
  const expiresAt = new Date(now + JOIN_LINK_DAYS * DAY_MS).toISOString();
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID();
    const token = deps.newToken();
    const ins = await db.from("join_links").insert({
      id,
      family_id: familyId,
      inviter_id: inviterId,
      token_hash: await deps.sha256Hex(token),
      token_enc: await deps.seal(id, token),
      expires_at: expiresAt,
    }).select("expires_at").single();
    if (!ins.error) return { url: `${deps.webUrl}/i?t=${token}`, expires_at: ins.data.expires_at as string };
    if (ins.error.code !== "23505") deps.dbFail("join link insert", ins.error); // else a collision: draw again
  }
  throw new deps.HttpError(500, "Couldn't make a link. Please try again.");
}

/** Turns off the family's live links; the next POST /join-links makes a new one. */
export async function revokeJoinLinks(deps: JoinDeps, familyId: string) {
  const { error } = await deps.db.from("join_links").update({ revoked_at: new Date(nowOf(deps)).toISOString() })
    .eq("family_id", familyId).is("revoked_at", null).not("expires_at", "is", null);
  if (error) deps.dbFail("join link revoke", error);
  return { ok: true };
}

/** What the join card shows (null: no such link). Reads only. */
export async function peekJoinLink(deps: JoinDeps, token: string, sameFamily: (familyId: string) => Promise<boolean | undefined>) {
  const { db } = deps;
  const { data, error } = await db.from("join_links").select("id, family_id, inviter_id, expires_at, revoked_at")
    .eq("token_hash", await deps.sha256Hex(token)).maybeSingle();
  if (error) deps.dbFail("join link peek", error);
  if (!data) return null;
  const link = data as LinkRow;
  const [fam, inviter] = await Promise.all([
    db.from("families").select("name").eq("id", link.family_id).single(),
    link.inviter_id
      ? db.from("profiles").select("name, relation, avatar_key, removed_at").eq("id", link.inviter_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (fam.error) deps.dbFail("join link family", fam.error);
  if (inviter.error) deps.dbFail("join link inviter", inviter.error);
  const by = inviter.data && !inviter.data.removed_at ? inviter.data : null;
  return {
    status: linkStatus(link, nowOf(deps)),
    family_name: fam.data.name as string,
    inviter: by ? { name: by.name, relation: by.relation, avatar_key: by.avatar_key } : null,
    invitee: null,
    expires_at: link.expires_at,
    same_family: await sameFamily(link.family_id),
    kind: "link" as const,
  };
}

/** 1.0's Join tap (POST /invites/accept) on a 1.1 join link: 426, and its page shows the sentence. */
export function refuseJoinLinkAccept(HttpError: JoinDeps["HttpError"], token: unknown): void {
  if (typeof token === "string" && JOIN_TOKEN.test(token.trim())) throw new HttpError(426, UPDATE_TO_JOIN);
}

// ---------------------------------------------------------------------------------------------
// Signing in with a link

/** Whether POST /auth/apple|google goes through signInByLink. */
export const hasLink = (b: Record<string, unknown>) => present(b.join_token) || present(b.link_ticket);

type Taken = { undo(): Promise<void>; used(deviceId: string): Promise<void> };
type Target = {
  familyId: string;
  familyName: string;
  role: Role;
  /** signups.share_token for this join. */
  token: string;
  /** The name a card suggests, for needs_name. */
  suggested: string | null;
  /** Uses the link up for this one join (a card side, an old invite); null for a join link anyone may use. */
  take: ((name: string, email: string | null) => Promise<Taken>) | null;
  /** take() writes the signups row itself (a card side's claim is that row). */
  logged: boolean;
};

async function notFound(deps: JoinDeps, ip: string): Promise<never> {
  await deps.rateLimit("badinvite", ip, 20, 10); // index.ts's inviteNotFound
  throw new deps.HttpError(404, "That invite link doesn't work.");
}

async function familyOf(deps: JoinDeps, id: string): Promise<{ id: string; name: string }> {
  const { data, error } = await deps.db.from("families").select("id, name").eq("id", id).maybeSingle();
  if (error) deps.dbFail("link family", error);
  if (!data) throw new deps.HttpError(404, "That family isn't on homecookd anymore.");
  return { id: data.id as string, name: data.name as string };
}

async function membersOf(deps: JoinDeps, familyId: string): Promise<Member[]> {
  const { data, error } = await deps.db.from("profiles").select(PROFILE_COLS)
    .eq("family_id", familyId).is("removed_at", null).order("sort");
  if (error) deps.dbFail("link family profiles", error);
  return (data ?? []) as Member[];
}

async function joinLinkTarget(deps: JoinDeps, token: string, role: Role, ip: string): Promise<Target> {
  const { data, error } = await deps.db.from("join_links").select("id, family_id, inviter_id, expires_at, revoked_at")
    .eq("token_hash", await deps.sha256Hex(token)).maybeSingle();
  if (error) deps.dbFail("join link", error);
  if (!data) return notFound(deps, ip);
  const status = linkStatus(data as LinkRow, nowOf(deps));
  if (status !== "pending") throw new deps.HttpError(410, LINK_GONE[status], { status });
  const fam = await familyOf(deps, data.family_id as string);
  return { familyId: fam.id, familyName: fam.name, role, token: `join:${data.id}`, suggested: null, take: null, logged: false };
}

/** A 1.0 phone's one-use invite: used up the way /invites/accept does, but always for a new person. */
async function inviteTarget(deps: JoinDeps, token: string, role: Role, ip: string): Promise<Target> {
  const { db, HttpError } = deps;
  const find = async (col: string, value: string) => {
    const { data, error } = await db.from("invites").select(INVITE_COLS).eq(col, value).maybeSingle();
    if (error) deps.dbFail("invite find", error);
    return (data as InviteRow | null) ?? null;
  };
  const inv = await find("token_hash", await deps.sha256Hex(token));
  if (!inv) return notFound(deps, ip);
  const status = inviteStatus(inv, nowOf(deps));
  if (status !== "pending") throw new HttpError(410, INVITE_GONE[status], { status });
  const fam = await familyOf(deps, inv.family_id);
  const take = async (): Promise<Taken> => {
    // One conditional UPDATE … RETURNING: of two joins at once, exactly one gets the invite.
    const at = new Date(nowOf(deps)).toISOString();
    const { data: claimed, error } = await db.from("invites").update({ status: "used", used_at: at })
      .eq("id", inv.id).eq("status", "pending").gt("expires_at", at).select("id");
    if (error) deps.dbFail("invite claim", error);
    if (!claimed?.length) {
      const row = await find("id", inv.id);
      const s = row ? inviteStatus(row, nowOf(deps)) : "revoked";
      if (s === "pending") throw new HttpError(409, "Please try again."); // another join's claim was just put back
      throw new HttpError(410, INVITE_GONE[s], { status: s });
    }
    return {
      undo: async () => {
        const up = await db.from("invites").update({ status: "pending", used_at: null })
          .eq("id", inv.id).eq("status", "used").is("used_device_id", null);
        if (up.error) console.error("invite put back:", up.error.message);
      },
      used: async (deviceId) => {
        const up = await db.from("invites").update({ used_device_id: deviceId }).eq("id", inv.id);
        if (up.error) console.error("invite device:", up.error.message);
      },
    };
  };
  return { familyId: fam.id, familyName: fam.name, role, token: `invite:${inv.id}`, suggested: null, take, logged: false };
}

/**
 * One join per card side: the signups row `link:<card>:<side>` is claimed before anyone is made. The unique
 * index signups_link_share_token (migration 20261029090000) refuses a second claim; before that migration
 * is applied, of two joins at once the earliest row wins and the other backs out.
 */
async function claimSide(deps: JoinDeps, familyId: string, token: string, name: string, email: string | null): Promise<Taken> {
  const { db, HttpError } = deps;
  const used = await db.from("signups").select("id").eq("share_token", token).limit(1);
  if (used.error) deps.dbFail("link used", used.error);
  if (used.data?.length) throw new HttpError(409, LINK_USED);
  const claim = await db.from("signups").insert({ name, email, share_token: token, family_id: familyId })
    .select("id").single();
  if (claim.error?.code === "23505") throw new HttpError(409, LINK_USED);
  if (claim.error) deps.dbFail("link claim", claim.error);
  const claimId = claim.data.id as string;
  const undo = async () => {
    const del = await db.from("signups").delete().eq("id", claimId);
    if (del.error) console.error("link unclaim:", del.error.message);
  };
  const first = await db.from("signups").select("id").eq("share_token", token)
    .order("created_at").order("id").limit(1);
  if (first.error || first.data?.[0]?.id !== claimId) {
    await undo();
    if (first.error) deps.dbFail("link first", first.error);
    throw new HttpError(409, LINK_USED);
  }
  return { undo, used: () => Promise.resolve() };
}

async function ticketTarget(deps: JoinDeps, raw: unknown): Promise<Target> {
  const secret = secretOf(deps);
  if (!secret) throw new deps.HttpError(503, "Links aren't set up yet.");
  if (typeof raw !== "string") throw new deps.HttpError(400, "link_ticket must be a string");
  const t = await verifyTicket(secret, raw.trim(), nowOf(deps));
  if (!t) throw new deps.HttpError(403, BAD_TICKET);
  const fam = await familyOf(deps, t.fam); // only from the ticket: anything else in the body is ignored
  const token = shareTokenFor(t.card, t.side);
  return {
    familyId: fam.id,
    familyName: fam.name,
    role: roleFor(t.side),
    token,
    suggested: t.name?.trim().slice(0, MAX_NAME) || null,
    take: (name, email) => claimSide(deps, fam.id, token, name, email),
    logged: true,
  };
}

/**
 * A new person in the link's family with this account and this phone's key. `leave` runs after the new
 * profile exists and before the account moves to it (a move's leaving the old family), so a name that's
 * taken changes nothing. Whatever was used up is put back when the join fails before the account is linked.
 */
async function addMember(deps: JoinDeps, who: Who, target: Target, name: string, label: string | null, leave?: () => Promise<void>) {
  const { db } = deps;
  const members = await membersOf(deps, target.familyId);
  const taken = target.take ? await target.take(name, who.email) : null;
  let made: Member | null = null;
  let linked: boolean;
  try {
    made = await deps.addProfile(target.familyId, members, { name, role: target.role });
    await leave?.();
    linked = await deps.linkIdentity(who, made.id);
  } catch (e) {
    if (made) {
      const del = await db.from("profiles").delete().eq("id", made.id);
      if (del.error) console.error("link profile undo:", del.error.message);
    }
    await taken?.undo();
    throw e;
  }
  const p = made;
  if (!linked) {
    await taken?.undo();
    return { lost: await deps.afterLostLink(who, { profileId: p.id }, label) };
  }
  const dev = await deps.createDevice(target.familyId, p.id, who.provider, label);
  await taken?.used(dev.id);
  if (!target.logged) {
    const su = await db.from("signups").insert({ name: p.name, email: who.email, share_token: target.token, family_id: target.familyId });
    if (su.error) console.error("signup log:", su.error.message);
  }
  return { lost: null, p, dev, members };
}

/** Of these people, does anyone sign in (a linked account or a live phone)? */
async function anySignedIn(deps: JoinDeps, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const [idn, dev] = await Promise.all([
    deps.db.from("identities").select("profile_id").in("profile_id", ids).limit(1),
    deps.db.from("devices").select("profile_id").in("profile_id", ids).is("revoked_at", null).limit(1),
  ]);
  if (idn.error) deps.dbFail("move identities", idn.error);
  if (dev.error) deps.dbFail("move devices", dev.error);
  return !!(idn.data?.length || dev.data?.length);
}

/**
 * A solo family's phone-less faces go with the person who moves. One the new family already has a name for
 * (a kid's face in Mom's family, when the kid is the one who sent the link) stays where it is, and so does
 * anyone past MAX_PROFILES. Best effort: the move itself has happened. Returns the ids moved.
 */
async function moveFaces(deps: JoinDeps, faces: Member[], fromId: string, toId: string, inNew: Member[]): Promise<string[]> {
  const { db } = deps;
  const moved: string[] = [];
  const names = new Set(inNew.map((p) => p.name.toLowerCase()));
  let sort = inNew.reduce((m, x) => Math.max(m, x.sort), 0);
  for (const f of faces) {
    if (inNew.length + moved.length >= MAX_PROFILES) break;
    if (names.has(f.name.toLowerCase())) continue;
    const up = await db.from("profiles").update({ family_id: toId, sort: sort + 1 })
      .eq("id", f.id).eq("family_id", fromId).is("removed_at", null).select("id");
    if (up.error) {
      console.error("move face:", up.error.code, up.error.message); // 23505: the name was taken a moment ago
      continue;
    }
    if (!up.data?.length) continue;
    sort++;
    moved.push(f.id);
    names.add(f.name.toLowerCase());
    // An invite naming them still points at the old family.
    const inv = await db.from("invites").update({ status: "revoked" }).eq("profile_id", f.id).eq("status", "pending");
    if (inv.error) console.error("move face invites:", inv.error.message);
  }
  return moved;
}

/** Leaves family A as "Leave the family" does, then joins the link's family B (JOIN-SIMPLE.md §4). */
async function moveTo(deps: JoinDeps, who: Who, known: Known, target: Target, name: string | null, label: string | null): Promise<LinkSignIn> {
  const old = known.profile;
  const fromId = old.family_id;
  const others = (await membersOf(deps, fromId)).filter((p) => p.id !== old.id);
  const solo = !(await anySignedIn(deps, others.map((p) => p.id)));
  const res = await addMember(deps, who, target, name ?? old.name, label, () => deps.removeProfile(fromId, old.id));
  if (res.lost) return res.lost;
  const { p, dev, members } = res;
  await deps.quietNote(fromId, old.id, `${old.name} left`);
  await deps.quietNote(target.familyId, p.id, `${p.name} joined`);
  const faces = solo ? await moveFaces(deps, others, fromId, target.familyId, [...members, p]) : [];
  const secret = secretOf(deps);
  const receipt = secret
    ? await signMoved(secret, {
      v: 1,
      kind: "moved",
      fromProfile: old.id,
      fromFamily: fromId,
      toProfile: p.id,
      toFamily: target.familyId,
      solo,
      faces,
      exp: nowOf(deps) + RECEIPT_MS,
    })
    : null;
  return {
    existing: true,
    needs_name: false,
    joined: true,
    device_key: dev.key,
    family_name: target.familyName,
    profile_id: p.id,
    moved: { receipt },
  };
}

/**
 * POST /auth/apple|google with `join_token` or `link_ticket`, once the id token checked out. `name` and
 * `role` are index.ts's parsed body fields.
 */
export async function signInByLink(
  deps: JoinDeps,
  who: Who,
  b: Record<string, unknown>,
  opts: { name: string | null; role: Role | null; label: string | null; ip: string },
): Promise<LinkSignIn> {
  const { HttpError } = deps;
  if (present(b.join_token) && present(b.link_ticket)) throw new HttpError(400, "Send join_token or link_ticket, not both.");
  if (b.move !== undefined && b.move !== null && typeof b.move !== "boolean") throw new HttpError(400, "move must be true or false");
  await deps.rateLimit("linkjoin-ip", opts.ip, 20, 10);

  let target: Target;
  if (present(b.join_token)) {
    if (typeof b.join_token !== "string") throw new HttpError(400, "join_token must be a string");
    const token = b.join_token.trim();
    const role = opts.role ?? "learner";
    if (JOIN_TOKEN.test(token)) target = await joinLinkTarget(deps, token, role, opts.ip);
    else if (INVITE_TOKEN.test(token)) target = await inviteTarget(deps, token, role, opts.ip);
    else target = await notFound(deps, opts.ip);
  } else {
    target = await ticketTarget(deps, b.link_ticket);
  }

  const known = await deps.knownIdentity(who);
  if (known && known.profile.family_id === target.familyId) return deps.signInKnown(who, known, opts.label);
  if (known) {
    if (b.move !== true) return { existing: true, needs_move: true, from_family: known.familyName, to_family: target.familyName };
    return moveTo(deps, who, known, target, opts.name, opts.label);
  }
  if (!opts.name) return { existing: false, needs_name: true, suggested_name: target.suggested ?? who.givenName };
  const res = await addMember(deps, who, target, opts.name, opts.label);
  if (res.lost) return res.lost;
  await deps.quietNote(target.familyId, res.p.id, `${res.p.name} joined`);
  return {
    existing: false,
    needs_name: false,
    joined: true,
    device_key: res.dev.key,
    family_name: target.familyName,
    profile_id: res.p.id,
  };
}
