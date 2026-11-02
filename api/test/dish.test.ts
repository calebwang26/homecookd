// The dish ask, every route through the app on real Postgres: convex/dishAsks.test.ts carried over, same titles where the meaning is the same.
// The models run in fake mode (DISH_FAKE_AI=1); `model` can make one fail or answer otherwise. S3 is a fake. Where the old test sent raw
// bytes, the helpers now do what a page does: ask for a link, put the bytes on S3, go on. docs/build/DISH-MIGRATION.md lists the differences.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { claimMerge, saveVersion } from "../src/modules/dish/merge.js";
import { DishModelError, FAKE_COST, FAKE_WORDS } from "../src/modules/dish/model.js";
import { askTokenFor, sha256Hex } from "../src/modules/dish/values.js";
import { handleMessage } from "../src/scheduled.js";
import {
  advance,
  answer,
  answersOf,
  anyNumber,
  anyString,
  askedCard,
  askMom,
  call,
  clearWindow,
  close,
  fileId,
  finish,
  getCard,
  hasDatabase,
  IP,
  like,
  makeCard,
  MIN,
  model,
  MOM_ASKED,
  near,
  newBackend,
  nextDay,
  ORIGIN,
  peek,
  post,
  rowOf,
  runNow,
  seedSpend,
  settle,
  silent,
  spent,
  store,
  TOKEN22,
  upload,
} from "./dishHelpers.js";

const skip = !hasDatabase;

const files = async () => (await db().query("select * from files order by created_at")).rows;

// ---------------------------------------------------------------------------------------------
// The kid's card

test("a card: two 22-character tokens, only their hashes stored, tonight's guess and the Ask Mom message", { skip }, async () => {
  const t = await newBackend();
  const r = await post(t, "/dish/cards", { dish: "  tomato egg ", kidName: "Caleb" });
  assert.equal(r.status, 201);
  assert.equal(r.headers["access-control-allow-origin"], ORIGIN);
  const { kidToken, card } = r.data;
  assert.match(kidToken, TOKEN22);
  const askToken = new URL(card.askUrl).searchParams.get("t")!;
  assert.equal(card.askUrl, `https://homecookd.app/a?t=${askToken}`);
  assert.equal(askToken, askTokenFor(kidToken));
  assert.match(askToken, TOKEN22);
  like(card, {
    dish: "tomato egg",
    relation: "mom",
    kidName: "Caleb",
    status: "draft",
    version: null,
    answers: [],
    merging: false,
    asked: [],
    message: "Mom, how do you make your tomato egg? I'm trying to make it here.",
    kidVoiceUrl: null,
    photoUrls: [],
    askedAt: null,
    openedAt: null,
    finishedAt: null,
    createdAt: near(Date.now()),
  });
  assert.equal(card.guess.servings, "1");
  assert.deepEqual(card.guess.questions.map((q: { id: string }) => q.id), ["q1", "q2", "q3"]);
  const ketchup = card.guess.ingredients.find((i: { name: string }) => i.name === "ketchup");
  like(ketchup, { amount: "", status: "unknown", isGuess: true, ask: "q1", clip: null, was: null, quote: null });
  like(card.guess.steps[0].lines[0], { status: "guessed", isGuess: true, was: null, quote: null });

  const row = await rowOf(kidToken);
  assert.equal(row.kid_token_hash, sha256Hex(kidToken));
  assert.equal(row.ask_token_hash, sha256Hex(askToken));
  const stored = JSON.stringify((await db().query("select * from dish_asks")).rows);
  for (const secret of [kidToken, askToken, IP]) assert.ok(!stored.includes(secret));
  assert.match(row.ip_key!, /^[0-9a-f]{64}$/);
  close(await spent(), FAKE_COST.guess);
});

test("a card's shape: exactly the fields the site's types name", { skip }, async () => {
  const t = await newBackend();
  const { card } = await makeCard(t);
  assert.deepEqual(Object.keys(card).sort(), [
    "askUrl", "askedAt", "answers", "asked", "createdAt", "dish", "filmingDay", "finishedAt", "guess", "kidName", "kidVoiceS", "kidVoiceUrl",
    "merging", "message", "openedAt", "photoUrls", "relation", "status", "version",
  ].sort());
  const ask = await peek(t, new URL(card.askUrl).searchParams.get("t")!);
  assert.deepEqual(Object.keys(ask).sort(), [
    "answered", "clips", "dish", "finished", "guess", "inLang", "kidName", "kidVoiceS", "kidVoiceUrl", "merging", "message", "photoUrls", "questions", "relation", "version",
  ].sort());
});

test("old links keep working: the ask token is worked out exactly as Convex does", () => {
  // The first 22 base62 digits of sha256("ask:" + kidToken).
  assert.equal(askTokenFor("A".repeat(22)), ASK_FOR_AS);
});
const ASK_FOR_AS = "SVzfCqjszVI6GTwW6xsuR5"; // computed from the formula; dishCopies.test.ts checks Convex still uses it

test("cards: bad input, filtered words and words that aren't a dish are refused, and nothing is stored", { skip }, async () => {
  const t = await newBackend();
  const card = (body: unknown, ip: string) => post(t, "/dish/cards", body, { ip });
  const cases: [unknown, number, string][] = [
    [{ dish: "x" }, 400, "bad_request"],
    [{}, 400, "bad_request"],
    [{ dish: "dal", relation: "cousin" }, 400, "bad_request"],
    [{ dish: "dal", kidName: "x".repeat(41) }, 400, "bad_request"],
    [{ dish: "x".repeat(201) }, 400, "bad_request"],
    [{ dish: "dal", photos: ["a", "b", "c", "d"] }, 400, "bad_request"],
    [{ dish: "dal", photos: "nope" }, 400, "bad_request"],
    [{ dish: "dal", voiceNote: "not-a-file-id" }, 400, "bad_request"],
    ["not json", 400, "bad_request"],
    ["[1,2]", 400, "bad_request"],
    [{ dish: "fuck this dal" }, 422, "words"],
    [{ dish: "dal", kidName: "slut" }, 422, "words"],
    [{ dish: "asdf qwerty" }, 422, "not_a_dish"],
  ];
  for (const [i, [body, status, code]] of cases.entries()) {
    const r = await card(body, `198.51.100.${i}`);
    assert.deepEqual([r.status, r.data.code], [status, code], JSON.stringify(body));
    assert.equal(typeof r.data.error, "string");
  }
  assert.equal((await card("[1,2]", "198.51.100.98")).data.error, "The body must be a JSON object.");
  assert.equal((await card("not json", "198.51.100.97")).data.error, "The body must be JSON.");
  assert.equal((await call(t, "POST", "/dish/cards/get", undefined)).data.error, "kidToken is required");
  assert.equal((await card({ dish: "x".repeat(70_000) }, "198.51.100.99")).status, 413);
  assert.equal((await db().query("select 1 from dish_asks")).rowCount, 0);
  // Only the not-a-dish one reached the model.
  assert.equal(model.calls.guess, 1);
});

test("cards: a filtered word in the guess is refused; a model failure is 502 and a missing key 503", { skip }, async () => {
  const t = await newBackend();
  model.guess = async (real) => {
    const r = (await real()) as { notADish: false; recipe: { ingredients: { name: string }[] } };
    r.recipe.ingredients[0].name = "whore eggs";
    return r;
  };
  like(await post(t, "/dish/cards", { dish: "tomato egg" }), { status: 422, data: { code: "words" } });
  model.guess = async () => {
    throw new DishModelError("model", "Claude 500");
  };
  like(await post(t, "/dish/cards", { dish: "tomato egg" }), { status: 502, data: { code: "model" } });
  model.guess = async () => {
    throw new DishModelError("not_set_up", "ANTHROPIC_API_KEY isn't set");
  };
  like(await post(t, "/dish/cards", { dish: "tomato egg" }), { status: 503, data: { code: "not_set_up" } });
  assert.equal((await db().query("select 1 from dish_asks")).rowCount, 0);
});

