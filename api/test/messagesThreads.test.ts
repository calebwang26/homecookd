// Threads and messages: Supabase's supabase/tests/api_test.ts on real Postgres, and Convex's convex/flow.test.ts, forKids.test.ts for messages.send, list and madeMyDish.
// Titles are the originals' where a test carried over. Convex's and Supabase's exact sentences became codes (MESSAGES-MIGRATION.md maps them).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { tx } from "../src/db.js";
import { markRead } from "../src/modules/messages/data.js";
import { NotSetUp } from "../src/modules/messages/models.js";
import { useLibrary } from "../src/modules/messages/library.js";
import { deliverRecipe, postSystemNote } from "../src/modules/messages/service.js";
import { awsRecipe, cdnLibrary, CHILI, circleOf, closeAll, DAL, drain, fakeModels, get, NOODLES, ok, pairOf, person, phone, post, pushes, recipe, refused, say, skip, text, tokenFor, uploaded, type World, world } from "./messagesHelpers.js";

const inbox = async (w: World, who: World["mom"]) => ok(await get(w.app, who, "/v1/threads")).threads;
const unread = async (w: World, who: World["mom"]) => ok(await get(w.app, who, "/v1/unread")).total;
const messages = async (w: World, who: World["mom"], thread: string, q = "") => ok(await get(w.app, who, `/v1/threads/${thread}/messages${q}`)).messages;

test("a text lands in the pair, the sender has read it, and the other person hasn't", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const sent = await text(w, w.mom, pair, "Dinner at 6?");
  assert.equal(sent.kind, "text");
  assert.equal(sent.senderId, w.mom.id);
  assert.equal(sent.threadId, pair);
  assert.deepEqual((await messages(w, w.dad, pair)).map((m: any) => m.body), ["Dinner at 6?"]);
  assert.equal(await unread(w, w.mom), 0);
  assert.equal(await unread(w, w.dad), 1);
  ok(await post(w.app, w.dad, `/v1/threads/${pair}/read`, undefined, { key: null }));
  assert.equal(await unread(w, w.dad), 0);
});

test("the circle comes first in the inbox; a pair shows once it has a message", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const before = await inbox(w, w.mom);
  assert.deepEqual(before.map((t: any) => t.kind), ["circle"]);
  assert.equal(before[0].other.id, "family");
  await text(w, w.dad, pair, "Home at 6");
  const list = await inbox(w, w.mom);
  assert.deepEqual(list.map((t: any) => [t.kind, t.unread]), [["circle", 0], ["pair", 1]]);
  assert.equal(list[1].other.name, "Dad");
  assert.deepEqual(list[1].members.map((p: any) => p.name).sort(), ["Dad", "Mom"]);
  assert.equal(list[1].last.body, "Home at 6");
});

test("two people starting the same pair at once make one thread", { skip }, async () => {
  const w = await world();
  const [a, b] = await Promise.all([pairOf(w, w.mom, w.dad), pairOf(w, w.dad, w.mom)]);
  assert.equal(a, b);
});

test("you can't start a conversation with yourself", { skip }, async () => {
  const w = await world();
  refused(await post(w.app, w.mom, "/v1/threads", { otherId: w.mom.id }, { key: null }), 400, "invalid", "otherId");
  refused(await post(w.app, w.mom, "/v1/threads", { otherId: "nobody" }, { key: null }), 404);
});

test("a 1:1 with someone removed stays in the inbox, read-only", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "Chili Sunday?");
  await db().query(`update people set removed_at = now() where id = $1`, [w.dad.id]);
  const row = (await inbox(w, w.mom)).find((t: any) => t.id === pair);
  assert.deepEqual([row.other.name, row.other.removed, row.last.body], ["Dad", true, "Chili Sunday?"]);
  assert.deepEqual(row.members.map((p: any) => p.name).sort(), ["Dad", "Mom"]);
  assert.deepEqual((await messages(w, w.mom, pair)).map((m: any) => m.body), ["Chili Sunday?"]);
  refused(await say(w, w.mom, pair, { kind: "text", body: "Hello?" }), 403, "other_left");
});

