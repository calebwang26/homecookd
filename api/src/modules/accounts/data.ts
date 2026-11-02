// The SQL for families, people and how a phone proves who it is. The index behind each read is named in SCHEMA.md section 3 ("Sessions and accounts"). Every write to
// `families` or `people` goes through a function here that checks the switch (values.ts), so nothing can quietly write them while the sync owns them.
import { createHmac, randomUUID } from "node:crypto";
import type { Queryable } from "../../db.js";
import { seal, FAMILY_CODE_SALT, unseal } from "./sealed.js";
import type { Who } from "./identity.js";
import {
  assertOwnsPeople,
  newFamilyCode,
  newInviteCode,
  newInviteToken,
  newSecret,
  normalizeCode,
  ownsPeople,
  refuse,
  roleOut,
  sha256Hex,
  type Role,
  SESSION_DAYS,
} from "./values.js";

export type Via = "invite" | "apple" | "google" | "code" | "share";

export type Person = {
  id: string;
  supabase_id: string | null;
  family_id: string;
  name: string;
  role: Role;
  relation: string | null;
  avatar_key: string | null;
  sort: number;
  memorial: boolean;
  email: string | null;
  removed_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
};

const PERSON = `id, supabase_id, family_id, name, role, relation, avatar_key, sort, memorial, email, removed_at, deleted_at, created_at`;

/** The id a phone knows someone or a family by: its Supabase uuid on a merged row, else its own id (a new row's is a uuid too). */
export const extId = (row: { id: string; supabase_id: string | null }) => row.supabase_id ?? row.id;

/** A person as old builds read one: `learner`, and the id they hold. */
export const toProfile = (p: Person) => ({ id: extId(p), name: p.name, role: roleOut(p.role), relation: p.relation, avatar_key: p.avatar_key });

// ---------------------------------------------------------------------------------------------
// Families

export type Family = { id: string; supabase_id: string | null; name: string; code_enc: string | null; blanked_at: Date | null };
const FAMILY = `id, supabase_id, name, code_enc, blanked_at`;

export async function familyById(q: Queryable, id: string): Promise<Family | null> {
  const { rows } = await q.query(`select ${FAMILY} from families where id = $1`, [id]);
  return rows[0] ?? null;
}

/** A family by the id a phone or a ticket holds. */
export async function familyByExtId(q: Queryable, id: string): Promise<Family | null> {
  const { rows } = await q.query(`select ${FAMILY} from families where supabase_id = $1 or id = $1`, [id]);
  return rows[0] ?? null;
}

export async function familyByCode(q: Queryable, code: string): Promise<Family | null> {
  const { rows } = await q.query(`select ${FAMILY} from families where code_hash = $1`, [sha256Hex(normalizeCode(code))]);
  return rows[0] ?? null;
}

/**
 * Holds the family until commit, so two joins can't both pass the 30-person check and a join can't slip in as its last person deletes. FK checks on other tables
 * take a weaker lock, so this doesn't block anyone's messages. Ordered by the caller when it takes two.
 */
export async function lockFamily(q: Queryable, id: string): Promise<Family | null> {
  const { rows } = await q.query(`select ${FAMILY} from families where id = $1 for no key update`, [id]);
  return rows[0] ?? null;
}

/** A new family with a fresh code (a hash for lookups, a sealed copy so it can be recovered). */
export async function insertFamily(q: Queryable, name: string): Promise<{ family: Family; code: string }> {
  assertOwnsPeople();
  for (let i = 0; i < 5; i += 1) {
    const id = randomUUID();
    const code = newFamilyCode();
    const { rows } = await q.query(
      `insert into families (id, name, code_hash, code_enc) values ($1, $2, $3, $4) on conflict (code_hash) do nothing returning ${FAMILY}`,
      [id, name, sha256Hex(normalizeCode(code)), await seal(FAMILY_CODE_SALT, id, normalizeCode(code))],
    );
    if (rows[0]) return { family: rows[0], code };
  }
  throw refuse(500, "Couldn't create your family. Please try again.");
}

