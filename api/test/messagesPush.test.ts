// Pushes on real Postgres with a fake Expo: convex/push.test.ts, convex/links.test.ts's pushEvents, and the notify() and message-push tests from
// supabase/tests/retention_test.ts and api_test.ts. Convex's and Supabase's kinds keep their own rules (SCHEMA.md), so both sets of tests run.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, tx } from "../src/db.js";
import { purgeDishForPerson } from "../src/modules/dish/account.js";
import { deliver, queuePush, RECEIPTS_AFTER_MS, type PushInput } from "../src/modules/messages/push.js";
import { deadReceipts, EXPO_RECEIPTS_URL, sendExpoPush } from "../src/modules/messages/expo.js";
import { CRAVINGS_PER_DAY, DAILY_MAX } from "../src/modules/messages/push.js";
import { quietDelayMs } from "../src/modules/messages/pushRules.js";
import { pushWords } from "../src/modules/messages/pushWords.js";
import { daily } from "../src/modules/messages/tasks.js";
import { handleMessage } from "../src/scheduled.js";
import { CHILI, circleOf, closeAll, DAL, drain, drainTwice, dueNow, get, logOf, ok, pairOf, person, phone, post, pushes, RICE, say, silent, skip, text, tokenFor, tokensOf, uploaded, type Who, type World, world } from "./messagesHelpers.js";

const push = (personId: string, over: Partial<PushInput> = {}, now = new Date()) =>
  tx((c) =>
    queuePush(c, {
      personId,
      kind: "answered",
      title: "Mom answered",
      body: "Tap to hear how Mom makes tomato egg.",
      url: "/dish/abc",
      dedupeKey: `k-${Math.random()}`,
      ...over,
    }, now),
  );

const nudge = (dedupeKey: string): Partial<PushInput> => ({ kind: "table_nudge", appInitiated: true, dedupeKey, title: "Mom", body: "Your week is open.", url: "/kid/home" });
const chat = { kind: "message", appInitiated: false, title: "Mom", body: "Hi", url: "/chat/x" };

test("register moves a phone's token to whoever signed in last, and keeps 5 per person", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "a", "Asia/Kolkata");
  assert.deepEqual((await tokensOf(w.dad.id)).map((r) => [r.token, r.tz]), [[tokenFor("a"), "Asia/Kolkata"]]);
  await phone(w, w.leo, "a", "Not/AZone");
  assert.equal((await tokensOf(w.dad.id)).length, 0);
  const [moved] = await tokensOf(w.leo.id);
  assert.deepEqual([moved.token, moved.tz], [tokenFor("a"), null]);
  for (let i = 0; i < 7; i += 1) await phone(w, w.dad, `dad${i}`);
  assert.deepEqual((await tokensOf(w.dad.id)).map((r) => r.token).sort(), [2, 3, 4, 5, 6].map((i) => tokenFor(`dad${i}`)));
  const bad = await post(w.app, w.dad, "/v1/push-tokens", { token: "nope", platform: "ios" }, { key: null });
  assert.deepEqual([bad.status, bad.data.error, bad.data.field], [400, "invalid", "token"]);
  const web = await post(w.app, w.dad, "/v1/push-tokens", { token: tokenFor("a"), platform: "web" }, { key: null });
  assert.deepEqual([web.status, web.data.error, web.data.field], [400, "invalid", "platform"]);
});

test("unregister drops a token only within the caller's family", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "a");
  ok(await post(w.app, w.stranger, "/v1/push-tokens/remove", { token: tokenFor("a") }, { key: null }));
  assert.equal((await tokensOf(w.dad.id)).length, 1);
  ok(await post(w.app, w.leo, "/v1/push-tokens/remove", { token: tokenFor("a") }, { key: null })); // same family
  assert.equal((await tokensOf(w.dad.id)).length, 0);
});

test("a token registers to the session's phone, so signing that phone out stops its pushes", { skip }, async () => {
  const w = await world();
  const { rows } = await db().query(
    `insert into devices (family_id, person_id, key_hash, via) values ($1, $2, repeat('a', 64), 'apple') returning id`,
    [w.family, w.leo.id],
  );
  await db().query(`update sessions set device_id = $1 where person_id = $2`, [rows[0].id, w.leo.id]);
  await phone(w, w.leo, "leo");
  assert.equal((await tokensOf(w.leo.id))[0].device_id, rows[0].id);
  await db().query(`update devices set revoked_at = now() where id = $1`, [rows[0].id]);
  assert.equal(await push(w.leo.id), "none");
  assert.equal((await tokensOf(w.leo.id)).length, 0, "a signed-out phone's token is dropped");
});