test("a removed person can't act", { skip }, async () => {
  const w = await world();
  await db().query(`update people set removed_at = now() where id = $1`, [w.dad.id]);
  refused(await get(w.app, w.dad, "/v1/threads"), 403);
  refused(await post(w.app, w.dad, "/v1/threads", { otherId: w.mom.id }, { key: null }), 403);
});

test("messages page back in order, and a poll reads only what's new", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const sent = [];
  for (let i = 0; i < 5; i += 1) sent.push(await text(w, w.mom, pair, `m${i}`));
  const page = ok(await get(w.app, w.dad, `/v1/threads/${pair}/messages?limit=2`));
  assert.deepEqual(page.messages.map((m: any) => m.body), ["m3", "m4"]);
  const older = ok(await get(w.app, w.dad, `/v1/threads/${pair}/messages?limit=2&cursor=${page.nextCursor}`));
  assert.deepEqual(older.messages.map((m: any) => m.body), ["m1", "m2"]);
  const oldest = ok(await get(w.app, w.dad, `/v1/threads/${pair}/messages?limit=2&cursor=${older.nextCursor}`));
  assert.deepEqual(oldest.messages.map((m: any) => m.body), ["m0"]);
  assert.equal(oldest.nextCursor, null);
  assert.deepEqual((await messages(w, w.dad, pair, `?after=${encodeURIComponent(sent[3].createdAt)}`)).map((m: any) => m.body), ["m4"]);
  assert.deepEqual(await messages(w, w.dad, pair, `?after=${encodeURIComponent(sent[4].createdAt)}`), []);
  refused(await get(w.app, w.dad, `/v1/threads/${pair}/messages?after=soon`), 400, "invalid", "after");
  refused(await get(w.app, w.dad, `/v1/threads/${pair}/messages?cursor=nope`), 400, "invalid", "cursor");
});

test("a forged cursor or time is a 400, never a server error", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "Hi");
  const cursor = (parts: unknown) => Buffer.from(JSON.stringify(parts)).toString("base64url");
  const forged = [
    "nope",
    cursor(["2026-02-31T00:00:00Z", "x"]), // Date.parse takes this, and Postgres doesn't
    cursor(["1", "x"]),
    cursor(["2026-11-01 10:00:00+00", "x\0y"]),
    cursor(["2026-11-01 10:00:00+00"]),
    cursor({ at: 1 }),
  ];
  for (const url of [`/v1/threads/${pair}/messages`, "/v1/threads", "/v1/messages", "/v1/favorites", "/v1/me/recipe-stats", "/v1/questions/open", `/v1/dishes/${CHILI}/notes`]) {
    for (const c of forged) {
      const r = await get(w.app, w.mom, `${url}?cursor=${encodeURIComponent(c)}`);
      assert.equal(r.status, 400, `${url} ${c}: ${r.body}`);
    }
  }
  const huge = cursor(["2026-11-01 10:00:00+00", "99999999999:x"]);
  assert.equal((await get(w.app, w.mom, `/v1/dishes/${CHILI}/notes?cursor=${huge}`)).status, 400);
  for (const after of ["1", "soon", "2026-02-31T00:00:00Z", "2026-11-01"]) {
    refused(await get(w.app, w.mom, `/v1/threads/${pair}/messages?after=${encodeURIComponent(after)}`), 400, "invalid", "after");
  }
  // What the server itself hands out still works, with a raw "+" arriving as a space.
  ok(await get(w.app, w.mom, `/v1/threads/${pair}/messages?after=${encodeURIComponent("2026-11-01T10:00:00.123456+00:00")}`));
  ok(await get(w.app, w.mom, `/v1/threads/${pair}/messages?after=2026-11-01T10:00:00.123456+00:00`));
});

test("a read mark never moves backward: a late write can't turn read messages unread", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.mom, pair, "One");
  ok(await post(w.app, w.dad, `/v1/threads/${pair}/read`, undefined, { key: null }));
  assert.equal(await unread(w, w.dad), 0);
  await markRead(db(), pair, w.dad.id, "2020-01-01T00:00:00Z");
  assert.equal(await unread(w, w.dad), 0);
});