/** Keeps the recoverable copy of the code current (an older family, or a rotated key). Best effort, and never while the sync owns the row. */
export async function resealCode(q: Queryable, family: Family, code: string): Promise<void> {
  if (!ownsPeople() || !process.env.EDIBLE_CODE_KEY?.trim()) return;
  const normal = normalizeCode(code);
  if ((await unseal(FAMILY_CODE_SALT, family.id, family.code_enc)) === normal) return;
  await q.query(`update families set code_enc = $2 where id = $1`, [family.id, await seal(FAMILY_CODE_SALT, family.id, normal)]);
}

// ---------------------------------------------------------------------------------------------
// People

/** Everyone in a family who hasn't deleted, removed people included. A tombstone is never in a list. */
export async function peopleOf(q: Queryable, familyId: string): Promise<Person[]> {
  const { rows } = await q.query(
    `select ${PERSON} from people where family_id = $1 and deleted_at is null order by sort, created_at limit 500`,
    [familyId],
  );
  return rows;
}

/** Someone by the id a phone holds, tombstones included. */
export async function personByExtId(q: Queryable, id: string): Promise<Person | null> {
  const { rows } = await q.query(`select ${PERSON} from people where supabase_id = $1 or id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * A live person, held until commit: a sign-in that gets past this can't finish after the delete has run, and one that waits on the delete finds nobody. Weaker than
 * the delete's own lock in name only: FOR SHARE and FOR NO KEY UPDATE conflict, so one always sees the other's outcome.
 */
export async function lockLivePerson(q: Queryable, id: string): Promise<Person | null> {
  const { rows } = await q.query(`select ${PERSON} from people where id = $1 and deleted_at is null and removed_at is null for share`, [id]);
  return rows[0] ?? null;
}

export async function insertPerson(
  q: Queryable,
  p: { familyId: string; name: string; role: Role; relation?: string | null; email?: string | null; sort: number },
): Promise<Person> {
  assertOwnsPeople();
  const { rows } = await q.query(
    `insert into people (family_id, name, role, relation, email, sort) values ($1, $2, $3, $4, $5, $6) returning ${PERSON}`,
    [p.familyId, p.name, p.role, p.relation ?? null, p.email ?? null, p.sort],
  );
  return rows[0];
}

/** Leaves the family: out of every list, old messages keep their name and face. Their email goes too. */
export async function markPersonRemoved(q: Queryable, familyId: string, personId: string): Promise<void> {
  assertOwnsPeople();
  await q.query(`update people set removed_at = now(), email = null where id = $1 and family_id = $2 and removed_at is null`, [personId, familyId]);
}

/** A solo family's phone-less face going with the person who moved. Returns whether it moved. */
export async function moveFace(q: Queryable, faceId: string, from: string, to: string, sort: number): Promise<boolean> {
  assertOwnsPeople();
  const { rowCount } = await q.query(`update people set family_id = $3, sort = $4 where id = $1 and family_id = $2 and removed_at is null and deleted_at is null`, [
    faceId,
    from,
    to,
    sort,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function setRelationIfUnset(q: Queryable, personId: string, relation: string): Promise<void> {
  assertOwnsPeople();
  await q.query(`update people set relation = $2 where id = $1 and relation is null`, [personId, relation]);
}

// ---------------------------------------------------------------------------------------------
// Phones

export type DeviceRow = {
  id: string;
  family_id: string;
  person_id: string | null;
  via: Via;
  last_seen_at: Date;
  revoked_at: Date | null;
};

export async function deviceByKey(q: Queryable, key: string): Promise<(DeviceRow & { family_supabase_id: string | null; family_name: string; family_blanked_at: Date | null }) | null> {
  const { rows } = await q.query(
    `select d.id, d.family_id, d.person_id, d.via, d.last_seen_at, d.revoked_at, f.supabase_id as family_supabase_id, f.name as family_name, f.blanked_at as family_blanked_at
       from devices d join families f on f.id = d.family_id
      where d.key_hash = $1`,
    [sha256Hex(key)],
  );
  return rows[0] ?? null;
}

export async function touchDevice(q: Queryable, id: string): Promise<void> {
  await q.query(`update devices set last_seen_at = now() where id = $1`, [id]);
}

/** Who has a live phone of their own in this family. */
export async function peopleWithPhones(q: Queryable, familyId: string): Promise<Set<string>> {
  const { rows } = await q.query(`select distinct person_id from devices where family_id = $1 and revoked_at is null and person_id is not null`, [familyId]);
  return new Set(rows.map((r) => r.person_id));
}

export async function insertDevice(q: Queryable, d: { familyId: string; personId: string | null; via: Via; label: string | null }): Promise<{ id: string; key: string }> {
  const key = newSecret();
  const { rows } = await q.query(`insert into devices (family_id, person_id, key_hash, label, via) values ($1, $2, $3, $4, $5) returning id`, [
    d.familyId,
    d.personId,
    sha256Hex(key),
    d.label,
    d.via,
  ]);
  return { id: rows[0].id, key };
}

/** Set once: never moves an owner, and never on a signed-out phone. */
export async function claimDevice(q: Queryable, deviceId: string, personId: string): Promise<boolean> {
  const { rowCount } = await q.query(`update devices set person_id = $2 where id = $1 and person_id is null and revoked_at is null`, [deviceId, personId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Signs a phone out and ends its sessions at once. Sessions copied from Convex have no device (SCHEMA.md: `device_id` is null on old rows), so the only way to be
 * sure is to end the person's unattached ones too: the app gets a new one from its device key without noticing. Refusing to guess, per SYSTEM-DESIGN.md.
 */
export async function revokeDevice(q: Queryable, deviceId: string, personId: string | null): Promise<void> {
  await q.query(`update devices set revoked_at = coalesce(revoked_at, now()) where id = $1`, [deviceId]);
  await q.query(`delete from sessions where device_id = $1`, [deviceId]);
  if (personId) await q.query(`delete from sessions where person_id = $1 and device_id is null`, [personId]);
}

/** Every phone of theirs, and every session as them or through those phones. */
export async function signPersonOut(q: Queryable, personId: string, exceptDevice?: string): Promise<void> {
  const { rows } = await q.query(
    `update devices set revoked_at = now() where person_id = $1 and revoked_at is null and id is distinct from $2 returning id`,
    [personId, exceptDevice ?? null],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length) await q.query(`delete from sessions where device_id = any($1::text[])`, [ids]);
  if (exceptDevice) await q.query(`delete from sessions where person_id = $1 and device_id is distinct from $2`, [personId, exceptDevice]);
  else await q.query(`delete from sessions where person_id = $1`, [personId]);
}

export async function recentDeviceCount(q: Queryable, personId: string, via: Via): Promise<number> {
  const { rows } = await q.query(`select count(*)::int as n from devices where person_id = $1 and via = $2 and created_at > now() - interval '2 minutes'`, [personId, via]);
  return rows[0].n;
}

/** Of these people, the ones who sign in: a linked account or a live phone. */
export async function signedInIds(q: Queryable, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await q.query(
    `select person_id from identities where person_id = any($1::text[])
     union select person_id from devices where person_id = any($1::text[]) and revoked_at is null`,
    [ids],
  );
  return new Set(rows.map((r) => r.person_id));
}

/** Earliest phone per person, signed out or not: when they became settled. */
export async function firstPhones(q: Queryable, familyId: string, ids: string[]): Promise<Map<string, Date>> {
  const { rows } = await q.query(
    `select person_id, min(created_at) as first from devices where family_id = $1 and person_id = any($2::text[]) group by person_id`,
    [familyId, ids],
  );
  return new Map(rows.map((r) => [r.person_id, r.first]));
}

// ---------------------------------------------------------------------------------------------
// Sessions

export async function insertSession(q: Queryable, s: { familyId: string; personId: string; deviceId: string | null }): Promise<string> {
  const token = newSecret();
  await q.query(
    `insert into sessions (token_hash, family_id, person_id, device_id, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [sha256Hex(token), s.familyId, s.personId, s.deviceId, SESSION_DAYS],
  );
  return token;
}

export async function deleteSessionByToken(q: Queryable, token: string): Promise<void> {
  await q.query(`delete from sessions where token_hash = $1`, [sha256Hex(token)]);
}

export async function deleteExpiredSessions(q: Queryable, batch = 500): Promise<number> {
  const { rowCount } = await q.query(`delete from sessions where id in (select id from sessions where expires_at < now() order by expires_at limit $1)`, [batch]);
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Apple and Google accounts

export async function identityOf(q: Queryable, who: Who): Promise<{ person_id: string; email: string | null } | null> {
  const { rows } = await q.query(`select person_id, email from identities where provider = $1 and subject = $2`, [who.provider, who.sub]);
  return rows[0] ?? null;
}

export async function dropIdentity(q: Queryable, who: Who): Promise<void> {
  await q.query(`delete from identities where provider = $1 and subject = $2`, [who.provider, who.sub]);
}

/** False when another tap linked this account a moment ago. */
export async function linkIdentity(q: Queryable, who: Who, personId: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `insert into identities (provider, subject, person_id, email) values ($1, $2, $3, $4) on conflict (provider, subject) do nothing`,
    [who.provider, who.sub, personId, who.email],
  );
  if (!rowCount) return false;
  // Someone who left before, signing in again: only deleting them reads this (deletion.ts).
  const hash = leftIdentityHash(who.provider, who.sub);
  if (hash) {
    const { rows } = await q.query(`delete from left_identities where hash = $1 returning person_id`, [hash]);
    if (rows[0] && rows[0].person_id !== personId) await setPreviousPerson(q, personId, rows[0].person_id);
  }
  return true;
}

/** Keyed with a secret only this api holds (LINK_JOIN_SECRET is Convex's and Supabase's too), so the table can't be matched against a list of Apple ids. With no key set, nobody's link is kept: the api says so when it starts. */
function leftIdentityHash(provider: string, subject: string): string | null {
  const secret = process.env.LEFT_IDENTITY_SECRET?.trim();
  return secret ? createHmac("sha256", secret).update(`${provider}:${subject}`).digest("hex") : null;
}

/** Before someone's identities go, when they leave. A later leave of the same account points at the newer row, and that row's own link reaches the older one. */
export async function rememberLeftIdentities(q: Queryable, personId: string): Promise<void> {
  const { rows } = await q.query(`select provider, subject from identities where person_id = $1`, [personId]);
  for (const row of rows) {
    const hash = leftIdentityHash(row.provider, row.subject);
    if (hash) await q.query(`insert into left_identities (hash, person_id) values ($1, $2) on conflict (hash) do update set person_id = excluded.person_id`, [hash, personId]);
  }
}

export async function setPreviousPerson(q: Queryable, personId: string, previousId: string): Promise<void> {
  await q.query(`update people set previous_person_id = $2 where id = $1 and previous_person_id is null`, [personId, previousId]);
}

/** Who this person was before, oldest last, with where they are now. */
export async function earlierSelves(q: Queryable, personId: string): Promise<{ id: string; family_id: string }[]> {
  const { rows } = await q.query(
    `with recursive chain as (
       select previous_person_id as id from people where id = $1 and previous_person_id is not null
       union select p.previous_person_id from people p join chain on p.id = chain.id where p.previous_person_id is not null
     )
     select p.id, p.family_id from chain join people p on p.id = chain.id`,
    [personId],
  );
  return rows;
}

export async function setIdentityEmail(q: Queryable, who: Who, email: string): Promise<void> {
  await q.query(`update identities set email = $3 where provider = $1 and subject = $2`, [who.provider, who.sub, email]);
}

export async function dropIdentitiesOf(q: Queryable, personId: string): Promise<void> {
  await q.query(`delete from identities where person_id = $1`, [personId]);
}

// ---------------------------------------------------------------------------------------------
// Invites

export type InviteRow = {
  id: string;
  family_id: string;
  inviter_id: string | null;
  person_id: string | null;
  phone: string | null;
  status: "pending" | "used" | "revoked";
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
};
const INVITE = `id, family_id, inviter_id, person_id, phone, status, expires_at, used_at, created_at`;

export async function inviteBy(q: Queryable, col: "token_hash" | "code_hash", hash: string): Promise<InviteRow | null> {
  const { rows } = await q.query(`select ${INVITE} from invites where ${col} = $1`, [hash]);
  return rows[0] ?? null;
}

/** One conditional UPDATE: of two taps at once, exactly one gets the row. */
export async function claimInvite(q: Queryable, where: { col: "token_hash" | "code_hash" | "id"; value: string }): Promise<InviteRow | null> {
  const { rows } = await q.query(
    `update invites set status = 'used', used_at = now() where ${where.col} = $1 and status = 'pending' and expires_at > now() returning ${INVITE}`,
    [where.value],
  );
  return rows[0] ?? null;
}

export async function setInviteDevice(q: Queryable, id: string, deviceId: string): Promise<void> {
  await q.query(`update invites set used_device_id = $2 where id = $1`, [id, deviceId]);
}

export async function revokeInvite(q: Queryable, id: string): Promise<void> {
  await q.query(`update invites set status = 'revoked' where id = $1`, [id]);
}

/** Turn off someone's pending invites (all but `keep`). */
export async function revokeInvitesOf(q: Queryable, personId: string, keep?: string): Promise<void> {
  await q.query(`update invites set status = 'revoked' where person_id = $1 and status = 'pending' and id is distinct from $2`, [personId, keep ?? null]);
}

/** A family invite they sent lets anyone in, them included, so those stop when they go. (A link naming someone else stays: it can only become that person.) */
export async function revokeFamilyInvitesFrom(q: Queryable, personId: string): Promise<void> {
  await q.query(`update invites set status = 'revoked' where inviter_id = $1 and person_id is null and status = 'pending'`, [personId]);
}

export async function insertInvite(
  q: Queryable,
  i: { familyId: string; inviterId: string; personId: string | null; phone: string | null; days: number },
): Promise<{ id: string; token: string; code: string; expiresAt: Date }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = newInviteToken();
    const code = newInviteCode();
    const { rows } = await q.query(
      `insert into invites (family_id, inviter_id, person_id, token_hash, code_hash, phone, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
       on conflict do nothing returning id, expires_at`,
      [i.familyId, i.inviterId, i.personId, sha256Hex(token), sha256Hex(code), i.phone, i.days],
    );
    if (rows[0]) return { id: rows[0].id, token, code, expiresAt: rows[0].expires_at };
  }
  throw refuse(500, "Couldn't make an invite. Please try again.");
}

