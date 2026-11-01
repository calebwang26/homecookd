// Invites, join links, adding yourself and leaving. Carries over supabase/tests/api_test.ts and joinLinks_test.ts, against real Postgres in place of their fake database.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { Api, clearLimits, code, count, device, freshDatabase, hasDatabase, makeDevice, makeFamily, makeJoinLink, makePerson, row, setup, SIGNED_OUT } from "./accountsHelpers.js";

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

const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;

async function familyWithCook() {
  const f = await makeFamily("The Wangs");
  const mom = await makePerson(f.id, "Mom");
  const phone = await makeDevice(f.id, mom);
  return { f, mom, phone, me: device(phone.key, mom) };
}

test("invite: create, peek, accept once, then 410; joined people aren't 'invited'", { skip }, async () => {
  const { f, me, mom } = await familyWithCook();
  const made = await api.post("/invites", { name: "Dad", role: "cook", relation: "Dad", phone: "+1 (555) 123-4567" }, me);
  assert.equal(made.status, 200);
  assert.equal(made.data.profile.name, "Dad");
  assert.equal(made.data.profile.invited, true);
  assert.equal(made.data.invite.phone, "+15551234567");
  assert.match(made.data.invite.url, /\/i\?t=[0-9A-Za-z]{16}&c=[A-Z2-9]{6}$/);
  const token = tokenOf(made.data.invite.url);

  const peeked = await api.post("/invites/peek", { token });
  assert.equal(peeked.status, 200);
  assert.deepEqual([peeked.data.status, peeked.data.family_name, peeked.data.invitee.name, peeked.data.inviter.name], ["pending", "The Wangs", "Dad", "Mom"]);
  assert.equal(await count("devices", "person_id = $1", [made.data.profile.id]), 0, "peeking joins nobody");

  const before = await api.get("/family", me);
  assert.equal(before.data.profiles.find((p: { name: string }) => p.name === "Dad").invited, true);

  const accepted = await api.post("/invites/accept", { token, device_label: "iPhone" });
  assert.equal(accepted.status, 200);
  assert.deepEqual([accepted.data.family_name, accepted.data.profile_id], ["The Wangs", made.data.profile.id]);
  assert.equal((await api.get("/family", device(accepted.data.device_key))).data.device_profile_id, made.data.profile.id);
  const notes = await db().query(`select body from messages where family_id = $1 and kind = 'system'`, [f.id]);
  assert.deepEqual(notes.rows.map((r) => r.body), ["Dad joined."]);

  const again = await api.post("/invites/accept", { token });
  assert.equal(again.status, 410);
  assert.equal(again.data.status, "used");
  assert.equal(again.data.error, "This invite was already used.");
  const after2 = await api.get("/family", me);
  assert.equal(after2.data.profiles.find((p: { name: string }) => p.name === "Dad").invited, false);
  assert.ok(mom);
});

test("of two Joins at once, exactly one gets the invite", { skip }, async () => {
  const { me } = await familyWithCook();
  const made = await api.post("/invites", {}, me);
  const token = tokenOf(made.data.invite.url);
  const replies = await Promise.all([api.post("/invites/accept", { token }), api.post("/invites/accept", { token })]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 410]);
});

test("someone who already wrote or invited isn't 'invited', even with a link of their own pending", { skip }, async () => {
  const { me, f } = await familyWithCook();
  const grandma = await api.post("/invites", { name: "Grandma", role: "cook" }, me);
  assert.equal((await api.get("/family", me)).data.profiles.find((p: { name: string }) => p.name === "Grandma").invited, true);
  const thread = await db().query(`insert into threads (family_id, kind) values ($1, 'circle') on conflict do nothing returning id`, [f.id]);
  const threadId = thread.rows[0]?.id ?? (await row("threads", "family_id = $1", [f.id])).id;
  await db().query(`insert into messages (family_id, thread_id, sender_id, kind, body) values ($1, $2, $3, 'text', 'hello')`, [f.id, threadId, grandma.data.profile.id]);
  assert.equal((await api.get("/family", me)).data.profiles.find((p: { name: string }) => p.name === "Grandma").invited, false);
});