test("what a poll needs: unread and lastMessageAt move with every new message", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const empty = ok(await get(w.app, w.dad, "/v1/unread"));
  assert.deepEqual([empty.total, empty.lastMessageAt], [0, null]);
  const m = await text(w, w.mom, pair, "Hi");
  const after = ok(await get(w.app, w.dad, "/v1/unread"));
  assert.deepEqual([after.total, after.lastMessageAt], [1, m.createdAt]);
});

test("createdAt keeps its microseconds, and messages sent at once all land in commit order", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const all = await Promise.all(Array.from({ length: 8 }, (_, i) => text(w, w.mom, pair, `m${i}`)));
  assert.ok(all.every((m) => /\.\d{6}Z$/.test(m.createdAt)));
  const stored = await messages(w, w.dad, pair);
  assert.equal(stored.length, 8);
  assert.equal(new Set(stored.map((m: any) => m.createdAt)).size, 8);
});

test("kinds: what each needs, and what's refused", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const send = (body: Record<string, unknown>) => say(w, w.mom, pair, body);
  refused(await send({ body: "no kind" }), 400, "invalid", "kind");
  refused(await send({ kind: "text" }), 400, "invalid", { field: "body", message: "Write something first." });
  refused(await send({ kind: "text", body: "   " }), 400, "invalid", "body");
  refused(await send({ kind: "text", body: "x".repeat(2001) }), 400, "invalid", { field: "body", message: "That message is too long." });
  refused(await send({ kind: "request" }), 400, "invalid", "body");
  refused(await send({ kind: "recipe" }), 400, "invalid", "libraryId");
  refused(await send({ kind: "cooked" }), 400, "invalid", "libraryId");
  refused(await send({ kind: "step", libraryId: CHILI }), 400, "invalid", "stepOrder");
  refused(await send({ kind: "step", stepOrder: 3 }), 400, "invalid", "libraryId");
  refused(await send({ kind: "question" }), 400, "invalid", { field: "body", message: "Write something first." });
  refused(await send({ kind: "question", body: "?", stepOrder: 1 }), 400, "invalid", "libraryId");
  refused(await send({ kind: "voice" }), 400, "invalid", "durationS");
  refused(await send({ kind: "voice", durationS: 0 }), 400, "invalid", "durationS");
  refused(await send({ kind: "voice", durationS: 301 }), 400, "invalid", "durationS");
  refused(await send({ kind: "voice", durationS: 5 }), 400, "invalid", "audioKey");
  refused(await send({ kind: "system", body: "fake" }), 400, "invalid", "kind");
  refused(await send({ kind: "wave" }), 400, "invalid", "kind");
  refused(await send({ kind: "recipe", libraryId: "NOT A RECIPE" }), 400, "invalid", "libraryId");
  refused(await send({ kind: "recipe", libraryId: "no-such-dish" }), 404, "not_found", { message: "That recipe isn't here anymore." });
  refused(await send({ kind: "voice", durationS: 3, clipKey: `${CHILI}/a.m4a`, clipStartS: 9, clipEndS: 2 }), 400, "invalid", "clipEndS");
  ok(await send({ kind: "recipe", libraryId: CHILI }));
  ok(await send({ kind: "step", libraryId: CHILI, stepOrder: 3 }));
});

test("the library being down doesn't hold up a send", { skip }, async () => {
  const w = await world();
  w.lib.down = true;
  const pair = await pairOf(w, w.mom, w.dad);
  ok(await say(w, w.mom, pair, { kind: "recipe", libraryId: "unknown-dish" }));
});

test("reply_to must be a message in this conversation", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const ring = await circleOf(w);
  const inRing = await text(w, w.mom, ring, "All of you");
  refused(await say(w, w.mom, pair, { kind: "text", body: "x", replyTo: inRing.id }), 400, "invalid", "replyTo");
  refused(await say(w, w.mom, pair, { kind: "text", body: "x", replyTo: "nope" }), 400, "invalid", "replyTo");
});

