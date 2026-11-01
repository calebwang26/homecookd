// A family's people and phones: what GET /family shows, adding a person, leaving, and each phone's own key. Each write is one transaction, so the undo steps the old
// code needed (put the invite back, delete the half-made profile) don't exist here: a failure leaves nothing behind.
import { db, tx, type Queryable } from "../../db.js";
import * as data from "./data.js";
import { endFamilyIfLast } from "./deletion.js";
import { extId, toProfile, type Family, type Person } from "./data.js";
import { markCircleRead, quietNote } from "./neighbors.js";
import { type Ctx, joinedIds, needsProfile, onOwnPhone, settledIds } from "./proofs.js";
import { answerableMoves } from "./moves.js";
import { MAX_NAME, MAX_PEOPLE, assertOwnsPeople, emailOf, deviceLabel, limit, refuse, roleOf, SIGNED_OUT, str, type Body, type Role } from "./values.js";

const EMAIL_TAKEN = "That email is already in a family";

/** A bad unique index hit turned into its sentence. The tx is over by then, so nothing was kept. */
export function mapUnique<T>(work: Promise<T>, taken: (constraint: string) => Error | null): Promise<T> {
  return work.catch((error: { code?: string; constraint?: string }) => {
    const mapped = error?.code === "23505" ? taken(error.constraint ?? "") : null;
    throw mapped ?? error;
  });
}

const isNameIndex = (constraint: string) => constraint === "people_family_name_unique";
const isEmailIndex = (constraint: string) => constraint === "people_email_unique";

/**
 * Adds a person. Names are unique per family, ignoring case, and so are emails across families, which the database also holds to. The caller holds the family's lock
 * and has read `existing` under it.
 */
export async function addPerson(
  c: Queryable,
  familyId: string,
  existing: Person[],
  p: { name: string; role: Role; relation?: string | null; email?: string | null },
  taken = (name: string) => `${name} is already in this family`,
): Promise<Person> {
  assertOwnsPeople();
  if (existing.length >= MAX_PEOPLE) throw refuse(400, `This family already has ${MAX_PEOPLE} people`);
  const same = existing.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (same) throw refuse(409, taken(same.name));
  const sort = existing.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
  const person = await data.insertPerson(c, { familyId, name: p.name, role: p.role, relation: p.relation, email: p.email, sort });
  await markCircleRead(c, familyId, person.id);
  return person;
}

/** Someone leaves softly: "Leave the family", and a move to another family. Phones and sessions end first, in the same transaction as the rest. */
export async function removePerson(c: Queryable, familyId: string, personId: string): Promise<void> {
  assertOwnsPeople();
  await data.signPersonOut(c, personId);
  await data.revokeInvitesOf(c, personId);
  await data.revokeFamilyInvitesFrom(c, personId);
  await data.dropIdentitiesOf(c, personId);
  await data.markPersonRemoved(c, familyId, personId);
  await data.closeMovesFor(c, familyId, personId);
}

const lockedFor = (ctx: Ctx, personId: string) => ctx.phones.has(personId) && ctx.device?.person_id !== personId;

/** People with a pending, unexpired invite who haven't joined. A family invite names nobody. */
export async function invitedIds(familyId: string): Promise<Set<string>> {
  const ids = await data.peopleWithLiveInvites(db(), familyId);
  const joined = await joinedIds(ids);
  return new Set(ids.filter((id) => !joined.has(id)));
}

/** GET /family. A count that can't be read is 0 or false: it must never stop the family from loading. */
export async function familyView(ctx: Ctx) {
  const phoneOwner = ctx.profiles.find((p) => p.id === ctx.device?.person_id);
  const who = ctx.me ? (onOwnPhone(ctx) ? ctx.me : null) : ctx.profiles.find((p) => p.id === ctx.device?.person_id) ?? null;
  const [invited, moves, manage] = await Promise.all([
    invitedIds(ctx.family.id),
    answerableMoves(ctx).then((r) => r.length).catch(() => 0),
    who ? settledIds(ctx, [who.id]).then((s) => s.has(who.id)).catch(() => false) : false,
  ]);
  return {
    family: { id: extId(ctx.family), name: ctx.family.name },
    profiles: ctx.profiles.map((p) => ({
      ...toProfile(p),
      invited: invited.has(p.id),
      has_phone: ctx.phones.has(p.id),
      locked: lockedFor(ctx, p.id),
      memorial: p.memorial,
    })),
    former_profiles: ctx.everyone.filter((p) => p.removed_at).map(toProfile),
    device_profile_id: phoneOwner ? extId(phoneOwner) : null,
    device_needs_profile: needsProfile(ctx.device),
    move_requests_pending: moves,
    can_manage: manage,
  };
}

async function lockedMembers(c: Queryable, familyId: string): Promise<{ family: Family; members: Person[] }> {
  const family = await data.lockFamily(c, familyId);
  if (!family || family.blanked_at) throw refuse(404, "That family isn't on homecookd anymore.");
  const members = (await data.peopleOf(c, familyId)).filter((p) => !p.removed_at);
  return { family, members };
}

