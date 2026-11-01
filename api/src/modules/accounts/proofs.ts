// How an old build proves who it is: a phone's device key, else the family code, with x-profile-id saying who's acting (supabase/functions/api/index.ts,
// authenticate()). New routes and Convex-era phones use a session token instead (auth.ts); a session and a device stay separate things (SCHEMA.md section 2).
// Every rule here is about one question: may this phone act as this person right now? A database failure refuses: nothing here has a fallback.
import type { FastifyRequest } from "fastify";
import { db } from "../../db.js";
import { actedIds } from "./neighbors.js";
import * as data from "./data.js";
import type { Person, Via } from "./data.js";
import { DEVICE_KEY, limit, refuse, SETTLED_MS, SIGNED_OUT, UUID } from "./values.js";

export type Ctx = {
  family: { id: string; supabase_id: string | null; name: string };
  /** The people in the family now (removed people left out). Every list comes from this. */
  profiles: Person[];
  /** Everyone in the family but tombstones, removed people included: for names and roles on old messages. */
  everyone: Person[];
  me: Person | null;
  /** The calling phone, when it sent x-device-key. `person_id` is set once: who signed in on it, who it was let in as, or the first phone-less person it wrote as. */
  device: { id: string; person_id: string | null; via: Via } | null;
  /** People with a live phone of their own. */
  phones: Set<string>;
  /** x-profile-id named someone in this family who deleted their account. Only a route that asked (`tombstoneOk`) gets this far. */
  meDeleted: boolean;
};

export type ProofOptions = {
  /** A removed or locked x-profile-id is ignored rather than refused, so a phone that remembers that person can still load the family. */
  lenientMe?: boolean;
  /** x-profile-id isn't read at all. */
  ignoreMe?: boolean;
  /** This write never makes a phone with no person theirs. */
  keepOwner?: boolean;
  /** A deleted x-profile-id isn't refused: the app's "remove" right after its delete still gets its ok. */
  tombstoneOk?: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    ctx?: Ctx;
  }
}

export type ProofInput = { key?: string; code?: string; profileId?: string; ip: string; method: string };

const ownPhone = (p: Person) => refuse(403, `${p.name} uses their own phone.`);

/** Who has joined: signed in, or already acted in the family. */
export async function joinedIds(ids: string[]): Promise<Set<string>> {
  const [signed, acted] = await Promise.all([data.signedInIds(db(), ids), actedIds(db(), ids)]);
  return new Set([...signed, ...acted]);
}

/** Invited and not joined: a live invite, never signed in anywhere, and never acted here. */
async function invitedOnly(personId: string): Promise<boolean> {
  return (await data.hasLiveInvite(db(), personId)) && !(await joinedIds([personId])).has(personId);
}