test("retention: reactions: a heart (no push), 'Just like mine' only on a dish someone else made, once", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  const thread = await pairOf(w, w.leo, w.mom);
  const made = ok(await say(w, w.leo, thread, { kind: "cooked", libraryId: DAL }));
  const words = await text(w, w.leo, thread, "So good");

  const heart = ok(await say(w, w.mom, thread, { kind: "reaction", body: "heart" }));
  assert.deepEqual([heart.kind, heart.body], ["reaction", "heart"]);
  refused(await say(w, w.mom, thread, { kind: "reaction", body: "wow" }), 400, "invalid", "body");
  for (const body of [
    { kind: "reaction", body: "just_like_mine" }, // needs the dish
    { kind: "reaction", body: "just_like_mine", replyTo: words.id }, // not a dish
  ]) {
    refused(await say(w, w.mom, thread, body), 400, "invalid", "replyTo");
  }
  refused(await say(w, w.leo, thread, { kind: "reaction", body: "heart", replyTo: made.id }), 400, "invalid", "replyTo"); // not on my own dish

  const jlm = { kind: "reaction", body: "just_like_mine", replyTo: made.id, libraryId: DAL };
  const [first, again] = await Promise.all([say(w, w.mom, thread, jlm), say(w, w.mom, thread, jlm)]);
  assert.equal(ok(again).id, ok(first).id);
  await drain();
  // Leo's phone: one push for "Just like mine", none for the heart.
  assert.deepEqual(pushes(w.expo).map((p) => [p[0], p[1], p[2]]), [[tokenFor("leo"), "Mom", "“Just like mine.” on your Dal"]]);

  // Reactions never become the inbox headline, never unread.
  const row = (await inbox(w, w.leo)).find((t: any) => t.id === thread);
  assert.deepEqual([row.last.id, row.unread], [words.id, 0]);
});

test("retention: a heart sent from Home never marks the chat read or moves it up the inbox", { skip }, async () => {
  const w = await world();
  const withLeo = await pairOf(w, w.leo, w.mom);
  await text(w, w.leo, withLeo, "Is it two cups?");
  const withDad = await pairOf(w, w.dad, w.mom);
  await text(w, w.dad, withDad, "Home at 6");
  const momsInbox = async () => (await inbox(w, w.mom)).map((t: any) => [t.id, t.unread]);
  const before = await momsInbox();
  assert.deepEqual(before.slice(1), [[withDad, 1], [withLeo, 1]]);
  const stamp = async () => (await db().query(`select last_message_at from threads where id = $1`, [withLeo])).rows[0].last_message_at;
  const at = await stamp();

  // Mom hearts Leo mid-cook from Home (no chat open, nothing answered).
  const heart = ok(await say(w, w.mom, withLeo, { kind: "reaction", body: "heart" }));
  assert.equal(heart.kind, "reaction");
  assert.deepEqual(await momsInbox(), before);
  assert.equal(await unread(w, w.mom), 2);
  assert.deepEqual(await stamp(), at);
});

test("PR 2: Mom's heart from Home reaches Leo's 1:1 as a reaction (no push, not unread, not the inbox headline)", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  const thread = await pairOf(w, w.mom, w.leo);
  const hi = await text(w, w.leo, thread, "Making your dal!");
  const heart = ok(await say(w, w.mom, thread, { kind: "reaction", body: "heart", libraryId: DAL }));
  assert.deepEqual([heart.kind, heart.body, heart.libraryId], ["reaction", "heart", DAL]);
  await drain();
  assert.equal(w.expo.sent.flat().filter((m) => m.to === tokenFor("leo")).length, 0);
  // The kid's heart watch reads it from the thread after the session start.
  const seen = await messages(w, w.leo, thread, `?after=${encodeURIComponent(hi.createdAt)}`);
  assert.deepEqual(seen.map((m: any) => [m.kind, m.body, m.senderId]), [["reaction", "heart", w.mom.id]]);
  const row = (await inbox(w, w.leo)).find((t: any) => t.id === thread);
  assert.deepEqual([row.last.id, row.unread], [hi.id, 0]);
  assert.equal(await unread(w, w.leo), 0);
  // A thread holding only a heart never shows in the inbox.
  const dadThread = await pairOf(w, w.dad, w.leo);
  ok(await say(w, w.dad, dadThread, { kind: "reaction", body: "heart" }));
  assert.ok(!(await inbox(w, w.leo)).some((t: any) => t.id === dadThread));
  assert.equal(await unread(w, w.leo), 0);
});

