// A phone's Expo token. Both old systems registered it, so this replaces two routes. It stays with the phone's newest person.
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { invalid } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { deviceOfSession } from "../people/family.js";
import { actorOf } from "./actor.js";
import * as data from "./pushData.js";
import { PLATFORMS, validPushToken, type Platform } from "./pushRules.js";
import { validTz } from "./time.js";

export async function register(signed: Signed, body: Record<string, unknown>) {
  await actorOf(signed);
  const token = typeof body.token === "string" ? body.token.trim() : body.token;
  if (!validPushToken(token)) throw invalid("token");
  if (!PLATFORMS.includes(body.platform as Platform)) throw invalid("platform");
  await hit(subjectKey(signed.personId), [{ bucket: "push-tokens", max: 30, windowS: 3600 }]);
  await data.saveToken(db(), {
    token,
    familyId: signed.familyId,
    personId: signed.personId,
    deviceId: await deviceOfSession(db(), signed.sessionId),
    platform: body.platform as Platform,
    tz: validTz(body.tz),
  });
  return { ok: true };
}

/** Sign-out: this phone's token stops getting the family's pushes. Only within the caller's family. */
export async function unregister(signed: Signed, body: Record<string, unknown>) {
  const token = typeof body.token === "string" ? body.token.trim() : body.token;
  if (!validPushToken(token)) throw invalid("token");
  await data.dropTokenInFamily(db(), token, signed.familyId);
  return { ok: true };
}
