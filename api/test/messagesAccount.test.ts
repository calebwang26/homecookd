// SCHEMA.md section 4 and C1 for this area's tables: what they sent goes; what the other person sent stays, voice notes included. These run this part alone (accountDeletion.test.ts runs the whole purge), so the tests
// tombstone the person by hand. Carries over convex/account.test.ts's messages, questions and push steps.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { deleteQuestionsOnRecipes, purgeMessagesForPerson, PURGE_BATCH } from "../src/modules/messages/account.js";
import { shareTokenHash } from "../src/sealed.js";
import { tx } from "../src/db.js";
import { CHILI, circleOf, closeAll, DAL, drain, fileRow, get, logOf, newKey, ok, pairOf, phone, post, recipe, say, silent, skip, text, tokensOf, uploaded, type Who, type World, world } from "./messagesHelpers.js";

const tombstone = (who: Who) =>
  db().query(
    `update people set name = 'Deleted', deleted_at = now(), relation = null, avatar_key = null, email = null, tz = null, share_cooking = null, language = null,
       voice_clone_consented_at = null, cartesia_voice_id = null, approx_lat = null, approx_lng = null, campus = null
     where id = $1`,
    [who.id],
  );
const count = async (sql: string, params: unknown[] = []) => (await db().query(`select count(*)::int as n from ${sql}`, params)).rows[0].n;
const purge = (w: World, who: Who) => purgeMessagesForPerson(who.id, w.family);
const marked = async (key: string) => (await fileRow(key)).delete_requested_at !== null;

test("C1: when someone deletes their account what they sent goes, and the other person's half stays, voice notes included", { skip }, async () => {
  const w = await world();
  const { mom: shreya, dad: rajani } = w;
  const pair = await pairOf(w, shreya, rajani);
  const hers = await uploaded(w, rajani); // the one who deletes
  const mine = await uploaded(w, shreya); // the one who stays
  ok(await say(w, rajani, pair, { kind: "voice", audioKey: hers, durationS: 5 }));
  const stays = ok(await say(w, shreya, pair, { kind: "voice", audioKey: mine, durationS: 6 }));
  await text(w, rajani, pair, "Come home soon");
  const ring = await circleOf(w);
  await text(w, rajani, ring, "To everyone, from her");
  const toEveryone = await text(w, shreya, ring, "To everyone, from me");

  await tombstone(rajani);
  await purge(w, rajani);

  // Her messages and her voice note are gone, in the pair and the circle.
  assert.equal(await count(`messages where sender_id = $1`, [rajani.id]), 0);
  assert.ok(await marked(hers));
  // Shreya's half stays, with its voice note, and it plays.
  const msgs = ok(await get(w.app, shreya, `/v1/threads/${pair}/messages`)).messages;
  assert.deepEqual(msgs.map((m: any) => m.id), [stays.id]);
  assert.equal(await marked(mine), false);
  assert.match(msgs[0].audioUrl, /fake-s3/);
  assert.deepEqual(ok(await get(w.app, shreya, `/v1/threads/${ring}/messages`)).messages.map((m: any) => m.id), [toEveryone.id]);
  // The pair stays in her inbox, pointing at the tombstone, read-only.
  const row = ok(await get(w.app, shreya, "/v1/threads")).threads.find((t: any) => t.id === pair);
  assert.deepEqual([row.other.name, row.other.removed, row.last.id], ["Deleted", true, stays.id]);
  const late = await say(w, shreya, pair, { kind: "text", body: "Hello?" });
  assert.deepEqual([late.status, late.data.error], [403, "other_left"]);
  assert.equal(await count(`threads where id = $1`, [pair]), 1);
  // The S3 delete itself is the sweep's.
  await sweep({ log: silent });
  assert.ok(!w.store.objects.has(hers));
  assert.ok(w.store.objects.has(mine));
});

test("a thread with nothing left in it goes from the other person's inbox", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.dad, pair, "Only mine");
  await tombstone(w.dad);
  await purge(w, w.dad);
  assert.ok(!ok(await get(w.app, w.mom, "/v1/threads")).threads.some((t: any) => t.id === pair));
  assert.equal(ok(await get(w.app, w.mom, "/v1/unread")).total, 0);
  // Read marks went: theirs, and any on those threads.
  assert.equal(await count(`thread_reads where thread_id = $1`, [pair]), 0);
});