/** This person has a pending, unexpired invite. */
export async function hasLiveInvite(q: Queryable, personId: string): Promise<boolean> {
  const { rows } = await q.query(`select 1 from invites where person_id = $1 and status = 'pending' and expires_at > now() limit 1`, [personId]);
  return rows.length > 0;
}

export async function peopleWithLiveInvites(q: Queryable, familyId: string): Promise<string[]> {
  const { rows } = await q.query(
    `select distinct person_id from invites where family_id = $1 and status = 'pending' and expires_at > now() and person_id is not null`,
    [familyId],
  );
  return rows.map((r) => r.person_id);
}

/** The number picked last time, so "Send again" opens the same chat. */
export async function lastInvitePhone(q: Queryable, personId: string): Promise<string | null> {
  const { rows } = await q.query(`select phone from invites where person_id = $1 and phone is not null order by created_at desc limit 1`, [personId]);
  return rows[0]?.phone ?? null;
}

// ---------------------------------------------------------------------------------------------
// Join links

export type JoinLinkRow = { id: string; family_id: string; inviter_id: string | null; token_enc: string | null; expires_at: Date | null; revoked_at: Date | null };
const JOIN_LINK = `id, family_id, inviter_id, token_enc, expires_at, revoked_at`;

export async function joinLinkByToken(q: Queryable, token: string): Promise<JoinLinkRow | null> {
  const { rows } = await q.query(`select ${JOIN_LINK} from join_links where token_hash = $1`, [sha256Hex(token)]);
  return rows[0] ?? null;
}