test("cards: 6 per IP in 10 minutes and 30 a day; the keys hold an HMAC of the IP, never the IP", { skip }, async () => {
  const t = await newBackend();
  for (let i = 0; i < 6; i++) await makeCard(t);
  like(await post(t, "/dish/cards", { dish: "tomato egg" }), { status: 429, data: { code: "rate" } });
  await makeCard(t, { dish: "dal" }, "192.0.2.50"); // another IP
  for (let w = 1; w < 5; w++) {
    await clearWindow("dish-cards");
    for (let i = 0; i < 6; i++) await makeCard(t);
  }
  await clearWindow("dish-cards"); // a new 10 minutes, but 30 today
  like(await post(t, "/dish/cards", { dish: "tomato egg" }), { status: 429, data: { code: "rate" } });
  const keys = (await db().query("select key from rate_hits")).rows.map((r) => r.key as string);
  assert.ok(keys.some((k) => k.startsWith("dish-cards-day:")));
  for (const k of keys) {
    assert.ok(!k.includes(IP));
    assert.match(k, /^dish-[a-z-]+:[0-9a-f]{64}$/);
  }
});

test("cards from photos and a voice note: the photos stay on the card; the voice note is heard and kept privately", { skip }, async () => {
  const t = await newBackend();
  const photos = [await fileId(t, "photo"), await fileId(t, "photo")];
  const voice = (await upload(t, "voice", "audio/webm", 2500)).data.fileId;
  const { card, kidToken, askToken } = await makeCard(t, { dish: "", photos, voiceNote: voice });
  assert.equal(card.dish, "tomato egg"); // nothing typed: the guess names it
  assert.equal(card.photoUrls.length, 2);
  assert.equal(card.kidVoiceUrl, null); // it isn't the voice note to Mom
  assert.equal(model.calls.transcribe, 1);
  const row = await rowOf(kidToken);
  const rows = await files();
  assert.deepEqual(rows.map((f) => [f.kind, f.ask_id]), [["photo", row.id], ["photo", row.id], ["voice", row.id]]);
  assert.equal(row.dish_voice_note_key, rows[2].key);
  assert.ok(store.objects.has(row.dish_voice_note_key!));
  // Neither page gets it.
  assert.ok(!JSON.stringify(await getCard(t, kidToken)).includes(row.dish_voice_note_key!));
  assert.ok(!JSON.stringify(await peek(t, askToken)).includes(row.dish_voice_note_key!));
  close(await spent(), FAKE_COST.guess + FAKE_COST.transcribe);

  // A file goes on one card only; an unknown one is a 404. The wrong kind is a 404 too (a 400 on Convex: DISH-MIGRATION.md).
  like(await post(t, "/dish/cards", { dish: "dal", photos: [photos[0]] }), { status: 404, data: { code: "not_found" } });
  like(await post(t, "/dish/cards", { dish: "dal", photos: ["A".repeat(22)] }), { status: 404 });
  const another = await fileId(t, "voice");
  like(await post(t, "/dish/cards", { dish: "dal", photos: [another] }), { status: 404, data: { code: "not_found" } });
  like(await post(t, "/dish/cards", { dish: "dal", photos: [another, another] }), { status: 400 });
});

// ---------------------------------------------------------------------------------------------
// Uploads

test("files: photos and voice notes by type and size, checked before anything is stored; 30 per IP in 10 minutes", { skip }, async () => {
  const t = await newBackend();
  const photo = await upload(t, "photo", "image/jpeg", 1000);
  assert.equal(photo.status, 201);
  assert.match(photo.data.fileId, TOKEN22);
  assert.deepEqual(photo.data, { fileId: photo.data.fileId, kind: "photo", contentType: "image/jpeg", size: 1000 });
  const voice = await upload(t, "voice", "audio/webm;codecs=opus", 500);
  like(voice.data, { kind: "voice", contentType: "audio/webm", size: 500 });
  for (const type of ["audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"]) {
    assert.equal((await upload(t, "voice", type, 10, { ip: "192.0.2.1" })).status, 201, type);
  }
  const stored = store.objects.size;
  assert.equal(stored, 9);
  const fileRow = (await files())[0];
  assert.ok(!JSON.stringify(fileRow).includes(photo.data.fileId)); // only its hash

  const refused: [string, string, number, number, string][] = [
    ["photo", "image/gif", 100, 415, "bad_type"],
    ["photo", "audio/webm", 100, 415, "bad_type"],
    ["voice", "image/jpeg", 100, 415, "bad_type"],
    ["voice", "video/mp4", 100, 415, "bad_type"],
    ["photo", "image/png", 5 * 1024 * 1024 + 1, 413, "too_large"],
    ["voice", "audio/mp4", 3 * 1024 * 1024 + 1, 413, "too_large"],
    ["photo", "image/png", 0, 400, "bad_request"],
    ["video", "video/mp4", 100, 400, "bad_request"],
  ];
  const rows = (await files()).length;
  for (const [kind, type, bytes, status, code] of refused) {
    const r = await upload(t, kind, type, bytes, { ip: "192.0.2.2" });
    assert.deepEqual([r.status, r.data.code], [status, code], `${kind} ${type} ${bytes}`);
  }
  assert.equal(store.objects.size, stored);
  assert.equal((await files()).length, rows, "a refused call leaves no row");

  for (let i = 0; i < 28; i++) assert.equal((await upload(t, "photo", "image/webp", 10)).status, 201);
  like(await upload(t, "photo", "image/webp", 10), { status: 429, data: { code: "rate" } });
});

test("an upload no card took is deleted after an hour; one on a card stays", { skip }, async () => {
  const t = await newBackend();
  const kept = await fileId(t, "photo");
  const orphan = await fileId(t, "photo");
  await makeCard(t, { dish: "dal", photos: [kept] });
  const before = await files();
  const orphanRow = before.find((f) => !f.ask_id)!;
  await advance(59 * MIN);
  await sweep({ log: silent });
  assert.equal(store.removed.length, 0);
  await advance(2 * MIN);
  await sweep({ log: silent });
  assert.deepEqual(store.removed, [orphanRow.key]);
  assert.ok(!store.objects.has(orphanRow.key));
  const left = (await files()).filter((f) => !f.deleted_at);
  assert.deepEqual(left.map((f) => f.kind), ["photo"]);
  assert.ok(left[0].ask_id);
  like(await post(t, "/dish/cards", { dish: "dal", photos: [orphan] }), { status: 404 });
});

// ---------------------------------------------------------------------------------------------
// get, update, sent