test("replies to deleted messages stay, without their reply_to", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const theirs = await text(w, w.dad, pair, "Question?");
  const reply = ok(await say(w, w.mom, pair, { kind: "text", body: "Answer.", replyTo: theirs.id }));
  await tombstone(w.dad);
  await purge(w, w.dad);
  const [m] = ok(await get(w.app, w.mom, `/v1/threads/${pair}/messages`)).messages;
  assert.deepEqual([m.id, m.replyTo], [reply.id, null]);
});

test("recipe notes: answered by them, deleted, with the clip marked; asked by them, the question comes off and the answer stays", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  // Leo asks; Dad answers by voice: both a message and a note. Nia asks; Mom answers.
  const q = ok(await say(w, w.leo, ring, { kind: "question", body: "How long?", libraryId: CHILI, stepOrder: 1 }));
  const clip = await uploaded(w, w.dad);
  ok(await say(w, w.dad, ring, { kind: "voice", audioKey: clip, durationS: 4, replyTo: q.id, transcript: "Ten minutes." }));
  const q2 = ok(await say(w, w.leo, ring, { kind: "question", body: "How hot?", libraryId: DAL, stepOrder: 2 }));
  ok(await say(w, w.mom, ring, { kind: "text", body: "Low.", replyTo: q2.id }));

  await tombstone(w.dad);
  await purge(w, w.dad);
  assert.ok(await marked(clip));
  assert.equal(await count(`recipe_notes where answered_by = $1`, [w.dad.id]), 0);
  assert.equal(await count(`recipe_notes`), 1);

  await tombstone(w.leo);
  await purge(w, w.leo);
  const [note] = (await db().query(`select * from recipe_notes`)).rows;
  assert.deepEqual([note.asked_by, note.question, note.question_message_id, note.answer_text], [null, null, null, "Low."]);
});

test("her questions, the ones on her recipes, and her answer to someone else's: the last goes back to waiting", { skip }, async () => {
  const w = await world();
  const { mom: rajani, dad: aai, leo: shreya } = w;
  const poha = await recipe(w.family, rajani.id, { title: "Kanda Poha" });
  const thalipeeth = await recipe(w.family, aai.id, { title: "Thalipeeth" });
  const ask = (who: Who, recipeId: string, words: string) => post(w.app, who, "/v1/questions", { recipeId, text: words }).then((r) => ok(r, 201).questionId as string);
  const onHers = await ask(shreya, poha, "How long?");
  const hersOnAai = await ask(rajani, thalipeeth, "Which flour?");
  const onAai = await ask(shreya, thalipeeth, "How hot?");
  const hersAudio = await uploaded(w, rajani);
  ok(await post(w.app, rajani, `/v1/questions/${onHers}/answer`, { audioKey: await uploaded(w, rajani) }));
  ok(await post(w.app, rajani, `/v1/questions/${onAai}/answer`, { audioKey: hersAudio }));
  await drain();

  await tombstone(rajani);
  await purge(w, rajani);
  const rows = (await db().query(`select id, status, answer_by, answer_audio_key, answer_transcript, answered_at from questions`)).rows;
  assert.deepEqual(rows.map((r) => r.id), [onAai]);
  assert.deepEqual([rows[0].status, rows[0].answer_by, rows[0].answer_audio_key, rows[0].answer_transcript, rows[0].answered_at], ["asked_cook", null, null, null, null]);
  assert.ok(await marked(hersAudio));
  // Aai sees it again.
  assert.deepEqual(ok(await get(w.app, aai, "/v1/questions/open")).questions.map((q: any) => q.id), [onAai]);
  assert.equal(hersOnAai.length > 0, true);
});

test("the at-once step can take a recipe's questions before the recipe goes, marking their clips", { skip }, async () => {
  const w = await world();
  const poha = await recipe(w.family, w.mom.id);
  const { questionId } = ok(await post(w.app, w.leo, "/v1/questions", { recipeId: poha, text: "Salt?" }), 201);
  const clip = await uploaded(w, w.mom);
  ok(await post(w.app, w.mom, `/v1/questions/${questionId}/answer`, { audioKey: clip }));
  assert.equal(await tx((c) => deleteQuestionsOnRecipes(c, w.mom.id, [poha])), 1);
  assert.ok(await marked(clip));
  await db().query(`delete from recipes where id = $1`, [poha]);
});