/** POST /profiles: someone without a phone joins the family's list. */
export async function addProfile(ctx: Ctx, b: Body) {
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const role = roleOf(b.role, true)!;
  const relation = str(b.relation, "relation", { max: MAX_NAME });
  const email = emailOf(b.email);
  // Emails were only for old builds' email sign-in, which hands back the family code. A phone with its own key must not be able to trade one for it.
  if (email && ctx.device) throw refuse(403, "Emails can't be added in this version. Send an invite instead.");
  const person = await mapUnique(
    tx(async (c) => {
      const { members } = await lockedMembers(c, ctx.family.id);
      return addPerson(c, ctx.family.id, members, { name, role, relation, email });
    }),
    (constraint) => (isNameIndex(constraint) ? refuse(409, `${name} is already in this family`) : isEmailIndex(constraint) ? refuse(409, EMAIL_TAKEN) : null),
  );
  return toProfile(person);
}

/** POST /profiles/self: "This is me". A phone with no person yet adds its own, and becomes their phone for good. Posts "<Name> joined." */
export async function addSelf(ctx: Ctx, b: Body) {
  const device = ctx.device;
  if (!device) throw refuse(400, "Send this phone's x-device-key to add yourself.");
  const belongsTo = (name: string | undefined) => refuse(409, `This phone already belongs to ${name ?? "someone in this family"}.`);
  if (device.person_id) throw belongsTo(ctx.everyone.find((p) => p.id === device.person_id)?.name);
  const name = str(b.name, "name", { max: MAX_NAME, required: true })!;
  const role = roleOf(b.role, true)!;
  await limit("profiles-self", ctx.family.id, 30, 60);
  const taken = (n: string) => `${n} is already in this family. Pick another name or tap your face.`;
  const person = await mapUnique(
    tx(async (c) => {
      const { members } = await lockedMembers(c, ctx.family.id);
      const p = await addPerson(c, ctx.family.id, members, { name, role }, taken);
      // Set once: if another tap gave this phone its person a moment ago, this whole transaction goes.
      if (!(await data.claimDevice(c, device.id, p.id))) {
        const { rows } = await c.query(`select d.revoked_at, p.name from devices d left join people p on p.id = d.person_id where d.id = $1`, [device.id]);
        if (!rows[0] || rows[0].revoked_at) throw refuse(401, SIGNED_OUT);
        throw belongsTo(rows[0].name ?? undefined);
      }
      return p;
    }),
    (constraint) => (isNameIndex(constraint) ? refuse(409, taken(name)) : null),
  );
  await quietNote(ctx.family.id, person.id, `${person.name} joined.`);
  return { ...toProfile(person), invited: false, has_phone: true, locked: false };
}

/**
 * Leave the family. Nobody removes anyone else: the person must be the one acting, on their own phone (which signs it out) or with no phone of their own (Grandma, acted
 * as on Mom's phone, which stays signed in). Removing someone already gone is fine: the app calls this right after deleting an account, and a retry is a repeated tap.
 */
export async function leaveFamily(ctx: Ctx, rawId: string) {
  const id = rawId.toLowerCase();
  if (ctx.meDeleted) return { ok: true };
  if (!ctx.me) throw refuse(400, "x-profile-id header is required for this request");
  if (ctx.everyone.some((p) => (p.id === id || p.supabase_id === id) && p.removed_at)) return { ok: true };
  const p = ctx.profiles.find((x) => x.id === id || x.supabase_id === id);
  if (!p) throw refuse(404, "id: no such person in this family");
  const self = p.id === ctx.me.id && (ctx.device?.person_id === ctx.me.id || !ctx.phones.has(ctx.me.id));
  if (!self) throw refuse(403, `Only ${p.name} can remove themselves.`);
  await tx(async (c) => {
    await data.lockFamily(c, ctx.family.id); // so a last person's delete, at the same moment, sees who's really left
    const wasSignedIn = (await data.signedInIds(c, [p.id])).has(p.id);
    await removePerson(c, ctx.family.id, p.id);
    await endFamilyIfLast(c, ctx.family.id, wasSignedIn);
  });
  return { ok: true };
}

/** POST /devices: swaps a saved family code for this phone's own key. Its person is the first phone-less person it then writes as. Not from a key: a second key would belong to nobody. */
export async function swapCodeForKey(ctx: Ctx, b: Body) {
  if (ctx.device) throw refuse(400, "This phone already has its own key.");
  await limit("devices", ctx.family.id, 30, 60);
  const device = await data.insertDevice(db(), { familyId: ctx.family.id, personId: null, via: "code", label: deviceLabel(b) });
  return { device_key: device.key };
}

/** POST /devices/revoke: sign this phone out. Its key and its sessions stop at once; x-profile-id isn't read, so a phone can always sign itself out. */
export async function signOutPhone(ctx: Ctx) {
  const device = ctx.device;
  if (!device) throw refuse(400, "Send this phone's x-device-key to sign it out.");
  await tx((c) => data.revokeDevice(c, device.id, device.person_id));
  return { ok: true };
}