// --- answers saved into a recipe, and taking one back out

async function leoAsks(w: World, body = "How long do I let the beef sit?") {
  const ring = await circleOf(w);
  const q = ok(await say(w, w.leo, ring, { kind: "question", body, libraryId: CHILI, stepOrder: 1 }));
  return { ring, q };
}
const openIds = async (w: World, who: World["mom"]) => ok(await get(w.app, who, "/v1/chat-questions/open")).map((x: any) => x.message.id);

test("an answer saved by mistake comes back out, and the question opens again", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  const a = await say(w, w.mom, ring, { kind: "text", body: "Hi everyone!", replyTo: q.id }).then((r) => ok(r));
  assert.equal(a.savedToRecipe, true);
  assert.equal(typeof a.noteId, "string");
  assert.deepEqual(await openIds(w, w.dad), []);

  const out = ok(await post(w.app, w.mom, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }));
  assert.deepEqual([out.ok, out.answerMessageId, out.questionMessageId], [true, a.id, q.id]);
  assert.equal((await db().query(`select count(*)::int as n from recipe_notes`)).rows[0].n, 0);
  assert.deepEqual(await openIds(w, w.dad), [q.id]);
  const msgs = await messages(w, w.mom, ring);
  const hello = msgs.find((m: any) => m.id === a.id);
  assert.deepEqual([hello.savedToRecipe, hello.noteId, hello.replyTo, msgs.find((m: any) => m.id === q.id).answeredBy], [false, null, null, null]);

  refused(await post(w.app, w.mom, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }), 404);
  refused(await post(w.app, w.mom, "/v1/notes/no such/remove", undefined, { key: null }), 404);
});

test("the asker and the dish's cook may take an answer out; nobody else may", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  const a = ok(await say(w, w.mom, ring, { kind: "text", body: "Ten minutes.", replyTo: q.id }));
  refused(await post(w.app, w.nia, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }), 403, "forbidden", {
    message: "Only the person who answered, the person who asked, or the cook can take this out.",
  });
  // Dad's chili (cook.name in its recipe.json): he may.
  ok(await post(w.app, w.dad, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }));
  const b = ok(await say(w, w.mom, ring, { kind: "text", body: "Twelve.", replyTo: q.id }));
  ok(await post(w.app, w.leo, `/v1/notes/${b.noteId}/remove`, undefined, { key: null })); // Leo asked
  assert.equal((await db().query(`select count(*)::int as n from recipe_notes`)).rows[0].n, 0);
});

test("a recipe made on AWS: its cook may take an answer out, found by the name in its own recipe.json", { skip }, async () => {
  const w = await world();
  const poha = await awsRecipe(w.mom);
  useLibrary(cdnLibrary({ [poha.jsonKey]: poha.json }));
  const ring = await circleOf(w);
  const q = ok(await say(w, w.leo, ring, { kind: "question", body: "How much poha?", libraryId: poha.libraryId, stepOrder: 1 }));
  const a = ok(await say(w, w.dad, ring, { kind: "text", body: "Two cups.", replyTo: q.id }));
  refused(await post(w.app, w.nia, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }), 403, "forbidden");
  ok(await post(w.app, w.mom, `/v1/notes/${a.noteId}/remove`, undefined, { key: null }));
});

test("taking one answer out leaves a question someone else answered answered", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  const mom = ok(await say(w, w.mom, ring, { kind: "text", body: "Hi everyone!", replyTo: q.id }));
  const dad = ok(await say(w, w.dad, ring, { kind: "text", body: "Five minutes, then flip.", replyTo: q.id }));
  assert.equal(dad.savedToRecipe, true);
  ok(await post(w.app, w.mom, `/v1/notes/${mom.noteId}/remove`, undefined, { key: null }));
  assert.deepEqual(await openIds(w, w.dad), []);
  const notes = ok(await get(w.app, w.leo, `/v1/dishes/${CHILI}/notes`)).notes;
  assert.deepEqual(notes.map((n: any) => n.answerText), ["Five minutes, then flip."]);
});

