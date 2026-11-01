// Sign in with Apple and Google, with and without a link. The real token checks run against fake provider keys. Carries over supabase/tests/api_test.ts and joinLinks_test.ts.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { createLocalJWKSet, errors as joseErrors, SignJWT, type JWTVerifyGetKey } from "jose";
import { db } from "../src/db.js";
import { idTokensWith, useIdTokens } from "../src/modules/accounts/identity.js";
import { signTicket, type JoinPayload } from "../src/modules/accounts/tickets.js";
import {
  Api,
  appleToken,
  APPLE_ISS,
  bearer,
  BUNDLE,
  clearLimits,
  count,
  device,
  freshDatabase,
  GOOGLE_ISS,
  googleToken,
  hasDatabase,
  type Keys,
  makeDevice,
  makeFamily,
  makeJoinLink,
  makePerson,
  row,
  SECRET,
  setup,
  SIGNED_OUT,
  signToken,
} from "./accountsHelpers.js";

const skip = !hasDatabase;
let api: Api;
let keys: Keys;
let subs = 0;
const newSub = () => `apple-sub-${(subs += 1)}`;

before(async () => {
  if (skip) return;
  await freshDatabase();
  keys = await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

const notes = async (familyId: string) => (await db().query(`select body from messages where family_id = $1 and kind = 'system' order by created_at`, [familyId])).rows.map((r) => r.body);

// ---- the token

test("a forged token, signed by another key with the same key id, is refused", { skip }, async () => {
  const forged = await signToken(keys.forger, { sub: "victim", aud: BUNDLE, iss: APPLE_ISS });
  const res = await api.apple({ id_token: forged, name: "Mallory", role: "cook" });
  assert.equal(res.status, 401);
  assert.equal(res.data.error, "That Apple sign-in didn't work. Please try again.");
  assert.equal(await count("identities", "subject = 'victim'"), 0);
});

test("an expired token is refused", { skip }, async () => {
  const res = await api.apple({ id_token: await appleToken(keys, "late", { expiresIn: Math.floor(Date.now() / 1000) - 60 }) });
  assert.equal(res.status, 401);
});

test("a wrong audience is 503 'not set up', since trying again can't help", { skip }, async () => {
  const res = await api.apple({ id_token: await appleToken(keys, "foreign", { aud: "com.other.app" }), name: "X", role: "cook" });
  assert.equal(res.status, 503);
  assert.match(res.data.error, /isn't set up for this version/);
  assert.equal(await count("identities", "subject = 'foreign'"), 0);
});

test("the bundle id is an audience by default, and APPLE_AUDIENCES replaces the list", { skip }, async () => {
  const saved = process.env.APPLE_AUDIENCES;
  delete process.env.APPLE_AUDIENCES;
  try {
    assert.equal((await api.apple({ id_token: await appleToken(keys, newSub(), { aud: BUNDLE }) })).data.needs_name, true);
    assert.equal((await api.apple({ id_token: await appleToken(keys, newSub(), { aud: "host.exp.Exponent" }) })).data.needs_name, true, "kept for now: Supabase's TODO");
    process.env.APPLE_AUDIENCES = "com.example.next";
    assert.equal((await api.apple({ id_token: await appleToken(keys, newSub(), { aud: BUNDLE }) })).status, 503);
    assert.equal((await api.apple({ id_token: await appleToken(keys, newSub(), { aud: "com.example.next" }) })).status, 200);
  } finally {
    process.env.APPLE_AUDIENCES = saved;
  }
});

test("the wrong issuer, no subject, no signature and a key-confusion token are refused", { skip }, async () => {
  const wrongIssuer = await appleToken(keys, "x", { iss: GOOGLE_ISS });
  const noSub = await signToken(keys.apple, { aud: BUNDLE, iss: APPLE_ISS });
  const header = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = header({ sub: "x", aud: BUNDLE, iss: APPLE_ISS, exp: Math.floor(Date.now() / 1000) + 600 });
  const unsigned = `${header({ alg: "none" })}.${claims}.`;
  // HS256 signed with the public key as if it were a shared secret: the classic confusion attack.
  const body = `${header({ alg: "HS256", kid: "apple-1" })}.${claims}`;
  const confused = `${body}.${createHmac("sha256", JSON.stringify(keys.apple.jwk)).update(body).digest("base64url")}`;
  for (const [name, token] of Object.entries({ wrongIssuer, noSub, unsigned, confused, junk: "not.a.jwt" })) {
    assert.equal((await api.apple({ id_token: token })).status, 401, name);
  }
  assert.equal((await api.apple({})).status, 400);
  assert.equal((await api.apple({ id_token: "x".repeat(8001) })).status, 400);
});

test("a token from Apple doesn't work as Google, or the other way", { skip }, async () => {
  assert.equal((await api.google({ id_token: await appleToken(keys, "x") })).status, 401);
  assert.equal((await api.apple({ id_token: await googleToken(keys, "x") })).status, 401);
});

test("keys that can't be fetched are 503, not a refusal: the person did nothing wrong", { skip }, async () => {
  const down = (error: Error): JWTVerifyGetKey => async () => {
    throw error;
  };
  const good = createLocalJWKSet({ keys: [keys.google.jwk] });
  for (const error of [new joseErrors.JWKSTimeout(), new joseErrors.JOSEError("Expected 200 OK"), new TypeError("fetch failed")]) {
    useIdTokens(idTokensWith({ apple: down(error), google: good }));
    const res = await api.apple({ id_token: await appleToken(keys, newSub()) });
    assert.equal(res.status, 503, error.name);
    assert.equal(res.data.error, "We couldn't reach Apple just now. Please try again.");
  }
  useIdTokens(idTokensWith({ apple: createLocalJWKSet({ keys: [keys.apple.jwk] }), google: good }));
});

test("Google answers 503 until it's set up", { skip }, async () => {
  const saved = process.env.GOOGLE_CLIENT_IDS;
  delete process.env.GOOGLE_CLIENT_IDS;
  try {
    const res = await api.google({ id_token: "anything" });
    assert.equal(res.status, 503);
    assert.equal(res.data.error, "Google sign-in isn't set up yet.");
  } finally {
    process.env.GOOGLE_CLIENT_IDS = saved;
  }
  assert.equal((await api.google({ id_token: await googleToken(keys, newSub()) })).data.needs_name, true);
});

// ---- no link

test("Apple with no link: a name, then a role, then their own family; the same account signs in again", { skip }, async () => {
  const sub = newSub();
  const token = await appleToken(keys, sub, { email: "NEW@Example.com", given_name: " Asha " });
  const first = await api.apple({ id_token: token });
  assert.deepEqual(first.data, { existing: false, needs_name: true, suggested_name: "Asha" });
  assert.equal(await count("identities", "subject = $1", [sub]), 0, "nothing is made");
  const noRole = await api.apple({ id_token: token, name: "Asha" });
  assert.equal(noRole.status, 400);
  assert.equal(noRole.data.error, "role must be cook or learner");
  const made = await api.apple({ id_token: token, name: "Asha", role: "cook", device_label: "iPhone" });
  assert.equal(made.status, 200);
  assert.deepEqual([made.data.existing, made.data.joined, made.data.family_name], [false, false, "Asha's family"]);
  assert.equal(made.data.device_key.length, 43);
  const seen = await api.get("/family", device(made.data.device_key, made.data.profile_id));
  assert.equal(seen.data.can_manage, true);
  assert.equal(seen.data.profiles[0].role, "cook");
  const identity = await row("identities", "subject = $1", [sub]);
  assert.equal(identity.email, "new@example.com");
  const signup = await row("signups", "person_id = $1", [made.data.profile_id]);
  assert.deepEqual([signup.email, signup.share_token], ["new@example.com", null], "today's live gap: the row now says whose it is");

  const again = await api.apple({ id_token: token });
  assert.deepEqual([again.data.existing, again.data.profile_id], [true, made.data.profile_id]);
  assert.notEqual(again.data.device_key, made.data.device_key);
  assert.equal((await api.apple({ id_token: token })).status, 200);
  assert.deepEqual(await notes(seen.data.family.id), [], "the first new phone isn't noted: this person's first phone was made within two minutes");
});

test("a known account on a new phone is noted once in the family's chat", { skip }, async () => {
  const sub = newSub();
  const token = await appleToken(keys, sub);
  const made = await api.apple({ id_token: token, name: "Old Hand", role: "cook" });
  await db().query(`update devices set created_at = now() - interval '1 day' where person_id = $1`, [made.data.profile_id]);
  const family = (await row("people", "id = $1", [made.data.profile_id])).family_id;
  await api.apple({ id_token: token });
  await api.apple({ id_token: token });
  assert.deepEqual(await notes(family), ["Old Hand signed in on a new phone"]);
});

test("two taps at once make one person and one family", { skip }, async () => {
  const sub = newSub();
  const token = await appleToken(keys, sub);
  const replies = await Promise.all([
    api.apple({ id_token: token, name: "Twice", role: "cook" }),
    api.apple({ id_token: token, name: "Twice", role: "cook" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status), [200, 200]);
  assert.equal(replies[0].data.profile_id, replies[1].data.profile_id);
  assert.equal(await count("people", "name = 'Twice'"), 1);
  assert.equal(await count("families", "name = 'Twice''s family'"), 1, "the loser's family went with its transaction");
});

test("a removed person's old link is dropped: they count as new", { skip }, async () => {
  const sub = newSub();
  const token = await appleToken(keys, sub);
  const made = await api.apple({ id_token: token, name: "Leaver", role: "cook" });
  await db().query(`update people set removed_at = now() where id = $1`, [made.data.profile_id]);
  assert.equal((await api.apple({ id_token: token })).data.needs_name, true);
  assert.equal(await count("identities", "subject = $1", [sub]), 0);
});

// ---- join links

async function family(name = "The Pawars") {
  const f = await makeFamily(name);
  const mom = await makePerson(f.id, "Mom");
  const link = await makeJoinLink(f.id, mom);
  return { f, mom, link };
}

test("a new account joins by a live link: a new person, the account, a phone key, signups join:<id>, the note", { skip }, async () => {
  const { f, link } = await family();
  const sub = newSub();
  const res = await api.apple({ id_token: await appleToken(keys, sub, { email: "asha@example.com" }), join_token: link.token, name: "Asha", role: "learner" });
  assert.equal(res.status, 200);
  assert.deepEqual([res.data.existing, res.data.joined, res.data.family_name], [false, true, "The Pawars"]);
  const person = await row("people", "id = $1", [res.data.profile_id]);
  assert.deepEqual([person.family_id, person.name, person.role], [f.id, "Asha", "kid"]);
  assert.equal(await count("identities", "subject = $1 and person_id = $2", [sub, person.id]), 1);
  assert.equal((await row("signups", "person_id = $1", [person.id])).share_token, `join:${link.id}`);
  assert.deepEqual(await notes(f.id), ["Asha joined"]);
  assert.equal(await count("thread_reads", "person_id = $1", [person.id]), 1, "the circle starts read");
  const second = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token, name: "Ravi", role: "cook" });
  assert.equal(second.status, 200, "a family's link works for anyone, any number of times");
  assert.equal((await row("people", "id = $1", [second.data.profile_id])).role, "cook");
});

test("a new account without a name gets needs_name and nothing is made", { skip }, async () => {
  const { f, link } = await family();
  const res = await api.apple({ id_token: await appleToken(keys, newSub(), { given_name: "Kiran" }), join_token: link.token });
  assert.deepEqual(res.data, { existing: false, needs_name: true, suggested_name: "Kiran" });
  assert.equal(await count("people", "family_id = $1", [f.id]), 1);
});

test("expired and revoked links get 410 with their sentence and make nothing; unknown tokens 404", { skip }, async () => {
  const { f, mom } = await family();
  const expired = await makeJoinLink(f.id, mom, { expires: "2026-01-01T00:00:00Z" });
  const res = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: expired.token, name: "Late", role: "learner" });
  assert.equal(res.status, 410);
  assert.deepEqual([res.data.error, res.data.status], ["This link expired.", "expired"]);
  const revoked = await makeJoinLink(f.id, mom);
  await db().query(`update join_links set revoked_at = now() where id = $1`, [revoked.id]);
  const off = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: revoked.token, name: "Late", role: "learner" });
  assert.deepEqual([off.status, off.data.error], [410, "This link was turned off."]);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), join_token: "Z".repeat(22), name: "Late" })).status, 404);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), join_token: "short", name: "Late" })).status, 404);
  assert.equal(await count("people", "family_id = $1 and name = 'Late'", [f.id]), 0);
});

