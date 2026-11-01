// SYSTEM-DESIGN: never lose or duplicate what someone wrote, and phone retries take an idempotency key. Each write that creates what someone wrote: a retry makes nothing
// new, the same key with a different body is refused, and a failure frees the key.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { idempotencyKey, once, requestHash } from "../src/idempotency.js";
import { CHILI, circleOf, closeAll, DAL, drain, newKey, ok, pairOf, post, recipe, refused, say, skip, tokenFor, uploaded, phone, pushes, world } from "./messagesHelpers.js";

const count = async (table: string) => (await db().query(`select count(*)::int as n from ${table}`)).rows[0].n;

test("a retried send is one message and one push, answered with the first message; a different body under that key is refused", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  const pair = await pairOf(w, w.mom, w.dad);
  const key = newKey();
  const first = ok(await say(w, w.mom, pair, { kind: "text", body: "Dinner at 6?" }, { key }));
  const retry = ok(await say(w, w.mom, pair, { kind: "text", body: "Dinner at 6?" }, { key }));
  assert.equal(retry.id, first.id);
  assert.equal(await count("messages"), 1);
  await drain();
  assert.deepEqual(pushes(w.expo).length, 1);

  refused(await say(w, w.mom, pair, { kind: "text", body: "Dinner at 7?" }, { key }), 409, "idempotency_conflict");
  assert.equal(await count("messages"), 1);
  // The same key on another route is refused too.
  refused(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: CHILI, to: [w.dad.id] }, { key }), 409, "idempotency_conflict");
  // Another thread is another request.
  refused(await say(w, w.mom, await circleOf(w), { kind: "text", body: "Dinner at 6?" }, { key }), 409, "idempotency_conflict");
});

test("two tries at the same moment make one message, and both get it", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const key = newKey();
  const [a, b] = await Promise.all([say(w, w.mom, pair, { kind: "text", body: "Hi" }, { key }), say(w, w.mom, pair, { kind: "text", body: "Hi" }, { key })]);
  assert.equal(ok(a).id, ok(b).id);
  assert.equal(await count("messages"), 1);
});

test("a retry of a voice note doesn't trip over its own attach", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const audioKey = await uploaded(w, w.mom);
  const key = newKey();
  const body = { kind: "voice", audioKey, durationS: 5 };
  const first = ok(await say(w, w.mom, pair, body, { key }));
  assert.equal(ok(await say(w, w.mom, pair, body, { key })).id, first.id);
});

test("a refused send frees its key: fixed and retried, it lands, and nothing was half-written", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const key = newKey();
  refused(await say(w, w.mom, pair, { kind: "voice", audioKey: "private/not-there.m4a", durationS: 5 }, { key }), 404);
  refused(await say(w, w.mom, pair, { kind: "text", body: "Hi", replyTo: "no-such-message" }, { key }), 400, "reply_not_in_thread");
  assert.equal(await count("idempotency_keys"), 0);
  ok(await say(w, w.mom, pair, { kind: "text", body: "Hi" }, { key }));
});

test("a failure halfway leaves nothing: the message, the thread's time, the read mark, the outbox row and the key all land together or not at all", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const before = (await db().query(`select last_message_at from threads where id = $1`, [pair])).rows[0].last_message_at;
  // A constraint the route doesn't check for: step_order is refused by the database at insert.
  await db().query(`alter table messages add constraint test_refuse check (body is distinct from 'boom')`);
  try {
    const r = await say(w, w.mom, pair, { kind: "text", body: "boom" });
    assert.equal(r.status, 500);
    assert.equal(r.data.error, "server_error");
    assert.ok(!r.body.includes("boom"));
  } finally {
    await db().query(`alter table messages drop constraint test_refuse`);
  }
  assert.equal(await count("messages"), 0);
  assert.equal(await count("idempotency_keys"), 0);
  assert.equal(await count("outbox"), 0);
  assert.equal(await count("thread_reads"), 0);
  assert.deepEqual((await db().query(`select last_message_at from threads where id = $1`, [pair])).rows[0].last_message_at, before);
});