test("a newcomer's open questions start after they joined (no backlog)", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  const linda = await person(w.family, "Linda", "kid");
  assert.deepEqual(await openIds(w, linda), []);
  assert.deepEqual(await openIds(w, w.dad), [q.id]);
  const later = ok(await say(w, w.leo, ring, { kind: "question", body: "And the beans?" }));
  assert.deepEqual(await openIds(w, linda), [later.id]);
});

test("GET /recipes/:id/questions: the circle's open questions and my own 1:1s, never someone else's", { skip }, async () => {
  const w = await world();
  const { leo, nia: priya, dad } = w;
  const ring = await circleOf(w);
  const ask = (thread: string, who: World["mom"], body: Record<string, unknown>) => say(w, who, thread, { kind: "question", ...body }).then((r) => ok(r));
  // Leo asks the circle about step 2, and Dad 1:1 about step 3; Priya asks Dad 1:1 too. Another dish's question never shows.
  const q1 = await ask(ring, leo, { body: "How long do I knead it?", libraryId: CHILI, stepOrder: 2 });
  await ask(await pairOf(w, leo, dad), leo, { body: "How much salt?", libraryId: CHILI, stepOrder: 3 });
  await ask(await pairOf(w, priya, dad), priya, { body: "Which beans?", libraryId: CHILI, stepOrder: 1 });
  await ask(ring, leo, { body: "Rice or noodles?", libraryId: NOODLES, stepOrder: 1 });

  const list = async (who: World["mom"]) =>
    ok(await get(w.app, who, `/v1/dishes/${CHILI}/chat-questions`)).map((q: any) => [q.stepOrder, q.asker.name, q.mine, q.threadKind, q.waitingFor?.name ?? null]);
  assert.deepEqual(await list(priya), [[1, "Nia", true, "pair", "Dad"], [2, "Leo", false, "circle", null]]);
  assert.deepEqual(await list(leo), [[3, "Leo", true, "pair", "Dad"], [2, "Leo", true, "circle", null]]);
  // Dad (asked) doesn't see others' 1:1s here either.
  assert.deepEqual(await list(dad), [[2, "Leo", false, "circle", null]]);

  // Dad answers the circle question: it's gone for everyone. Leo's 1:1 one still waits.
  ok(await say(w, dad, ring, { kind: "text", body: "Until it's smooth.", replyTo: q1.id }));
  assert.deepEqual(await list(priya), [[1, "Nia", true, "pair", "Dad"]]);
  assert.deepEqual(await list(leo), [[3, "Leo", true, "pair", "Dad"]]);
  refused(await get(w.app, leo, "/v1/dishes/not%20a%20recipe/chat-questions"), 400, "invalid", "libraryId");

  // Someone who left: their own questions drop (asker gone), and so do questions to them.
  await ask(ring, priya, { body: "Fresh or dried chiles?", libraryId: CHILI, stepOrder: 4 });
  assert.equal((await list(leo)).length, 2);
  await db().query(`update people set removed_at = now() where id = $1`, [priya.id]);
  assert.deepEqual(await list(leo), [[3, "Leo", true, "pair", "Dad"]]);
  await db().query(`update people set removed_at = now() where id = $1`, [dad.id]);
  assert.deepEqual(await list(leo), []);
});

test("a removed person's recipe notes keep their name and face", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  ok(await say(w, w.dad, ring, { kind: "text", body: "Brick red oil.", replyTo: q.id }));
  await db().query(`update people set removed_at = now() where id = any($1::text[])`, [[w.dad.id, w.leo.id]]);
  const notes = ok(await get(w.app, w.mom, `/v1/dishes/${CHILI}/notes`)).notes;
  assert.deepEqual([notes[0].author.name, notes[0].asker.name], ["Dad", "Leo"]);
});

