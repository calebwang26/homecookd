// How a phone proves who it is: device keys, family codes and session tokens, kept apart. Carries over supabase/tests/api_test.ts (auth, devices, /family) and convex/sessions.test.ts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import {
  Api,
  bearer,
  clearLimits,
  code,
  count,
  device,
  freshDatabase,
  hasDatabase,
  makeDevice,
  makeFamily,
  makePerson,
  row,
  setup,
  SIGNED_OUT,
} from "./accountsHelpers.js";
import { session } from "./helpers.js";

const skip = !hasDatabase;
let api: Api;

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

const mint = (key: string, profileId: string) => api.post("/v1/sessions/start", { deviceKey: key, profileId });

test("CORS allows x-device-key", { skip }, async () => {
  const res = await api.app.inject({ method: "OPTIONS", url: "/family" });
  assert.equal(res.statusCode, 204);
  assert.match(String(res.headers["access-control-allow-headers"]), /x-device-key/);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  const refused = await api.get("/family");
  assert.equal(refused.status, 401);
  assert.equal(refused.headers["access-control-allow-origin"], "*", "a refusal too, or the web page can't read the sentence");
  assert.equal((await api.post("/invites/peek", { token: "x" })).headers["access-control-allow-origin"], "*");
});

test("an answer that's null is JSON's null, as on Supabase: old builds parse a body", { skip }, async () => {
  const f = await makeFamily();
  const phone = await makeDevice(f.id, await makePerson(f.id));
  const res = await api.app.inject({ method: "GET", url: "/move-requests/mine", headers: device(phone.key) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "null");
  assert.match(String(res.headers["content-type"]), /json/);
});

test("GET /family by device key: invited, phones, locks, former people, this phone's profile", { skip }, async () => {
  const f = await makeFamily("The Wangs");
  const mom = await makePerson(f.id, "Mom");
  const leo = await makePerson(f.id, "Leo", "kid");
  const gone = await makePerson(f.id, "Gone", "kid");
  const zed = await makePerson(f.id, "Zed", "kid");
  await db().query(`update people set removed_at = now() where id = $1`, [gone]);
  const momPhone = await makeDevice(f.id, mom);
  await makeDevice(f.id, leo);
  await db().query(
    `insert into invites (family_id, inviter_id, person_id, token_hash, code_hash, expires_at) values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [f.id, mom, zed, hashToken("invite-token"), hashToken("invite-code")],
  );
  const { status, data } = await api.get("/family", device(momPhone.key, mom));
  assert.equal(status, 200);
  assert.equal(data.family.name, "The Wangs");
  const by = (name: string) => data.profiles.find((p: { name: string }) => p.name === name);
  assert.equal(by("Leo").role, "learner", "old builds read learner");
  assert.deepEqual([by("Mom").locked, by("Mom").has_phone], [false, true]);
  assert.deepEqual([by("Leo").locked, by("Leo").has_phone], [true, true]);
  assert.equal(by("Zed").invited, true);
  assert.equal(by("Gone"), undefined);
  assert.deepEqual(data.former_profiles.map((p: { name: string }) => p.name), ["Gone"]);
  assert.equal(data.device_profile_id, mom);
  assert.equal(data.device_needs_profile, false);
});

test("a merged row is known by the Supabase id phones hold, and answers with it", { skip }, async () => {
  const f = await makeFamily();
  const old = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const { rows } = await db().query(`insert into people (id, supabase_id, family_id, name, role) values ('j57convexid', $1, $2, 'Merged', 'cook') returning id`, [old, f.id]);
  const phone = await makeDevice(f.id, rows[0].id);
  const { data } = await api.get("/family", device(phone.key, old));
  assert.equal(data.device_profile_id, old);
  assert.equal(data.profiles[0].id, old);
  const s = await mint(phone.key, old);
  assert.equal(s.status, 200);
  assert.equal(s.data.personId, "j57convexid", "session routes use the row's own id, as Convex's did");
});

test("unknown, malformed and revoked keys all get the exact signed-out 401", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const revoked = await makeDevice(f.id, p);
  await db().query(`update devices set revoked_at = now() where id = $1`, [revoked.id]);
  for (const key of ["x".repeat(43), "short", revoked.key]) {
    const { status, data } = await api.get("/family", device(key));
    assert.equal(status, 401);
    assert.equal(data.error, SIGNED_OUT);
  }
  const none = await api.get("/family");
  assert.equal(none.status, 401);
  assert.match(none.data.error, /Missing family code/);
});

test("bad keys are limited per address", { skip }, async () => {
  await clearLimits();
  for (let i = 0; i < 20; i += 1) assert.equal((await api.get("/family", device("x".repeat(43)), "192.0.2.77")).status, 401);
  assert.equal((await api.get("/family", device("x".repeat(43)), "192.0.2.77")).status, 429);
  await clearLimits();
});

test("a removed person can't act, but GET /family still loads for them", { skip }, async () => {
  const f = await makeFamily();
  const a = await makePerson(f.id, "Amy");
  const b = await makePerson(f.id, "Ben");
  const shared = await makeDevice(f.id, a);
  await db().query(`update people set removed_at = now() where id = $1`, [b]);
  assert.equal((await api.get("/family", device(shared.key, b))).status, 200);
  const refused = await api.post("/invites", {}, device(shared.key, b));
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /was removed/);
});

test("family code still works, and POST /devices swaps it for a key (never a key for a key)", { skip }, async () => {
  const f = await makeFamily();
  await makePerson(f.id);
  assert.equal((await api.get("/family", code(f.code))).status, 200);
  assert.equal((await api.get("/family", code(` ${f.code.toLowerCase()} `))).status, 200, "ignores case and spaces");
  const swapped = await api.post("/devices", { device_label: "iPhone" }, code(f.code));
  assert.equal(swapped.status, 200);
  const fam = await api.get("/family", device(swapped.data.device_key));
  assert.equal(fam.status, 200);
  assert.equal(fam.data.device_profile_id, null);
  const again = await api.post("/devices", {}, device(swapped.data.device_key));
  assert.equal(again.status, 400);
  const wrong = await api.get("/family", code("NOPE-NOPE"));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "Family code not recognised");
});

test("a phone with no person gets one on its first write as someone phone-less, and it never moves", { skip }, async () => {
  const f = await makeFamily();
  const first = await makePerson(f.id, "Grandma");
  const second = await makePerson(f.id, "Grandpa");
  const phone = await makeDevice(f.id, null, "code");
  assert.equal((await api.get("/family", device(phone.key, first))).data.device_profile_id, null, "a read never sets it");
  assert.equal((await api.post("/join-links", {}, device(phone.key, first))).status, 200);
  assert.equal((await row("devices", "id = $1", [phone.id])).person_id, first);
  assert.equal((await api.post("/join-links", {}, device(phone.key, second))).status, 200, "lending to another phone-less person");
  assert.equal((await row("devices", "id = $1", [phone.id])).person_id, first, "it stays hers");
});

test("someone with their own phone can only be them from it: other phones and the code get 403, reads too", { skip }, async () => {
  const f = await makeFamily();
  const mom = await makePerson(f.id, "Mom");
  const dad = await makePerson(f.id, "Dad");
  await makeDevice(f.id, mom);
  const dads = await makeDevice(f.id, dad);
  const fromOther = await api.post("/invites", {}, device(dads.key, mom));
  assert.equal(fromOther.status, 403);
  assert.equal(fromOther.data.error, "Mom uses their own phone.");
  assert.equal((await api.post("/invites", {}, code(f.code, mom))).status, 403);
  assert.equal((await api.get("/move-requests", device(dads.key, mom))).status, 403, "a read too");
});

test("sign-in checks the device key and hands back a session; only its hash is stored", { skip }, async () => {
  const f = await makeFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const phone = await makeDevice(f.id, leo);
  const s = await mint(phone.key, leo);
  assert.equal(s.status, 200);
  assert.deepEqual([s.data.familyId, s.data.personId, s.data.role], [f.id, leo, "kid"]);
  assert.equal(s.data.sessionToken.length, 43);
  const stored = await row("sessions", "person_id = $1", [leo]);
  assert.equal(stored.token_hash, hashToken(s.data.sessionToken));
  assert.equal(stored.device_id, phone.id, "new sessions know their phone");
  assert.ok(stored.expires_at.getTime() > Date.now() + 29 * 86_400_000);
  const me = await api.get("/v1/me", bearer(s.data.sessionToken));
  assert.equal(me.data.person.id, leo);
});

test("sign-in refuses locked, invited and unknown people, and passes on a signed-out key", { skip }, async () => {
  const f = await makeFamily();
  const mom = await makePerson(f.id, "Mom");
  const dad = await makePerson(f.id, "Dad");
  const amy = await makePerson(f.id, "Amy", "kid");
  await makeDevice(f.id, mom);
  const phone = await makeDevice(f.id, dad);
  await db().query(
    `insert into invites (family_id, inviter_id, person_id, token_hash, code_hash, expires_at) values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [f.id, dad, amy, hashToken(`t-${amy}`), hashToken(`c-${amy}`)],
  );
  const words = async (id: string) => (await mint(phone.key, id)).data.error;
  assert.equal(await words(mom), "Mom uses their own phone.");
  assert.equal(await words(amy), "They haven't joined yet.");
  assert.match(await words("11111111-2222-4333-8444-555555555555"), /isn't part of this family/);
  await db().query(`update devices set revoked_at = now() where id = $1`, [phone.id]);
  assert.equal(await words(dad), SIGNED_OUT);
  assert.equal(await count("sessions", "person_id = $1", [dad]), 0);
});

test("a family code can't mint a session", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const res = await mint(f.code, p);
  assert.equal(res.status, 401);
  assert.equal(await count("sessions", "person_id = $1", [p]), 0);
});

test("every session route needs a live session, and sees only its own family", { skip }, async () => {
  const bad = bearer("x".repeat(43));
  for (const [method, url] of [
    ["GET", "/v1/me"],
    ["GET", "/v1/apple/revoke-ready"],
    ["POST", "/v1/apple/revoke"],
    ["POST", "/v1/account/delete"],
    ["POST", "/v1/links/claim"],
    ["POST", "/v1/links/moved"],
  ] as const) {
    const res = method === "GET" ? await api.get(url, bad) : await api.post(url, {}, bad);
    assert.equal(res.status, 401, url);
    assert.equal(res.data.error, "signed_out", url);
  }
});

test("expired sessions stop working and get swept", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const token = await session(f.id, p, -1);
  assert.equal((await api.get("/v1/me", bearer(token))).status, 401);
  const { accountsSweep } = await import("../src/modules/accounts/tasks.js");
  await accountsSweep({});
  assert.equal(await count("sessions", "person_id = $1", [p]), 0);
});

