// POST /auth/apple and /auth/google (supabase/functions/api/index.ts signInWith, and joinLinks.ts signInByLink). The token is checked first, with no transaction open, then
// each path is one transaction: the put-it-back steps the old code needed for a half-done join are gone, because a failure leaves nothing behind. A sign-in refuses rather
// than guesses, and it can never land on a tombstone: a deleted person's accounts are unlinked, and no path here makes or claims anyone who has deleted.
import { db, tx, type Queryable } from "../../db.js";
import { invalid, notFound, notSetUp } from "../../errors.js";
import { cancelDinnersOfLeaver } from "../community/account.js";
import * as data from "./data.js";
import { endFamilyIfLast } from "./deletion.js";
import { extId, type Family, type Person } from "./data.js";
import { addPerson, mapUnique, removePerson } from "./family.js";
import { audiencesOf, idTokens, providerLabel, type Provider, type Who } from "./identity.js";
import { inviteNotFound, inviteStatus, linkStatus } from "./invites.js";
import { quietNote, shareByToken, type Share } from "./neighbors.js";
import { joinSecret, roleForSide, shareTokenForSide, signMoved, verifyTicket } from "./tickets.js";
import {
  ALREADY_ON,
  BAD_TICKET,
  deviceLabel,
  INVITE_GONE,
  INVITE_TOKEN,
  JOIN_TOKEN,
  limit,
  LINK_GONE,
  LINK_USED,
  MAX_JOINS_PER_SHARE,
  MAX_NAME,
  MAX_PEOPLE,
  NOT_IN_FAMILY,
  present,
  RECEIPT_MS,
  refuse,
  roleOf,
  sha256Hex,
  shareTokenOf,
  str,
  UUID,
  type Body,
  type Role,
} from "./values.js";

const nameTaken = (name: string) => refuse(409, "name_taken", `${name} is already in this family. Try another name.`);
/** Another tap linked this account a moment ago: everything this one did goes back, and it signs in as that one did. */
class LostLink extends Error {}

type SignedIn = { existing: boolean; needs_name: boolean; joined: boolean; device_key: string; family_name: string; profile_id: string };
type Known = { person: Person; family: Family; email: string | null };
type Log = (fields: object, message: string) => void;
type Options = { name: string | null; role: Role | null; label: string | null; ip: string; log?: Log };

const ownName = (taken: (n: string) => string, name: string) => (constraint: string) =>
  constraint === "people_family_name_unique" ? refuse(409, "name_taken", taken(name)) : null;

const joinedName = (n: string) => `${n} is already in this family`;

/** The person this account signs in as. A removed or deleted person's old link is dropped: they count as new, and can never come back as that person. */
export async function knownIdentity(who: Who): Promise<Known | null> {
  const link = await data.identityOf(db(), who);
  if (!link) return null;
  const person = await data.personByExtId(db(), link.person_id);
  if (!person || person.removed_at || person.deleted_at) {
    await data.dropIdentity(db(), who);
    return null;
  }
  const family = await data.familyById(db(), person.family_id);
  if (!family || family.blanked_at) {
    await data.dropIdentity(db(), who);
    return null;
  }
  return { person, family, email: link.email };
}

/** A known person on a new phone. The person's row is held while the key is made, so this can't finish after their delete has run. */
async function signInKnown(who: Who, known: Known, opts: Options): Promise<SignedIn | null> {
  const p = known.person;
  const made = await tx(async (c) => {
    if (!(await data.lockLivePerson(c, p.id))) return null;
    // A repeated tap (or a retry after a lost response) is the same phone: no second note.
    const recent = await data.recentDeviceCount(c, p.id, who.provider);
    const device = await data.insertDevice(c, { familyId: p.family_id, personId: p.id, via: who.provider, label: opts.label });
    if (who.email && who.email !== known.email) await data.setIdentityEmail(c, who, who.email);
    return { device, recent };
  });
  if (!made) return null;
  if (!made.recent) await quietNote(p.family_id, p.id, `${p.name} signed in on a new phone`, opts.log);
  return { existing: true, needs_name: false, joined: false, device_key: made.device.key, family_name: known.family.name, profile_id: extId(p) };
}