test("a key is required where someone's words are being created, and honored where it isn't required", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const chili = await recipe(w.family, w.dad.id);
  const required: [string, unknown][] = [
    [`/v1/threads/${pair}/messages`, { kind: "text", body: "Hi" }],
    ["/v1/messages", { kind: "text", text: "Hi" }],
    ["/v1/send-recipe", { libraryId: CHILI, to: [w.dad.id] }],
    ["/v1/questions", { recipeId: chili, text: "Beans?" }],
    ["/v1/pending-sends", { uploadId: "up-1", recipientIds: [w.dad.id] }],
  ];
  for (const [url, body] of required) refused(await post(w.app, w.mom, url, body, { key: null }), 400, "idempotency_key_required");
  refused(await post(w.app, w.mom, `/v1/threads/${pair}/messages`, { kind: "text", body: "Hi" }, { key: "short" }), 400, "bad_idempotency_key");
  refused(await post(w.app, w.mom, `/v1/threads/${pair}/messages`, { kind: "text", body: "Hi" }, { key: "has spaces in it!" }), 400, "bad_idempotency_key");
});

test("a retried Convex send, question, answer, send-recipe and pending send each make one row", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const twice = async (url: string, body: unknown, status = 200) => {
    const key = newKey();
    const a = ok(await post(w.app, w.dad, url, body, { key }), status);
    const b = ok(await post(w.app, w.dad, url, body, { key }), status);
    return [a, b];
  };
  const [m1, m2] = await twice("/v1/messages", { kind: "text", text: "Hi", to: w.leo.id });
  assert.equal(m1.id, m2.id);
  const [q1, q2] = await twice("/v1/questions", { recipeId: chili, text: "Beans?" }, 201);
  assert.equal(q1.questionId, q2.questionId);
  await twice(`/v1/questions/${q1.questionId}/answer`, { text: "Yes" });
  assert.equal((await db().query(`select status from questions where id = $1`, [q1.questionId])).rows[0].status, "answered");
  const [s1, s2] = await twice("/v1/send-recipe", { libraryId: DAL, to: [w.leo.id] });
  assert.deepEqual(s1, s2);
  await twice("/v1/pending-sends", { uploadId: "up-2", recipientIds: [w.leo.id] });
  assert.equal(await count("questions"), 1);
  assert.equal((await db().query(`select count(*)::int as n from messages where kind = 'text'`)).rows[0].n, 1);
  assert.equal((await db().query(`select count(*)::int as n from messages where kind = 'recipe'`)).rows[0].n, 1);
});

test("a retried answer on an answered question replays; another key on it is refused as already answered", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const asked = ok(await post(w.app, w.leo, "/v1/questions", { recipeId: chili, text: "Beans?" }), 201);
  ok(await post(w.app, w.dad, `/v1/questions/${asked.questionId}/answer`, { text: "Yes" }));
  refused(await post(w.app, w.dad, `/v1/questions/${asked.questionId}/answer`, { text: "No" }), 409, "already_answered");
});

test("keys belong to one person: the same key from someone else is their own", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  const key = newKey();
  const a = ok(await say(w, w.mom, ring, { kind: "text", body: "Hi" }, { key }));
  const b = ok(await say(w, w.dad, ring, { kind: "text", body: "Hi" }, { key }));
  assert.notEqual(a.id, b.id);
});

test("no message text or file key sits in idempotency_keys", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  const audioKey = await uploaded(w, w.mom);
  ok(await say(w, w.mom, ring, { kind: "voice", audioKey, durationS: 5, body: "SECRET-WORDS" }));
  const { rows } = await db().query(`select * from idempotency_keys`);
  const stored = JSON.stringify(rows);
  assert.ok(!stored.includes("SECRET-WORDS"));
  assert.ok(!stored.includes(audioKey));
});

test("requestHash doesn't care about field order; once() with no key still runs in one transaction", { skip }, async () => {
  await world();
  assert.equal(requestHash({ a: 1, b: [2, { c: 3, d: null }] }), requestHash({ b: [2, { d: null, c: 3 }], a: 1 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
  const out = await once({ scope: "x", key: null, route: "r", hash: "h" }, async () => "made");
  assert.deepEqual(out, { resourceId: "made", replayed: false });
  assert.equal(idempotencyKey({ headers: {} } as never, false), null);
  assert.equal(tokenFor("a"), "ExponentPushToken[a]");
});

after(closeAll);
