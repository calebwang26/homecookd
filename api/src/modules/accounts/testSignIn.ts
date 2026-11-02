// Staging only: a sign-in for scripts, which can't do Sign in with Apple (docs/build/contracts/ACCOUNTS.md, "Staging testing"). The route exists only while
// TEST_SIGNIN_KEY is set, and only staging's Terraform gives the api that secret: the env module refuses it in production (infra/modules/env/variables.tf).
// A caller sends the key in x-test-signin-key and a test_id of its own. The account it signs in as is an Apple one whose subject starts "test:", which no
// real Apple account can have, so a test person never meets a real one. After that it's /auth/apple's own path (signInAs): the same body, the same answers.
import { createHash, timingSafeEqual } from "node:crypto";
import { signInAs } from "./signin.js";
import { limit, refuse, type Body } from "./values.js";

export const TEST_SUB_PREFIX = "test:";
const TEST_ID = /^[a-z0-9-]{1,40}$/;

/** Null unless this api runs on staging with the key loaded. */
export const testSignInKey = () => process.env.TEST_SIGNIN_KEY?.trim() || null;

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Compared as hashes, so the time it takes says nothing about the key, its length included. */
export const keyMatches = (given: unknown, key: string) => typeof given === "string" && timingSafeEqual(digest(given), digest(key));

/** `{test_id, name?, role?, share_token?, join_token?, link_ticket?, ...}`: /auth/apple's body with test_id in place of id_token. */
export async function testSignIn(key: string, given: unknown, b: Body, ip: string, log?: (fields: object, message: string) => void) {
  if (!keyMatches(given, key)) throw refuse(401, "That test key isn't right.");
  await limit("testsignin-ip", ip, 60, 10);
  const testId = typeof b.test_id === "string" ? b.test_id.trim() : "";
  if (!TEST_ID.test(testId)) throw refuse(400, "test_id is 1 to 40 lowercase letters, digits or dashes");
  const name = typeof b.name === "string" ? b.name.trim() || null : null;
  return signInAs(async () => ({ provider: "apple", sub: `${TEST_SUB_PREFIX}${testId}`, email: null, givenName: name }), b, ip, log);
}