test("sign-out ends the session at once, and it's fine to do twice", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const phone = await makeDevice(f.id, p);
  const { data } = await mint(phone.key, p);
  assert.equal((await api.post("/v1/sessions/end", {}, bearer(data.sessionToken))).status, 200);
  assert.equal((await api.get("/v1/me", bearer(data.sessionToken))).status, 401);
  assert.equal((await api.post("/v1/sessions/end", {}, bearer(data.sessionToken))).status, 200);
  assert.equal((await api.get("/family", device(phone.key, p))).status, 200, "the phone's key is a separate thing, and still works");
});

test("revoking a phone ends its key and its sessions at once, old sessions with no phone included", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Pat");
  const lent = await makePerson(f.id, "Grandma");
  const other = await makePerson(f.id, "Other");
  const phone = await makeDevice(f.id, p);
  const otherPhone = await makeDevice(f.id, other);
  const mine = (await mint(phone.key, p)).data.sessionToken;
  const lentOut = (await mint(phone.key, lent)).data.sessionToken;
  const copied = await session(f.id, p); // a row copied from Convex: no device on it
  const unrelated = (await mint(otherPhone.key, other)).data.sessionToken;
  const out = await api.post("/devices/revoke", {}, device(phone.key));
  assert.equal(out.status, 200);
  for (const token of [mine, lentOut, copied]) assert.equal((await api.get("/v1/me", bearer(token))).status, 401);
  assert.equal((await api.get("/family", device(phone.key))).status, 401);
  assert.equal((await api.get("/v1/me", bearer(unrelated))).status, 200, "someone else's phone is untouched");
});

test("a session on a revoked phone is refused even if a race left the row behind", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const phone = await makeDevice(f.id, p);
  const { data } = await mint(phone.key, p);
  await db().query(`update devices set revoked_at = now() where id = $1`, [phone.id]);
  assert.equal((await api.get("/v1/me", bearer(data.sessionToken))).status, 401);
});

test("a removed person's session is refused", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const token = await session(f.id, p);
  await db().query(`update people set removed_at = now() where id = $1`, [p]);
  assert.equal((await api.get("/v1/me", bearer(token))).status, 403);
});

test("sign-in refuses rather than guesses when the database can't answer", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const phone = await makeDevice(f.id, p);
  const real = db().query.bind(db());
  (db() as unknown as { query: unknown }).query = () => Promise.reject(Object.assign(new Error("db down"), { code: "57P01" }));
  try {
    assert.equal((await api.get("/family", device(phone.key, p))).status, 500);
    assert.equal((await mint(phone.key, p)).status, 500);
    const fromSession = await api.get("/v1/me", bearer("x".repeat(43)));
    assert.equal(fromSession.status, 500, "not a 200, and not read as a good session");
  } finally {
    (db() as unknown as { query: unknown }).query = real;
  }
});