test("a push goes to every phone with the Supabase profile id, then receipts clean dead tokens", { skip }, async () => {
  const w = await world();
  const leo = await person(w.family, "Lea", "kid", { supabaseId: "p-leo" });
  await phone(w, leo, "a");
  await phone(w, leo, "b");
  w.expo.deadInReceipts.add(tokenFor("b"));
  assert.equal(await push(leo.id, { dedupeKey: "answered:abc:1" }), "queued");
  await drain();
  assert.equal(w.expo.sent.length, 1);
  assert.deepEqual(w.expo.sent[0].map((m) => m.to).sort(), [tokenFor("a"), tokenFor("b")]);
  const [m] = w.expo.sent[0];
  assert.deepEqual([m.title, m.sound, m.priority, m.channelId, m.data], ["Mom answered", "default", "high", "default", { url: "/dish/abc", kind: "answered", profile_id: "p-leo" }]);
  const [log] = await logOf(leo.id);
  assert.equal(log.status, "sent");
  assert.equal(log.tickets.length, 2);
  // The receipts check runs RECEIPTS_AFTER_MS later and drops the token Expo reported gone.
  assert.equal(RECEIPTS_AFTER_MS, 15 * 60_000);
  assert.equal((await tokensOf(leo.id)).length, 2, "not yet");
  await dueNow();
  await drain();
  assert.deepEqual((await tokensOf(leo.id)).map((r) => r.token), [tokenFor("a")]);
});

test("a ticket that says the device is gone drops that token at once", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  w.expo.dead.add(tokenFor("a"));
  await push(w.leo.id);
  await drain();
  assert.equal((await tokensOf(w.leo.id)).length, 0);
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.status, log.error], ["failed", "gone"]);
});

test("dedupe, no phone, and Expo down", { skip }, async () => {
  const w = await world();
  assert.equal(await push(w.dad.id, { dedupeKey: "same" }), "none"); // no token yet: logged, not sent
  await phone(w, w.leo, "a");
  assert.equal(await push(w.leo.id, { dedupeKey: "same" }), "queued");
  assert.equal(await push(w.leo.id, { dedupeKey: "same" }), "dup");
  w.expo.down = true;
  await drain();
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.status, log.error], ["failed", "HTTP 503"]);
  assert.equal((await tokensOf(w.leo.id)).length, 1); // a failed send is never a dead token
});

test("a craving waits out quiet hours on the parent's clock, and at most 3 a day reach her", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "a", "America/Los_Angeles");
  const late = new Date("2030-10-30T06:30:00Z"); // 23:30 in Los Angeles
  assert.equal(await push(w.dad.id, { kind: "craving" }, late), "queued");
  const [first] = await logOf(w.dad.id);
  assert.equal(first.send_at.toISOString(), "2030-10-30T15:00:00.000Z"); // 08:00 there
  assert.equal(await push(w.dad.id, { kind: "answered" }, late), "queued"); // other kinds go now
  await push(w.dad.id, { kind: "craving" }, late);
  await push(w.dad.id, { kind: "craving" }, late);
  assert.equal(await push(w.dad.id, { kind: "craving" }, late), "capped");
  assert.equal(CRAVINGS_PER_DAY, 3);
  await drain();
  assert.equal(w.expo.sent.flat().length, 1, "only the answer has gone: the cravings wait in the outbox");
  await dueNow();
  await drain();
  assert.equal(w.expo.sent.flat().length, 4); // 3 cravings + the answer; the capped one never went
});

test("at most 20 pushes a day to one person, among Convex's kinds; a busy chat doesn't use them up", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  for (let i = 0; i < 30; i += 1) assert.equal(await push(w.leo.id, chat), "queued");
  for (let i = 0; i < DAILY_MAX; i += 1) assert.equal(await push(w.leo.id), "queued");
  assert.equal(await push(w.leo.id), "capped");
  assert.equal(await push(w.leo.id, {}, new Date(Date.now() + 24 * 3600 * 1000 + 60_000)), "queued");
});

test("a deleted account gets nothing, and a queued push isn't sent", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  await push(w.leo.id);
  await db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [w.leo.id]);
  assert.equal(await push(w.leo.id), "gone");
  await drain();
  assert.equal(w.expo.sent.length, 0);
});

