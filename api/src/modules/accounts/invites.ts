// Invites and join links. A family's join link (22 characters) works for anyone, any number of times, for a week: that's how people join from 1.1 on
// (docs/build/JOIN-SIMPLE.md). One-use invites with a 6-letter code stay for 1.0 phones (old builds keep working, SYSTEM-DESIGN.md). Peeking reads only: opening or
// previewing a link never joins.
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db, tx, type Queryable } from "../../db.js";
import { invalid, notFound } from "../../errors.js";
import * as data from "./data.js";
import { extId, toProfile, type InviteRow, type JoinLinkRow, type Person } from "./data.js";
import { addPerson, mapUnique } from "./family.js";
import { quietNote } from "./neighbors.js";
import { JOIN_LINK_SALT, seal, unseal } from "../../sealed.js";
import { type Ctx, profileIn, requireMe } from "./proofs.js";
import {
  BAD_INVITE_CODE,
  BAD_INVITE_LINK,
  DEVICE_KEY,
  deviceLabel,
  INVITE_CODE,
  INVITE_DAYS,
  INVITE_GONE,
  INVITE_TOKEN,
  JOIN_LINK_DAYS,
  JOIN_TOKEN,
  limit,
  MAX_NAME,
  nameKey,
  newJoinToken,
  phoneOf,
  refuse,
  roleOf,
  roleOut,
  sha256Hex,
  str,
  TOO_MANY_INVITES,
  UPDATE_TO_JOIN,
  type Body,
} from "./values.js";

const webUrl = () => (process.env.EDIBLE_WEB_URL ?? "https://homecookd.app").replace(/\/+$/, "");

export const inviteStatus = (r: Pick<InviteRow, "status" | "expires_at">) =>
  r.status === "pending" && r.expires_at.getTime() <= Date.now() ? ("expired" as const) : r.status;

export const linkStatus = (r: Pick<JoinLinkRow, "expires_at" | "revoked_at">) =>
  r.revoked_at ? ("revoked" as const) : r.expires_at !== null && r.expires_at.getTime() <= Date.now() ? ("expired" as const) : ("pending" as const);

// ---------------------------------------------------------------------------------------------
// The family's link

/** The family's live link while it has more than a day left, so "Invite family" shows the same link all week; else a new one. Never the operator's with no expiry. */
export async function familyJoinLink(ctx: Ctx) {
  const me = requireMe(ctx);
  await limit("joinlinks", ctx.family.id, 50, 24 * 60, TOO_MANY_INVITES);
  for (const row of await data.liveJoinLinks(db(), ctx.family.id)) {
    const token = await unseal(JOIN_LINK_SALT, row.id, row.token_enc);
    if (token && JOIN_TOKEN.test(token)) return { url: `${webUrl()}/i?t=${token}`, expires_at: row.expires_at!.toISOString() };
  }
  for (let i = 0; i < 3; i += 1) {
    const id = randomUUID();
    const token = newJoinToken();
    const expires = await data.insertJoinLink(db(), {
      id,
      familyId: ctx.family.id,
      inviterId: me.id,
      tokenHash: sha256Hex(token),
      tokenEnc: await seal(JOIN_LINK_SALT, id, token),
      days: JOIN_LINK_DAYS,
    });
    if (expires) return { url: `${webUrl()}/i?t=${token}`, expires_at: expires.toISOString() };
  }
  throw refuse(500, "server_error", "Couldn't make a link. Please try again.");
}

