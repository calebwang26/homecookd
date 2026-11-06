// Staging's test sign-in (src/modules/accounts/testSignIn.ts): no route without the key, a wrong key makes nothing, and with the right one a script signs in as
// /auth/apple would, into an account no real Apple sign-in can reach.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { keyMatches } from "../src/modules/accounts/testSignIn.js";
import { Api, count, freshDatabase, hasDatabase, said, setup } from "./accountsHelpers.js";

const skip = !hasDatabase;
const KEY = "made-up-test-signin-key";
let withKey: Api;
let withoutKey: Api;

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  // Routes are added when an app starts, so each one starts while the environment is as it says.
  delete process.env.TEST_SIGNIN_KEY;
  withoutKey = new Api();
  await withoutKey.app.ready();
  process.env.TEST_SIGNIN_KEY = KEY;
  withKey = new Api();
  await withKey.app.ready();
});

after(async () => {
  delete process.env.TEST_SIGNIN_KEY;
  if (!skip) await db().end();
});

const signIn = (body: Record<string, unknown>, key: string | null = KEY) => withKey.post("/v1/test/sign-in", body, key === null ? {} : { "x-test-signin-key": key });

test("the key is compared whole, whatever its length", () => {
  assert.ok(keyMatches(KEY, KEY));
  assert.ok(!keyMatches(KEY.slice(0, -1), KEY));
  assert.ok(!keyMatches(`${KEY}x`, KEY));
  assert.ok(!keyMatches(undefined, KEY));
  assert.ok(!keyMatches(["made-up-test-signin-key"], KEY));
});

test("without TEST_SIGNIN_KEY the route isn't there, as in production", { skip }, async () => {
  const res = await withoutKey.post("/v1/test/sign-in", { test_id: "nobody", name: "Nobody", role: "cook" }, { "x-test-signin-key": KEY });
  assert.equal(res.status, 404);
});

test("a missing or wrong key is refused and makes nothing", { skip }, async () => {
  const before = await count("families");
  assert.equal((await signIn({ test_id: "mallory", name: "Mallory", role: "cook" }, null)).status, 401);
  const wrong = await signIn({ test_id: "mallory", name: "Mallory", role: "cook" }, "not-the-key");
  assert.equal(wrong.status, 401);
  assert.deepEqual(said(wrong), ["signed_out", "That test key isn't right."]);
  assert.equal(await count("families"), before);
});

test("test_id must be short, lowercase letters, digits and dashes", { skip }, async () => {
  for (const test_id of [undefined, "", "Has Caps", "a/b", "x".repeat(41)]) {
    assert.equal((await signIn({ test_id, name: "Asha", role: "cook" })).status, 400, String(test_id));
  }
});

test("a new test cook starts a family, gets a session, and signs back in as the same person", { skip }, async () => {
  const asked = await signIn({ test_id: "cook-1" });
  assert.deepEqual(asked.data, { existing: false, needs_name: true, suggested_name: null }, "no name: the app asks, as with Apple");

  const first = await signIn({ test_id: "cook-1", name: "Asha", role: "cook" });
  assert.equal(first.status, 200);
  assert.equal(first.data.existing, false);
  const session = await withKey.post("/v1/sessions/start", { deviceKey: first.data.device_key, profileId: first.data.profile_id });
  assert.equal(session.status, 200);
  assert.equal(session.data.role, "cook");
  assert.equal(session.data.personId, first.data.profile_id);

  const again = await signIn({ test_id: "cook-1" });
  assert.equal(again.data.existing, true);
  assert.equal(again.data.profile_id, first.data.profile_id);

  const link = await db().query(`select provider, subject from identities where person_id = $1`, [first.data.profile_id]);
  assert.deepEqual(link.rows, [{ provider: "apple", subject: "test:cook-1" }], "an Apple subject no real Apple account has");
});