test("notify skips removed & memorial people, and people with no phones", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  await db().query(`update people set removed_at = now() where id = $1`, [w.leo.id]);
  assert.equal(await push(w.leo.id, chat), "gone");
  const gran = await person(w.family, "Gran", "cook", { memorial: true });
  await phone(w, gran, "gran");
  assert.equal(await push(gran.id, chat), "gone");
  assert.equal(await push(w.nia.id, chat), "none");
  assert.equal((await logOf(w.nia.id)).length, 0, "Supabase's kinds log nothing without a phone");
});

test("notify: app-initiated pushes are capped & skipped in quiet hours (logged), person ones aren't", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a", "America/Los_Angeles");
  const at = (s: string) => new Date(s);
  // Saturday 22:00: quiet. Logged as skipped, with its key, nothing sent.
  assert.equal(await push(w.leo.id, nudge("n:sat"), at("2030-10-19T22:00:00-07:00")), "quiet");
  assert.equal((await logOf(w.leo.id)).at(-1).skipped_reason, "quiet");
  // A skipped push doesn't use up the cap: Sunday 17:10 goes out.
  assert.equal(await push(w.leo.id, nudge("n:sun"), at("2030-10-20T17:10:00-07:00")), "queued");
  // A second app-initiated push the same local day is capped.
  assert.equal(await push(w.leo.id, nudge("n:sun2"), at("2030-10-20T18:00:00-07:00")), "daily");
  // A person's message still goes out, even at night.
  assert.equal(await push(w.leo.id, chat, at("2030-10-20T23:30:00-07:00")), "queued");
  // The same key as a skipped push is a dup, not a second try.
  assert.equal(await push(w.leo.id, nudge("n:sat"), at("2030-10-19T12:00:00-07:00")), "dup");
});

test("two app-initiated pushes at once can't both fit under a cap", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a", "America/Los_Angeles");
  const sun = new Date("2030-10-20T17:10:00-07:00");
  const out = await Promise.all([push(w.leo.id, nudge("x:1"), sun), push(w.leo.id, nudge("x:2"), sun), push(w.leo.id, nudge("x:3"), sun)]);
  assert.deepEqual(out.sort(), ["daily", "daily", "queued"]);
});

test("the same push delivered twice reaches Expo once, and a holder that died can be taken over", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  await push(w.leo.id);
  await drainTwice();
  assert.equal(w.expo.sent.flat().length, 1);

  await push(w.leo.id);
  const [log] = (await logOf(w.leo.id)).filter((r) => r.status === "queued");
  await db().query(`update push_log set delivering_at = now() where id = $1`, [log.id]);
  await deliver(log.id);
  assert.equal(w.expo.sent.flat().length, 1, "someone is sending it");
  await db().query(`update push_log set delivering_at = now() - interval '5 minutes' where id = $1`, [log.id]);
  await deliver(log.id);
  assert.equal(w.expo.sent.flat().length, 2, "they died: taken over");
});

test("a sent push's words come off the log, and an Expo error never keeps a token", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "a");
  await push(w.leo.id, { body: "SECRET-WORDS" });
  await drain();
  const [log] = await logOf(w.leo.id);
  assert.deepEqual([log.title, log.body], [null, null]);
  const { tickets } = await sendExpoPush(
    [{ to: tokenFor("a"), title: "t", body: "b", sound: "default", priority: "high", channelId: "default", data: { url: "/", kind: "message", profile_id: "p" } }],
    { fetch: (async () => Response.json({ data: [{ status: "error", message: `"${tokenFor("a")}" is not registered`, details: { error: "DeviceNotRegistered" } }] })) as typeof fetch },
  );
  assert.equal(JSON.stringify(tickets).includes(tokenFor("a")), false);
});