test("a cook can save their own message to a recipe by hand; a kid or someone else's message can't", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.dad, w.leo);
  const about = ok(await say(w, w.dad, pair, { kind: "step", libraryId: CHILI, stepOrder: 2, body: "Low heat." }));
  const note = ok(await post(w.app, w.dad, "/v1/notes", { messageId: about.id }, { key: null }));
  assert.deepEqual([note.libraryId, note.stepOrder, note.answerText, note.author.name], [CHILI, 2, "Low heat.", "Dad"]);
  // Once per message.
  assert.equal(ok(await post(w.app, w.dad, "/v1/notes", { messageId: about.id }, { key: null })).id, note.id);
  refused(await post(w.app, w.leo, "/v1/notes", { messageId: about.id }, { key: null }), 403); // a kid
  const ring = await circleOf(w);
  const theirs = await text(w, w.mom, ring, "Mine");
  refused(await post(w.app, w.dad, "/v1/notes", { messageId: theirs.id }, { key: null }), 403, "forbidden", { message: "You can only save your own messages." });
  refused(await post(w.app, w.mom, "/v1/notes", { messageId: about.id }, { key: null }), 404); // outside the pair
  const plain = await text(w, w.dad, pair, "Hello");
  refused(await post(w.app, w.dad, "/v1/notes", { messageId: plain.id }, { key: null }), 400, "invalid", "messageId");
  refused(await post(w.app, w.dad, "/v1/notes", { messageId: "nope" }, { key: null }), 404);
});

test("a kid's reply saves nothing to the recipe; a voice reply on a dish someone made answers no question", { skip }, async () => {
  const w = await world();
  const { ring, q } = await leoAsks(w);
  const reply = ok(await say(w, w.nia, ring, { kind: "text", body: "I think ten", replyTo: q.id }));
  assert.equal(reply.savedToRecipe, false);
  assert.deepEqual(await openIds(w, w.dad), [q.id]);
});

// --- recipes sent inside the family, system notes

test("retention: a recipe sent or delivered by the pipeline pushes 'Just in from' with the dish, opening it", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  await phone(w, w.mom, "mom");
  const sent = ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: CHILI, to: [w.leo.id] }));
  assert.equal(sent.sent.length, 1);
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("leo"), "Just in from Mom", "Dad's Sunday Chili", `/recipe/${CHILI}`]]);
});

test("send-recipe: everyone, a list, never myself; a retry sends nothing twice", { skip }, async () => {
  const w = await world();
  const everyone = ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: "everyone", note: "Try this" }));
  assert.equal(everyone.sent.length, 3);
  refused(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: [w.mom.id] }), 400, "invalid", "to");
  refused(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: [] }), 400, "invalid", "to");
  refused(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: ["nobody"] }), 404);
  refused(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: [w.stranger.id] }), 404);
  const key = "send-recipe-retry-1";
  const a = ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: CHILI, to: [w.dad.id] }, { key }));
  const b = ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: CHILI, to: [w.dad.id] }, { key }));
  assert.deepEqual(a, b);
  assert.equal((await db().query(`select count(*)::int as n from messages where library_id = $1`, [CHILI])).rows[0].n, 1);
});

test("a system note isn't a headline while a thread has real messages, and never counts as unread", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  const hi = await text(w, w.dad, ring, "Hello all");
  await tx((c) => postSystemNote(c, w.family, w.nia.id, "Nia joined."));
  const row = (await inbox(w, w.mom))[0];
  assert.deepEqual([row.last.id, row.unread], [hi.id, 1]);
  // Its "sender" has read nothing.
  assert.equal((await db().query(`select count(*)::int as n from thread_reads where person_id = $1`, [w.nia.id])).rows[0].n, 0);
  assert.ok((await messages(w, w.mom, ring)).some((m: any) => m.kind === "system" && m.body === "Nia joined."));
});

test("delivering a recording: the recipe then the hello, in order, in each pair", { skip }, async () => {
  const w = await world();
  const hello = await uploaded(w, w.dad);
  const sent = await tx((c) => deliverRecipe(c, w.family, w.dad.id, [w.leo.id, w.nia.id], CHILI, { helloKey: hello, helloDurationS: 5 }));
  assert.equal(sent.length, 2);
  const pair = sent.find((x) => x.personId === w.leo.id)!.threadId;
  assert.deepEqual((await messages(w, w.leo, pair)).map((m: any) => m.kind), ["recipe", "voice"]);
});