/** Signs in as whoever this account now is; a known account that just went (deleted a moment ago) is 409, and the phone's next try is a new person. */
async function signInAgain(who: Who, opts: Options): Promise<SignedIn> {
  const known = await knownIdentity(who);
  const signed = known ? await signInKnown(who, known, opts) : null;
  if (!signed) throw refuse(409, "retry", "Please try again.");
  return signed;
}

/** Runs a join, and answers as the other tap did when one beat it to linking this account. */
async function orLostLink<T>(who: Who, opts: Options, join: () => Promise<T>): Promise<T | SignedIn> {
  try {
    return await join();
  } catch (error) {
    if (error instanceof LostLink) return signInAgain(who, opts);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Where a link points

type Target = {
  familyId: string;
  familyName: string;
  role: Role;
  /** signups.share_token for this join. */
  token: string;
  suggested: string | null;
  /** A card side: its signups row is the claim, made first. */
  side: boolean;
  /** An old one-use invite, used up in the join. */
  inviteId: string | null;
};

async function familyOf(id: string): Promise<Family> {
  const family = await data.familyByExtId(db(), id);
  if (!family || family.blanked_at) throw notFound("That family isn't on homecookd anymore.");
  return family;
}

async function targetOfLink(token: string, role: Role, ip: string): Promise<Target> {
  const link = await data.joinLinkByToken(db(), token);
  if (!link) return inviteNotFound(ip);
  const status = linkStatus(link);
  if (status !== "pending") throw refuse(410, "gone", LINK_GONE[status], { status });
  const family = await familyOf(link.family_id);
  return { familyId: family.id, familyName: family.name, role, token: `join:${link.id}`, suggested: null, side: false, inviteId: null };
}

async function targetOfInvite(token: string, role: Role, ip: string): Promise<Target> {
  const inv = await data.inviteBy(db(), "token_hash", sha256Hex(token));
  if (!inv) return inviteNotFound(ip);
  const status = inviteStatus(inv);
  if (status !== "pending") throw refuse(410, "gone", INVITE_GONE[status], { status });
  const family = await familyOf(inv.family_id);
  return { familyId: family.id, familyName: family.name, role, token: `invite:${inv.id}`, suggested: null, side: false, inviteId: inv.id };
}

async function targetOfTicket(raw: unknown): Promise<Target> {
  const secret = joinSecret();
  if (!secret) throw notSetUp("Links aren't set up yet.");
  if (typeof raw !== "string") throw invalid("link_ticket", "link_ticket must be a string");
  const t = verifyTicket(secret, raw.trim(), Date.now());
  if (!t) throw refuse(403, "ticket_expired", BAD_TICKET);
  const family = await familyOf(t.fam); // only from the ticket: anything else in the body is ignored
  return {
    familyId: family.id,
    familyName: family.name,
    role: roleForSide(t.side),
    token: shareTokenForSide(t.card, t.side),
    suggested: t.name?.trim().slice(0, MAX_NAME) || null,
    side: true,
    inviteId: null,
  };
}

/** The target's family under its lock, checked again: its last person may have deleted since the link was read. */
async function lockTargetFamily(c: Queryable, familyId: string): Promise<Person[]> {
  const family = await data.lockFamily(c, familyId);
  if (!family || family.blanked_at) throw notFound("That family isn't on homecookd anymore.");
  return (await data.peopleOf(c, familyId)).filter((p) => !p.removed_at);
}

async function useInvite(c: Queryable, inviteId: string): Promise<void> {
  const claimed = await data.claimInvite(c, { col: "id", value: inviteId });
  if (claimed) return;
  const { rows } = await c.query(`select status, expires_at from invites where id = $1`, [inviteId]);
  const status = rows[0] ? inviteStatus(rows[0]) : ("revoked" as const);
  if (status === "pending") throw refuse(409, "retry", "Please try again.");
  throw refuse(410, "gone", INVITE_GONE[status], { status });
}

// ---------------------------------------------------------------------------------------------
// Joining

/** A new person in the link's family with this account and this phone's key. `leave` runs after they exist and before the account moves to them, so a taken name changes nothing. */
async function joinAsNew(
  c: Queryable,
  who: Who,
  target: Target,
  name: string,
  label: string | null,
  members: Person[],
  leave?: () => Promise<void>,
): Promise<{ person: Person; device: { id: string; key: string } }> {
  let signup: string | null = null;
  if (target.inviteId) await useInvite(c, target.inviteId);
  if (target.side) {
    signup = await data.claimSignup(c, { name, email: who.email, shareToken: target.token, familyId: target.familyId });
    if (!signup) throw refuse(409, "link_used", LINK_USED);
  }
  const person = await addPerson(c, target.familyId, members, { name, role: target.role });
  await leave?.();
  if (!(await data.linkIdentity(c, who, person.id))) throw new LostLink();
  const device = await data.insertDevice(c, { familyId: target.familyId, personId: person.id, via: who.provider, label });
  if (target.inviteId) await data.setInviteDevice(c, target.inviteId, device.id);
  if (signup) await data.setSignupPerson(c, signup, person.id);
  else await data.insertSignup(c, { name: person.name, email: who.email, shareToken: target.token, familyId: target.familyId, personId: person.id });
  return { person, device };
}

/** Of these people, are any signed in anywhere? */
const anySignedIn = async (q: Queryable, ids: string[]) => (await data.signedInIds(q, ids)).size > 0;

/** "Yes, that's me": a new account becomes the family's phone-less person, with their name, role and history. One claim per person. Everything peek showed is checked again here. */
async function claimMember(who: Who, target: Target, rawId: string, opts: Options) {
  const claimed = await tx(async (c) => {
    await lockTargetFamily(c, target.familyId);
    const found = await data.personByExtId(c, rawId.toLowerCase());
    if (!found || found.family_id !== target.familyId || found.removed_at || found.deleted_at) throw refuse(409, "not_in_family", NOT_IN_FAMILY);
    const person = await data.lockLivePerson(c, found.id);
    if (!person) throw refuse(409, "not_in_family", NOT_IN_FAMILY);
    if (await anySignedIn(c, [person.id])) throw refuse(409, "already_joined", ALREADY_ON);
    const signup = await data.claimSignup(c, { name: person.name, email: who.email, shareToken: `link:claim:${extId(person)}`, familyId: target.familyId });
    if (!signup) throw refuse(409, "already_joined", ALREADY_ON);
    await data.setSignupPerson(c, signup, person.id);
    if (target.inviteId) await useInvite(c, target.inviteId);
    if (!(await data.linkIdentity(c, who, person.id))) throw new LostLink();
    const device = await data.insertDevice(c, { familyId: target.familyId, personId: person.id, via: who.provider, label: opts.label });
    if (target.inviteId) await data.setInviteDevice(c, target.inviteId, device.id);
    await data.revokeInvitesOf(c, person.id); // a 1.0 invite naming them would sign another phone in as them
    return { person, device };
  });
  await quietNote(target.familyId, claimed.person.id, `${claimed.person.name} joined`, opts.log);
  return { existing: false, needs_name: false, joined: true, device_key: claimed.device.key, family_name: target.familyName, profile_id: extId(claimed.person) };
}

/** A solo family's phone-less faces go with the person who moves. One the new family already has a name for stays, and so does anyone past the limit. */
/** Who comes along with someone moving: not a face the new family has a name for, and not past the limit. */
function whoComes(faces: Person[], inNew: Pick<Person, "name">[]): { comes: Person[]; left: Person[] } {
  const comes: Person[] = [];
  const left: Person[] = [];
  const names = new Set(inNew.map((p) => p.name.toLowerCase()));
  for (const face of faces) {
    if (inNew.length + comes.length >= MAX_PEOPLE || names.has(face.name.toLowerCase())) {
      left.push(face);
      continue;
    }
    comes.push(face);
    names.add(face.name.toLowerCase());
  }
  return { comes, left };
}

async function moveFaces(c: Queryable, faces: Person[], fromId: string, toId: string, inNew: Person[]): Promise<Person[]> {
  const moved: Person[] = [];
  let sort = inNew.reduce((m, x) => Math.max(m, x.sort), 0);
  for (const face of whoComes(faces, inNew).comes) {
    sort += 1;
    if (!(await data.moveFace(c, face.id, fromId, toId, sort))) continue;
    moved.push(face);
    await data.revokeInvitesOf(c, face.id); // an invite naming them still points at the old family
    await cancelDinnersOfLeaver(c, face.id); // a dinner they host would too (its blocks, who it's `ours` to): it's called off
  }
  return moved;
}

/**
 * Asked before a move, so the app can warn: the phone-less people this move would delete. With nobody else signed in to the old family they come along, and one who can't comes to
 * an end with it (endFamilyIfLast).
 */
async function facesAMoveDeletes(known: Known, target: Target, name: string | undefined): Promise<{ profile_id: string; name: string }[]> {
  const old = known.person;
  const others = (await data.peopleOf(db(), old.family_id)).filter((p) => !p.removed_at && p.id !== old.id);
  if (await anySignedIn(db(), others.map((p) => p.id))) return [];
  const members = (await data.peopleOf(db(), target.familyId)).filter((p) => !p.removed_at);
  return whoComes(others, [...members, { name: name ?? old.name }]).left.map((p) => ({ profile_id: extId(p), name: p.name }));
}

/** Leaves family A as "Leave the family" does, then joins the link's family B (JOIN-SIMPLE.md section 4). Only with `move: true`, after a fresh sign-in. */
async function moveTo(who: Who, known: Known, target: Target, opts: Options) {
  const old = known.person;
  const fromId = old.family_id;
  const joined = await mapUnique(
    tx(async (c) => {
      // In id order, so two moves between the same two families can't deadlock.
      for (const id of [fromId, target.familyId].sort()) await data.lockFamily(c, id);
      if (!(await data.lockLivePerson(c, old.id))) throw new LostLink();
      const others = (await data.peopleOf(c, fromId)).filter((p) => !p.removed_at && p.id !== old.id);
      const solo = !(await anySignedIn(c, others.map((p) => p.id)));
      const members = await lockTargetFamily(c, target.familyId);
      const { person, device } = await joinAsNew(c, who, target, opts.name ?? old.name, opts.label, members, () => removePerson(c, fromId, old.id));
      await data.setPreviousPerson(c, person.id, old.id);
      const faces = solo ? await moveFaces(c, others, fromId, target.familyId, [...members, person]) : [];
      await endFamilyIfLast(c, fromId, true); // a face the new family has a name for doesn't come along, and doesn't keep the old one open
      return { person, device, solo, faces };
    }),
    ownName(joinedName, opts.name ?? old.name),
  );
  const { person, device, solo, faces } = joined;
  await quietNote(fromId, old.id, `${old.name} left`, opts.log);
  await quietNote(target.familyId, person.id, `${person.name} joined`, opts.log);
  const secret = joinSecret();
  const receipt = secret
    ? signMoved(secret, {
        v: 1,
        kind: "moved",
        fromProfile: extId(old),
        fromFamily: extId(known.family),
        toProfile: extId(person),
        toFamily: extId((await data.familyById(db(), target.familyId))!),
        solo,
        faces: faces.map(extId),
        exp: Date.now() + RECEIPT_MS,
      })
    : null;
  return {
    existing: true,
    needs_name: false,
    joined: true,
    device_key: device.key,
    family_name: target.familyName,
    profile_id: extId(person),
    moved: { receipt },
  };
}

async function signInByLink(who: Who, b: Body, opts: Options) {
  if (present(b.join_token) && present(b.link_ticket)) throw invalid("link_ticket", "Send join_token or link_ticket, not both.");
  if (b.move !== undefined && b.move !== null && typeof b.move !== "boolean") throw invalid("move", "move must be true or false");
  let claim: string | null = null;
  if (present(b.claim_profile_id)) {
    if (!present(b.join_token)) throw invalid("claim_profile_id", "claim_profile_id goes only with a family join link.");
    if (typeof b.claim_profile_id !== "string" || b.claim_profile_id.length > 100) throw invalid("claim_profile_id", "claim_profile_id must be a profile id");
    claim = b.claim_profile_id.trim();
  }
  await limit("linkjoin-ip", opts.ip, 20, 10);

  let target: Target;
  if (present(b.join_token)) {
    if (typeof b.join_token !== "string") throw invalid("join_token", "join_token must be a string");
    const token = b.join_token.trim();
    const role = opts.role ?? "kid";
    if (JOIN_TOKEN.test(token)) target = await targetOfLink(token, role, opts.ip);
    else if (INVITE_TOKEN.test(token)) target = await targetOfInvite(token, role, opts.ip);
    else target = await inviteNotFound(opts.ip);
  } else {
    target = await targetOfTicket(b.link_ticket);
  }

  const known = await knownIdentity(who);
  if (known && known.person.family_id === target.familyId) return (await signInKnown(who, known, opts)) ?? signInAgain(who, opts);
  if (known) {
    if (b.move !== true) {
      return { existing: true, needs_move: true, from_family: known.family.name, to_family: target.familyName, would_delete: await facesAMoveDeletes(known, target, opts.name ?? undefined) };
    }
    return orLostLink(who, opts, () => moveTo(who, known, target, opts));
  }
  if (claim) return orLostLink(who, opts, () => claimMember(who, target, claim, opts));
  if (!opts.name) return { existing: false, needs_name: true, suggested_name: target.suggested ?? who.givenName };
  const name = opts.name;
  return orLostLink(who, opts, async () => {
    const { person, device } = await mapUnique(
      tx(async (c) => joinAsNew(c, who, target, name, opts.label, await lockTargetFamily(c, target.familyId))),
      ownName(joinedName, name),
    );
    await quietNote(target.familyId, person.id, `${person.name} joined`, opts.log);
    return { existing: false, needs_name: false, joined: true, device_key: device.key, family_name: target.familyName, profile_id: extId(person) };
  });
}

// ---------------------------------------------------------------------------------------------
// Older links and no link

/** A new person from a recipe link (1.0 phones): joins that family. A leaked link stops after MAX_JOINS_PER_SHARE; only someone invited and not yet joined can be claimed by name. */
async function joinByShare(who: Who, share: Share, name: string, role: Role, opts: Options) {
  return orLostLink(who, opts, async () => {
    const family = await data.familyById(db(), share.family_id);
    const joined = await mapUnique(
      tx(async (c) => {
        const members = await lockTargetFamily(c, share.family_id);
        if ((await data.joinsVia(c, `share:${share.id}`, share.family_id)) >= MAX_JOINS_PER_SHARE) throw refuse(403, "link_full", "This link is full. Ask your family for a new one.");
        const same = members.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (same) {
          const claimable = same.id !== share.sender_id && !same.email && !(await anySignedIn(c, [same.id])) && (await data.hasLiveInvite(c, same.id));
          if (!claimable) throw nameTaken(same.name);
        }
        const person = same ?? (await addPerson(c, share.family_id, members, { name, role }));
        if (!(await data.linkIdentity(c, who, person.id))) throw new LostLink();
        const device = await data.insertDevice(c, { familyId: share.family_id, personId: person.id, via: who.provider, label: opts.label });
        await data.insertSignup(c, { name, email: who.email, shareToken: `share:${share.id}`, familyId: share.family_id, personId: person.id });
        if (same) await data.revokeInvitesOf(c, same.id);
        return { person, device, sender: share.sender_id ? members.find((x) => x.id === share.sender_id) : undefined };
      }),
      (constraint) => (constraint === "people_family_name_unique" ? nameTaken(name) : null),
    );
    const note = joined.sender ? `${joined.person.name} joined from ${joined.sender.name}'s link` : `${joined.person.name} joined from a shared link`;
    await quietNote(share.family_id, joined.person.id, note, opts.log);
    return { existing: false, needs_name: false, joined: true, device_key: joined.device.key, family_name: family?.name ?? "", profile_id: extId(joined.person) };
  });
}

/** A new person with no link: their own family, "<Name>'s family". The one path into homecookd without a link. */
async function startFamily(who: Who, name: string, role: Role, opts: Options) {
  await limit("signup", opts.ip, 5, 60);
  const familyName = `${name}'s family`.slice(0, 60);
  return orLostLink(who, opts, async () => {
    const { person, device } = await tx(async (c) => {
      const { family } = await data.insertFamily(c, familyName);
      const founder = await addPerson(c, family.id, [], { name, role });
      if (!(await data.linkIdentity(c, who, founder.id))) throw new LostLink();
      const device = await data.insertDevice(c, { familyId: family.id, personId: founder.id, via: who.provider, label: opts.label });
      await data.insertSignup(c, { name, email: who.email, shareToken: null, familyId: family.id, personId: founder.id });
      return { person: founder, device };
    });
    return { existing: false, needs_name: false, joined: false, device_key: device.key, family_name: familyName, profile_id: extId(person) };
  });
}

/**
 * `{id_token, name?, role?, share_token?, device_label?}`. A known account signs in. A new account without `name` gets `{needs_name, suggested_name}` and nothing is made;
 * the app asks, then calls again with the same token. With `join_token` or `link_ticket`, plus `move?` and `claim_profile_id?`, signInByLink answers.
 */
export async function signInWith(provider: Provider, b: Body, ip: string, log?: Log) {
  if (!audiencesOf(provider).length) throw notSetUp(`${providerLabel(provider)} sign-in isn't set up yet.`);
  await limit("authid-ip", ip, 30, 10);
  const idToken = str(b.id_token, "id_token", { max: 8000, required: true })!;
  return signInAs(() => idTokens().verify(provider, idToken), b, ip, log);
}

/**
 * Everything after the provider: the same body, minus `id_token`. `identify` runs after the body is checked, so a bad field is still refused before the token,
 * as it was. Staging's test sign-in (testSignIn.ts) comes in here with a made-up account, so a script signs in, joins and starts a family exactly as a phone does.
 */
export async function signInAs(identify: () => Promise<Who>, b: Body, ip: string, log?: Log) {
  const label = deviceLabel(b);
  const name = str(b.name, "name", { max: MAX_NAME });
  const role = roleOf(b.role);
  const claim = typeof b.claim_profile_id === "string" ? b.claim_profile_id.trim() : "";
  if (claim && !UUID.test(claim)) throw invalid("claim_profile_id", "claim_profile_id is not a valid id");
  const who = await identify();
  const opts: Options = { name, role, label, ip, log };
  if (present(b.join_token) || present(b.link_ticket) || present(b.claim_profile_id)) return signInByLink(who, b, opts);

  const known = await knownIdentity(who);
  if (known) {
    const signed = await signInKnown(who, known, opts);
    if (signed) return signed;
    // They deleted between the two reads: the account is free now, so this is someone new.
  }
  if (!name) return { existing: false, needs_name: true, suggested_name: who.givenName };
  const shareToken = shareTokenOf(b.share_token);
  const share = shareToken ? await shareByToken(db(), shareToken) : null;
  if (share) return joinByShare(who, share, name, role ?? "kid", opts);
  // A recipe link that no longer works still means a learner; with no link at all the app asks.
  const hadLink = typeof b.share_token === "string" && b.share_token.trim() !== "";
  const finalRole = role ?? (hadLink ? "kid" : null);
  if (!finalRole) throw invalid("role", "role must be cook or learner");
  return startFamily(who, name, finalRole, opts);
}