test("Expo's receipts: dead ids only; a failure reads as none", { skip: false }, async () => {
  const fetchOk = (async (url: string, init?: RequestInit) => {
    assert.equal(url, EXPO_RECEIPTS_URL);
    const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
    return Response.json({ data: Object.fromEntries(ids.map((id) => [id, id === "dead" ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok" }])) });
  }) as unknown as typeof fetch;
  assert.deepEqual(await deadReceipts(["ok", "dead"], { fetch: fetchOk }), ["dead"]);
  assert.deepEqual(await deadReceipts([], { fetch: fetchOk }), []);
  assert.deepEqual(await deadReceipts(["x"], { fetch: (async () => new Response("down", { status: 503 })) as typeof fetch }), []);
  assert.deepEqual(await deadReceipts(["x"], { fetch: (async () => Promise.reject(new TypeError("off"))) as typeof fetch }), []);
});

test("a push that won't go keeps no words: no phone and capped, as skipped already does", { skip }, async () => {
  const w = await world();
  // A craving names the kid. With no phone, it logs `none`.
  assert.equal(await push(w.dad.id, { kind: "craving", title: "SECRET-KID wants your dal", body: "Show SECRET-KID how you make it." }), "none");
  assert.deepEqual((await logOf(w.dad.id)).map((r) => [r.status, r.title, r.body]), [["none", null, null]]);
  // Past the day's cravings, it logs `capped`.
  await phone(w, w.dad, "dad");
  for (let i = 0; i < CRAVINGS_PER_DAY; i += 1) await push(w.dad.id, { kind: "craving", title: "ok", body: "ok" });
  assert.equal(await push(w.dad.id, { kind: "craving", title: "SECRET-KID wants your dal", body: "Show SECRET-KID how you make it." }), "capped");
  const capped = (await logOf(w.dad.id)).find((r) => r.status === "capped");
  assert.deepEqual([capped.title, capped.body], [null, null]);
  assert.ok(!JSON.stringify(await logOf(w.dad.id)).includes("SECRET-KID"));
});

test("the log is pruned after 40 days", { skip }, async () => {
  const w = await world();
  await push(w.leo.id);
  await db().query(`update push_log set created_at = now() - interval '41 days'`);
  await push(w.leo.id);
  await daily();
  assert.equal((await logOf(w.leo.id)).length, 1);
});

test("quiet hours are 21:00 to 08:00 on the person's clock", () => {
  const at = (iso: string, tz: string) => quietDelayMs(Date.parse(iso), tz) / 60_000;
  assert.equal(at("2026-10-29T19:00:00Z", "America/Los_Angeles"), 0); // noon
  assert.equal(at("2026-10-30T04:00:00Z", "America/Los_Angeles"), 11 * 60); // 21:00
  assert.equal(at("2026-10-30T14:59:00Z", "America/Los_Angeles"), 1); // 07:59
  assert.equal(at("2026-10-29T16:00:00Z", "Asia/Kolkata"), 10.5 * 60); // 21:30 there
  assert.equal(at("2026-10-29T19:00:00Z", "Bogus/Zone"), 0); // unknown zone reads as Los Angeles
});

test("push words follow the recipient's language", () => {
  const vars = { kid: "Caleb", dish: "braised pork", relation: "Mom", name: "Caleb" };
  assert.deepEqual(pushWords("craving", undefined, vars), { title: "Caleb wants your braised pork", body: "Show Caleb how you make it." });
  assert.equal(pushWords("craving", "hi", vars).title, "Caleb को आपका braised pork चाहिए");
  assert.equal(pushWords("craving", "mr", vars).title, "Caleb को आपका braised pork चाहिए"); // Marathi reads as Hindi
  assert.equal(pushWords("craving", "fr", vars).title, "Caleb wants your braised pork"); // no words yet: English
  assert.equal(pushWords("craving", "hi", { dish: "braised pork" }).title, "Your kid wants your braised pork");
  assert.equal(pushWords("joined", "en", vars, "cook").title, "Caleb is on homecookd");
  assert.deepEqual(pushWords("joined", "en", { name: "Mom" }, "kid"), { title: "Mom joined your kitchen", body: "You're in the same kitchen now." });
  assert.deepEqual(pushWords("answered", "en", vars), { title: "Mom answered", body: "Tap to hear how Mom makes braised pork." });
});

// --- pushes for messages

test("retention: a text pushes the other person once, with the sender's name and the chat; never the sender", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  await phone(w, w.mom, "mom");
  const pair = await pairOf(w, w.mom, w.dad);
  const sent = await text(w, w.mom, pair, "Dinner at 6?");
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("dad"), "Mom", "Dinner at 6?", `/chat/${pair}`]]);
  assert.deepEqual((await logOf(w.dad.id)).map((r) => [r.kind, r.app_initiated, r.dedupe_key]), [["message", false, `message:${sent.id}`]]);
  // No phone with push on: nothing sent, nothing logged.
  await db().query(`delete from push_tokens where person_id = $1`, [w.dad.id]);
  await text(w, w.mom, pair, "Again?");
  await drain();
  assert.equal(w.expo.sent.flat().length, 1);
  assert.equal((await logOf(w.dad.id)).length, 1);
});

test("the same message's push task running twice sends once", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "Dinner at 6?");
  await drainTwice();
  assert.equal(w.expo.sent.flat().length, 1);
});

