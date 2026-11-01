// Session tokens (convex/sessions.ts). A session lasts 30 days and is minted from a device key; only its hash is stored, and every /v1 route checks it (auth.ts). Convex asked Supabase's
// GET /family whether the key was good and copied the family across. Here both live in one database, so the same checks run directly and nothing is copied.
import { db, tx } from "../../db.js";
import * as data from "./data.js";
import { invitedIds } from "./family.js";
import { prove } from "./proofs.js";
import { ACCOUNT_DELETED, type Body, NOT_IN_THIS_FAMILY, refuse } from "./values.js";

export async function startSession(b: Body, ip: string) {
  const deviceKey = typeof b.deviceKey === "string" ? b.deviceKey.trim() : "";
  const profileId = typeof b.profileId === "string" ? b.profileId.trim() : "";
  if (!deviceKey || deviceKey.length > 200 || !profileId || profileId.length > 100) throw refuse(400, "Sign in again.");
  // A session needs a phone's key: the family code can't mint one.
  const ctx = await prove({ key: deviceKey, profileId, ip, method: "GET" }, { lenientMe: true, tombstoneOk: true });
  if (ctx.meDeleted) throw refuse(403, ACCOUNT_DELETED);
  const id = profileId.toLowerCase();
  const me = ctx.profiles.find((p) => p.id === id || p.supabase_id === id);
  if (!me) throw refuse(403, NOT_IN_THIS_FAMILY);
  if ((await invitedIds(ctx.family.id)).has(me.id)) throw refuse(403, "They haven't joined yet.");
  if (ctx.phones.has(me.id) && ctx.device?.person_id !== me.id) throw refuse(403, `${me.name} uses their own phone.`);
  const token = await tx(async (c) => {
    if (!(await data.lockLivePerson(c, me.id))) throw refuse(403, NOT_IN_THIS_FAMILY);
    return data.insertSession(c, { familyId: me.family_id, personId: me.id, deviceId: ctx.device?.id ?? null });
  });
  return { sessionToken: token, familyId: me.family_id, personId: me.id, role: me.role };
}

/** Sign this phone out of its session. A session that's already gone, or was never there, is the same result. */
export async function endSession(token: string): Promise<{ ok: true }> {
  if (token.length >= 20 && token.length <= 200) await data.deleteSessionByToken(db(), token);
  return { ok: true };
}