test("the operator's link with no expiry keeps working: how Apple's reviewer gets in", { skip }, async () => {
  const { f, mom } = await family("The TEST family");
  const link = await makeJoinLink(f.id, mom, { expires: null });
  const res = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token, name: "Reviewer", role: "learner" });
  assert.equal(res.status, 200);
  assert.equal(res.data.family_name, "The TEST family");
});

test("a known account in the link's family just signs in, and nothing is used up", { skip }, async () => {
  const { link } = await family();
  const sub = newSub();
  const made = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, name: "Known", role: "learner" });
  const again = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, name: "Ignored" });
  assert.deepEqual([again.data.existing, again.data.joined, again.data.profile_id], [true, false, made.data.profile_id]);
});

async function movable() {
  const sub = newSub();
  const token = await appleToken(keys, sub);
  const old = await api.apple({ id_token: token, name: "Zed", role: "cook" });
  const oldFamily = (await row("people", "id = $1", [old.data.profile_id])).family_id;
  const b = await family();
  return { sub, token, old, oldFamily, ...b };
}

test("a known account in another family gets needs_move and nothing changes; move:true moves them", { skip }, async () => {
  const m = await movable();
  const asked = await api.apple({ id_token: m.token, join_token: m.link.token });
  assert.deepEqual(asked.data, { existing: true, needs_move: true, from_family: "Zed's family", to_family: "The Pawars" });
  assert.equal((await row("families", "id = $1", [m.oldFamily])).blanked_at, null);
  assert.equal((await row("people", "id = $1", [m.old.data.profile_id])).removed_at, null);
  assert.equal((await api.apple({ id_token: m.token, join_token: m.link.token, move: "yes" })).status, 400);

  const session = (await api.post("/v1/sessions/start", { deviceKey: m.old.data.device_key, profileId: m.old.data.profile_id })).data.sessionToken;
  const moved = await api.apple({ id_token: m.token, join_token: m.link.token, move: true, name: "Zed New", role: "cook" });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.data.existing, moved.data.joined, moved.data.family_name], [true, true, "The Pawars"]);
  assert.notEqual(moved.data.profile_id, m.old.data.profile_id);
  assert.ok(moved.data.moved.receipt);

  const was = await row("people", "id = $1", [m.old.data.profile_id]);
  assert.ok(was.removed_at, "they left family A as 'Leave the family' does");
  assert.equal(was.name, "Zed", "their old messages keep their name");
  assert.equal(await count("identities", "person_id = $1", [m.old.data.profile_id]), 0);
  assert.equal(await count("identities", "subject = $1 and person_id = $2", [m.sub, moved.data.profile_id]), 1);
  // A moved person: the old phone, the old session and the old face are all refused.
  assert.equal((await api.get("/family", device(m.old.data.device_key))).data.error, SIGNED_OUT);
  assert.equal((await api.get("/v1/me", bearer(session))).status, 401);
  assert.equal((await api.post("/v1/sessions/start", { deviceKey: m.old.data.device_key, profileId: m.old.data.profile_id })).status, 401);
  assert.deepEqual(await notes(m.oldFamily), ["Zed left"]);
  assert.equal((await row("families", "id = $1", [m.oldFamily])).name, "Deleted", "they were its last");
  assert.deepEqual(await notes(m.f.id), ["Zed New joined"]);
  assert.equal((await api.apple({ id_token: m.token })).data.profile_id, moved.data.profile_id, "signing in later lands in the new family");
});