test("retention: a dead token is pruned; Expo's answer never fails the send", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dead");
  await phone(w, w.dad, "alive");
  w.expo.dead.add(tokenFor("dead"));
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "Hi");
  await drain();
  assert.deepEqual(w.expo.sent.flat().map((m) => m.to).sort(), [tokenFor("alive"), tokenFor("dead")]);
  assert.deepEqual((await tokensOf(w.dad.id)).map((t) => t.token), [tokenFor("alive")]);
});

test("Expo down: the message still landed, and the failure is on the log", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  w.expo.down = true;
  const pair = await pairOf(w, w.mom, w.dad);
  const sent = await text(w, w.mom, pair, "Hi");
  await drain();
  assert.equal((await logOf(w.dad.id))[0].status, "failed");
  assert.equal(ok(await get(w.app, w.dad, `/v1/threads/${pair}/messages`)).messages[0].id, sent.id);
});

test("retention: a circle question pushes the cooks but the asker, naming the dish; a 1:1 question only the one asked", { skip }, async () => {
  const w = await world();
  await phone(w, w.mom, "mom");
  await phone(w, w.dad, "dad");
  await phone(w, w.leo, "leo");
  const ring = await circleOf(w);
  ok(await say(w, w.leo, ring, { kind: "question", body: "How long do the beans soak?", libraryId: CHILI, stepOrder: 2 }));
  await drain();
  assert.deepEqual(pushes(w.expo).sort(), [
    [tokenFor("dad"), "Leo asked about Dad's Sunday Chili", "How long do the beans soak?", `/chat/${ring}`],
    [tokenFor("mom"), "Leo asked about Dad's Sunday Chili", "How long do the beans soak?", `/chat/${ring}`],
  ]);
  assert.deepEqual((await logOf(w.mom.id)).map((r) => r.kind), ["question"]);

  w.expo.sent.length = 0;
  const pair = await pairOf(w, w.leo, w.dad);
  ok(await say(w, w.leo, pair, { kind: "step", libraryId: CHILI, stepOrder: 3, body: "Lid on?" }));
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("dad"), "Leo asked about Dad's Sunday Chili", "Lid on?", `/chat/${pair}`]]);
  // A circle text goes to everyone else in the family.
  w.expo.sent.length = 0;
  await text(w, w.dad, ring, "Overnight.");
  await drain();
  assert.deepEqual(pushes(w.expo).map((x) => [x[0], x[1]]).sort(), [[tokenFor("leo"), "Dad"], [tokenFor("mom"), "Dad"]]);
});

test("retention: in the circle, 'Just like mine' goes only to whoever made the dish; never to a maker who has left the family", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  await phone(w, w.dad, "dad");
  const ring = await circleOf(w);
  const made = ok(await say(w, w.leo, ring, { kind: "cooked", libraryId: DAL }));
  await drain();
  w.expo.sent.length = 0;
  ok(await say(w, w.mom, ring, { kind: "reaction", body: "just_like_mine", replyTo: made.id, libraryId: DAL }));
  await drain();
  assert.deepEqual(w.expo.sent.flat().map((m) => m.to), [tokenFor("leo")]);

  const again = ok(await say(w, w.leo, ring, { kind: "cooked", libraryId: DAL }));
  await db().query(`update people set removed_at = now() where id = $1`, [w.leo.id]);
  w.expo.sent.length = 0;
  ok(await say(w, w.mom, ring, { kind: "reaction", body: "just_like_mine", replyTo: again.id, libraryId: DAL }));
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);
});

test("a deleted sender's queued message push does nothing", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "Hi");
  await db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [w.mom.id]);
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);
});

// --- postcards

async function made(w: World, who: Who, thread: string, library = CHILI) {
  return ok(await say(w, who, thread, { kind: "cooked", libraryId: library }));
}