/** The family's live links with more than a day left, newest expiry first. Never an operator's link with no expiry. */
export async function liveJoinLinks(q: Queryable, familyId: string): Promise<JoinLinkRow[]> {
  const { rows } = await q.query(
    `select ${JOIN_LINK} from join_links where family_id = $1 and revoked_at is null and expires_at > now() + interval '1 day' order by expires_at desc limit 5`,
    [familyId],
  );
  return rows;
}

export async function insertJoinLink(q: Queryable, l: { id: string; familyId: string; inviterId: string; tokenHash: string; tokenEnc: string; days: number }): Promise<Date | null> {
  const { rows } = await q.query(
    `insert into join_links (id, family_id, inviter_id, token_hash, token_enc, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     on conflict (token_hash) do nothing returning expires_at`,
    [l.id, l.familyId, l.inviterId, l.tokenHash, l.tokenEnc, l.days],
  );
  return rows[0]?.expires_at ?? null;
}

export async function revokeJoinLinksOf(q: Queryable, familyId: string): Promise<void> {
  await q.query(`update join_links set revoked_at = now() where family_id = $1 and revoked_at is null and expires_at is not null`, [familyId]);
}

// ---------------------------------------------------------------------------------------------
// Move requests

export type MoveRow = {
  id: string;
  family_id: string;
  person_id: string;
  device_id: string;
  status: "pending" | "approved" | "declined";
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
};
const MOVE = `id, family_id, person_id, device_id, status, created_at, decided_at, decided_by`;