test("re-invite turns the old link off and keeps the number", { skip }, async () => {
  const { me } = await familyWithCook();
  const first = await api.post("/invites", { name: "Uncle", role: "cook", phone: "5551112222" }, me);
  const again = await api.post("/invites", { profile_id: first.data.profile.id }, me);
  assert.equal(again.status, 200);
  assert.equal(again.data.invite.phone, "5551112222");
  const old = await api.post("/invites/accept", { token: tokenOf(first.data.invite.url) });
  assert.equal(old.status, 410);
  assert.equal(old.data.status, "revoked");
  assert.equal((await api.post("/invites/accept", { token: tokenOf(again.data.invite.url) })).status, 200);
  const late = await api.post("/invites", { profile_id: first.data.profile.id }, me);
  assert.equal(late.status, 409);
  assert.match(late.data.error, /already joined/);
});

test("expired and unknown invites", { skip }, async () => {
  const { me } = await familyWithCook();
  const made = await api.post("/invites", {}, me);
  const token = tokenOf(made.data.invite.url);
  await db().query(`update invites set expires_at = now() - interval '1 minute' where id = $1`, [made.data.invite.id]);
  assert.equal((await api.post("/invites/peek", { token })).data.status, "expired");
  const late = await api.post("/invites/accept", { token });
  assert.equal(late.status, 410);
  assert.equal(late.data.error, "This invite expired.");
  const unknown = await api.post("/invites/accept", { token: "A".repeat(16) });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.error, "That invite link doesn't work.");
  assert.equal((await api.post("/invites/peek", { code: "AAAAAA" })).data.error, "That invite code doesn't work.");
  assert.equal((await api.post("/invites/peek", {})).status, 400);
});

test("typed codes are counted before lookup, per IP and service-wide; links aren't", { skip }, async () => {
  await clearLimits();
  const ip = "192.0.2.10";
  for (let i = 0; i < 20; i += 1) assert.equal((await api.post("/invites/peek", { code: "AAAAAA" }, {}, ip)).status, 404);
  const blocked = await api.post("/invites/peek", { code: "AAAAAA" }, {}, ip);
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /Too many tries/);
  await clearLimits();
  for (let i = 0; i < 100; i += 1) await api.post("/invites/peek", { code: "AAAAAA" }, {}, `192.0.3.${i}`);
  const busy = await api.post("/invites/peek", { code: "AAAAAA" }, {}, "192.0.4.1");
  assert.equal(busy.status, 429);
  assert.match(busy.data.error, /busy/);
  await clearLimits();
});

test("family invite: an empty body names nobody; Join makes a phone with no person and posts no note", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const made = await api.post("/invites", {}, me);
  assert.equal(made.data.profile, null);
  const peeked = await api.post("/invites/peek", { token: tokenOf(made.data.invite.url) });
  assert.equal(peeked.data.invitee, null);
  const joined = await api.post("/invites/accept", { token: tokenOf(made.data.invite.url) });
  assert.equal(joined.data.profile_id, null);
  const seen = await api.get("/family", device(joined.data.device_key));
  assert.equal(seen.data.device_needs_profile, true);
  assert.equal(await count("messages", "family_id = $1", [f.id]), 0);
});

test("a family-invite phone can't take a face: writes as anyone are 403 'Add yourself first.' until it adds itself", { skip }, async () => {
  const { f, mom, me } = await familyWithCook();
  const grandma = await makePerson(f.id, "Grandma");
  assert.ok(mom);
  const made = await api.post("/invites", {}, me);
  const joined = await api.post("/invites/accept", { token: tokenOf(made.data.invite.url) });
  const asGrandma = await api.post("/invites", {}, device(joined.data.device_key, grandma));
  assert.equal(asGrandma.status, 403);
  assert.equal(asGrandma.data.error, "Add yourself first.");
  assert.equal((await api.get("/family", device(joined.data.device_key, grandma))).status, 200, "reading as a phone-less face is fine");
});