test("PR 3: the postcard goes on my own cooked message: photo & rating, one push to the dish's cook; again replaces", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  await phone(w, w.mom, "mom");
  await phone(w, w.leo, "leo");
  const pair = await pairOf(w, w.leo, w.dad);
  const card = await made(w, w.leo, pair);
  assert.deepEqual([card.photoUrl, card.rating], [null, null]);
  await drain();
  assert.equal(w.expo.sent.flat().length, 0); // a cooked message alone pushes nobody

  const photo = await uploaded(w, w.leo, "photo");
  const sent = ok(await post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey: photo, rating: 4 }));
  assert.deepEqual([sent.id, sent.kind, sent.rating, sent.threadId], [card.id, "cooked", 4, pair]);
  assert.match(sent.photoUrl, /fake-s3/);
  assert.ok(!Object.keys(sent).includes("photoKey"), "the key never leaves the server");
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("dad"), "Leo made your Sunday Chili", "Sent you a postcard.", "/parent/home"]]);
  assert.deepEqual((await logOf(w.dad.id)).map((r) => [r.kind, r.app_initiated, r.dedupe_key]), [["postcard", false, `postcard:${card.id}`]]);

  // "Take another": a new photo and no rating replace both; still one card, still one push. The old photo goes.
  const another = await uploaded(w, w.leo, "photo");
  const second = ok(await post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey: another }));
  assert.equal(second.rating, null);
  await drain();
  assert.equal(w.expo.sent.flat().length, 1);
  assert.equal((await db().query(`select count(*)::int as n from messages where kind = 'cooked'`)).rows[0].n, 1);
  assert.notEqual((await db().query(`select delete_requested_at from files where key = $1`, [photo])).rows[0].delete_requested_at, null);
  // The same photo again is a retry, not a held file.
  ok(await post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey: another, rating: 5 }));

  // Dad reads it in the chat and in his inbox's `last`.
  const inbox = ok(await get(w.app, w.dad, "/v1/threads")).threads.find((t: any) => t.id === pair);
  assert.deepEqual([inbox.last.id, !!inbox.last.photoUrl, inbox.postcards], [card.id, true, 1]);

  // Dad answers with "Just like mine" and a voice note held down on the card: both reach Leo; the voice note answers no question and is saved to no recipe.
  w.expo.sent.length = 0;
  ok(await say(w, w.dad, pair, { kind: "reaction", body: "just_like_mine", replyTo: card.id, libraryId: CHILI }));
  const voice = ok(await say(w, w.dad, pair, { kind: "voice", audioKey: await uploaded(w, w.dad), durationS: 5, replyTo: card.id }));
  assert.deepEqual([voice.replyTo, voice.savedToRecipe], [card.id, false]);
  await drain();
  assert.deepEqual(pushes(w.expo).map((x) => [x[0], x[1], x[2]]), [
    [tokenFor("leo"), "Dad", "“Just like mine.” on your Sunday Chili"],
    [tokenFor("leo"), "Dad", "Sent a voice note · 0:05"],
  ]);
});

test("PR 3: only my own cooked message, a photo of ours, a rating of 1-5; never after the cook left", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.leo, w.dad);
  const card = await made(w, w.leo, pair);
  const words = await text(w, w.leo, pair, "So good");
  const photo = await uploaded(w, w.leo, "photo");
  const send = (id: string, body: Record<string, unknown>, who: Who = w.leo) => post(w.app, who, `/v1/messages/${id}/postcard`, body);

  const notMine = await send(card.id, { photoKey: await uploaded(w, w.dad, "photo") }, w.dad);
  assert.deepEqual([notMine.status, notMine.data.error, notMine.data.message], [403, "forbidden", "Only whoever made the dish can send its postcard."]);
  const notDish = await send(words.id, { photoKey: photo });
  assert.deepEqual([notDish.status, notDish.data.error, notDish.data.field], [400, "invalid", "id"]);
  const noPhoto = await send(card.id, {});
  assert.deepEqual([noPhoto.status, noPhoto.data.error, noPhoto.data.field], [400, "invalid", "photoKey"]);
  for (const rating of [0, 6, 2.5, "4", true]) {
    const r = await send(card.id, { photoKey: photo, rating });
    assert.deepEqual([r.status, r.data.error, r.data.field], [400, "invalid", "rating"], JSON.stringify(rating));
  }
  assert.equal((await send("not a message", { photoKey: photo })).status, 404);
  assert.equal((await send("no-such-message", { photoKey: photo })).status, 404);
  // Nothing above wrote anything.
  assert.equal((await db().query(`select photo_key from messages where id = $1`, [card.id])).rows[0].photo_key, null);
  // The cook left the family: the 1:1 is read-only, postcard included.
  await db().query(`update people set removed_at = now() where id = $1`, [w.dad.id]);
  const gone = await send(card.id, { photoKey: photo });
  assert.deepEqual([gone.status, gone.data.error], [403, "other_left"]);
});

