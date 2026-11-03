// Anonymous file safety. There's no session on these routes, so files.ts's fileKeys guard can't run; a capability (`fileId`, stored only as
// files.capability_hash) stands in for it. Each rule below has its own test, and the last test reaches every field in the real app that says
// it isn't an S3 key, so a new one can't skip this.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { FILE_GONE, sha256Hex } from "../src/modules/dish/values.js";
import { sweep } from "../src/modules/dish/tasks.js";
import {
  advance,
  answer,
  answerClip,
  answersOf,
  askedCard,
  askMom,
  attachAnswer,
  fileId,
  finish,
  getCard,
  hasDatabase,
  like,
  makeCard,
  MIN,
  newBackend,
  post,
  type Reply,
  rowOf,
  settle,
  silent,
  store,
} from "./dishHelpers.js";

const skip = !hasDatabase;
const GONE = { status: 404, data: { error: "not_found", message: FILE_GONE } };
/** A reply's bytes but its request id, which each reply has its own of. */
const bytes = (r: Reply) => r.body.replace(r.data.requestId, "");
const fileRow = async (id: string) => (await db().query("select * from files where capability_hash = $1", [sha256Hex(id)])).rows[0];
const outboxHears = async () => (await db().query("select count(*)::int as n from outbox where payload->>'task' = 'dish.hear'")).rows[0].n;

test("a capability reaches its own file, and only its hash is stored", { skip }, async () => {
  const t = await newBackend();
  const mine = await fileId(t, "photo");
  const theirs = await fileId(t, "photo");
  const { kidToken, card } = await makeCard(t, { dish: "dal", photos: [mine] });
  const row = await rowOf(kidToken);
  assert.equal(row.photo_keys.length, 1);
  assert.equal(row.photo_keys[0], (await fileRow(mine)).key);
  assert.notEqual(row.photo_keys[0], (await fileRow(theirs)).key);
  assert.ok(card.photoUrls[0].includes(row.photo_keys[0]));
  const stored = JSON.stringify((await db().query("select * from files")).rows);
  for (const id of [mine, theirs]) assert.ok(!stored.includes(id));
  assert.equal((await fileRow(mine)).capability_hash, sha256Hex(mine));
});

test("an S3 key isn't a capability: naming a file by its key, whole or in part, gets nowhere", { skip }, async () => {
  const t = await newBackend();
  const key = (await fileRow(await fileId(t, "photo"))).key as string;
  // A key isn't the shape of a file id, so it's refused at the door.
  like(await post(t, "/dish/cards", { dish: "dal", photos: [key] }), { status: 400 });
  const slice = key.replaceAll(/[^0-9A-Za-z]/g, "").slice(0, 22);
  like(await post(t, "/dish/cards", { dish: "dal", photos: [slice] }), GONE);
});

// --- A file held by a card, or by a dish answer, is refused. ---

test("held by a card: another card can't take it, by any route, and the first card keeps it", { skip }, async () => {
  const t = await newBackend();
  const photo = await fileId(t, "photo");
  const note = await fileId(t, "voice");
  const about = await fileId(t, "voice");
  const a = await makeCard(t, { dish: "dal", photos: [photo], voiceNote: about });
  const b = await makeCard(t, { dish: "pozole" });
  await post(t, "/dish/cards/update", { kidToken: a.kidToken, voiceNote: note });
  like(await post(t, "/dish/cards", { dish: "upma", photos: [photo] }), GONE);
  like(await post(t, "/dish/cards", { dish: "upma", voiceNote: about }), GONE);
  like(await post(t, "/dish/cards/update", { kidToken: b.kidToken, voiceNote: note }), GONE);
  like(await post(t, "/dish/cards/update", { kidToken: b.kidToken, voiceNote: about }), GONE);
  const row = await rowOf(a.kidToken);
  assert.equal((await fileRow(photo)).ask_id, row.id);
  assert.equal((await fileRow(note)).ask_id, row.id);
  assert.equal((await rowOf(b.kidToken)).kid_voice_note_key, null);
  // The same card, another field: not the same attach.
  like(await post(t, "/dish/cards/update", { kidToken: a.kidToken, voiceNote: about }), GONE);
});

test("held by a dish answer: neither a kid nor another card's Mom can take her clip", { skip }, async () => {
  const t = await newBackend();
  const a = await askedCard(t);
  const b = await askedCard(t, "192.0.2.60");
  const link = await answerClip(t, a.askToken, "q1");
  const clip = link.data.fileId;
  assert.equal((await attachAnswer(t, a.askToken, "q1", clip)).status, 200);
  like(await post(t, "/dish/cards", { dish: "upma", voiceNote: clip }), GONE);
  like(await post(t, "/dish/cards/update", { kidToken: a.kidToken, voiceNote: clip }), GONE); // her own card's kid
  like(await post(t, "/dish/cards/update", { kidToken: b.kidToken, voiceNote: clip }), GONE);
  like(await attachAnswer(t, b.askToken, "q1", clip), GONE);
  assert.deepEqual(await answersOf((await rowOf(b.kidToken)).id), []);
});