/** Turns off the family's live links; the next call makes a new one. A link with no expiry, the TEST family's, is an operator's and stays. */
export async function revokeFamilyLinks(ctx: Ctx) {
  requireMe(ctx);
  await data.revokeJoinLinksOf(db(), ctx.family.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Peeking

/** "Are you Leo?": the one person whose name is exactly the typed one, not removed, with no account and no live phone. Never a list; nothing without a typed name. */
export async function claimableIn(q: Queryable, familyId: string, typed: unknown) {
  const key = nameKey(typed);
  if (!key) return null;
  const named = (await data.peopleOf(q, familyId)).filter((p) => !p.removed_at && nameKey(p.name) === key);
  if (!named.length) return null;
  const on = await data.signedInIds(q, named.map((p) => p.id));
  const free = named.filter((p) => !on.has(p.id));
  if (free.length !== 1) return null;
  return { id: extId(free[0]), name: free[0].name, avatar_key: free[0].avatar_key ?? null };
}

/** Misses count against the IP, on top of each route's own limit. */
export async function inviteNotFound(ip: string, by: "token" | "code" = "token"): Promise<never> {
  await limit("badinvite", ip, 20, 10);
  throw notFound(by === "code" ? BAD_INVITE_CODE : BAD_INVITE_LINK);
}

/** Every typed code is counted before it's looked up: per IP, and across the service, so many IPs together can't sweep 32^6 codes. Links are never slowed by this. */
async function limitCodeTries(ip: string): Promise<void> {
  await limit("invitecode-ip", ip, 20, 10, "Too many tries. Wait a few minutes, or tap the invite link instead.");
  await limit("invitecode-all", "all", 100, 10, "Invite codes are busy right now. Tap the invite link instead.");
}

async function inviteLookup(b: Body) {
  const token = str(b.token, "token", { max: 100 });
  const code = str(b.code, "code", { max: 20 });
  if (token) return { by: "token" as const, col: "token_hash" as const, hash: INVITE_TOKEN.test(token) ? sha256Hex(token) : null };
  if (code) {
    const c = code.toUpperCase().replace(/[\s-]/g, "");
    return { by: "code" as const, col: "code_hash" as const, hash: INVITE_CODE.test(c) ? sha256Hex(c) : null };
  }
  throw invalid("token", "token or code is required");
}

/** Whether the phone sending x-device-key is already in this family. Reads only: a bad or signed-out key is simply false. Without the header it's left out. */
async function sameFamily(req: FastifyRequest, familyId: string): Promise<boolean | undefined> {
  const raw = req.headers["x-device-key"];
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return undefined;
  if (!DEVICE_KEY.test(key)) return false;
  const row = await data.deviceByKey(db(), key);
  return !!row && !row.revoked_at && row.family_id === familyId;
}

const shownInviter = (p: Person | null) => (p && !p.removed_at && !p.deleted_at ? { name: p.name, relation: p.relation, avatar_key: p.avatar_key } : null);

async function personIn(id: string | null): Promise<Person | null> {
  return id ? data.personByExtId(db(), id) : null;
}

export async function peek(req: FastifyRequest, b: Body) {
  const ip = req.ip;
  await limit("invitepeek-ip", ip, 60, 10);
  const raw = typeof b.token === "string" ? b.token.trim() : "";
  if (JOIN_TOKEN.test(raw)) {
    const link = await data.joinLinkByToken(db(), raw);
    if (!link) return inviteNotFound(ip);
    const family = await data.familyById(db(), link.family_id);
    if (!family || family.blanked_at) return inviteNotFound(ip);
    const status = linkStatus(link);
    return {
      status,
      family_name: family.name,
      inviter: shownInviter(await personIn(link.inviter_id)),
      invitee: null,
      expires_at: link.expires_at?.toISOString() ?? null,
      same_family: await sameFamily(req, link.family_id),
      kind: "link" as const,
      claimable: status === "pending" ? await claimableIn(db(), link.family_id, b.name) : null,
    };
  }
  const look = await inviteLookup(b);
  if (look.by === "code" && look.hash) await limitCodeTries(ip);
  const inv = look.hash ? await data.inviteBy(db(), look.col, look.hash) : null;
  if (!inv) return inviteNotFound(ip, look.by);
  const family = await data.familyById(db(), inv.family_id);
  if (!family || family.blanked_at) return inviteNotFound(ip, look.by);
  const invitee = await personIn(inv.person_id);
  // Names someone who no longer exists.
  if (inv.person_id && (!invitee || invitee.deleted_at)) return inviteNotFound(ip, look.by);
  const status = inviteStatus(inv) === "pending" && invitee?.removed_at ? ("revoked" as const) : inviteStatus(inv);
  return {
    status,
    family_name: family.name,
    inviter: shownInviter(await personIn(inv.inviter_id)),
    invitee: invitee ? { name: invitee.name, role: roleOut(invitee.role), avatar_key: invitee.avatar_key } : null,
    expires_at: inv.expires_at.toISOString(),
    same_family: await sameFamily(req, inv.family_id),
    claimable: !invitee && status === "pending" ? await claimableIn(db(), inv.family_id, b.name) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Making an invite (1.0 phones)

async function createInvite(q: Queryable, ctx: Ctx, inviterId: string, personId: string | null, phone: string | null) {
  const made = await data.insertInvite(q, { familyId: ctx.family.id, inviterId, personId, phone, days: INVITE_DAYS });
  return {
    id: made.id,
    // The code rides along so the web /i page can show it (only hashes are kept here).
    url: `${webUrl()}/i?t=${made.token}&c=${made.code}`,
    code: made.code,
    expires_at: made.expiresAt.toISOString(),
    phone,
  };
}

/**
 * `{}`: a family invite, for whoever opens it. Older shapes still work: invite someone new (`{name, role, relation?, phone?}`: their person is made now, so their face
 * shows right away) or send a fresh link to someone who hasn't joined (`{profile_id, phone?}`; their older links stop working).
 */
export async function makeInvite(ctx: Ctx, b: Body) {
  const me = requireMe(ctx);
  let phone = phoneOf(b.phone);
  const given = (v: unknown) => v !== undefined && v !== null;
  const counted = () => limit("invites", ctx.family.id, 50, 24 * 60, TOO_MANY_INVITES);
  if (!given(b.name) && !given(b.profile_id)) {
    await counted();
    const invite = await createInvite(db(), ctx, me.id, null, phone);
    return { invite: { ...invite, profile_id: null }, profile: null };
  }
  if (given(b.profile_id)) {
    const p = profileIn(ctx, b.profile_id, "profile_id");
    if (p.id === me.id) throw invalid("profile_id", "You're already in.");
    if ((await data.signedInIds(db(), [p.id])).has(p.id)) throw refuse(409, "already_joined", `${p.name} already joined.`);
    await counted();
    phone ??= await data.lastInvitePhone(db(), p.id);
    const invite = await tx(async (c) => {
      await data.revokeInvitesOf(c, p.id);
      return createInvite(c, ctx, me.id, p.id, phone);
    });
    return { invite: { ...invite, profile_id: extId(p) }, profile: { ...toProfile(p), invited: true } };
  }
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const role = roleOf(b.role, true)!;
  const relation = str(b.relation, "relation", { max: MAX_NAME });
  await counted();
  const { invite, person } = await mapUnique(
    tx(async (c) => {
      const family = await data.lockFamily(c, ctx.family.id);
      if (!family || family.blanked_at) throw notFound("That family isn't on homecookd anymore.");
      const members = (await data.peopleOf(c, ctx.family.id)).filter((p) => !p.removed_at);
      const person = await addPerson(c, ctx.family.id, members, { name, role, relation });
      return { person, invite: await createInvite(c, ctx, me.id, person.id, phone) };
    }),
    (constraint) => (constraint === "people_family_name_unique" ? refuse(409, "name_taken", `${name} is already in this family`) : null),
  );
  return { invite: { ...invite, profile_id: extId(person) }, profile: { ...toProfile(person), invited: true } };
}

// ---------------------------------------------------------------------------------------------
// The Join tap (1.0 phones)

/**
 * Uses the invite up and hands this phone its key. A named invite signs it in as that person; a family invite makes a phone with no person yet, which then adds itself or
 * asks to move in. A 1.1 family join link needs Sign in with Apple: 426. One transaction: nothing is used up unless the key is made.
 */
export async function acceptInvite(req: FastifyRequest, b: Body) {
  const ip = req.ip;
  await limit("inviteaccept-ip", ip, 20, 10);
  if (typeof b.token === "string" && JOIN_TOKEN.test(b.token.trim())) throw refuse(426, "update_app", UPDATE_TO_JOIN);
  const look = await inviteLookup(b);
  const label = deviceLabel(b);
  if (!look.hash) return inviteNotFound(ip, look.by);
  if (look.by === "code") await limitCodeTries(ip);

  const outcome = await tx(async (c) => {
    const inv = await data.claimInvite(c, { col: look.col, value: look.hash! });
    if (!inv) {
      const row = await data.inviteBy(c, look.col, look.hash!);
      return { kind: "missed" as const, row };
    }
    const family = await data.lockFamily(c, inv.family_id);
    if (!family || family.blanked_at) throw refuse(410, "gone", INVITE_GONE.revoked, { status: "revoked" });
    const person = inv.person_id ? await data.lockLivePerson(c, inv.person_id) : null;
    if (inv.person_id && !person) {
      await data.revokeInvite(c, inv.id);
      return { kind: "gone" as const };
    }
    const device = await data.insertDevice(c, { familyId: inv.family_id, personId: person?.id ?? null, via: "invite", label });
    await data.setInviteDevice(c, inv.id, device.id);
    if (person) await data.revokeInvitesOf(c, person.id, inv.id);
    return { kind: "joined" as const, inv, person, family, device };
  });
  if (outcome.kind === "gone") throw refuse(410, "gone", INVITE_GONE.revoked, { status: "revoked" });
  if (outcome.kind === "missed") {
    const row = outcome.row;
    if (!row) return inviteNotFound(ip, look.by);
    const status = inviteStatus(row);
    // Still pending: another tap holds it right now. The next tap will work.
    if (status === "pending") throw refuse(409, "retry", "Please tap Join again.");
    throw refuse(410, "gone", INVITE_GONE[status], { status });
  }
  const { person, family, device, inv } = outcome;
  // A family invite posts no note yet: "<Name> joined." comes when the phone says who it is.
  if (person) await quietNote(inv.family_id, person.id, `${person.name} joined.`, req.log.error.bind(req.log));
  return { device_key: device.key, family_name: family.name, profile_id: person ? extId(person) : null };
}