test("solo: the old family's phone-less faces come along (not one the new family has a name for), and the receipt says so", { skip }, async () => {
  const m = await movable();
  const face = await makePerson(m.oldFamily, "Grandma");
  const clash = await makePerson(m.oldFamily, "Mom");
  const moved = await api.apple({ id_token: m.token, join_token: m.link.token, move: true });
  assert.equal(moved.status, 200);
  assert.equal((await row("people", "id = $1", [face])).family_id, m.f.id);
  const left = await row("people", "id = $1", [clash]);
  assert.equal(left.family_id, m.oldFamily, "the new family already has a Mom");
  assert.ok(left.deleted_at, "and she can't keep a family with nobody signed in open");
  assert.equal(await count("account_deletions", "person_id = $1", [clash]), 1);
  const receipt = JSON.parse(Buffer.from(moved.data.moved.receipt.split(".")[0], "base64url").toString());
  assert.deepEqual([receipt.solo, receipt.faces, receipt.kind], [true, [face], "moved"]);
  assert.ok((await row("families", "id = $1", [m.oldFamily])).blanked_at);
});

test("someone else still signing in to the old family: not solo, the faces stay", { skip }, async () => {
  const m = await movable();
  const other = await makePerson(m.oldFamily, "Sibling");
  await makeDevice(m.oldFamily, other);
  const face = await makePerson(m.oldFamily, "Grandma");
  const moved = await api.apple({ id_token: m.token, join_token: m.link.token, move: true });
  const receipt = JSON.parse(Buffer.from(moved.data.moved.receipt.split(".")[0], "base64url").toString());
  assert.equal(receipt.solo, false);
  assert.equal((await row("people", "id = $1", [face])).family_id, m.oldFamily);
});