test("POST /profiles/self: a phone with no person adds its own, once, and is then theirs alone", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const made = await api.post("/invites", {}, me);
  const key = (await api.post("/invites/accept", { token: tokenOf(made.data.invite.url) })).data.device_key;
  const taken = await api.post("/profiles/self", { name: "mom", role: "learner" }, device(key));
  assert.equal(taken.status, 409);
  assert.match(taken.data.error, /already in this family. Pick another name/);
  const self = await api.post("/profiles/self", { name: "Asha", role: "learner" }, device(key));
  assert.equal(self.status, 200);
  assert.deepEqual([self.data.role, self.data.has_phone, self.data.locked], ["learner", true, false]);
  const again = await api.post("/profiles/self", { name: "Other", role: "learner" }, device(key));
  assert.equal(again.status, 409);
  assert.match(again.data.error, /already belongs to Asha/);
  assert.equal((await db().query(`select body from messages where family_id = $1 and kind = 'system'`, [f.id])).rows[0].body, "Asha joined.");
});

test("POST /profiles/self: when another tap gave the phone its person first, the new face is undone", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const made = await api.post("/invites", {}, me);
  const key = (await api.post("/invites/accept", { token: tokenOf(made.data.invite.url) })).data.device_key;
  const replies = await Promise.all([
    api.post("/profiles/self", { name: "Tap One", role: "learner" }, device(key)),
    api.post("/profiles/self", { name: "Tap Two", role: "learner" }, device(key)),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await count("people", "family_id = $1 and name like 'Tap %'", [f.id]), 1);
});

test("POST /profiles: names are unique per family, ignoring case, and old builds can't trade a key for an email", { skip }, async () => {
  const { me, f } = await familyWithCook();
  assert.equal((await api.post("/profiles", { name: "Grandpa", role: "cook" }, me)).status, 200);
  const same = await api.post("/profiles", { name: "GRANDPA", role: "cook" }, me);
  assert.equal(same.status, 409);
  assert.equal(same.data.error, "GRANDPA is already in this family".replace("GRANDPA", "Grandpa"));
  const withEmail = await api.post("/profiles", { name: "Eve", role: "cook", email: "eve@example.com" }, me);
  assert.equal(withEmail.status, 403);
  assert.equal((await api.post("/profiles", { name: "Eve", role: "cook", email: "eve@example.com" }, code(f.code))).status, 200);
  assert.equal((await api.post("/profiles", { name: "Eve Two", role: "cook", email: "EVE@example.com" }, code(f.code))).status, 409, "an email is one person");
  assert.equal((await api.post("/profiles", { name: "Bad", role: "chef" }, me)).status, 400);
});

test("a family stops at 30 people", { skip }, async () => {
  const { f, me } = await familyWithCook();
  await db().query(`insert into people (family_id, name, role) select $1, 'Filler ' || g, 'kid' from generate_series(1, 29) g`, [f.id]);
  const full = await api.post("/profiles", { name: "One more", role: "learner" }, me);
  assert.equal(full.status, 400);
  assert.match(full.data.error, /already has 30 people/);
});

test("removing someone turns off the family invites they sent (named ones stay)", { skip }, async () => {
  const { f, mom } = await familyWithCook();
  const leo = await makePerson(f.id, "Leo", "kid");
  const leoPhone = await makeDevice(f.id, leo);
  const leoMe = device(leoPhone.key, leo);
  const family = await api.post("/invites", {}, leoMe);
  const named = await api.post("/invites", { name: "Named", role: "learner" }, leoMe);
  assert.equal((await api.post(`/profiles/${leo}/remove`, {}, leoMe)).status, 200);
  assert.equal((await api.post("/invites/peek", { token: tokenOf(family.data.invite.url) })).data.status, "revoked");
  assert.equal((await api.post("/invites/peek", { token: tokenOf(named.data.invite.url) })).data.status, "pending");
  assert.ok(mom);
});