test("cards/get, update and sent: the same card back; who, name, message and the voice note to Mom change", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, card } = await makeCard(t);
  assert.deepEqual(await getCard(t, kidToken), card);
  const update = (body: Record<string, unknown>) => post(t, "/dish/cards/update", { kidToken, ...body });

  // The untouched message follows who they're asking; an edited one stays.
  let r = await update({ relation: "grandma", kidName: "Cal" });
  like(r.data.card, { relation: "grandma", kidName: "Cal", message: "Grandma, how do you make your tomato egg? I'm trying to make it here." });
  r = await update({ message: "  Nani, how do you make it?  " });
  assert.equal(r.data.card.message, "Nani, how do you make it?");
  assert.equal((await update({ relation: "dad" })).data.card.message, "Nani, how do you make it?");
  assert.equal((await update({ kidName: null })).data.card.kidName, null);

  like(await update({ message: "   " }), { status: 400, data: { code: "bad_request" } });
  like(await update({ message: "x".repeat(501) }), { status: 400 });
  like(await update({ message: 5 }), { status: 400 });
  like(await update({ message: "fuck it, just tell me" }), { status: 422, data: { code: "words" } });
  like(await update({ kidName: "cunt" }), { status: 422, data: { code: "words" } });
  like(await update({ relation: "boss" }), { status: 400 });

  // The voice note to Mom: a new one replaces (and deletes) the old; null removes it.
  const first = await fileId(t, "voice");
  r = await update({ voiceNote: first });
  like(r.data.card, { kidVoiceUrl: anyString });
  const firstKey = (await rowOf(kidToken)).kid_voice_note_key!;
  const second = await fileId(t, "voice");
  await update({ voiceNote: second });
  await sweep({ log: silent });
  assert.ok(!store.objects.has(firstKey));
  const secondKey = (await rowOf(kidToken)).kid_voice_note_key!;
  assert.notEqual(secondKey, firstKey);
  like(await update({ voiceNote: first }), { status: 404 }); // gone with its card spot
  like(await update({ voiceNote: await fileId(t, "photo") }), { status: 404 }); // the wrong kind: the one not-found (a 400 on Convex)
  r = await update({ voiceNote: null });
  assert.equal(r.data.card.kidVoiceUrl, null);
  await sweep({ log: silent });
  assert.ok(!store.objects.has(secondKey));
  assert.equal((await files()).filter((f) => !f.delete_requested_at).length, 1); // only the unused photo

  // Sent: the first one marks it asked.
  r = await post(t, "/dish/cards/sent", { kidToken, via: "whatsapp" });
  like(r.data.card, { status: "asked", askedAt: near(Date.now()) });
  const askedAt = r.data.card.askedAt;
  r = await post(t, "/dish/cards/sent", { kidToken, via: "copy" });
  assert.equal(r.data.card.askedAt, askedAt);
  assert.equal((await rowOf(kidToken)).asked_via, "whatsapp");
  like(await post(t, "/dish/cards/sent", { kidToken, via: "fax" }), { status: 400 });
});

test("once Mom sent her answers, the message and the voice note to her are closed (409); who and name aren't", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle();
  const update = (body: Record<string, unknown>) => post(t, "/dish/cards/update", { kidToken, ...body });
  like(await update({ message: "Mom?" }), { status: 409, data: { code: "closed", error: "Mom already sent her answers." } });
  like(await update({ voiceNote: null }), { status: 409 });
  assert.equal((await update({ kidName: "Cal" })).status, 200);
});

// ---------------------------------------------------------------------------------------------
// Tokens, CORS

test("unknown and malformed tokens are 404, and after 20 in 10 minutes the IP gets 429; good tokens still work", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await makeCard(t);
  const bad = "Z".repeat(22);
  like(await post(t, "/dish/cards/get", { kidToken: bad }), { status: 404, data: { code: "not_found", error: "This link doesn't work anymore." } });
  like(await post(t, "/dish/cards/get", {}), { status: 400 }); // missing: not counted
  like(await post(t, "/dish/ask/peek", { askToken: "short" }), { status: 404 });
  like(await post(t, "/dish/cards/get", { kidToken: askToken }), { status: 404 }); // the ask token reads no card
  like(await post(t, "/dish/ask/peek", { askToken: kidToken }), { status: 404 }); // and the kid token isn't Mom's
  like(await answer(t, askToken, "q1", { token: bad }), { status: 404 });
  for (let i = 5; i < 20; i++) assert.equal((await post(t, "/dish/ask/finish", { askToken: bad })).status, 404);
  like(await post(t, "/dish/cards/update", { kidToken: bad }), { status: 429, data: { code: "rate" } });
  assert.equal((await post(t, "/dish/cards/get", { kidToken })).status, 200);
  assert.equal((await post(t, "/dish/ask/peek", { askToken })).status, 200);
  assert.equal((await post(t, "/dish/cards/get", { kidToken: bad }, { ip: "192.0.2.77" })).status, 404);
  await clearWindow("dish-bad");
  assert.equal((await post(t, "/dish/cards/get", { kidToken: bad })).status, 404);
});

test("CORS: homecookd.app and local dev pages get their origin back, other sites 403, and the preflight allows X-Dish-Token", { skip }, async () => {
  const t = await newBackend();
  const pre = (origin: string) => call(t, "OPTIONS", "/dish/ask/answer", undefined, { origin });
  const ok = await pre("https://www.homecookd.app");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers["access-control-allow-origin"], "https://www.homecookd.app");
  assert.equal(ok.headers["access-control-allow-headers"], "Content-Type, X-Dish-Token");
  assert.equal(ok.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal((await pre("https://evil.example")).status, 403);
  assert.equal((await pre("https://homecookd.app.evil.example")).status, 403);

  like(await post(t, "/dish/cards", { dish: "dal" }, { origin: "https://evil.example" }), { status: 403, data: { code: "origin" } });
  assert.equal(model.calls.guess, 0);
  const local = await post(t, "/dish/cards/get", { kidToken: "Z".repeat(22) }, { origin: "http://localhost:3105" });
  assert.deepEqual([local.status, local.headers["access-control-allow-origin"]], [404, "http://localhost:3105"]);
  assert.equal((await post(t, "/dish/cards", { dish: "dal" }, { origin: null })).status, 201); // no Origin: allowed
  like(await post(t, "/dish/nope", {}), { status: 404, data: { code: "not_found" } });
});

// ---------------------------------------------------------------------------------------------
// Asking Mom

test("cards/ask: her answered questions stay first and are left out when asked again; at most 3 open and 6 in all", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await makeCard(t);
  let r = await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup, really?" }, { text: "Do you salt the eggs?" }]);
  assert.deepEqual(r.data.card.asked, [
    { id: "q1", text: "How much ketchup, really?" },
    { id: "q4", text: "Do you salt the eggs?" },
  ]);
  assert.equal((await answer(t, askToken, "q1")).status, 200);
  assert.equal((await answer(t, askToken, "q4")).status, 200);
  r = await askMom(t, kidToken, [
    { id: "q1", text: "How much ketchup again?" },
    { id: "q2", text: "How do you know the eggs are ready?" },
  ]);
  assert.deepEqual(r.data.card.asked, [
    { id: "q1", text: "How much ketchup, really?" },
    { id: "q4", text: "Do you salt the eggs?" },
    { id: "q2", text: "How do you know the eggs are ready?" },
  ]);
  assert.deepEqual((await peek(t, askToken)).questions.map((q: { id: string }) => q.id), ["q2"]);
  like(await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup again?" }]), { status: 409, data: { code: "closed", error: "That was already answered." } });
  const bad: [unknown, string][] = [
    [[], "questions must be a list of 1 to 3 questions"],
    ["q1", "questions must be a list of 1 to 3 questions"],
    [[{ text: "One?" }, { text: "Two?" }, { text: "Three?" }, { text: "Four?" }], "At most 3 questions at a time"],
    [[{ id: "q1", text: "How much?" }, { id: "q1", text: "How much, again?" }], "The same question is in the list twice"],
    [[{ id: "q4", text: "Mine?" }], "questions[0].id must be q1, q2 or q3, or left out for the kid's own question"],
    [[{ text: "Hm" }], "questions[0].text must be 3 to 120 characters"],
    [[{ text: "x".repeat(121) }], "questions[0].text must be 3 to 120 characters"],
    [[{ text: 5 }], "questions[0].text must be a string"],
  ];
  for (const [questions, error] of bad) like(await askMom(t, kidToken, questions), { status: 400, data: { code: "bad_request", error } });
  like(await askMom(t, kidToken, [{ text: "Why the fuck is it red?" }]), { status: 422, data: { code: "words" } });

  r = await askMom(t, kidToken, [{ id: "q2", text: "How do you know they're ready?" }, { id: "q3", text: "What goes on top?" }, { text: "Can I use canned tomatoes?" }]);
  assert.deepEqual(r.data.card.asked.map((q: { id: string }) => q.id), ["q1", "q4", "q2", "q3", "q5"]);
  await answer(t, askToken, "q2");
  await answer(t, askToken, "q3");
  const three = [{ text: "One?" }, { text: "Two?" }, { text: "Three?" }];
  assert.equal((await askMom(t, kidToken, three)).data.error, "At most 6 questions in all");
  r = await askMom(t, kidToken, three.slice(0, 2));
  assert.deepEqual(r.data.card.asked.map((q: { id: string }) => q.id), ["q1", "q4", "q2", "q3", "q5", "q6"]);
  // A line break in a question becomes a space.
  r = await askMom(t, kidToken, [{ text: "How long\ndo you fry?" }]);
  assert.deepEqual(r.data.card.asked.at(-1), { id: "q5", text: "How long do you fry?" });

  // The kid's own questions run out at q6.
  const ip = "192.0.2.9";
  const own = await makeCard(t, { dish: "dal" }, ip);
  await askMom(t, own.kidToken, [{ text: "One?" }, { text: "Two?" }, { text: "Three?" }], { ip });
  for (const q of ["q4", "q5", "q6"]) await answer(t, own.askToken, q, { ip });
  assert.equal((await askMom(t, own.kidToken, [{ text: "Four?" }], { ip })).data.error, "At most 3 questions of your own");
});

