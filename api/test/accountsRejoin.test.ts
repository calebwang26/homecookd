// Someone who left or moved and came back is a new person, tied to the old row only so that deleting them reaches it. Made-up data only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { db } from "../src/db.js";
import { startDeletion, runPurge } from "../src/modules/accounts/deletion.js";
import { Api, appleToken, bearer, count, device, freshDatabase, hasDatabase, type Keys, makeDevice, makeFamily, makeJoinLink, makePerson, row, setup } from "./accountsHelpers.js";

const skip = !hasDatabase;
let api: Api;
let keys: Keys;
const uniq = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;
const q = (sql: string, args: unknown[] = []) => db().query(sql, args);

before(async () => {
  if (skip) return;
  await freshDatabase();
  keys = await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

const signUp = async (sub: string, name: string) => {
  const res = await api.apple({ id_token: await appleToken(keys, sub), name, role: "cook" });
  assert.equal(res.status, 200);
  return { person: res.data.profile_id as string, key: res.data.device_key as string, family: (await row("people", "id = $1", [res.data.profile_id])).family_id as string };
};

const joinByLink = async (sub: string, name: string, extra: Record<string, unknown> = {}) => {
  const f = await makeFamily(`KEEP-${uniq("family")}`);
  await makePerson(f.id, "Someone here");
  const link = await makeJoinLink(f.id, null);
  const res = await api.apple({ id_token: await appleToken(keys, sub), join_token: link.token, name, role: "cook", ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { person: res.data.profile_id as string, key: res.data.device_key as string, family: f.id };
};

const said = async (family: string, sender: string, body: string) => {
  const { rows } = await q(`select id from threads where family_id = $1 and kind = 'circle'`, [family]);
  const thread = rows[0]?.id ?? (await q(`insert into threads (family_id, kind) values ($1, 'circle') returning id`, [family])).rows[0].id;
  await q(`insert into messages (family_id, thread_id, sender_id, kind, body) values ($1, $2, $3, 'text', $4)`, [family, thread, sender, body]);
};

const purgeAll = async (personId: string) => {
  const did = await startDeletion(personId, "person");
  const { rows } = await q(`select id from account_deletions where purged_at is null`);
  for (const r of rows) await runPurge(r.id, {});
  return did;
};

test("someone who moved: deleting the new person deletes the row they left behind, across families", { skip }, async () => {
  const sub = uniq("mover");
  const first = await signUp(sub, "Zed");
  await makeDevice(first.family, await makePerson(first.family, "A sibling, signed in"));
  await said(first.family, first.person, "SECRET-from-the-old-row");
  const moved = await joinByLink(sub, "Zed Two", { move: true });
  assert.notEqual(moved.person, first.person);
  assert.equal((await row("people", "id = $1", [moved.person])).previous_person_id, first.person);
  assert.ok((await row("people", "id = $1", [first.person])).removed_at);

  await purgeAll(moved.person);
  const old = await row("people", "id = $1", [first.person]);
  assert.deepEqual([old.name, !!old.deleted_at], ["Deleted", true]);
  assert.equal((await row("people", "id = $1", [moved.person])).previous_person_id, null, "a tombstone points at nothing");
  assert.equal(await count("messages", "body = 'SECRET-from-the-old-row'"), 0);
  assert.equal(await count("account_deletions", "person_id = $1", [first.person]), 1);
});

test("someone who left and signs in again: the same account finds the old row, and only a keyed hash was kept", { skip }, async () => {
  const sub = uniq("leaver");
  const first = await joinByLink(sub, "Asha");
  await said(first.family, first.person, "SECRET-before-she-left");
  assert.equal((await api.post(`/profiles/${first.person}/remove`, {}, device(first.key, first.person))).status, 200);

  const kept = await row("left_identities", "person_id = $1", [first.person]);
  assert.ok(kept);
  assert.ok(!JSON.stringify(kept).includes(sub), "never the subject");
  assert.equal(await count("identities", "person_id = $1", [first.person]), 0);

  const back = await signUp(sub, "Asha");
  assert.notEqual(back.person, first.person);
  assert.equal((await row("people", "id = $1", [back.person])).previous_person_id, first.person);
  assert.equal(await count("left_identities", "person_id = $1", [first.person]), 0, "used once");

  await purgeAll(back.person);
  assert.ok((await row("people", "id = $1", [first.person])).deleted_at);
  assert.equal(await count("messages", "body = 'SECRET-before-she-left'"), 0);
});

test("the link gives nothing: the old row stays out of reach, and someone else's account doesn't find it", { skip }, async () => {
  const sub = uniq("leaver");
  const first = await joinByLink(sub, "Asha");
  assert.equal((await api.post(`/profiles/${first.person}/remove`, {}, device(first.key, first.person))).status, 200);
  const stranger = await signUp(uniq("stranger"), "Other");
  assert.equal((await row("people", "id = $1", [stranger.person])).previous_person_id, null);

  const back = await signUp(sub, "Asha");
  const session = (await api.post("/v1/sessions/start", { deviceKey: back.key, profileId: back.person })).data.sessionToken;
  assert.equal((await api.get("/v1/me", bearer(session))).status, 200);
  const family = await api.get("/family", device(back.key, back.person));
  assert.ok(!JSON.stringify(family.data).includes(first.person), "the new person's family never shows the old row");
  assert.equal((await api.get("/family", device(first.key))).status, 401, "the old phone stays signed out");
  assert.equal((await row("people", "id = $1", [first.person])).family_id, first.family);
  assert.ok((await row("people", "id = $1", [first.person])).removed_at, "and the old row stays removed");
});

test("two moves: deleting the last person reaches both rows behind them", { skip }, async () => {
  const sub = uniq("twice");
  const one = await signUp(sub, "Zed");
  const two = await joinByLink(sub, "Zed Two", { move: true });
  const three = await joinByLink(sub, "Zed Three", { move: true });
  await purgeAll(three.person);
  for (const id of [one.person, two.person, three.person]) assert.ok((await row("people", "id = $1", [id])).deleted_at, id);
});

test("someone who deleted and comes back is a new person: nothing about them was kept to find", { skip }, async () => {
  const sub = uniq("deleted");
  const first = await joinByLink(sub, "Asha");
  await purgeAll(first.person);
  assert.equal(await count("left_identities", "person_id = $1", [first.person]), 0);
  const back = await signUp(sub, "Asha");
  assert.notEqual(back.person, first.person);
  assert.equal((await row("people", "id = $1", [back.person])).previous_person_id, null);
});

test("someone who left and later deletes through their old row leaves nothing behind", { skip }, async () => {
  const sub = uniq("left-then-gone");
  const first = await joinByLink(sub, "Asha");
  assert.equal((await api.post(`/profiles/${first.person}/remove`, {}, device(first.key, first.person))).status, 200);
  await purgeAll(first.person);
  assert.equal(await count("left_identities", "person_id = $1", [first.person]), 0, "the hash goes with the row");
});

test("the sync passes on one person and no more", { skip }, async () => {
  const sub = uniq("synced");
  const one = await signUp(sub, "Zed");
  const two = await joinByLink(sub, "Zed Two", { move: true });
  await startDeletion(two.person, "sync");
  assert.equal((await row("people", "id = $1", [one.person])).deleted_at, null);
});