test("a move with a name the new family has changes nothing; without the secret the receipt is null", { skip }, async () => {
  const m = await movable();
  const taken = await api.apple({ id_token: m.token, join_token: m.link.token, move: true, name: "Mom" });
  assert.equal(taken.status, 409);
  assert.equal((await row("people", "id = $1", [m.old.data.profile_id])).removed_at, null, "still in the old family");
  assert.equal((await api.get("/family", device(m.old.data.device_key))).status, 200, "the old phone still works");
  delete process.env.LINK_JOIN_SECRET;
  try {
    const moved = await api.apple({ id_token: m.token, join_token: m.link.token, move: true, name: "Zed Two" });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.moved.receipt, null);
  } finally {
    process.env.LINK_JOIN_SECRET = SECRET;
  }
});

test("a removed person trying every proof: their phone, their session, their account, the code and a claim are all refused", { skip }, async () => {
  const { f, mom, link } = await family();
  const sub = newSub();
  const token = await appleToken(keys, sub);
  const joined = await api.apple({ id_token: token, join_token: link.token, name: "Leaver", role: "learner" });
  const person = joined.data.profile_id;
  const sessionToken = (await api.post("/v1/sessions/start", { deviceKey: joined.data.device_key, profileId: person })).data.sessionToken;
  const otherPhone = await makeDevice(f.id, mom);
  assert.equal((await api.post(`/profiles/${person}/remove`, {}, device(joined.data.device_key, person))).status, 200);

  assert.equal((await api.get("/family", device(joined.data.device_key))).data.error, SIGNED_OUT, "their phone");
  assert.equal((await api.get("/v1/me", bearer(sessionToken))).status, 401, "their session, at once");
  assert.equal((await api.post("/v1/sessions/start", { deviceKey: joined.data.device_key, profileId: person })).status, 401);
  const asThem = await api.post("/v1/sessions/start", { deviceKey: otherPhone.key, profileId: person });
  assert.deepEqual([asThem.status, asThem.data.error], [403, "That person isn't in this family anymore."], "someone else's phone can't mint one for them");
  assert.equal((await api.post("/invites", {}, device(otherPhone.key, person))).status, 403);
  assert.equal(await count("identities", "person_id = $1", [person]), 0);
  const claim = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token, claim_profile_id: person });
  assert.deepEqual([claim.status, claim.data.error], [409, "That person isn't in this family."]);
  // Their account is free: they can come back through the link, as a new person.
  assert.equal((await api.apple({ id_token: token })).data.needs_name, true);
  const back = await api.apple({ id_token: token, join_token: link.token, name: "Leaver", role: "learner" });
  assert.equal(back.status, 200, "a removed name can be used again");
  assert.notEqual(back.data.profile_id, person);
});