export async function prove(input: ProofInput, options: ProofOptions = {}): Promise<Ctx> {
  const q = db();
  let family: Ctx["family"];
  let device: Ctx["device"] = null;
  if (input.key) {
    const row = DEVICE_KEY.test(input.key) ? await data.deviceByKey(q, input.key) : null;
    if (!row) {
      await limit("badcode", input.ip, 20, 10); // same budget as wrong family codes
      throw refuse(401, SIGNED_OUT);
    }
    if (row.revoked_at || row.family_blanked_at) throw refuse(401, SIGNED_OUT);
    if (Date.now() - row.last_seen_at.getTime() > 10 * 60_000) await data.touchDevice(q, row.id).catch(() => {}); // best effort
    family = { id: row.family_id, supabase_id: row.family_supabase_id, name: row.family_name };
    device = { id: row.id, person_id: row.person_id, via: row.via };
  } else if (input.code?.trim()) {
    // TODO(caleb): a family code can't be changed, so removing someone can't keep out a person who holds it (Supabase's own TODO). It stays while old builds send it.
    const row = input.code.length > 100 ? null : await data.familyByCode(q, input.code);
    if (!row || row.blanked_at) {
      await limit("badcode", input.ip, 20, 10);
      throw refuse(401, "Family code not recognised");
    }
    await data.resealCode(q, row, input.code).catch(() => {}); // best effort
    family = { id: row.id, supabase_id: row.supabase_id, name: row.name };
  } else {
    throw refuse(401, "Missing family code (x-family-code header)");
  }

  const [everyone, phones] = await Promise.all([data.peopleOf(q, family.id), data.peopleWithPhones(q, family.id)]);
  const profiles = everyone.filter((p) => !p.removed_at);
  // Removal revokes that person's phones; this only catches a request racing the removal.
  const owner = device?.person_id;
  if (owner && !profiles.some((p) => p.id === owner)) throw refuse(401, SIGNED_OUT);

  let me: Person | null = null;
  let meDeleted = false;
  const pid = options.ignoreMe ? undefined : input.profileId?.trim();
  if (pid) {
    if (!UUID.test(pid)) throw refuse(400, "x-profile-id must be a profile id");
    const id = pid.toLowerCase();
    const known = (p: Person) => p.id === id || p.supabase_id === id;
    me = profiles.find(known) ?? null;
    if (!me) {
      if (everyone.some(known)) {
        if (!options.lenientMe) throw refuse(403, "That person was removed from this family. Pick who you are.");
      } else {
        const gone = options.tombstoneOk ? await data.personByExtId(q, id) : null;
        if (gone?.deleted_at && gone.family_id === family.id) meDeleted = true;
        else throw refuse(403, "That profile isn't part of this family");
      }
    }
  }
  // A phone that joined through a family invite says who it is before it writes: it adds itself or asks to move in as someone, which someone else approves. Writing
  // as an existing face never makes it theirs, so whoever opened a forwarded link can't become Dad.
  if (me && input.method !== "GET" && device?.via === "invite" && !device.person_id) throw refuse(403, "Add yourself first.");
  // Someone with their own phone is only ever them from that phone: another phone, or the family code, gets 403, reads included.
  if (me && phones.has(me.id) && device?.person_id !== me.id) {
    if (!options.lenientMe) throw ownPhone(me);
    me = null;
  }
  // Nobody writes as someone only invited: until Dad taps his own link, a message "from Dad" would really be from whoever's phone this is.
  if (me && input.method !== "GET" && device?.person_id !== me.id && (await invitedOnly(me.id))) {
    throw refuse(403, `${me.name} hasn't joined yet. Pick your own face.`);
  }
  // A family-code swap with no person yet becomes the phone of the first person it writes as. Set once; reads never set it.
  if (device && !device.person_id && device.via !== "invite" && me && input.method !== "GET" && !options.keepOwner) {
    if (await data.claimDevice(q, device.id, me.id)) {
      device.person_id = me.id;
      phones.add(me.id);
    }
  }
  return { family, profiles, everyone, me, device, phones, meDeleted };
}

/** A route's preValidation: refuses before the body is looked at. */
export const requireProof = (options: ProofOptions = {}) => async (req: FastifyRequest): Promise<void> => {
  const header = (name: string) => {
    const value = req.headers[name];
    return typeof value === "string" ? value : undefined;
  };
  req.ctx = await prove(
    { key: header("x-device-key")?.trim(), code: header("x-family-code"), profileId: header("x-profile-id"), ip: req.ip, method: req.method },
    options,
  );
};

export function ctxOf(req: FastifyRequest): Ctx {
  if (!req.ctx) throw refuse(401, SIGNED_OUT); // a route that forgot requireProof refuses rather than runs
  return req.ctx;
}

export function requireMe(ctx: Ctx): Person {
  if (!ctx.me) throw refuse(400, "x-profile-id header is required for this request");
  return ctx.me;
}

export function profileIn(ctx: Ctx, id: unknown, field: string): Person {
  if (typeof id !== "string" || !UUID.test(id)) throw refuse(400, `${field} must be a profile id`);
  const lower = id.toLowerCase();
  const p = ctx.profiles.find((x) => x.id === lower || x.supabase_id === lower);
  if (!p) throw refuse(404, `${field}: no such person in this family`);
  return p;
}

/** On their own phone: this key's person is the acting person (not lent to Grandma, not the family code). */
export const onOwnPhone = (ctx: Ctx) => !!ctx.me && !!ctx.device && ctx.device.person_id === ctx.me.id;

/**
 * Of these people, the settled ones: their first phone joined over a day ago (with no phone ever, when they were added), or they're the family's first person. Only
 * settled people answer asks to move in, so someone who opened a forwarded invite a minute ago can't let a stranger in as Grandma.
 */
export async function settledIds(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const first = await data.firstPhones(db(), ctx.family.id, ids);
  const founder = [...ctx.everyone].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.sort - b.sort)[0]?.id;
  const cutoff = Date.now() - SETTLED_MS;
  return new Set(
    ids.filter((id) => {
      if (id === founder) return true;
      const added = ctx.profiles.find((p) => p.id === id)?.created_at;
      const since = first.get(id) ?? added;
      return since !== undefined && since.getTime() <= cutoff;
    }),
  );
}