export async function pendingMovesOf(q: Queryable, familyId: string, notFor: string, days: number): Promise<MoveRow[]> {
  const { rows } = await q.query(
    `select ${MOVE} from move_requests
      where family_id = $1 and status = 'pending' and person_id <> $2 and created_at > now() - make_interval(days => $3)
      order by created_at desc limit 50`,
    [familyId, notFor, days],
  );
  return rows;
}

export async function waitingDevices(q: Queryable, ids: string[]): Promise<Set<string>> {
  const { rows } = await q.query(`select id from devices where id = any($1::text[]) and person_id is null and revoked_at is null`, [ids]);
  return new Set(rows.map((r) => r.id));
}

export async function moveById(q: Queryable, id: string, familyId: string): Promise<MoveRow | null> {
  const { rows } = await q.query(`select ${MOVE} from move_requests where id = $1 and family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

/** pending -> `to`, in one conditional update, so of two answers at once exactly one lands. */
export async function decideMove(q: Queryable, id: string, to: "approved" | "declined", by: string, days: number): Promise<boolean> {
  const { rowCount } = await q.query(
    `update move_requests set status = $2, decided_at = now(), decided_by = $3 where id = $1 and status = 'pending' and created_at > now() - make_interval(days => $4)`,
    [id, to, by, days],
  );
  return (rowCount ?? 0) > 0;
}

export async function closeMoveAs(q: Queryable, id: string): Promise<void> {
  await q.query(`update move_requests set status = 'declined', decided_at = coalesce(decided_at, now()) where id = $1 and status <> 'declined'`, [id]);
}

export async function pendingMovesOfDevice(q: Queryable, deviceId: string): Promise<MoveRow[]> {
  const { rows } = await q.query(`select ${MOVE} from move_requests where device_id = $1 and status = 'pending'`, [deviceId]);
  return rows;
}

export async function insertMove(q: Queryable, m: { familyId: string; personId: string; deviceId: string }): Promise<MoveRow | null> {
  const { rows } = await q.query(
    `insert into move_requests (family_id, person_id, device_id) values ($1, $2, $3) on conflict (device_id) where status = 'pending' do nothing returning ${MOVE}`,
    [m.familyId, m.personId, m.deviceId],
  );
  return rows[0] ?? null;
}

export async function latestMoveOfDevice(q: Queryable, deviceId: string): Promise<MoveRow | null> {
  const { rows } = await q.query(`select ${MOVE} from move_requests where device_id = $1 order by created_at desc limit 1`, [deviceId]);
  return rows[0] ?? null;
}

/** A phone asking to be someone who left stops waiting (its /move-requests/mine reads declined). */
export async function closeMovesFor(q: Queryable, familyId: string, personId: string): Promise<void> {
  await q.query(`update move_requests set status = 'declined', decided_at = now() where person_id = $1 and family_id = $2 and status = 'pending'`, [personId, familyId]);
}

// ---------------------------------------------------------------------------------------------
// The sign-up log

export async function insertSignup(q: Queryable, s: { name: string; email: string | null; shareToken: string | null; familyId: string; personId: string | null }): Promise<void> {
  await q.query(`insert into signups (name, email, share_token, family_id, person_id) values ($1, $2, $3, $4, $5)`, [
    s.name.slice(0, 100),
    s.email,
    s.shareToken,
    s.familyId,
    s.personId,
  ]);
}

/** One join per card side, one claim per person: the unique index refuses a second. False means taken. Returns the row's id so the person can be set on it. */
export async function claimSignup(q: Queryable, s: { name: string; email: string | null; shareToken: string; familyId: string }): Promise<string | null> {
  const { rows } = await q.query(
    `insert into signups (name, email, share_token, family_id) values ($1, $2, $3, $4)
     on conflict (share_token) where share_token like 'link:%' do nothing returning id`,
    [s.name.slice(0, 100), s.email, s.shareToken, s.familyId],
  );
  return rows[0]?.id ?? null;
}

export async function setSignupPerson(q: Queryable, id: string, personId: string): Promise<void> {
  await q.query(`update signups set person_id = $2 where id = $1`, [id, personId]);
}

export async function joinsVia(q: Queryable, token: string, familyId: string): Promise<number> {
  const { rows } = await q.query(`select count(*)::int as n from signups where share_token = $1 and family_id = $2`, [token, familyId]);
  return rows[0].n;
}

/**
 * C2: when nobody's left in it (deletion.ts, endFamilyIfLast), its name and codes go, and it takes nobody in. The row stays for the FKs. Run under the family's lock.
 */
export async function blankFamilyIfEmpty(q: Queryable, familyId: string): Promise<boolean> {
  const { rows } = await q.query(`select blanked_at from families where id = $1 for no key update`, [familyId]);
  if (!rows[0] || rows[0].blanked_at) return false;
  const live = await q.query(`select 1 from people where family_id = $1 and deleted_at is null and removed_at is null limit 1`, [familyId]);
  if (live.rows.length) return false;
  await q.query(`update families set name = 'Deleted', public_name = null, code_hash = null, code_enc = null, blanked_at = now() where id = $1`, [familyId]);
  await q.query(`update devices set revoked_at = coalesce(revoked_at, now()) where family_id = $1`, [familyId]);
  await q.query(`delete from sessions where family_id = $1`, [familyId]);
  await q.query(`update join_links set revoked_at = coalesce(revoked_at, now()) where family_id = $1`, [familyId]);
  await q.query(`update invites set status = 'revoked' where family_id = $1 and status = 'pending'`, [familyId]);
  return true;
}