// ---- tickets

const FAM_UUID = "11111111-2222-4333-8444-555555555555";
const payload = (over: Partial<JoinPayload> = {}): JoinPayload => ({
  v: 1,
  fam: FAM_UUID,
  card: "f25009a97fe921e7818ce826",
  side: "cook",
  name: "Mom",
  exp: Date.now() + 600_000,
  jti: "AbCdEfGhIjKlMnOp",
  ...over,
});

let cards = 0;
const newCard = () => `c${String((cards += 1)).padStart(23, "0")}`;

async function ticketFamily() {
  const f = await makeFamily("The Ticketed");
  await db().query(`update families set supabase_id = gen_random_uuid()::text where id = $1`, [f.id]);
  const fam = (await row("families", "id = $1", [f.id])).supabase_id as string;
  return { f, fam };
}

test("a ticket joins once per card side, with the side's role; the family comes only from the ticket", { skip }, async () => {
  const { f, fam } = await ticketFamily();
  const decoy = await makeFamily("Decoy");
  const card = newCard();
  const ticket = signTicket(SECRET, payload({ fam, card, side: "cook", name: "Mom" }));
  const asked = await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket });
  assert.deepEqual(asked.data, { existing: false, needs_name: true, suggested_name: "Mom" });
  const joined = await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket, name: "Mom", role: "learner", family_id: decoy.id });
  assert.equal(joined.status, 200);
  const person = await row("people", "id = $1", [joined.data.profile_id]);
  assert.deepEqual([person.family_id, person.role], [f.id, "cook"], "the side's role beats the body's");
  assert.equal((await row("signups", "share_token = $1", [`link:${card}:cook`])).person_id, person.id);

  // Replayed, by anyone: the same ticket and a fresh one for that side both get 409.
  for (const again of [ticket, signTicket(SECRET, payload({ fam, card, side: "cook", jti: "ZZZZZZZZZZZZZZZZ" }))]) {
    const res = await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: again, name: "Stranger" });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, "This link already brought someone in. Ask them for an invite.");
  }
  assert.equal(await count("people", "family_id = $1 and name = 'Stranger'", [f.id]), 0);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: signTicket(SECRET, payload({ fam, card, side: "kid", name: "Kid" })), name: "Kid" })).status, 200, "the other side is its own");
});