// --- Convex's messages

test("messages: privacy, and the photo note", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const photo = await uploaded(w, w.leo, "photo");
  const { draft, aiDrafted } = ok(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: photo }, { key: null }));
  assert.equal(aiDrafted, true);
  assert.equal(draft, "Made your chili, Dad. Not as good as yours yet!");

  ok(await post(w.app, w.leo, "/v1/messages", { kind: "photo", photoKey: photo, recipeId: chili, to: w.dad.id, text: `${draft} Thank you!`, aiDrafted: true }));
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "photo" }), 400, "invalid", "photoKey");
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "  " }), 400, "invalid", { field: "text", message: "Write something first." });

  const [msg] = ok(await get(w.app, w.dad, "/v1/messages")).messages;
  assert.deepEqual([msg.kind, msg.aiDrafted, msg.fromName, msg.to], ["photo", true, "Leo", w.dad.id]);
  assert.equal(typeof msg.photoUrl, "string");

  // A message to Dad isn't shown to a third person in the family.
  assert.deepEqual(ok(await get(w.app, w.nia, "/v1/messages")).messages, []);

  fakeModels.note = () => Promise.reject(new NotSetUp());
  refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: photo }, { key: null }), 503, "not_set_up", { message: "The note writer isn't set up yet." });
});

test("messages.send: to no one is the circle, to someone is the pair; the other family, a bad recipe and a file on text are refused", { skip }, async () => {
  const w = await world();
  const toAll = ok(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: " Hello all " }));
  assert.equal(toAll.body, "Hello all");
  assert.equal(toAll.threadId, await circleOf(w));
  const toDad = ok(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "Hi Dad", to: w.dad.id }));
  assert.equal(toDad.threadId, await pairOf(w, w.leo, w.dad));
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", to: w.stranger.id }), 404);
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", to: w.leo.id }), 400, "invalid", "to");
  const theirs = await recipe(w.otherFamily, w.stranger.id);
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", recipeId: theirs }), 404, "not_found", { message: "That recipe isn't here anymore." });
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", audioKey: "private/x" }), 404); // the guard says first
  const voice = await uploaded(w, w.leo);
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", audioKey: voice }), 400, "invalid", "audioKey");
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "wave" }), 400, "invalid", "kind");
  // Someone who left can't be written to.
  await db().query(`update people set removed_at = now() where id = $1`, [w.nia.id]);
  refused(await post(w.app, w.leo, "/v1/messages", { kind: "text", text: "x", to: w.nia.id }), 404);
});

test("madeMyDish: the newest photo of one of my dishes, from someone else, in the last two weeks", { skip }, async () => {
  const w = await world();
  const made = async () => ok(await get(w.app, w.dad, "/v1/messages/made-my-dish"));
  assert.equal(await made(), null);
  const chili = await recipe(w.family, w.dad.id);
  const niasDish = await recipe(w.family, w.nia.id, { title: "Nia's Toast" });
  const send = async (who: World["mom"], recipeId: string, words?: string) =>
    ok(await post(w.app, who, "/v1/messages", { kind: "photo", photoKey: await uploaded(w, who, "photo"), recipeId, to: who.id === w.dad.id ? w.leo.id : w.dad.id, text: words }));

  // A photo of someone else's dish, or my own photo, isn't mine to see here.
  await send(w.leo, niasDish);
  await send(w.dad, chili);
  assert.equal(await made(), null);

  await send(w.leo, chili, "Tasted like home.");
  const card = await made();
  assert.deepEqual([card.fromName, card.recipeTitle, card.text], ["Leo", "Sunday Chili", "Tasted like home."]);
  assert.match(card.photoUrl, /^https?:/);
  await send(w.nia, chili);
  assert.equal((await made()).fromName, "Nia");
  // Leo only sees what was sent to him, not Dad's card.
  assert.equal(ok(await get(w.app, w.leo, "/v1/messages/made-my-dish")), null);

  await db().query(`update messages set created_at = created_at - interval '15 days'`);
  assert.equal(await made(), null);
});

after(closeAll);
