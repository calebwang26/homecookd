// Moving to a new phone: ask, someone settled lets them in, the old phones sign out. Carries over supabase/tests/api_test.ts's move tests.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { Api, bearer, clearLimits, count, device, freshDatabase, hasDatabase, makeDevice, makeFamily, makePerson, row, said, setup, SIGNED_OUT } from "./accountsHelpers.js";
import { session } from "./helpers.js";

const skip = !hasDatabase;
let api: Api;
const LONG_AGO = "2026-01-01T00:00:00Z";

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

/** Mom (settled, on her own phone), Dad with an old phone, and a new phone that just joined with no person. */
async function moving() {
  const f = await makeFamily();
  const mom = await makePerson(f.id, "Mom", "cook", { created: LONG_AGO });
  const dad = await makePerson(f.id, "Dad", "cook", { created: LONG_AGO });
  const momPhone = await makeDevice(f.id, mom, "apple", LONG_AGO);
  const dadPhone = await makeDevice(f.id, dad, "apple", LONG_AGO);
  const newPhone = await makeDevice(f.id, null, "invite");
  return { f, mom, dad, momPhone, dadPhone, newPhone, momMe: device(momPhone.key, mom), asker: device(newPhone.key) };
}

test("move to a new phone: ask, the family sees it, approve, and the old phone is signed out, with no note", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  assert.equal(asked.status, 200);
  assert.deepEqual([asked.data.profile_id, asked.data.status], [m.dad, "pending"]);
  const list = await api.get("/move-requests", m.momMe);
  assert.deepEqual(list.data.map((r: { id: string; profile: { name: string } }) => [r.id, r.profile.name]), [[asked.data.id, "Dad"]]);
  assert.equal((await api.get("/family", m.momMe)).data.move_requests_pending, 1);
  const oldSession = (await api.post("/v1/sessions/start", { deviceKey: m.dadPhone.key, profileId: m.dad })).data.sessionToken;
  const copied = await session(m.f.id, m.dad);
  assert.equal((await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe)).data.ok, true);

  assert.deepEqual(said(await api.get("/family", device(m.dadPhone.key))), ["signed_out", SIGNED_OUT]);
  assert.equal((await api.get("/v1/me", bearer(oldSession))).status, 401, "the lost phone's session ends at once");
  assert.equal((await api.get("/v1/me", bearer(copied))).status, 401, "and any old session with no phone on it");
  const onNew = await api.get("/family", device(m.newPhone.key));
  assert.equal(onNew.data.device_profile_id, m.dad);
  assert.equal(await count("messages", "family_id = $1", [m.f.id]), 0);
  const mine = await api.get("/move-requests/mine", device(m.newPhone.key));
  assert.deepEqual([mine.data.status, mine.data.let_in_by], ["approved", "Mom"]);
  assert.equal((await api.post("/v1/sessions/start", { deviceKey: m.newPhone.key, profileId: m.dad })).status, 200, "the new phone can start one");
});

test("only a phone that just joined can ask, and only to be someone in the family now", { skip }, async () => {
  const m = await moving();
  assert.equal((await api.post("/move-requests", { profile_id: m.dad }, m.momMe)).status, 400);
  const removed = await makePerson(m.f.id, "Removed");
  await db().query(`update people set removed_at = now() where id = $1`, [removed]);
  assert.equal((await api.post("/move-requests", { profile_id: removed }, m.asker)).status, 404);
  assert.equal((await api.post("/move-requests", { profile_id: "not-an-id" }, m.asker)).status, 400);
  const other = await makeFamily();
  const stranger = await makePerson(other.id, "Stranger");
  assert.equal((await api.post("/move-requests", { profile_id: stranger }, m.asker)).status, 404);
});

test("asking again: the same person returns the same ask; someone else replaces it", { skip }, async () => {
  const m = await moving();
  const first = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  assert.equal((await api.post("/move-requests", { profile_id: m.dad }, m.asker)).data.id, first.data.id);
  const other = await api.post("/move-requests", { profile_id: m.mom }, m.asker);
  assert.notEqual(other.data.id, first.data.id);
  assert.equal((await row("move_requests", "id = $1", [first.data.id])).status, "declined");
});

test("two taps at once make one ask: same person returns it", { skip }, async () => {
  const m = await moving();
  const replies = await Promise.all([api.post("/move-requests", { profile_id: m.dad }, m.asker), api.post("/move-requests", { profile_id: m.dad }, m.asker)]);
  assert.deepEqual(replies.map((r) => r.status), [200, 200]);
  assert.equal(replies[0].data.id, replies[1].data.id);
  assert.equal(await count("move_requests", "device_id = $1 and status = 'pending'", [m.newPhone.id]), 1);
});

test("an ask expires after 7 days: it reads expired, can't be answered, and the phone can ask again", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  await db().query(`update move_requests set created_at = now() - interval '8 days' where id = $1`, [asked.data.id]);
  assert.equal((await api.get("/move-requests/mine", m.asker)).data.status, "expired");
  assert.deepEqual((await api.get("/move-requests", m.momMe)).data, []);
  const late = await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe);
  assert.equal(late.status, 410);
  assert.deepEqual(said(late), ["gone", "That request expired."]);
  const again = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  assert.notEqual(again.data.id, asked.data.id);
});