test("a clip uploaded for one card's answer can't land anywhere else, even before it's attached", { skip }, async () => {
  const t = await newBackend();
  const a = await askedCard(t);
  const b = await askedCard(t, "192.0.2.61");
  const clip = (await answerClip(t, a.askToken, "q1")).data.fileId;
  like(await attachAnswer(t, b.askToken, "q1", clip), GONE);
  like(await post(t, "/dish/cards/update", { kidToken: a.kidToken, voiceNote: clip }), GONE);
  // A kid's voice note isn't an answer either.
  const note = await fileId(t, "voice");
  like(await attachAnswer(t, a.askToken, "q1", note), GONE);
  assert.equal((await fileRow(note)).attached_at, null);
  // Her clip on another question of her own card, once it holds q1, isn't the same attach.
  await askMom(t, a.kidToken, [{ id: "q1", text: "How much ketchup?" }, { id: "q2", text: "How do you know it's done?" }]);
  assert.equal((await attachAnswer(t, a.askToken, "q1", clip)).status, 200);
  like(await attachAnswer(t, a.askToken, "q2", clip), GONE);
});

// --- The same caller's retry of the same attach succeeds and changes nothing, and two at once stay one attach. ---

test("retry: the same voice note on the same card succeeds and changes nothing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken } = await makeCard(t);
  const note = await fileId(t, "voice");
  const first = await post(t, "/dish/cards/update", { kidToken, voiceNote: note, voiceNoteS: 12 });
  assert.equal(first.status, 200);
  const before = await rowOf(kidToken);
  const file = await fileRow(note);
  const again = await post(t, "/dish/cards/update", { kidToken, voiceNote: note, voiceNoteS: 12 });
  assert.equal(again.status, 200);
  assert.deepEqual(again.data.card, first.data.card);
  assert.deepEqual(await rowOf(kidToken), before);
  assert.deepEqual(await fileRow(note), file);
  assert.equal(file.delete_requested_at, null, "the retry didn't replace it with itself and delete it");
});

test("retry: two of the same voice note at once are one attach", { skip }, async () => {
  const t = await newBackend();
  const { kidToken } = await makeCard(t);
  const note = await fileId(t, "voice");
  const send = () => post(t, "/dish/cards/update", { kidToken, voiceNote: note });
  const replies = await Promise.all([send(), send(), send(), send()]);
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200]);
  const row = await rowOf(kidToken);
  const file = await fileRow(note);
  assert.equal(row.kid_voice_note_key, file.key);
  assert.equal(file.ask_id, row.id);
  assert.equal(file.delete_requested_at, null);
});

test("retry: the same clip on the same question succeeds and changes nothing, even after Send", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const clip = (await answerClip(t, askToken, "q1")).data.fileId;
  const first = await attachAnswer(t, askToken, "q1", clip);
  assert.equal(first.status, 200);
  const [before] = await answersOf((await rowOf(kidToken)).id);
  const again = await attachAnswer(t, askToken, "q1", clip);
  assert.equal(again.status, 200);
  assert.deepEqual(again.data.ask, first.data.ask);
  assert.deepEqual((await answersOf((await rowOf(kidToken)).id))[0], before);
  assert.equal(await outboxHears(), 1, "her clip is heard once");

  await finish(t, askToken);
  await settle();
  assert.equal((await attachAnswer(t, askToken, "q1", clip)).status, 200, "a late retry of a merged clip");
  assert.equal((await getCard(t, kidToken)).status, "answered");
  assert.equal(await outboxHears(), 1);
});

test("retry: two of the same clip at once are one attach, one answer, one hearing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const clip = (await answerClip(t, askToken, "q1")).data.fileId;
  const replies = await Promise.all(Array.from({ length: 5 }, () => attachAnswer(t, askToken, "q1", clip)));
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200, 200]);
  const answers = await answersOf((await rowOf(kidToken)).id);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].audio_key, (await fileRow(clip)).key);
  assert.equal(await outboxHears(), 1);
});

test("two cards racing for one file: one wins, the other gets the one not-found and leaves nothing behind", { skip }, async () => {
  const t = await newBackend();
  const photo = await fileId(t, "photo");
  const replies = await Promise.all(Array.from({ length: 4 }, (_, i) => post(t, "/dish/cards", { dish: "dal", photos: [photo] }, { ip: `192.0.2.${70 + i}` })));
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 404, 404, 404]);
  for (const r of replies.filter((x) => x.status === 404)) like(r, GONE);
  assert.equal((await db().query("select 1 from dish_asks")).rowCount, 1, "the losers' cards rolled back");
});