test("two postcards racing with different photos leave one, and mark the other: a replaced photo can't outlive its owner", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.leo, w.dad);
  for (let round = 0; round < 6; round += 1) {
    const card = await made(w, w.leo, pair);
    const [a, b] = [await uploaded(w, w.leo, "photo"), await uploaded(w, w.leo, "photo")];
    const send = (photoKey: string) => post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey });
    const replies = await Promise.all([send(a), send(b)]);
    assert.deepEqual(replies.map((r) => r.status), [200, 200]);
    const kept = (await db().query(`select photo_key from messages where id = $1`, [card.id])).rows[0].photo_key;
    const loser = kept === a ? b : a;
    const state = async (key: string) => (await db().query(`select delete_requested_at from files where key = $1`, [key])).rows[0].delete_requested_at;
    assert.notEqual(await state(loser), null, `round ${round}: the loser survived`);
    assert.equal(await state(kept), null);
  }
});

test("PR 3: the postcard limit: 60 an hour per person", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.leo, w.dad);
  const card = await made(w, w.leo, pair);
  await db().query(`insert into rate_hits (key, window_start, count) select key, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 60 from (select 'postcard:' || $1 as key) k`, [
    (await import("../src/rateLimit.js")).subjectKey(w.leo.id),
  ]);
  const r = await post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey: "x" });
  // The guard reads the file first, so a refused file is a 404 before the limit. With a real file it's a 429.
  assert.equal(r.status, 404);
  const photo = await uploaded(w, w.leo, "photo");
  assert.equal((await post(w.app, w.leo, `/v1/messages/${card.id}/postcard`, { photoKey: photo })).status, 429);
});

test("PR 3: the push names only the dish's cook: in the circle by name, never someone else's 1:1", { skip }, async () => {
  const w = await world();
  await phone(w, w.dad, "dad");
  await phone(w, w.mom, "mom");
  // A card about Dad's chili in the family circle: Dad, by the name on the dish.
  const ring = await circleOf(w);
  const inRing = await made(w, w.leo, ring);
  // Dad writes before the photo lands, so the card is no longer the circle's newest message.
  const reply = await text(w, w.dad, ring, "Looks so good");
  await drain();
  w.expo.sent.length = 0;
  ok(await post(w.app, w.leo, `/v1/messages/${inRing.id}/postcard`, { photoKey: await uploaded(w, w.leo, "photo"), rating: 5 }));
  await drain();
  assert.deepEqual(pushes(w.expo).map((x) => [x[0], x[1]]), [[tokenFor("dad"), "Leo made your Sunday Chili"]]);

  // `last` stays Dad's text; the postcard count is what tells his Home to look again.
  const row = ok(await get(w.app, w.dad, "/v1/threads")).threads.find((t: any) => t.kind === "circle");
  assert.deepEqual([row.last.id, row.postcards], [reply.id, 1]);

  // A card about Dad's chili in Leo's 1:1 with Mom: Mom isn't its cook, so nobody is told "your".
  w.expo.sent.length = 0;
  const withMom = await pairOf(w, w.leo, w.mom);
  const wrong = await made(w, w.leo, withMom);
  ok(await post(w.app, w.leo, `/v1/messages/${wrong.id}/postcard`, { photoKey: await uploaded(w, w.leo, "photo") }));
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);

  // With the library unreachable, a pair's other person if they're a cook.
  w.lib.down = true;
  const blind = ok(await say(w, w.leo, withMom, { kind: "cooked", libraryId: RICE }));
  ok(await post(w.app, w.leo, `/v1/messages/${blind.id}/postcard`, { photoKey: await uploaded(w, w.leo, "photo") }));
  await drain();
  assert.deepEqual(pushes(w.expo).map((x) => [x[0], x[1]]), [[tokenFor("mom"), "Leo made your recipe"]]);
});

// --- pushEvents

async function card(w: World, o: { person?: string; requestedOf?: string; dish?: string; kidName?: string; relation?: string }) {
  const { rows } = await db().query(
    `insert into dish_asks (kid_token_hash, ask_token_hash, dish, kid_name, relation, guess, message, status, person_id, requested_of, family_id)
     values (md5(random()::text) || md5(random()::text), md5(random()::text) || md5(random()::text), $1, $2, $3, '{}'::jsonb, 'Hi', 'asked', $4, $5, $6) returning id`,
    [o.dish ?? "braised pork", o.kidName ?? "Caleb", o.relation ?? "mom", o.person ?? null, o.requestedOf ?? null, w.family],
  );
  return rows[0].id as string;
}
const run = (payload: Record<string, unknown>) => handleMessage(JSON.stringify({ payload }), silent);