test("everything else of theirs: pending sends, share links, hearts, events, push, retry keys and spare uploads", { skip }, async () => {
  const w = await world();
  const { dad } = w;
  await phone(w, dad, "dad");
  // A push on the log, sent to them.
  const pair = await pairOf(w, w.mom, dad);
  await text(w, w.mom, pair, "Hi");
  await drain();
  assert.equal((await logOf(dad.id)).length, 1);
  // Theirs, and to them.
  const hello = await uploaded(w, dad);
  ok(await post(w.app, dad, "/v1/pending-sends", { uploadId: "up-theirs", recipientIds: [w.leo.id], helloKey: hello }));
  ok(await post(w.app, w.mom, "/v1/pending-sends", { uploadId: "up-to-them", recipientIds: [dad.id, w.leo.id] }));
  const share = ok(await post(w.app, dad, "/v1/shares", { libraryId: CHILI }, { key: null }));
  ok(await post(w.app, dad, "/v1/favorites", { libraryId: CHILI, on: true }, { key: null }));
  ok(await post(w.app, dad, "/v1/events", { libraryId: CHILI, kind: "cooked" }, { key: null }));
  ok(await post(w.app, w.leo, "/v1/events", { libraryId: CHILI, kind: "cooked", cookId: dad.id }, { key: null }));
  const spare = await uploaded(w, dad);
  ok(await post(w.app, dad, `/v1/threads/${pair}/messages`, { kind: "text", body: "Bye" }, { key: newKey() }));
  assert.ok((await count(`idempotency_keys where scope = $1`, [dad.id])) > 0);

  await tombstone(dad);
  await purge(w, dad);

  assert.equal(await count(`pending_sends where upload_id = 'up-theirs'`), 0);
  assert.ok(await marked(hello));
  assert.deepEqual((await db().query(`select recipient_ids from pending_sends where upload_id = 'up-to-them'`)).rows[0].recipient_ids, [w.leo.id]);
  assert.equal((await db().query(`select sender_id from shares where token_hash = $1`, [shareTokenHash(share.token)])).rows[0].sender_id, null);
  assert.equal(await count(`favorites where person_id = $1`, [dad.id]), 0);
  assert.equal(await count(`recipe_events where person_id = $1`, [dad.id]), 0);
  assert.deepEqual((await db().query(`select person_id, cook_id from recipe_events`)).rows, [{ person_id: w.leo.id, cook_id: null }]);
  assert.equal((await tokensOf(dad.id)).length, 0);
  assert.equal((await logOf(dad.id)).length, 0);
  assert.equal(await count(`idempotency_keys where scope = $1`, [dad.id]), 0);
  assert.ok(await marked(spare));
  // A share link with its sender gone still opens, naming nobody.
  const opened = ok(await post(w.app, null, "/v1/shares/open", { token: share.token }, { key: null }));
  assert.equal(opened.sender, null);
});

test("a deleted person's name and words don't linger on what others were pushed", { skip }, async () => {
  const w = await world();
  await phone(w, w.mom, "mom");
  const pair = await pairOf(w, w.mom, w.dad);
  await text(w, w.dad, pair, "SECRET-WORDS");
  await drain();
  await tombstone(w.dad);
  await purge(w, w.dad);
  const stored = JSON.stringify(await logOf(w.mom.id));
  assert.ok(!stored.includes("SECRET-WORDS"));
  assert.ok(!stored.includes("Dad"));
});

test("safe to run again, and past a batch: more messages than one batch all go", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const many = PURGE_BATCH + 50;
  await db().query(
    `insert into messages (family_id, thread_id, sender_id, kind, body) select $1, $2, $3, 'text', 'm' || g from generate_series(1, $4::int) g`,
    [w.family, pair, w.dad.id, many],
  );
  await text(w, w.mom, pair, "Mine");
  await tombstone(w.dad);
  await purge(w, w.dad);
  assert.equal(await count(`messages where sender_id = $1`, [w.dad.id]), 0);
  await purge(w, w.dad);
  assert.equal(await count(`messages where thread_id = $1`, [pair]), 1);
});

test("a task for a deleted person's row does nothing", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.mom.id);
  const { questionId } = ok(await post(w.app, w.dad, "/v1/questions", { recipeId: chili, text: "Salt?" }), 201);
  ok(await post(w.app, w.mom, `/v1/questions/${questionId}/answer`, { text: "Yes" }));
  const pair = await pairOf(w, w.dad, w.mom);
  await text(w, w.dad, pair, "Hi");
  await tombstone(w.dad);
  await purge(w, w.dad);
  await drain(); // the outbox rows left behind: none finds anything to do
  assert.equal(w.expo.sent.flat().length, 0);
});

after(closeAll);