test("a card's own create can't be retried: its token isn't stored, so its files answer not-found (DISH-MIGRATION.md)", { skip }, async () => {
  const t = await newBackend();
  const photo = await fileId(t, "photo");
  await makeCard(t, { dish: "dal", photos: [photo] });
  like(await post(t, "/dish/cards", { dish: "dal", photos: [photo] }), GONE);
  assert.equal((await db().query("select 1 from dish_asks")).rowCount, 1);
});

// --- Anything else gets the same not-found answer, whatever the reason. ---

test("every refusal reads the same, byte for byte: a guess, someone else's, unconfirmed, deleted, on its way out, the wrong kind", { skip }, async () => {
  const t = await newBackend();
  const a = await makeCard(t, { dish: "dal", voiceNote: await fileId(t, "voice") });
  const guess = "Q".repeat(22);
  const taken = await fileId(t, "voice");
  await post(t, "/dish/cards/update", { kidToken: a.kidToken, voiceNote: taken });
  const notUploaded = (await post(t, "/dish/files?kind=voice", { contentType: "audio/mp4", size: 100 })).data.fileId;
  const deleted = await fileId(t, "voice");
  await db().query("update files set deleted_at = now() where capability_hash = $1", [sha256Hex(deleted)]);
  const going = await fileId(t, "voice");
  await db().query("update files set delete_requested_at = now() where capability_hash = $1", [sha256Hex(going)]);
  const wrongKind = await fileId(t, "photo");
  const b = await makeCard(t, { dish: "pozole" });

  const replies = [];
  for (const [i, id] of [guess, taken, notUploaded, deleted, going, wrongKind].entries()) {
    replies.push(await post(t, "/dish/cards/update", { kidToken: b.kidToken, voiceNote: id }, { ip: `192.0.2.${100 + i}` }));
  }
  for (const r of replies) like(r, GONE);
  assert.equal(new Set(replies.map(bytes)).size, 1, replies.map((r) => r.body).join(" | "));
  assert.equal(new Set(replies.map((r) => JSON.stringify(Object.keys(r.headers).filter((h) => h !== "x-request-id" && h !== "date" && h !== "content-length")))).size, 1);
});

test("on the card route too, and on Mom's: a guess gets what a real file that isn't yours gets", { skip }, async () => {
  const t = await newBackend();
  const guess = "Q".repeat(22);
  const taken = await fileId(t, "photo");
  await makeCard(t, { dish: "dal", photos: [taken] });
  const onCard = await Promise.all([guess, taken].map((id, i) => post(t, "/dish/cards", { dish: "x y", photos: [id] }, { ip: `192.0.2.${110 + i}` })));
  like(onCard[0], GONE);
  assert.equal(bytes(onCard[0]), bytes(onCard[1]));

  const a = await askedCard(t, "192.0.2.112");
  const b = await askedCard(t, "192.0.2.113");
  const hers = (await answerClip(t, a.askToken, "q1", { ip: "192.0.2.112" })).data.fileId;
  const onAnswer = await Promise.all([guess, hers].map((id, i) => attachAnswer(t, b.askToken, "q1", id, { ip: `192.0.2.${114 + i}` })));
  like(onAnswer[0], GONE);
  assert.equal(bytes(onAnswer[0]), bytes(onAnswer[1]));
  like(await post(t, "/dish/files/confirm", { fileId: guess }), GONE);
});

test("an upload S3 never got can't be confirmed; a real one can; a file that isn't what its link said is deleted", { skip }, async () => {
  const t = await newBackend();
  const link = (await post(t, "/dish/files?kind=photo", { contentType: "image/jpeg", size: 2000 })).data;
  like(await post(t, "/dish/files/confirm", { fileId: link.fileId }), GONE);
  assert.equal((await fileRow(link.fileId)).uploaded_at, null);
  store.put(link.uploadUrl, new Uint8Array(2000), "image/jpeg");
  assert.equal((await post(t, "/dish/files/confirm", { fileId: link.fileId })).status, 201);
  assert.ok((await fileRow(link.fileId)).uploaded_at);
  // Asking again is harmless, and doesn't ask S3.
  store.failHeads = true;
  assert.equal((await post(t, "/dish/files/confirm", { fileId: link.fileId })).status, 201);
  store.failHeads = false;

  // S3 refuses a mismatch on a signed link. If one ever arrives, it's still not used.
  const big = (await post(t, "/dish/files?kind=photo", { contentType: "image/jpeg", size: 100 })).data;
  store.put(big.uploadUrl, new Uint8Array(6 * 1024 * 1024), "image/jpeg");
  like(await post(t, "/dish/files/confirm", { fileId: big.fileId }), { status: 413, data: { error: "too_large" } });
  assert.ok((await fileRow(big.fileId)).delete_requested_at);
  const odd = (await post(t, "/dish/files?kind=photo", { contentType: "image/jpeg", size: 100 })).data;
  store.put(odd.uploadUrl, new Uint8Array(100), "image/gif");
  like(await post(t, "/dish/files/confirm", { fileId: odd.fileId }), { status: 415, data: { error: "bad_type" } });
  await sweep({ log: silent });
  assert.ok(!store.objects.has((await fileRow(big.fileId)).key));
});