test("the holder replaying their own ticket just signs in", { skip }, async () => {
  const { fam } = await ticketFamily();
  const sub = newSub();
  const ticket = signTicket(SECRET, payload({ fam, card: newCard() }));
  const first = await api.apple({ id_token: await appleToken(keys, sub), link_ticket: ticket, name: "Mom" });
  const again = await api.apple({ id_token: await appleToken(keys, sub), link_ticket: ticket });
  assert.deepEqual([again.data.existing, again.data.profile_id], [true, first.data.profile_id]);
});

test("two joins on one side at once: exactly one gets in", { skip }, async () => {
  const { f, fam } = await ticketFamily();
  const ticket = signTicket(SECRET, payload({ fam, card: newCard() }));
  const replies = await Promise.all([
    api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket, name: "One" }),
    api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket, name: "Two" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await count("people", "family_id = $1", [f.id]), 1);
});

test("a name already in the family claims nobody, makes nothing, and the side stays open", { skip }, async () => {
  const { f, fam } = await ticketFamily();
  await makePerson(f.id, "Mom");
  const card = newCard();
  const ticket = signTicket(SECRET, payload({ fam, card }));
  const taken = await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket, name: "mom" });
  assert.equal(taken.status, 409);
  assert.equal(taken.data.error, "Mom is already in this family");
  assert.equal(await count("signups", "share_token = $1", [`link:${card}:cook`]), 0, "the side stays open");
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: ticket, name: "Amma" })).status, 200);
});

test("bad, forged and expired tickets get 403; no secret 503; both kinds of link, or a move that isn't true/false, 400", { skip }, async () => {
  const { fam } = await ticketFamily();
  const token = await appleToken(keys, newSub());
  const good = signTicket(SECRET, payload({ fam, card: newCard() }));
  const forged = signTicket("another-secret", payload({ fam, card: newCard() }));
  const expired = signTicket(SECRET, payload({ fam, card: newCard(), exp: Date.now() - 1 }));
  const tampered = `${Buffer.from(JSON.stringify(payload({ fam, side: "kid" }))).toString("base64url")}.${good.split(".")[1]}`;
  for (const [name, ticket] of Object.entries({ forged, expired, tampered, junk: "nope", extra: `${good}.x` })) {
    const res = await api.apple({ id_token: token, link_ticket: ticket, name: "Nope" });
    assert.equal(res.status, 403, name);
    assert.equal(res.data.error, "This link didn't work. Open it again.", name);
  }
  assert.equal((await api.apple({ id_token: token, link_ticket: 5, name: "Nope" })).status, 400);
  assert.equal((await api.apple({ id_token: token, join_token: "A".repeat(22), link_ticket: good })).status, 400);
  assert.equal((await api.apple({ id_token: token, link_ticket: good, move: 1 })).status, 400);
  delete process.env.LINK_JOIN_SECRET;
  try {
    assert.equal((await api.apple({ id_token: token, link_ticket: good, name: "Nope" })).status, 503);
  } finally {
    process.env.LINK_JOIN_SECRET = SECRET;
  }
  const noFamily = signTicket(SECRET, payload({ fam: "99999999-2222-4333-8444-555555555555", card: newCard() }));
  assert.equal((await api.apple({ id_token: token, link_ticket: noFamily, name: "Nope" })).status, 404);
});

// ---- old invites

async function oldInvite(familyId: string, inviterId: string) {
  const res = await db().query(
    `insert into invites (family_id, inviter_id, token_hash, code_hash, expires_at) values ($1, $2, encode(sha256($3::bytea), 'hex'), encode(sha256($4::bytea), 'hex'), now() + interval '14 days') returning id`,
    [familyId, inviterId, Buffer.from(`old${(cards += 1)}`.padEnd(16, "0")).toString(), `C${cards}`],
  );
  return { id: res.rows[0].id as string, token: `old${cards}`.padEnd(16, "0") };
}

test("an old one-use invite joins a NEW person (never the invited face) and is used up; a used one gets 410", { skip }, async () => {
  const { f, mom } = await family();
  const inv = await oldInvite(f.id, mom);
  const res = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, name: "Fresh", role: "learner" });
  assert.equal(res.status, 200);
  const used = await row("invites", "id = $1", [inv.id]);
  assert.equal(used.status, "used");
  assert.ok(used.used_device_id);
  const again = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, name: "Other", role: "learner" });
  assert.equal(again.status, 410);
  assert.equal(again.data.status, "used");
});