test("remove: nobody removes anyone else; leaving from your own phone signs it out", { skip }, async () => {
  const { f, mom, phone, me } = await familyWithCook();
  const dad = await makePerson(f.id, "Dad");
  const dadPhone = await makeDevice(f.id, dad);
  const refused = await api.post(`/profiles/${dad}/remove`, {}, me);
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, "Only Dad can remove themselves.");
  const left = await api.post(`/profiles/${dad}/remove`, {}, device(dadPhone.key, dad));
  assert.equal(left.status, 200);
  assert.equal((await api.get("/family", device(dadPhone.key))).data.error, SIGNED_OUT);
  const stillThere = await api.get("/family", me);
  assert.deepEqual(stillThere.data.former_profiles.map((p: { name: string }) => p.name), ["Dad"]);
  assert.equal((await api.post(`/profiles/${dad}/remove`, {}, device(phone.key, mom))).status, 200, "someone already gone is fine: a repeated tap");
});

test("remove: someone with no phone leaves from a lent or shared phone, which stays signed in", { skip }, async () => {
  const { f, phone, me } = await familyWithCook();
  const grandma = await makePerson(f.id, "Grandma");
  assert.equal((await api.post(`/profiles/${grandma}/remove`, {}, device(phone.key, grandma))).status, 200);
  assert.equal((await api.get("/family", me)).status, 200);
  assert.equal(await count("people", "id = $1 and removed_at is not null", [grandma]), 1);
  assert.equal((await row("devices", "id = $1", [phone.id])).person_id !== grandma, true, "the write doesn't make it hers");
});

test("join links: one link for the family all week, peek says kind link, 1.0's accept gets 426, revoke turns it off", { skip }, async () => {
  const { me } = await familyWithCook();
  const first = await api.post("/join-links", {}, me);
  assert.equal(first.status, 200);
  assert.match(first.data.url, /\/i\?t=[0-9A-Za-z]{22}$/);
  const same = await api.post("/join-links", {}, me);
  assert.equal(same.data.url, first.data.url, "the same link while it has more than a day left");
  const token = tokenOf(first.data.url);
  const peeked = await api.post("/invites/peek", { token });
  assert.deepEqual([peeked.data.kind, peeked.data.status, peeked.data.family_name, peeked.data.inviter.name], ["link", "pending", "The Wangs", "Mom"]);
  const onOld = await api.post("/invites/accept", { token });
  assert.equal(onOld.status, 426);
  assert.equal(onOld.data.error, "Update homecookd to join this family.");
  assert.equal((await api.post("/join-links/revoke", {}, me)).data.ok, true);
  assert.equal((await api.post("/invites/peek", { token })).data.status, "revoked");
  const fresh = await api.post("/join-links", {}, me);
  assert.notEqual(fresh.data.url, first.data.url);
});

test("the family's link is new in its last day; the operator's never shows and revoke leaves it", { skip }, async () => {
  const { f, mom, me } = await familyWithCook();
  const operator = await makeJoinLink(f.id, null, { expires: null });
  const first = await api.post("/join-links", {}, me);
  assert.notEqual(tokenOf(first.data.url), operator.token);
  await db().query(`update join_links set expires_at = now() + interval '12 hours' where family_id = $1 and expires_at is not null`, [f.id]);
  const second = await api.post("/join-links", {}, me);
  assert.notEqual(second.data.url, first.data.url);
  await api.post("/join-links/revoke", {}, me);
  assert.equal((await row("join_links", "id = $1", [operator.id])).revoked_at, null);
  assert.ok(mom);
});