test("two people answer at once: the first wins, the other gets 409", { skip }, async () => {
  const m = await moving();
  const aunt = await makePerson(m.f.id, "Aunt", "cook", { created: LONG_AGO });
  const auntPhone = await makeDevice(m.f.id, aunt, "apple", LONG_AGO);
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  const replies = await Promise.all([
    api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe),
    api.post(`/move-requests/${asked.data.id}/approve`, {}, device(auntPhone.key, aunt)),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await row("devices", "id = $1", [m.newPhone.id])).person_id, m.dad);
});

test("GET /move-requests/mine names who can let them in (settled, on their own phone), then who did", { skip }, async () => {
  const m = await moving();
  const fresh = await makePerson(m.f.id, "Fresh");
  await makeDevice(m.f.id, fresh);
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  const mine = await api.get("/move-requests/mine", m.asker);
  assert.deepEqual(mine.data.asked, ["Mom"]);
  assert.equal(mine.data.let_in_by, null);
  await api.post(`/move-requests/${asked.data.id}/decline`, {}, m.momMe);
  assert.equal((await api.get("/move-requests/mine", m.asker)).data.status, "declined");
  assert.equal((await api.get("/move-requests/mine", device(m.momPhone.key))).data, null);
});

test("only settled people answer asks: a day after their first phone joined, or the family's first person", { skip }, async () => {
  const m = await moving();
  const fresh = await makePerson(m.f.id, "Fresh");
  const freshPhone = await makeDevice(m.f.id, fresh);
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  const refused = await api.post(`/move-requests/${asked.data.id}/approve`, {}, device(freshPhone.key, fresh));
  assert.equal(refused.status, 403);
  assert.deepEqual(said(refused), ["forbidden", "You can do this after your first day here."]);
  assert.deepEqual((await api.get("/move-requests", device(freshPhone.key, fresh))).data, []);

  const other = await makeFamily();
  const founder = await makePerson(other.id, "Founder");
  const founderPhone = await makeDevice(other.id, founder);
  const can = await api.get("/family", device(founderPhone.key, founder));
  assert.equal(can.data.can_manage, true, "the family's first person is settled from the start");
});

test("the family's first person stays first after leaving: it never passes to whoever joined last", { skip }, async () => {
  const other = await makeFamily();
  const founder = await makePerson(other.id, "Founder", "cook", { created: LONG_AGO });
  const later = await makePerson(other.id, "Later");
  const laterPhone = await makeDevice(other.id, later);
  await db().query(`update people set removed_at = now() where id = $1`, [founder]);
  assert.equal((await api.get("/family", device(laterPhone.key, later))).data.can_manage, false);
});

test("only someone on their own phone can answer: not a lent phone, not the family code", { skip }, async () => {
  const m = await moving();
  const grandma = await makePerson(m.f.id, "Grandma", "cook", { created: LONG_AGO });
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  const lent = await api.post(`/move-requests/${asked.data.id}/approve`, {}, device(m.momPhone.key, grandma));
  assert.equal(lent.status, 403);
  assert.equal(lent.data.error, "forbidden");
  assert.match(lent.data.message, /own phone/);
  const byCode = await api.post(`/move-requests/${asked.data.id}/approve`, {}, { "x-family-code": m.f.code, "x-profile-id": grandma });
  assert.equal(byCode.status, 403);
});

test("nobody lets themselves in", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.mom }, m.asker);
  assert.equal((await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe)).status, 400);
});

test("approving for a phone that stopped waiting: 409, the ask is declined, nobody is signed out", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  await db().query(`update devices set revoked_at = now() where id = $1`, [m.newPhone.id]);
  const res = await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe);
  assert.equal(res.status, 409);
  assert.deepEqual(said(res), ["conflict", "That phone isn't waiting anymore."]);
  assert.equal((await row("move_requests", "id = $1", [asked.data.id])).status, "declined");
  assert.equal((await api.get("/family", device(m.dadPhone.key))).status, 200);
});

test("decline: the ask closes with no note, and the phone can ask again", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  assert.equal((await api.post(`/move-requests/${asked.data.id}/decline`, {}, m.momMe)).data.ok, true);
  const twice = await api.post(`/move-requests/${asked.data.id}/decline`, {}, m.momMe);
  assert.equal(twice.status, 409);
  assert.deepEqual(said(twice), ["answered", "Already handled."]);
  assert.equal(await count("messages", "family_id = $1", [m.f.id]), 0);
  assert.equal((await api.post("/move-requests", { profile_id: m.dad }, m.asker)).status, 200);
});

test("removing someone closes asks to be them", { skip }, async () => {
  const m = await moving();
  const asked = await api.post("/move-requests", { profile_id: m.dad }, m.asker);
  await api.post(`/profiles/${m.dad}/remove`, {}, device(m.dadPhone.key, m.dad));
  assert.equal((await api.get("/move-requests/mine", m.asker)).data.status, "declined");
  assert.deepEqual((await api.get("/move-requests", m.momMe)).data, []);
  assert.equal((await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe)).status, 409);
});

test("another family's ask is the same answer as none", { skip }, async () => {
  const m = await moving();
  const other = await moving();
  const asked = await api.post("/move-requests", { profile_id: other.dad }, other.asker);
  assert.equal((await api.post(`/move-requests/${asked.data.id}/approve`, {}, m.momMe)).status, 404);
  assert.equal((await row("move_requests", "id = $1", [asked.data.id])).status, "pending");
  await clearLimits();
});