test("an old invite whose join fails stays unused; of two joins at once exactly one gets it", { skip }, async () => {
  const { f, mom } = await family();
  const inv = await oldInvite(f.id, mom);
  const taken = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, name: "Mom", role: "learner" });
  assert.equal(taken.status, 409);
  assert.equal((await row("invites", "id = $1", [inv.id])).status, "pending");
  const replies = await Promise.all([
    api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, name: "Race One", role: "learner" }),
    api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, name: "Race Two", role: "learner" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 410]);
});

// ---- "Are you Leo?"

test("a claim attaches the account and this phone to the existing person: no new person, their name and role, the note", { skip }, async () => {
  const { f, link } = await family();
  const leo = await makePerson(f.id, "Leo", "kid");
  const sub = newSub();
  const res = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, claim_profile_id: leo, name: "Ignored", role: "cook" });
  assert.equal(res.status, 200);
  assert.equal(res.data.profile_id, leo);
  assert.equal(await count("identities", "subject = $1 and person_id = $2", [sub, leo]), 1);
  assert.equal((await row("people", "id = $1", [leo])).role, "kid");
  assert.equal(await count("people", "family_id = $1 and name = 'Ignored'", [f.id]), 0);
  assert.deepEqual(await notes(f.id), ["Leo joined"]);
  assert.equal((await row("signups", "share_token = $1", [`link:claim:${leo}`])).person_id, leo);
});

test("a claim is refused for someone with a live phone or an account, another family's person, someone removed", { skip }, async () => {
  const { f, link } = await family();
  const phone = await makePerson(f.id, "Phoned", "kid");
  await makeDevice(f.id, phone);
  const accounted = await makePerson(f.id, "Accounted", "kid");
  await db().query(`insert into identities (provider, subject, person_id) values ('google', $1, $2)`, [newSub(), accounted]);
  const removed = await makePerson(f.id, "Removed", "kid");
  await db().query(`update people set removed_at = now() where id = $1`, [removed]);
  const elsewhere = await makePerson((await makeFamily()).id, "Elsewhere", "kid");
  const attempt = async (id: string) => api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token, claim_profile_id: id });
  assert.deepEqual([(await attempt(phone)).status, (await attempt(phone)).data.error], [409, "That person is already on homecookd."]);
  assert.equal((await attempt(accounted)).data.error, "That person is already on homecookd.");
  for (const id of [removed, elsewhere]) {
    const res = await attempt(id);
    assert.equal(res.status, 409);
    assert.equal(res.data.error, "That person isn't in this family.");
  }
  assert.equal((await attempt("not-a-uuid")).status, 400);
});

test("one claim per person: a second claim and two at once get 409", { skip }, async () => {
  const { f, link } = await family();
  const leo = await makePerson(f.id, "Leo", "kid");
  const attempt = async () => api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token, claim_profile_id: leo });
  const replies = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await attempt()).status, 409);
  assert.equal(await count("identities", "person_id = $1", [leo]), 1);
});

test("a claim through an old family invite uses the invite up; claim_profile_id goes only with a join link", { skip }, async () => {
  const { f, mom } = await family();
  const leo = await makePerson(f.id, "Leo", "kid");
  const inv = await oldInvite(f.id, mom);
  const res = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: inv.token, claim_profile_id: leo });
  assert.equal(res.status, 200);
  assert.equal((await row("invites", "id = $1", [inv.id])).status, "used");
  const { fam } = await ticketFamily();
  const onTicket = await api.apple({ id_token: await appleToken(keys, newSub()), link_ticket: signTicket(SECRET, payload({ fam, card: newCard() })), claim_profile_id: leo });
  assert.equal(onTicket.status, 400);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), claim_profile_id: leo })).status, 400);
});

test("a known account's claim is ignored", { skip }, async () => {
  const { f, link } = await family();
  const leo = await makePerson(f.id, "Leo", "kid");
  const sub = newSub();
  const made = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, name: "Known", role: "learner" });
  const res = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, claim_profile_id: leo });
  assert.equal(res.data.profile_id, made.data.profile_id);
  assert.equal(await count("identities", "person_id = $1", [leo]), 0);
});