test("a link that can't be opened (a rotated key) is replaced, not shown broken", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const first = await api.post("/join-links", {}, me);
  await db().query(`update join_links set token_enc = 'v1:AAAA.AAAA' where family_id = $1`, [f.id]);
  const next = await api.post("/join-links", {}, me);
  assert.equal(next.status, 200);
  assert.notEqual(next.data.url, first.data.url);
});

test("peek: claimable is the one phone-less person of exactly the typed name, ignoring case and spaces", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const leo = await makePerson(f.id, "Leo Big", "kid");
  const token = tokenOf((await api.post("/join-links", {}, me)).data.url);
  const seen = await api.post("/invites/peek", { token, name: "  leo   BIG " });
  assert.deepEqual(seen.data.claimable, { id: leo, name: "Leo Big", avatar_key: null });
  assert.equal((await api.post("/invites/peek", { token })).data.claimable, null, "never without a typed name");
  assert.equal((await api.post("/invites/peek", { token, name: "Le" })).data.claimable, null, "never a partial match");
});

test("peek: null for someone with an account, someone removed, or a link that's gone", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const account = await makePerson(f.id, "Accounted", "kid");
  await db().query(`insert into identities (provider, subject, person_id) values ('apple', 'sub-accounted', $1)`, [account]);
  const removed = await makePerson(f.id, "Removed", "kid");
  await db().query(`update people set removed_at = now() where id = $1`, [removed]);
  await makePerson(f.id, "Free", "kid");
  const token = tokenOf((await api.post("/join-links", {}, me)).data.url);
  assert.equal((await api.post("/invites/peek", { token, name: "Accounted" })).data.claimable, null);
  assert.equal((await api.post("/invites/peek", { token, name: "Removed" })).data.claimable, null);
  await api.post("/join-links/revoke", {}, me);
  assert.equal((await api.post("/invites/peek", { token, name: "Free" })).data.claimable, null);
});

test("an invite that names someone who deleted is gone", { skip }, async () => {
  const { f, me } = await familyWithCook();
  const made = await api.post("/invites", { name: "Soon Gone", role: "learner" }, me);
  await db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [made.data.profile.id]);
  assert.equal((await api.post("/invites/peek", { token: tokenOf(made.data.invite.url) })).status, 404);
  const tap = await api.post("/invites/accept", { token: tokenOf(made.data.invite.url) });
  assert.equal(tap.status, 410);
  assert.equal(await count("devices", "family_id = $1 and via = 'invite'", [f.id]), 0, "nothing was handed out");
});

test("the routes' own limits", { skip }, async () => {
  await clearLimits();
  const { me } = await familyWithCook();
  for (let i = 0; i < 50; i += 1) assert.equal((await api.post("/invites", {}, me)).status, 200);
  const blocked = await api.post("/invites", {}, me);
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /lot of invites/);
  await clearLimits();
  const real = tokenOf((await api.post("/join-links", {}, me)).data.url);
  for (let i = 0; i < 60; i += 1) assert.equal((await api.post("/invites/peek", { token: real }, {}, "192.0.5.1")).status, 200);
  assert.equal((await api.post("/invites/peek", { token: real }, {}, "192.0.5.1")).status, 429, "60 peeks in 10 minutes");
  await clearLimits();
  for (let i = 0; i < 20; i += 1) assert.equal((await api.post("/invites/peek", { token: "B".repeat(16) }, {}, "192.0.5.2")).status, 404);
  assert.equal((await api.post("/invites/peek", { token: "B".repeat(16) }, {}, "192.0.5.2")).status, 429, "20 misses in 10 minutes");
  await clearLimits();
  const ip = "192.0.6.2";
  for (let i = 0; i < 20; i += 1) assert.equal((await api.post("/invites/accept", { token: real }, {}, ip)).status, 426);
  assert.equal((await api.post("/invites/accept", { token: real }, {}, ip)).status, 429, "20 Join taps in 10 minutes");
  await clearLimits();
});