test("cards/ask: a text/plain body works (the share tap's keepalive save); 30 per IP in 10 minutes", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await makeCard(t);
  const questions = [{ id: "q2", text: "How do you know the eggs are ready?" }];
  const r = await call(t, "POST", "/dish/cards/ask", JSON.stringify({ kidToken, questions }), { headers: { "content-type": "text/plain;charset=UTF-8" } });
  assert.deepEqual(r.data.card.asked, questions);
  assert.deepEqual((await peek(t, askToken)).questions, questions);
  for (let i = 1; i < 30; i++) assert.equal((await askMom(t, kidToken, questions)).status, 200);
  like(await askMom(t, kidToken, questions), { status: 429, data: { code: "rate" } });
});

// ---------------------------------------------------------------------------------------------
// Mom

test("ask/peek: the dish, the kid's guess and message, the asked questions; never the kid token; opened once", { skip }, async () => {
  const t = await newBackend();
  const photo = await fileId(t, "photo");
  const { kidToken, askToken } = await makeCard(t, { dish: "tomato egg", kidName: "Caleb", photos: [photo] });
  await askMom(t, kidToken, MOM_ASKED);
  const voice = await fileId(t, "voice");
  await post(t, "/dish/cards/update", { kidToken, voiceNote: voice });
  const r = await post(t, "/dish/ask/peek", { askToken });
  assert.equal(r.status, 200);
  const ask = r.data.ask;
  like(ask, {
    dish: "tomato egg",
    relation: "mom",
    kidName: "Caleb",
    message: "Mom, how do you make your tomato egg? I'm trying to make it here.",
    kidVoiceUrl: anyString,
    inLang: null,
    photoUrls: [anyString],
    questions: MOM_ASKED,
    answered: [],
    clips: [],
    finished: false,
    version: null,
    merging: false,
  });
  like(ask.guess.ingredients[2], { name: "ketchup", isGuess: true });
  assert.ok(!r.body.includes(kidToken));
  const openedAt = (await getCard(t, kidToken)).openedAt;
  like({ openedAt }, { openedAt: near(Date.now()) });
  await peek(t, askToken);
  assert.equal((await getCard(t, kidToken)).openedAt, openedAt);
});

test("Mom's page in her language: translated once and cached, again when the message or questions change", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const before = await spent();
  const hi = await peek(t, askToken, "hi");
  like(hi.inLang, {
    lang: "hi",
    questions: [{ id: "q1", text: `[hi] ${MOM_ASKED[0].text}` }],
    message: "[hi] Mom, how do you make your tomato egg? I'm trying to make it here.",
  });
  assert.equal(hi.inLang.guess.dish, "[hi] tomato egg");
  // Ids, statuses and links stay; an empty amount stays empty.
  like(hi.inLang.guess.ingredients[2], { name: "[hi] ketchup", amount: "", status: "unknown", isGuess: true, ask: "q1" });
  assert.equal(hi.inLang.guess.steps[0].lines[0].text, "[hi] Beat the eggs with **a pinch** of salt");
  assert.equal(hi.guess.dish, "tomato egg"); // the English stays alongside
  assert.equal(hi.message, "Mom, how do you make your tomato egg? I'm trying to make it here.");
  assert.equal(model.calls.forMom, 1);
  close(await spent(), before + FAKE_COST.forMom);

  assert.deepEqual((await peek(t, askToken, "hi")).inLang, hi.inLang); // cached: no call, no spend
  assert.equal(model.calls.forMom, 1);
  close(await spent(), before + FAKE_COST.forMom);
  // The kid's card stays in English.
  assert.equal((await getCard(t, kidToken)).guess.dish, "tomato egg");

  await post(t, "/dish/cards/update", { kidToken, message: "Mom, I need your tomato egg" });
  assert.equal((await peek(t, askToken, "hi")).inLang.message, "[hi] Mom, I need your tomato egg");
  assert.equal(model.calls.forMom, 2);
  await askMom(t, kidToken, [{ id: "q2", text: "How do you know the eggs are done?" }]);
  const asked = await peek(t, askToken, "hi");
  assert.deepEqual(asked.inLang.questions, [{ id: "q2", text: "[hi] How do you know the eggs are done?" }]);
  assert.equal(model.calls.forMom, 3);

  // Another language has its own entry; the first stays cached.
  assert.equal((await peek(t, askToken, "mr")).inLang.lang, "mr");
  assert.equal((await peek(t, askToken, "hi")).inLang.lang, "hi");
  assert.equal(model.calls.forMom, 4);
  const langs = (await db().query("select lang from dish_ask_translations where ask_id = $1 order by lang", [(await rowOf(kidToken)).id])).rows;
  assert.deepEqual(langs.map((x) => x.lang), ["hi", "mr"]);

  // English, an unknown code or no lang: no translation. A lang that isn't a string is a 400.
  for (const lang of ["en", "xx", undefined, null]) assert.equal((await peek(t, askToken, lang)).inLang, null);
  like(await post(t, "/dish/ask/peek", { askToken, lang: 5 }), { status: 400, data: { code: "bad_request" } });
  assert.equal(model.calls.forMom, 4);

  // Her answer (in its language) and Send (with lang) give the cached translation back; they never translate.
  assert.equal((await answer(t, askToken, "q2", { lang: "hi" })).data.ask.inLang.lang, "hi");
  assert.equal((await post(t, "/dish/ask/finish", { askToken, lang: "mr" })).data.ask.inLang.lang, "mr");
  assert.equal(model.calls.forMom, 4);
});

test("Mom's page stays in English past $11, when the translation fails, and when it has a filtered word", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  await seedSpend(11);
  assert.equal((await peek(t, askToken, "hi")).inLang, null);
  assert.equal(model.calls.forMom, 0);
  await seedSpend(10.5); // over the budget for cards, still under Mom's overage
  model.forMom = async () => null;
  assert.equal((await peek(t, askToken, "hi")).inLang, null);
  model.forMom = async (real) => {
    const r = (await real()) as { message: string };
    r.message = "fuck";
    return r;
  };
  assert.equal((await peek(t, askToken, "hi")).inLang, null);
  model.forMom = null;
  assert.equal((await peek(t, askToken, "hi")).inLang?.lang, "hi");
  assert.equal(model.calls.forMom, 3);
  close(await spent(), 10.5 + 2 * FAKE_COST.forMom); // the null one cost nothing
});

test("a failing translation is tried at most 3 times an hour per card and language, however often her page polls", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  model.forMom = async () => null;
  for (let i = 0; i < 6; i++) assert.equal((await peek(t, askToken, "hi")).inLang, null);
  assert.equal(model.calls.forMom, 3);
  model.forMom = null;
  assert.equal((await peek(t, askToken, "mr")).inLang?.lang, "mr", "another language has its own tries");
  await clearWindow("dish-mom-lang"); // an hour later
  assert.equal((await peek(t, askToken, "hi")).inLang?.lang, "hi", "an hour later it's tried again");
  assert.equal(model.calls.forMom, 5);
});