test("another tap linked the account first: this join backs out and signs in as that one", { skip }, async () => {
  const { f, link } = await family();
  const token = await appleToken(keys, newSub());
  const replies = await Promise.all([
    api.apple({ id_token: token, join_token: link.token, name: "Tap A", role: "learner" }),
    api.apple({ id_token: token, join_token: link.token, name: "Tap B", role: "learner" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status), [200, 200]);
  assert.equal(replies[0].data.profile_id, replies[1].data.profile_id);
  assert.equal(await count("people", "family_id = $1 and name like 'Tap %'", [f.id]), 1);
});

// ---- recipe links (1.0 phones)

async function share(familyId: string, senderId: string | null) {
  const token = String((cards += 1)).padStart(10, "s");
  await db().query(`insert into shares (token, family_id, library_id, sender_id) values ($1, $2, 'chicken-biryani', $3)`, [token, familyId, senderId]);
  return token;
}

test("Apple via a recipe link: joins as a learner by default; only an invited, not-yet-joined person can be claimed; the link fills up", { skip }, async () => {
  const { f, mom } = await family();
  const token = await share(f.id, mom);
  const first = await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: "Sharer" });
  assert.equal(first.status, 200);
  assert.equal((await row("people", "id = $1", [first.data.profile_id])).role, "kid");
  assert.deepEqual(await notes(f.id), ["Sharer joined from Mom's link"]);

  const taken = await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: "Mom" });
  assert.equal(taken.status, 409);
  assert.equal(taken.data.error, "Mom is already in this family. Try another name.");

  const dad = await makePerson(f.id, "Dad");
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: "Dad" })).status, 409, "a face with no invite can't be claimed");
  await db().query(
    `insert into invites (family_id, inviter_id, person_id, token_hash, code_hash, expires_at) values ($1, $2, $3, encode(sha256('s1'::bytea), 'hex'), encode(sha256('s2'::bytea), 'hex'), now() + interval '1 day')`,
    [f.id, mom, dad],
  );
  const claimed = await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: "dad" });
  assert.equal(claimed.data.profile_id, dad);

  for (let i = 0; i < 3; i += 1) assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: `Extra ${i}` })).status, 200);
  const full = await api.apple({ id_token: await appleToken(keys, newSub()), share_token: token, name: "Sixth" });
  assert.equal(full.status, 403);
  assert.equal(full.data.error, "This link is full. Ask your family for a new one.");

  const dead = await api.apple({ id_token: await appleToken(keys, newSub()), share_token: "NOSUCHLINK", name: "Dead Link" });
  assert.equal(dead.status, 200, "a recipe link that no longer works still means a learner, with their own family");
  assert.equal((await row("people", "id = $1", [dead.data.profile_id])).role, "kid");
});

// ---- limits

test("sign-in is limited per address: tokens, then starting families, then link joins", { skip }, async () => {
  await clearLimits();
  const ip = "192.0.2.50";
  for (let i = 0; i < 30; i += 1) await api.apple({ id_token: "junk" }, ip);
  assert.equal((await api.apple({ id_token: "junk" }, ip)).status, 429);
  await clearLimits();
  for (let i = 0; i < 5; i += 1) assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), name: `Starter ${i}`, role: "cook" }, ip)).status, 200);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), name: "Starter 6", role: "cook" }, ip)).status, 429);
  await clearLimits();
  const { link } = await family();
  for (let i = 0; i < 20; i += 1) await api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token }, ip);
  assert.equal((await api.apple({ id_token: await appleToken(keys, newSub()), join_token: link.token }, ip)).status, 429);
  await clearLimits();
});

test("the sentence on a 429 is the old one, with retry-after", { skip }, async () => {
  await clearLimits();
  const ip = "192.0.2.51";
  for (let i = 0; i < 30; i += 1) await api.apple({ id_token: "junk" }, ip);
  const res = await api.apple({ id_token: "junk" }, ip);
  assert.equal(res.data.error, "Too many attempts. Please wait a few minutes.");
  assert.ok(Number(res.headers["retry-after"]) > 0);
  await clearLimits();
});

// A guard against testing the wrong thing: every token above is really verified, with no shortcut.
test("the helper signs real tokens that the real check takes", { skip }, async () => {
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "apple-1" }).setSubject("direct").setAudience(BUNDLE).setIssuer(APPLE_ISS).setExpirationTime("1m").sign(keys.apple.privateKey);
  assert.equal((await api.apple({ id_token: jwt })).data.needs_name, true);
});

test("an email nobody checked isn't kept", { skip }, async () => {
  const sub = `unverified-${Date.now()}`;
  const res = await api.apple({ id_token: await appleToken(keys, sub, { email: "not.checked@example.com", email_verified: "false" }), name: "Asha", role: "cook" });
  assert.equal(res.status, 200);
  assert.equal((await row("identities", "subject = $1", [sub])).email, null);
});