test("a clip's link follows the card's rules: an unasked question or a closed card gets no link", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  like(await answerClip(t, askToken, "q5"), { status: 400, data: { error: "invalid", field: "q", message: "That question wasn't asked." } });
  assert.equal(await answer(t, askToken, "q1").then((r) => r.status), 200);
  await finish(t, askToken);
  like(await answerClip(t, askToken, "q1"), { status: 409, data: { error: "closed" } });
  assert.equal((await db().query("select 1 from files")).rowCount, 1);
});

test("the upload's link is what S3 needs to refuse the wrong thing: its type and size", { skip }, async () => {
  const t = await newBackend();
  const r = await post(t, "/dish/files?kind=voice", { contentType: "audio/webm;codecs=opus", size: 1234 });
  assert.equal(r.status, 201);
  like(r.data, { kind: "voice", contentType: "audio/webm", size: 1234, uploadHeaders: { "Content-Type": "audio/webm" }, expiresInS: 120 });
  const row = await fileRow(r.data.fileId);
  like(row, { bucket: "private", kind: "voice", content_type: "audio/webm", uploaded_at: null, attached_at: null, family_id: null, owner_person_id: null });
  assert.equal(String(row.size_bytes), "1234");
  assert.match(row.key, /^private\/dish\//);
  like(await post(t, "/dish/files?kind=voice", { contentType: "audio/webm", size: "big" }), { status: 400 });
  like(await post(t, "/dish/files?kind=voice", { contentType: "audio/webm", size: -1 }), { status: 400 });
});

test("an abandoned clip goes with the hour, as any upload does", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  const clip = (await answerClip(t, askToken, "q1")).data.fileId;
  const key = (await fileRow(clip)).key;
  await advance(61 * MIN);
  await sweep({ log: silent });
  assert.ok(!store.objects.has(key));
  like(await attachAnswer(t, askToken, "q1", clip), GONE);
});

test("every anonymous file field in the real app is checked: a guess is refused, and nothing is exempt by accident", { skip }, async () => {
  const t = await newBackend();
  const kid = await makeCard(t);
  const ask = (await askedCard(t, "192.0.2.80")).askToken;
  const guess = "Q".repeat(22);
  // Field by field, how to send a guess there. A new exemption fails this until it's listed here with its own check.
  const checks: Record<string, ((id: string) => Promise<{ status: number; data: unknown }>) | "not a file"> = {
    "/dish/files/confirm fileId": (id) => post(t, "/dish/files/confirm", { fileId: id }, { ip: "192.0.2.81" }),
    "/dish/cards photos": (id) => post(t, "/dish/cards", { dish: "dal", photos: [id] }, { ip: "192.0.2.82" }),
    "/dish/cards voiceNote": (id) => post(t, "/dish/cards", { dish: "dal", voiceNote: id }, { ip: "192.0.2.83" }),
    "/dish/cards/update voiceNote": (id) => post(t, "/dish/cards/update", { kidToken: kid.kidToken, voiceNote: id }, { ip: "192.0.2.84" }),
    "/dish/cards/update voiceNoteS": "not a file", // its length in seconds
    "/dish/ask/answer fileId": (id) => attachAnswer(t, ask, "q1", id, { ip: "192.0.2.85" }),
    // Signed-in routes, each with its own refusals in messagesFiles.test.ts. Not anonymous files, so not this test's guess.
    "/v1/uploads/confirm key": "not a file",
    "/v1/threads/:id/messages clipKey": "not a file",
    "/web-events path": "not a file", // the lander's page, as text: webEvents.test.ts
  };
  const app = buildApp({ logger: false });
  await app.ready();
  const declared = app.notFileKeyRoutes.flatMap((route) => route.fields.map((field) => `${route.url} ${field}`));
  assert.deepEqual(declared.sort(), Object.keys(checks).sort());
  for (const [name, check] of Object.entries(checks)) {
    if (check !== "not a file") like(await check(guess), GONE, name);
  }
});

after(async () => {
  if (hasDatabase) await db().end();
});