test("ask/answer: only an asked question, her audio checked before it's stored; a re-record replaces the old clip", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const askId = (await rowOf(kidToken)).id;
  const objects = store.objects.size;
  const refused: [Parameters<typeof answer>[3] & { q?: string }, number, string][] = [
    [{ q: "q5" }, 400, "That question wasn't asked."],
    [{ q: "q9" }, 400, "q must be one of q1 to q6"],
    [{ token: null }, 400, "The X-Dish-Token header is required"],
    [{ type: "video/mp4" }, 415, "That recording type isn't supported."],
    [{ type: "text/plain" }, 415, "That recording type isn't supported."],
    [{ bytes: 5 * 1024 * 1024 + 1 }, 413, "That answer is too long."],
    [{ bytes: 0 }, 400, "The recording is empty."],
    [{ durationS: 0 }, 400, "durationS must be more than 0 and at most 120"],
    [{ durationS: 126 }, 400, "durationS must be more than 0 and at most 120"],
    [{ durationS: "abc" }, 400, "durationS must be more than 0 and at most 120"],
    [{ lang: "xx" }, 400, "lang must be one of en hi mr gu ta te pa ur bn zh ko es tl ar pt vi"],
  ];
  for (const [o, status, error] of refused) {
    const r = await answer(t, askToken, o.q ?? "q1", { ...o, ip: "192.0.2.3" });
    assert.deepEqual([r.status, r.data.error], [status, error], JSON.stringify(o));
  }
  assert.equal(store.objects.size, objects);

  let r = await answer(t, askToken, "q1", { durationS: 124.6, type: "audio/webm;codecs=opus" });
  assert.equal(r.status, 200, r.body);
  like(r.data.ask, { answered: ["q1"], questions: [], finished: false, merging: false });
  like(r.data.ask.clips, [{ id: "q1", audioUrl: anyString, durationS: 120 }]);
  await settle(); // Ink hears it after the reply
  let [a] = await answersOf(askId);
  like(a, { question_id: "q1", duration_s: 120, language: "en", words: FAKE_WORDS, english: null, english_settled: true, merged: false });
  const firstClip = a.audio_key;

  r = await answer(t, askToken, "q1", { lang: "mr", durationS: 3 });
  assert.equal(r.status, 200);
  like(r.data.ask.clips, [{ id: "q1", audioUrl: anyString, durationS: 3 }]);
  [a] = await answersOf(askId);
  like(a, { language: "mr", duration_s: 3, merged: false, words: null, english_settled: false });
  await sweep({ log: silent });
  assert.ok(!store.objects.has(firstClip));
  await settle();
  [a] = await answersOf(askId);
  like(a, { words: FAKE_WORDS, english: `(English) ${FAKE_WORDS}` });
  assert.equal((await answersOf(askId)).length, 1);
  // Her answers reach the kid only with her version (or once no version will come).
  assert.deepEqual((await getCard(t, kidToken)).answers, []);
});

test("ask/answer: 30 per IP in 10 minutes", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  for (let i = 0; i < 30; i++) assert.equal((await answer(t, askToken, "q1")).status, 200);
  like(await answer(t, askToken, "q1"), { status: 429, data: { code: "rate" } });
});

test("Send: finished and merging at once, then her version in her words; the kid gets it with her clip; no more answers", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const sent = await finish(t, askToken);
  assert.equal(sent.status, 200);
  like(sent.data.ask, { finished: true, merging: true, version: null, answered: ["q1"] });
  like(await getCard(t, kidToken), { status: "asked", merging: true });

  await settle();
  const ask = await peek(t, askToken);
  assert.equal(ask.merging, false);
  assert.equal(ask.finished, true);
  // Settled: hers, with her clip, and nothing left to ask about it.
  like(ask.version.ingredients[2], { name: "ketchup", amount: "two big spoons", status: "mom", isGuess: false, ask: null, clip: "q1" });
  like(ask.clips, [{ id: "q1", audioUrl: anyString, durationS: 4.2 }]);
  const card = await getCard(t, kidToken);
  like(card, { status: "answered", merging: false, finishedAt: near(Date.now()) });
  assert.deepEqual(card.version, ask.version);
  like(card.answers, [{ id: "q1", words: FAKE_WORDS, english: null, audioUrl: anyString, durationS: 4.2 }]);
  assert.ok((await rowOf(kidToken)).merged_at);
  assert.equal(model.calls.version, 1);

  like(await answer(t, askToken, "q1"), { status: 409, data: { code: "closed", error: "These answers were already sent." } });
  // Send again changes nothing, and no merge runs twice.
  like((await finish(t, askToken)).data.ask, { finished: true, merging: false });
  await settle();
  assert.equal(model.calls.version, 1);

  // Send with nothing answered keeps her link open.
  const other = await askedCard(t, "192.0.2.20");
  like((await finish(t, other.askToken)).data.ask, { finished: false, merging: false });
  assert.equal((await getCard(t, other.kidToken)).status, "asked");
});

test("a second card's ask token sees only that card, and can't answer the first card's questions", { skip }, async () => {
  const t = await newBackend();
  const first = await askedCard(t); // q1 asked
  const second = await makeCard(t, { dish: "dal", kidName: "Priya", relation: "grandma" });
  await askMom(t, second.kidToken, [{ id: "q2", text: "How do you know it's done?" }]);
  const theirs = await peek(t, second.askToken);
  like(theirs, { kidName: "Priya", relation: "grandma", questions: [{ id: "q2", text: "How do you know it's done?" }] });
  assert.ok(!JSON.stringify(theirs).includes("Caleb"));

  like(await answer(t, first.askToken, "q1", { token: second.askToken }), { status: 400, data: { error: "That question wasn't asked." } });
  assert.equal((await answer(t, second.askToken, "q2")).status, 200);
  assert.deepEqual(await answersOf((await rowOf(first.kidToken)).id), []);
  assert.deepEqual((await answersOf((await rowOf(second.kidToken)).id)).map((a) => a.question_id), ["q2"]);
  assert.deepEqual((await peek(t, first.askToken)).answered, []);
  assert.equal((await finish(t, second.askToken)).data.ask.finished, true);
  assert.equal((await peek(t, first.askToken)).finished, false);
});

test("silent clips: no version comes, Claude never sees them, and the kid gets her clip without words", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { bytes: 50 });
  await settle();
  like((await finish(t, askToken)).data.ask, { finished: true, merging: false });
  await settle();
  assert.equal(model.calls.version, 0);
  const card = await getCard(t, kidToken);
  like(card, { status: "answered", version: null });
  like(card.answers, [{ id: "q1", words: "", english: null, audioUrl: anyString, durationS: 4.2 }]);
});