test("pushEvents: Mom answered goes to the kid, a craving to the parent, in their language", { skip }, async () => {
  const w = await world();
  const dad = await person(w.family, "Baba", "cook", { language: "hi" });
  await phone(w, w.leo, "leo");
  await phone(w, dad, "baba");
  const askId = await card(w, { person: w.leo.id });
  await run({ task: "push.dish_answered", askId });
  await run({ task: "push.dish_answered", askId }); // the same answer: once
  assert.deepEqual((await logOf(w.leo.id)).map((p) => p.kind), ["answered"]);
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("leo"), "Mom answered", "Tap to hear how Mom makes braised pork.", `/dish/${askId}`]]);

  w.expo.sent.length = 0;
  const asked = await card(w, { requestedOf: dad.id });
  await run({ task: "push.dish_requested", askId: asked });
  await dueNow();
  await drain();
  assert.deepEqual(pushes(w.expo).map((p) => [p[1], p[3]]), [["Caleb को आपका braised pork चाहिए", `/request/${asked}`]]);

  // A card no kid has claimed in the app: nothing to send.
  const web = await card(w, {});
  await run({ task: "push.dish_answered", askId: web });
  assert.equal((await db().query(`select count(*)::int as n from push_log`)).rows[0].n, 2);
});

test("a craving waiting for morning doesn't go if its kid or cook has deleted, and takes its words with it", { skip }, async () => {
  const words = async (askId: string, cook: string) => (await db().query(`select status, title, body from push_log where person_id = $1 and dedupe_key = $2`, [cook, `craving:${askId}`])).rows[0];
  const gone = { status: "none", title: null, body: null };
  const deleted = (id: string) => db().query(`update people set deleted_at = now(), name = 'Deleted', relation = null, avatar_key = null, email = null, tz = null, share_cooking = null, language = null where id = $1`, [id]);
  const waiting = async (w: World, o: { person?: string; requestedOf: string }) => {
    const askId = await card(w, o);
    await run({ task: "push.dish_requested", askId });
    assert.equal((await words(askId, o.requestedOf)).status, "queued");
    assert.match((await words(askId, o.requestedOf)).title, /Caleb/);
    return askId;
  };

  // The kid deleted and the purge hasn't run: the card still names them, and nothing goes.
  let w = await world();
  await phone(w, w.dad, "dad");
  const beforePurge = await waiting(w, { person: w.leo.id, requestedOf: w.dad.id });
  await deleted(w.leo.id);
  await dueNow();
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);
  assert.deepEqual(await words(beforePurge, w.dad.id), gone);

  // The purge ran with Dad still here: the card stays for him, the name comes off it, and the row's words go at once, not at 8:00.
  w = await world();
  await phone(w, w.dad, "dad");
  const afterPurge = await waiting(w, { person: w.leo.id, requestedOf: w.dad.id });
  await deleted(w.leo.id);
  await purgeDishForPerson(w.leo.id);
  assert.equal((await db().query(`select kid_name from dish_asks where id = $1`, [afterPurge])).rows[0].kid_name, null);
  assert.deepEqual(await words(afterPurge, w.dad.id), gone);
  await dueNow();
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);

  // The card itself is gone.
  w = await world();
  await phone(w, w.dad, "dad");
  const noCard = await waiting(w, { requestedOf: w.dad.id });
  await db().query(`delete from dish_asks where id = $1`, [noCard]);
  await dueNow();
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);
  assert.deepEqual(await words(noCard, w.dad.id), gone);

  // The cook deleted.
  w = await world();
  await phone(w, w.dad, "dad");
  const cookLeft = await waiting(w, { person: w.leo.id, requestedOf: w.dad.id });
  await deleted(w.dad.id);
  await dueNow();
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);
  assert.deepEqual(await words(cookLeft, w.dad.id), gone);

  // Nobody deleted: an anonymous kid's craving goes, and so does one that never had a name.
  w = await world();
  await phone(w, w.dad, "dad");
  await waiting(w, { requestedOf: w.dad.id });
  const nameless = await card(w, { requestedOf: w.dad.id });
  await db().query(`update dish_asks set kid_name = null where id = $1`, [nameless]);
  await run({ task: "push.dish_requested", askId: nameless });
  await dueNow();
  await drain();
  assert.deepEqual(pushes(w.expo).map((p) => p[1]).sort(), ["Caleb wants your braised pork", "Your kid wants your braised pork"]);
});

test("pushEvents: a recipe Mom filmed goes to the kid once", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  const askId = await card(w, { person: w.leo.id });
  await run({ task: "push.dish_filmed", askId, recipeId: "r1" });
  await run({ task: "push.dish_filmed", askId, recipeId: "r1" });
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("leo"), "Mom filmed braised pork", "Watch Mom make it.", "/recipe/r1"]]);
});

after(closeAll);