test("a failed merge is tried again 3 minutes later, 5 tries at most; then the kid gets her clips", { skip }, async () => {
  const t = await newBackend();
  model.version = async () => {
    throw new DishModelError("model", "Claude 500");
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await runNow(); // the first try
  const row = await rowOf(kidToken);
  assert.deepEqual([row.merge_tries, row.version], [1, null]);
  assert.equal((await getCard(t, kidToken)).status, "asked");
  assert.equal((await peek(t, askToken)).merging, true);
  assert.equal(model.calls.version, 1);

  await settle(); // the retries, 3 minutes apart
  assert.equal(model.calls.version, 5);
  assert.equal((await rowOf(kidToken)).merge_tries, 5);
  const card = await getCard(t, kidToken);
  like(card, { status: "answered", version: null, merging: false });
  assert.deepEqual(card.answers.map((a: { id: string; words: string }) => [a.id, a.words]), [["q1", ""]]);
  assert.equal((await peek(t, askToken)).merging, false); // right after the last try, not 3 minutes on
  await advance(60 * MIN);
  await getCard(t, kidToken);
  await settle();
  assert.equal(model.calls.version, 5); // no sixth try
});

test("a failed merge is finished by the kid's next look once Claude is back", { skip }, async () => {
  const t = await newBackend();
  let down = true;
  model.version = async (real) => {
    if (down) throw new DishModelError("model", "Claude 503");
    return real();
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await runNow();
  down = false;
  await db().query("update outbox set send_after = now() + interval '1 hour' where sent_at is null"); // the scheduled retry hasn't fired yet
  await advance(3 * 60_000 + 1);
  await getCard(t, kidToken); // starts the try that's due
  await runNow();
  const card = await getCard(t, kidToken);
  assert.equal(card.status, "answered");
  assert.equal(card.version.ingredients[2].clip, "q1");
  await db().query("update outbox set send_after = now() where sent_at is null");
  await settle(); // the scheduled retry finds nothing to do
  assert.equal(model.calls.version, 2);
});

test("a kid's page polling queues one merge at a time, not one a look", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  const row = await rowOf(kidToken);
  const queued = async () => (await db().query(`select count(*)::int as n from outbox where payload->>'task' = 'dish.merge' and payload->>'askId' = $1`, [row.id])).rows[0].n as number;
  assert.ok((await queued()) <= 1);
  for (let i = 0; i < 5; i += 1) await getCard(t, kidToken);
  assert.equal(await queued(), 1, "five looks, one message");
  await advance(61_000);
  await getCard(t, kidToken);
  assert.equal(await queued(), 2, "one that was lost goes again a minute on");
});

test("what her answer changed carries the guess's value it replaced and her words (was, quote), to both pages", { skip }, async () => {
  const t = await newBackend();
  model.version = async (real) => {
    const r = (await real()) as { ingredients: Record<string, unknown>[]; steps: { lines: Record<string, unknown>[] }[] };
    Object.assign(r.ingredients[2], { was: "", quote: { words: "दो बड़े चम्मच", english: "two big spoons" } });
    Object.assign(r.steps[1].lines[1], { was: "Stir in the ketchup and **1/2 tsp** sugar", quote: { words: FAKE_WORDS, english: null } });
    return r;
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle();
  const card = await getCard(t, kidToken);
  like(card.version.ingredients[2], { was: "", quote: { words: "दो बड़े चम्मच", english: "two big spoons" } });
  like(card.version.steps[1].lines[1], { was: "Stir in the ketchup and **1/2 tsp** sugar", quote: { words: FAKE_WORDS, english: null } });
  like(card.version.ingredients[0], { was: null, quote: null }); // untouched
  assert.deepEqual((await peek(t, askToken)).version.ingredients[2].quote, { words: "दो बड़े चम्मच", english: "two big spoons" });
});

test("a filtered word in her version isn't saved (the try fails)", { skip }, async () => {
  const t = await newBackend();
  model.version = async (real) => {
    const r = (await real()) as { steps: { title: string }[] };
    r.steps[0].title = "Scramble the fucking eggs";
    return r;
  };
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle();
  assert.equal((await rowOf(kidToken)).version, null);
  assert.equal((await getCard(t, kidToken)).status, "answered");
});

test("a try that a newer answer overtook writes nothing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  const row = await rowOf(kidToken);
  await db().query("update dish_asks set finished_at = now() where id = $1", [row.id]);
  const claim = (await claimMerge(row.id))!;
  assert.equal(claim.tries, 1);
  assert.equal(await claimMerge(row.id), null); // one is running
  await db().query("update dish_asks set finished_at = null where id = $1", [row.id]);
  await answer(t, askToken, "q1"); // she records again: the merges start over
  assert.equal(await saveVersion(row.id, claim.claimedAt, claim.guess, []), false);
  assert.equal((await rowOf(kidToken)).version, null);
});

test("answers she left 20 minutes without Send count as sent; the kid asking again gives her 20 more", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await advance(15 * MIN);
  await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup?" }, { id: "q2", text: "How do you know the eggs are done?" }]);
  await advance(10 * MIN);
  await getCard(t, kidToken);
  assert.equal((await rowOf(kidToken)).finished_at, null); // 25 minutes after her answer, 10 after the ask
  await advance(10 * MIN + 100);
  const closed = await getCard(t, kidToken);
  like(closed, { finishedAt: near(Date.now()) });
  await settle();
  const got = await getCard(t, kidToken);
  assert.equal(got.status, "answered");
  assert.deepEqual(got.answers.map((a: { id: string }) => a.id), ["q1"]);
  assert.equal((await peek(t, askToken)).finished, true);
  like(await answer(t, askToken, "q2"), { status: 409 });
});

test("asking again after Send reopens her link; her version stays, and her new answer rebuilds it", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await finish(t, askToken);
  await settle();
  const v1 = (await getCard(t, kidToken)).version;
  const r = await askMom(t, kidToken, [{ text: "What else goes in the eggs?" }]);
  like(r.data.card, { status: "asked", finishedAt: null });
  assert.deepEqual(r.data.card.version, v1);
  like(await peek(t, askToken), { finished: false, questions: [{ id: "q4", text: "What else goes in the eggs?" }], answered: ["q1"] });
  await answer(t, askToken, "q4");
  await finish(t, askToken);
  await settle();
  const card = await getCard(t, kidToken);
  assert.equal(card.status, "answered");
  assert.deepEqual(card.answers.map((a: { id: string }) => a.id), ["q1", "q4"]);
  assert.equal(model.calls.version, 2);
});

// ---------------------------------------------------------------------------------------------
// The daily budget

test("at $10 new cards are refused, but Mom's answer and Send still work and her version is written", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await seedSpend(10);
  like(await post(t, "/dish/cards", { dish: "dal" }, { ip: "192.0.2.30" }), {
    status: 429,
    data: { code: "budget", error: "homecookd has made all the recipes it can today. Try again tomorrow." },
  });
  assert.equal((await answer(t, askToken, "q1", { lang: "hi" })).status, 200);
  like((await finish(t, askToken)).data.ask, { finished: true, merging: true });
  await settle();
  assert.equal((await getCard(t, kidToken)).status, "answered");
  assert.notEqual((await peek(t, askToken)).version, null);
  // Her calls were counted: Ink, the translation, the merge.
  close(await spent(), 10 + FAKE_COST.transcribe + FAKE_COST.toEnglish + FAKE_COST.version);
});

test("past $11 her clips are saved but not heard: merging is false and the kid gets her clip; a later day merges it", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await seedSpend(11);
  assert.equal((await answer(t, askToken, "q1")).status, 200);
  like((await finish(t, askToken)).data.ask, { finished: true, merging: false });
  await settle();
  assert.equal(model.calls.transcribe, 0);
  assert.equal(model.calls.version, 0);
  let card = await getCard(t, kidToken);
  like(card, { status: "answered", version: null, merging: false });
  like(card.answers, [{ id: "q1", words: "", english: null, audioUrl: anyString, durationS: 4.2 }]);
  assert.equal((await rowOf(kidToken)).merge_tries, 0); // no try was spent

  await nextDay(); // a new UTC day
  like(await getCard(t, kidToken), { status: "asked", merging: true }); // merging again
  await settle();
  card = await getCard(t, kidToken);
  assert.equal(card.status, "answered");
  assert.equal(card.answers[0].words, FAKE_WORDS);
  assert.notEqual(card.version, null);
  close(await spent(), FAKE_COST.transcribe + FAKE_COST.version);
});

test("the first time a day reaches $10 the team is told once", { skip }, async () => {
  const t = await newBackend();
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  const pushes: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    pushes.push({ url, init });
    return new Response("ok");
  }) as typeof fetch;
  try {
    await seedSpend(9.9995);
    const { askToken } = await askedCard(t); // its guess crosses $10
    const day = (await db().query("select alerted_at from daily_spend")).rows[0];
    assert.ok(day.alerted_at);
    await answer(t, askToken, "q1");
    await finish(t, askToken);
    await settle();
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].url, "https://ntfy.sh/homecookd-test");
    assert.equal((pushes[0].init.headers as Record<string, string>).Title, "homecookd: dish budget reached");
    assert.ok(String(pushes[0].init.body).includes(new Date().toISOString().slice(0, 10)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the limiter's old windows are pruned; this window's stay", { skip }, async () => {
  const t = await newBackend();
  await makeCard(t);
  const count = async () => (await db().query("select count(*)::int as n from rate_hits")).rows[0].n;
  assert.equal(await count(), 2);
  await db().query("update rate_hits set window_start = window_start - interval '3 days'");
  await makeCard(t);
  assert.equal(await count(), 4);
  await handleMessage(JSON.stringify({ payload: { task: "platform.prune" } }), silent);
  assert.equal(await count(), 2);
});

test("the kid's voice note to Mom carries the length the page measured, on both pages; a bad length is a 400", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const note = await fileId(t, "voice");
  like(await post(t, "/dish/cards/update", { kidToken, voiceNote: note, voiceNoteS: 0 }), { status: 400 });
  const r = await post(t, "/dish/cards/update", { kidToken, voiceNote: note, voiceNoteS: 12.345 });
  assert.equal(r.data.card.kidVoiceS, 12.35);
  assert.equal((await peek(t, askToken)).kidVoiceS, 12.35);
  const gone = await post(t, "/dish/cards/update", { kidToken, voiceNote: null });
  assert.equal(gone.data.card.kidVoiceS, null);
});

test("Mom's version is translated into her page's language before it's saved, so it lands with her version", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  assert.equal((await peek(t, askToken, "hi")).inLang.version, null);
  assert.equal((await answer(t, askToken, "q1", { lang: "hi" })).status, 200);
  assert.equal((await finish(t, askToken)).status, 200);
  await settle();
  const calls = model.calls.forMom;
  const ask = await peek(t, askToken, "hi");
  assert.equal(model.calls.forMom, calls, "already cached by the merge");
  assert.notEqual(ask.version, null);
  assert.equal(ask.inLang.version.ingredients[0].name, `[hi] ${ask.version.ingredients[0].name}`);
  assert.equal(ask.inLang.guess.ingredients[0].name, `[hi] ${ask.guess.ingredients[0].name}`);
});

// ---------------------------------------------------------------------------------------------
// §10: the kid shapes the card

test("no one in particular: asking is off (no link, no message) until the kid picks someone; then it's on", { skip }, async () => {
  const t = await newBackend();
  const r = await post(t, "/dish/cards", { dish: "tomato egg", kidName: "Caleb", relation: "none" });
  assert.equal(r.status, 201);
  const { kidToken } = r.data;
  like(r.data.card, { relation: "none", askUrl: null, message: "" });
  like(await askMom(t, kidToken, MOM_ASKED), { status: 400, data: { error: "Pick who you're asking first." } });
  like(await post(t, "/dish/cards/sent", { kidToken, via: "sms" }), { status: 400 });
  const picked = (await post(t, "/dish/cards/update", { kidToken, relation: "grandma" })).data.card;
  assert.match(picked.askUrl, /\/a\?t=/);
  assert.match(picked.message, /^Grandma, how do you make your/);
  assert.equal((await post(t, "/dish/cards/sent", { kidToken, via: "sms" })).status, 200);
  like(await post(t, "/dish/cards/update", { kidToken, relation: "none" }), { status: 409 });
});

test("the kid asks about any part of the guess: a template question (or their words) linked to that part", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, card } = await makeCard(t);
  const name = card.guess.ingredients[1].name.split(",")[0].trim();
  const r = await askMom(t, kidToken, [
    { about: { kind: "ingredient", index: 1 } },
    { about: { kind: "line", step: 0, line: 0 }, text: "Do you stir it the whole time?" },
  ]);
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.data.card.asked, [
    { id: "q4", text: `How much ${name} do you use?` },
    { id: "q5", text: "Do you stir it the whole time?" },
  ]);
  assert.equal(r.data.card.guess.ingredients[1].ask, "q4");
  assert.equal(r.data.card.guess.steps[0].lines[0].ask, "q5");
  like(await askMom(t, kidToken, [{ about: { kind: "ingredient", index: 99 } }]), { status: 400 });
  like(await askMom(t, kidToken, [{ about: { kind: "line", step: 0, line: 0 }, text: "fuck this" }]), { status: 422 });
  like(await askMom(t, kidToken, [{ id: "q1", about: { kind: "ingredient", index: 0 }, text: "How much?" }]), { status: 400 });
});

test("the kid edits the guess: their fixes are stated, word-filtered and size-capped; closed after Send; strangers refused", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken, card } = await askedCard(t);
  const r = await post(t, "/dish/cards/update", {
    kidToken,
    edits: [
      { kind: "ingredient", index: 0, amount: "3" },
      { kind: "line", step: 0, line: 0, text: "Beat **3** eggs with a fork" },
    ],
  });
  assert.equal(r.status, 200, r.body);
  like(r.data.card.guess.ingredients[0], { name: card.guess.ingredients[0].name, amount: "3", status: "stated", isGuess: false });
  like(r.data.card.guess.steps[0].lines[0], { text: "Beat **3** eggs with a fork", detail: null, status: "stated", isGuess: false });
  like((await peek(t, askToken)).guess.ingredients[0], { amount: "3", isGuess: false });

  const bad = (edits: unknown) => post(t, "/dish/cards/update", { kidToken, edits });
  like(await bad([{ kind: "ingredient", index: 0, name: "fucking salt" }]), { status: 422 });
  like(await bad([{ kind: "ingredient", index: 0, amount: "x".repeat(41) }]), { status: 400 });
  like(await bad([{ kind: "line", step: 0, line: 0, text: "x".repeat(81) }]), { status: 400 });
  like(await bad([{ kind: "ingredient", index: 99, amount: "2" }]), { status: 400 });
  like(await bad([{ kind: "ingredient", index: 0 }]), { status: 400 });
  like(await bad(Array.from({ length: 21 }, () => ({ kind: "ingredient", index: 0, amount: "2" }))), { status: 400 });
  like(await post(t, "/dish/cards/update", { kidToken: "A".repeat(22), edits: [{ kind: "ingredient", index: 0, amount: "2" }] }), { status: 404 });

  assert.equal((await answer(t, askToken, "q1")).status, 200);
  assert.equal((await finish(t, askToken)).status, 200);
  like(await bad([{ kind: "ingredient", index: 0, amount: "4" }]), { status: 409 });
});

// ---------------------------------------------------------------------------------------------
// New here: what Convex gave for free, or what this move adds

test("a model call is written down with its cost and no family content", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1", { lang: "hi" });
  await finish(t, askToken);
  await settle();
  const askId = (await rowOf(kidToken)).id;
  const { rows } = await db().query("select purpose, provider, ok, cost_usd, error, ask_id, prompt_version from model_calls order by id");
  assert.deepEqual(rows.map((r) => r.purpose), ["dish_guess", "transcribe", "dish_translate_words", "dish_merge"]);
  for (const r of rows) {
    assert.equal(r.ask_id, askId);
    assert.ok(Number(r.cost_usd) > 0);
    assert.equal(r.ok, true);
  }
  const all = JSON.stringify(rows);
  for (const secret of ["tomato", "ketchup", "Caleb", kidToken, askToken]) assert.ok(!all.includes(secret), secret);
});

test("/dish/craving/peek and a craving token wait for the sync: an honest not-found, never a card that doesn't reach her", { skip }, async () => {
  const t = await newBackend();
  like(await post(t, "/dish/craving/peek", { cravingToken: "A".repeat(22) }), { status: 404, data: { code: "not_found" } });
  like(await post(t, "/dish/cards", { dish: "dal", kidName: "Cal", cravingToken: "A".repeat(22) }), { status: 404 });
  like(await post(t, "/dish/cards", { dish: "dal", cravingToken: "A".repeat(22) }), { status: 400, data: { error: "kidName is required" } });
  assert.equal((await db().query("select 1 from dish_asks")).rowCount, 0);
  assert.equal(model.calls.guess, 0);
});

test("two Sends at once make one merge; a repeated merge message does nothing", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  await Promise.all([finish(t, askToken), finish(t, askToken), finish(t, askToken)]);
  await settle();
  assert.equal(model.calls.version, 1);
  const askId = (await rowOf(kidToken)).id;
  await handleMessage(JSON.stringify({ payload: { task: "dish.merge", askId } }), silent);
  assert.equal(model.calls.version, 1);
  assert.equal((await rowOf(kidToken)).merge_tries, 1);
});

test("two edits at once both land: a card is read and written under its lock", { skip }, async () => {
  const t = await newBackend();
  const { kidToken } = await makeCard(t);
  const edit = (index: number) => post(t, "/dish/cards/update", { kidToken, edits: [{ kind: "ingredient", index, amount: String(index + 1) }] });
  await Promise.all([edit(0), edit(1), edit(2), edit(3), edit(4)]);
  const { guess } = await getCard(t, kidToken);
  assert.deepEqual(guess.ingredients.slice(0, 5).map((i: { amount: string }) => i.amount), ["1", "2", "3", "4", "5"]);
});

test("nothing about a family reaches the logs", { skip }, async () => {
  const { Writable } = await import("node:stream");
  const { buildApp, pathOnly } = await import("../src/app.js");
  await newBackend();
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _e, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const t = buildApp({ logger: { stream, level: "info", serializers: { req: (r: { method: string; url: string }) => ({ method: r.method, path: pathOnly(r.url) }) } } });
  const photo = await fileId(t, "photo");
  const { kidToken, askToken } = await makeCard(t, { dish: "grandma's secret dal", kidName: "Caleb", photos: [photo] });
  await askMom(t, kidToken, [{ text: "How much secret masala?" }]);
  await peek(t, askToken, "hi");
  const q = (await rowOf(kidToken)).asked[0].id;
  await answer(t, askToken, q);
  await finish(t, askToken);
  model.version = async () => {
    throw new DishModelError("model", "Claude 500");
  };
  await settle();
  await post(t, "/dish/cards/get", { kidToken: "Z".repeat(22) });
  await post(t, "/dish/cards", { dish: "fuck this" });
  const output = lines.join("");
  assert.ok(output.length > 0);
  for (const secret of ["secret", "Caleb", "masala", kidToken, askToken, photo, "fake-s3.test", IP]) assert.ok(!output.includes(secret), secret);
});

test("a raw file is refused, unread: bytes don't pass through the api", { skip }, async () => {
  const t = await newBackend();
  const big = Buffer.alloc(6 * 1024 * 1024, 1);
  const raw = await call(t, "POST", "/dish/files?kind=photo", big, { headers: { "content-type": "image/jpeg" } });
  like(raw, { status: 415, data: { code: "bad_type" } });
  const clip = await call(t, "POST", "/dish/ask/answer?q=q1&durationS=3", big, { headers: { "content-type": "audio/webm", "x-dish-token": "A".repeat(22) } });
  like(clip, { status: 415, data: { code: "bad_type" } });
  assert.equal(store.objects.size, 0);
});

test("when S3 can't answer, the caller hears it's safe to retry, and no file is marked", { skip }, async () => {
  const t = await newBackend();
  const link = await post(t, "/dish/files?kind=photo", { contentType: "image/jpeg", size: 100 });
  store.put(link.data.uploadUrl, new Uint8Array(100), "image/jpeg");
  store.failHeads = true;
  like(await post(t, "/dish/files/confirm", { fileId: link.data.fileId }), { status: 502, data: { code: "storage" } });
  store.failHeads = false;
  like(await post(t, "/dish/files/confirm", { fileId: link.data.fileId }), { status: 201, data: { size: anyNumber } });
});

test("a read link that can't be made never loses a card: the kid still gets the token, and the files aren't stranded", { skip }, async () => {
  const t = await newBackend();
  const photo = await fileId(t, "photo");
  store.failGets = true;
  const r = await post(t, "/dish/cards", { dish: "dal", kidName: "Caleb", photos: [photo] });
  assert.equal(r.status, 201, r.body);
  assert.match(r.data.kidToken, TOKEN22);
  assert.deepEqual(r.data.card.photoUrls, [], "no link yet, in a shape the page already handles");
  const askToken = new URL(r.data.card.askUrl).searchParams.get("t")!;
  // The other pages come back too, with their files missing for now.
  assert.equal((await post(t, "/dish/cards/get", { kidToken: r.data.kidToken })).status, 200);
  assert.equal((await post(t, "/dish/ask/peek", { askToken })).status, 200);
  store.failGets = false;
  const card = await getCard(t, r.data.kidToken);
  assert.equal(card.photoUrls.length, 1, "the next look has the file");
  like(await post(t, "/dish/cards", { dish: "dal", photos: [photo] }), { status: 404 }); // it's on that one card
});

test("a clip whose read link can't be made reads as null, as a missing clip always did", { skip }, async () => {
  const t = await newBackend();
  const { askToken } = await askedCard(t);
  await answer(t, askToken, "q1");
  store.failGets = true;
  like((await peek(t, askToken)).clips, [{ id: "q1", audioUrl: null, durationS: 4.2 }]);
});

test("Mom's two answer routes take her token in the body, like every other JSON route; the header still works; neither goes in the query", { skip }, async () => {
  const t = await newBackend();
  const { kidToken, askToken } = await askedCard(t);
  const q = "q=q1&durationS=3";
  const link = await post(t, `/dish/ask/answer/upload?${q}`, { askToken, contentType: "audio/mp4", size: 400 });
  assert.equal(link.status, 201, link.body);
  store.put(link.data.uploadUrl, new Uint8Array(400).fill(1), "audio/mp4");
  const r = await post(t, `/dish/ask/answer?${q}`, { askToken, fileId: link.data.fileId });
  assert.deepEqual(r.data.ask.answered, ["q1"]);
  assert.equal((await answersOf((await rowOf(kidToken)).id)).length, 1);
  like(await post(t, `/dish/ask/answer/upload?${q}`, { contentType: "audio/mp4", size: 400 }), { status: 400, data: { error: "The X-Dish-Token header is required" } });
  like(await post(t, `/dish/ask/answer/upload?${q}&askToken=${askToken}`, { contentType: "audio/mp4", size: 400 }), { status: 400 });
  like(await post(t, `/dish/ask/answer/upload?${q}`, { askToken: "Z".repeat(22), contentType: "audio/mp4", size: 400 }), { status: 404 });
});

test("a page on localhost may call on any deployment, as on Convex; DISH_WEB_ORIGIN takes only https", { skip }, async () => {
  const t = await newBackend();
  const before = process.env.DEPLOY_ENV;
  try {
    for (const env of ["staging", "production"]) {
      process.env.DEPLOY_ENV = env;
      const local = await post(t, "/dish/cards/get", { kidToken: "Z".repeat(22) }, { origin: "http://localhost:3105" });
      assert.equal(local.headers["access-control-allow-origin"], "http://localhost:3105", env);
    }
    process.env.DEPLOY_ENV = "staging"; // fake models stay off on production
    process.env.DISH_WEB_ORIGIN = "http://evil.example";
    like(await post(t, "/dish/cards/get", {}, { origin: "http://evil.example" }), { status: 403, data: { code: "origin" } });
    assert.equal((await makeCard(t)).card.askUrl.startsWith("https://homecookd.app/a?t="), true, "an http origin isn't honored");
    process.env.DISH_WEB_ORIGIN = "https://test.homecookd.app";
    assert.equal((await post(t, "/dish/cards/get", {}, { origin: "https://test.homecookd.app" })).headers["access-control-allow-origin"], "https://test.homecookd.app");
  } finally {
    if (before === undefined) delete process.env.DEPLOY_ENV;
    else process.env.DEPLOY_ENV = before;
    delete process.env.DISH_WEB_ORIGIN;
  }
});

after(async () => {
  if (hasDatabase) await db().end();
});
