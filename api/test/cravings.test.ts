// convex/cravings.test.ts on the new api, the signed-in side: her link, her requests, her filming day, and her voice recipe merged into her version. The models run in fake mode. Card-making
// (peek, a card from the link, its caps) stays with the dish module and isn't here.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../src/db.js";
import { purgeDishForPerson } from "../src/modules/dish/account.js";
import { linkByToken } from "../src/modules/dish/cravingData.js";
import { CRAVING_TOTAL, DEFAULT_CRAVING_MESSAGE } from "../src/modules/dish/cravings.js";
import { FAKE_WORDS } from "../src/modules/dish/model.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { sha256Hex } from "../src/modules/dish/values.js";
import { CRAVING_LINK_SALT, unseal } from "../src/sealed.js";
import { call, family, ok, person, refusedWith, type Who, world } from "./communityHelpers.js";
import { cravingCard, cravingLink, voiceUpload } from "./cravingHelpers.js";
import { advance, answer, answersOf, anyString, askMom, getCard, hasDatabase, like, makeCard, MIN, model, rowOf, seedSpend, settle, store, TOKEN22 } from "./dishHelpers.js";

const skip = !hasDatabase;

async function wangs() {
  const w = await world();
  const f = await family("Wang family");
  const dad = await person(f, "Dad", "cook");
  const leo = await person(f, "Leo", "kid");
  return { ...w, dad, leo };
}

const links = async () => (await db().query("select * from craving_links order by created_at")).rows;
const get = (t: any, who: Who, id: string) => call(t, who, "GET", `/v1/cravings/${id}`);
const day = (t: any, who: Who, id: string, value: unknown) => call(t, who, "POST", `/v1/cravings/${id}/filming-day`, { day: value });
const send = (t: any, who: Who, id: string, audioKey: string, extra: Record<string, unknown> = {}) =>
  call(t, who, "POST", `/v1/cravings/${id}/voice-recipe`, { audioKey, durationS: 42.5, ...extra });
const fileRow = async (key: string) => (await db().query("select * from files where key = $1", [key])).rows[0];
/** A signed-in upload someone else made, confirmed and free. */
async function othersFile(familyId: string | null, ownerId: string | null, askId: string | null) {
  const key = `private/dish/${randomUUID()}`;
  await db().query(`insert into files (key, bucket, kind, family_id, owner_person_id, ask_id, uploaded_at) values ($1, 'private', 'voice', $2, $3, $4, now())`, [key, familyId, ownerId, askId]);
  store.objects.set(key, { bytes: new Uint8Array(400).fill(1), contentType: "audio/mp4" });
  return key;
}

test("createLink: one live link per person, reused (a new message updates it); revoked, the next is new", { skip }, async () => {
  const { t, dad, leo } = await wangs();
  const { url, token } = await cravingLink(t, dad);
  assert.equal(url, `https://homecookd.app/miss?c=${token}`);
  assert.match(token, TOKEN22);
  like((await links())[0], { token_hash: sha256Hex(token), message: DEFAULT_CRAVING_MESSAGE, uses: 0, person_id: dad.personId, family_id: dad.familyId });

  // Reused, any number of times; a new message replaces her line.
  assert.equal((await cravingLink(t, dad)).url, url);
  assert.equal((await cravingLink(t, dad, "  What should I cook when you're home?  ")).url, url);
  assert.equal((await links())[0].message, "What should I cook when you're home?");

  // Bad messages change nothing.
  like(await refusedWith(call(t, dad, "POST", "/v1/cravings/link", { message: "x".repeat(301) }), 400, "Your message must be 1 to 300 characters."), { data: { error: "invalid", field: "message" } });
  await refusedWith(call(t, dad, "POST", "/v1/cravings/link", { message: "   " }), 400, /1 to 300/);
  like(await refusedWith(call(t, dad, "POST", "/v1/cravings/link", { message: "what the fuck do you miss" }), 422, /can't be used here/), { data: { error: "words" } });
  assert.equal((await links())[0].message, "What should I cook when you're home?");
  // Someone else's link is their own.
  assert.notEqual((await cravingLink(t, leo)).url, url);

  // Stopped: her next createLink is a new link; stopping again is nothing to stop.
  await ok(call(t, dad, "POST", "/v1/cravings/link/revoke"));
  await ok(call(t, dad, "POST", "/v1/cravings/link/revoke"));
  const fresh = await cravingLink(t, dad);
  assert.notEqual(fresh.url, url);
  assert.equal((await links()).filter((l) => l.person_id === dad.personId).length, 2);

  // Used up, so she gets a new one.
  await db().query("update craving_links set uses = $1 where token_hash = $2", [CRAVING_TOTAL, sha256Hex(fresh.token)]);
  assert.notEqual((await cravingLink(t, dad)).url, fresh.url);
});

test("her link's token is stored only as its sha256 and sealed: the row alone opens nothing, and she's shown the same link again", { skip }, async () => {
  const { t, dad } = await wangs();
  const { url, token } = await cravingLink(t, dad, "What do you miss, beta?");
  const [row] = await links();
  assert.ok(!JSON.stringify(row).includes(token), "no column holds the token");
  assert.equal(await unseal(CRAVING_LINK_SALT, row.id, row.token_enc), token);
  assert.equal(await unseal(CRAVING_LINK_SALT, "another-link", row.token_enc), null, "sealed to its own row");
  assert.equal((await cravingLink(t, dad)).url, url);
  // Found by the token, as the kid's page will; a wrong token or the hash itself finds nothing.
  assert.equal((await linkByToken(db(), token))?.id, row.id);
  assert.equal(await linkByToken(db(), `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`), null);
  assert.equal(await linkByToken(db(), row.token_hash), null);

  // Without the key, nothing is made.
  await ok(call(t, dad, "POST", "/v1/cravings/link/revoke"));
  const key = process.env.EDIBLE_CODE_KEY;
  delete process.env.EDIBLE_CODE_KEY;
  try {
    assert.equal((await call(t, dad, "POST", "/v1/cravings/link", {})).status, 500);
  } finally {
    process.env.EDIBLE_CODE_KEY = key;
  }
  assert.equal((await links()).length, 1);

  // A live link that can't be opened gets a new one with her line; the old one is still found.
  await db().query("update craving_links set revoked_at = null, token_enc = 'v1:AAAA.AAAA'");
  const next = await cravingLink(t, dad);
  assert.notEqual(next.token, token);
  assert.equal((await links())[1].message, "What do you miss, beta?");
  assert.equal((await linkByToken(db(), token))?.id, row.id);
});

test("two createLinks at once are one link", { skip }, async () => {
  const { t, dad } = await wangs();
  const urls = await Promise.all(Array.from({ length: 6 }, () => cravingLink(t, dad)));
  assert.equal(new Set(urls.map((u) => u.url)).size, 1);
  assert.equal((await links()).length, 1);
});

test("forCook: the cards asked of her, newest first, in the app's shape; get is refused for anyone else's", { skip }, async () => {
  const { t, dad, leo, caleb } = await wangs();
  const first = await cravingCard(t, dad, { dish: "braised pork", kidName: "Caleb" });
  await db().query("update dish_asks set photo_keys = $2::text[]::s3_key[], created_at = created_at - interval '1 minute' where id = $1", [first.row.id, ["private/dish/a-photo"]]);
  const second = await cravingCard(t, dad, { dish: "dal", kidName: "Amy" });
  // Leo's own link, and another family's: not Dad's.
  const leos = await cravingCard(t, leo);
  const theirs = await cravingCard(t, caleb);

  const asks = (await ok(call(t, dad, "GET", "/v1/cravings"))).asks;
  assert.deepEqual(asks.map((a: any) => a.id), [second.row.id, first.row.id]);
  const row = await rowOf(first.kidToken);
  assert.deepEqual(asks[1], {
    id: first.row.id,
    kidName: "Caleb",
    dish: "tomato egg", // the fake guess names every dish so
    guess: row.guess.ingredients.map((i: any) => ({ amount: i.amount, name: i.name })),
    kidVoiceUrl: null,
    photoUrl: "https://fake-s3.test/get/private/dish/a-photo",
    message: first.card.message,
    createdAt: row.created_at.getTime(),
    answered: false,
    voiceRecipe: null,
    filmingDay: null,
  });
  assert.ok(asks[1].guess.length > 0);
  assert.equal(asks[0].photoUrl, null);

  assert.deepEqual((await get(t, dad, first.row.id)).data, asks[1]);
  for (const id of [leos.row.id, theirs.row.id, "nope", "x".repeat(32)]) assert.equal((await get(t, dad, id)).status, 404);
  assert.equal((await get(t, caleb, first.row.id)).status, 404);
  assert.deepEqual((await ok(call(t, caleb, "GET", "/v1/cravings"))).asks.map((a: any) => a.id), [theirs.row.id]);
  assert.equal((await call(t, { ...dad, token: "x".repeat(43) }, "GET", "/v1/cravings")).status, 401);
});

test("forCook pages", { skip }, async () => {
  const { t, dad } = await wangs();
  const { row } = await cravingCard(t, dad);
  await db().query(
    `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, guess, message, status, requested_of, family_id, created_at)
     select md5(n::text) || md5(n::text), md5((n + 1000)::text) || md5((n + 1000)::text), 'dal', 'mom', guess, '', 'draft', requested_of, family_id, created_at + n * interval '1 microsecond'
       from dish_asks, generate_series(1, 60) n where id = $1`,
    [row.id],
  );
  const first = await ok(call(t, dad, "GET", "/v1/cravings"));
  assert.equal(first.asks.length, 50);
  const second = await ok(call(t, dad, "GET", `/v1/cravings?cursor=${first.nextCursor}`));
  assert.equal(second.asks.length, 11);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.asks, ...second.asks].map((a: any) => a.id)).size, 61);
});

test("setFilmingDay: only the one it was asked of; the kid's card shows it; null clears it", { skip }, async () => {
  const { t, dad, leo, caleb } = await wangs();
  const { kidToken, row } = await cravingCard(t, dad);
  like(await refusedWith(day(t, leo, row.id, 0), 403, "Only Dad can pick the day."), { data: { error: "not_asked_of_you" } });
  like(await refusedWith(day(t, caleb, row.id, 0), 404, "Not found."), { data: { error: "not_found" } });
  for (const value of [7, -1, 1.5, "1", true]) like(await refusedWith(day(t, dad, row.id, value), 400, "Pick a day of the week."), { data: { error: "invalid", field: "day" } });
  assert.equal((await getCard(t, kidToken)).filmingDay, null);

  await ok(day(t, dad, row.id, 0));
  assert.equal((await getCard(t, kidToken)).filmingDay, 0);
  assert.equal((await get(t, dad, row.id)).data.filmingDay, 0);
  await ok(day(t, dad, row.id, null));
  assert.equal((await getCard(t, kidToken)).filmingDay, null);
});

test("sendVoiceRecipe: only the one it was asked of; a wrong type or size is refused", { skip }, async () => {
  const { t, dad, leo, caleb } = await wangs();
  const { row } = await cravingCard(t, dad);
  const upload = (who: Who, body: object) => call(t, who, "POST", `/v1/cravings/${row.id}/voice-recipe/upload`, body);
  await refusedWith(upload(leo, { contentType: "audio/mp4", size: 400 }), 403, "Only Dad can answer this one.");
  await refusedWith(upload(caleb, { contentType: "audio/mp4", size: 400 }), 404, "Not found.");

  // Refused before a link exists, so nothing is stored.
  like(await refusedWith(upload(dad, { contentType: "image/jpeg", size: 400 }), 415, "That recording type isn't supported."), { data: { error: "bad_type" } });
  like(await refusedWith(upload(dad, { contentType: "audio/webm;codecs=opus", size: 5 * 1024 * 1024 + 1 }), 413, "That answer is too long."), { data: { error: "too_large" } });
  like(await refusedWith(upload(dad, { contentType: "audio/mp4", size: 0 }), 400, "The recording is empty."), { data: { error: "invalid", field: "size" } });
  // S3 can't sign the link: safe to try again.
  const presignPut = store.presignPut;
  store.presignPut = async () => {
    throw new Error("S3 is down");
  };
  like(await refusedWith(upload(dad, { contentType: "audio/mp4", size: 400 }), 502, "Something went wrong on our side. Please try again."), { data: { error: "provider_down" } });
  store.presignPut = presignPut;

  const clip = await voiceUpload(t, dad, row.id);
  await refusedWith(send(t, leo, row.id, clip), 404); // the guard: not his file. An owner's rule is by person
  await refusedWith(send(t, caleb, row.id, clip), 404);
  assert.equal((await fileRow(clip)).delete_requested_at, null); // not theirs to delete
  for (const durationS of [0.5, 126]) {
    like(await refusedWith(send(t, dad, row.id, clip, { durationS }), 400, "A voice recipe is 1 second to 2 minutes long."), { data: { error: "invalid", field: "durationS" } });
  }
  like(await refusedWith(send(t, dad, row.id, clip, { language: "xx" }), 400, "Pick a language from the list."), { data: { error: "invalid", field: "language" } });
  assert.deepEqual(await answersOf(row.id), []);
  assert.equal(model.calls.transcribe, 0);
});

test("a recording that isn't what its link was for is deleted and refused", { skip }, async () => {
  const { t, dad } = await wangs();
  const { row } = await cravingCard(t, dad);
  const link = await ok(call(t, dad, "POST", `/v1/cravings/${row.id}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 }));
  store.put(link.uploadUrl, new Uint8Array(400).fill(1), "image/jpeg");
  like(await refusedWith(send(t, dad, row.id, link.audioKey), 415, "That recording type isn't supported."), { data: { error: "bad_type" } });
  assert.ok((await fileRow(link.audioKey)).delete_requested_at);
  const big = await ok(call(t, dad, "POST", `/v1/cravings/${row.id}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 }));
  store.put(big.uploadUrl, new Uint8Array(5 * 1024 * 1024 + 1), "audio/mp4");
  like(await refusedWith(send(t, dad, row.id, big.audioKey), 413, "That answer is too long."), { data: { error: "too_large" } });
  assert.ok((await fileRow(big.audioKey)).delete_requested_at);
  // Nothing on S3 yet: the plain not-found, and the file waits.
  const none = await ok(call(t, dad, "POST", `/v1/cravings/${row.id}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 }));
  await refusedWith(send(t, dad, row.id, none.audioKey), 404);
  assert.equal((await fileRow(none.audioKey)).delete_requested_at, null);
  store.objects.set(none.audioKey, { bytes: new Uint8Array(400), contentType: "audio/mp4" });
  await ok(send(t, dad, row.id, none.audioKey));
  assert.ok(await answersOf(row.id));
});

test("attaching a file: anyone else's, another card's, or one already held is refused the same, and left alone", { skip }, async () => {
  const { t, dad, leo, caleb } = await wangs();
  const { row } = await cravingCard(t, dad);
  const other = await cravingCard(t, dad, { dish: "dal", kidName: "Amy" });
  const mine = await voiceUpload(t, dad, row.id);
  await ok(send(t, dad, row.id, mine));

  // An anonymous kid's clip on a card, and an anonymous upload.
  const anonymous = await makeCard(t, { dish: "rice", kidName: "Ana" }, "192.0.2.71");
  const clipOfCard = await othersFile(null, null, (await rowOf(anonymous.kidToken)).id);

  const cases: [string, string][] = [
    ["another family's file", await othersFile(caleb.familyId, caleb.personId, null)],
    ["another family's, no owner", await othersFile(caleb.familyId, null, null)],
    ["my family's, someone else's", await othersFile(dad.familyId, leo.personId, row.id)],
    ["an anonymous kid's clip", clipOfCard],
    ["my upload for another card", await voiceUpload(t, dad, other.row.id)],
    ["my family's with no owner: not made for this card", await othersFile(dad.familyId, null, null)],
    ["a key with no row", "private/dish/nothing-here"],
    ["a clip already on another card", await (async () => {
      const k = await voiceUpload(t, dad, other.row.id);
      await ok(send(t, dad, other.row.id, k));
      return k;
    })()],
  ];
  const before = (await answersOf(row.id)).map((a) => a.audio_key);
  for (const [what, key] of cases) {
    const r = await send(t, dad, row.id, key);
    assert.equal(r.status, 404, `${what}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "not_found", what);
  }
  assert.deepEqual((await answersOf(row.id)).map((a) => a.audio_key), before);

  // A file on its way out is refused too, even her own.
  const going = await voiceUpload(t, dad, row.id);
  await send(t, dad, row.id, going);
  const again = await voiceUpload(t, dad, row.id);
  await db().query("update files set uploaded_at = now(), delete_requested_at = now() where key = $1", [again]);
  assert.equal((await send(t, dad, row.id, again)).status, 404);
});

test("sendVoiceRecipe: writing, then her version on the kid's card with her clip; a second one replaces the first", { skip }, async () => {
  const { t, dad } = await wangs();
  await db().query("update people set language = 'mr' where id = $1", [dad.personId]);
  const { kidToken, row } = await cravingCard(t, dad);
  const first = await voiceUpload(t, dad, row.id);
  await ok(send(t, dad, row.id, first, { durationS: 124 }));
  // A retry of the same clip succeeds and changes nothing.
  await ok(send(t, dad, row.id, first, { durationS: 124 }));
  assert.equal((await answersOf(row.id)).length, 1);
  let ask = (await get(t, dad, row.id)).data;
  like(ask, { answered: false, voiceRecipe: "writing" });
  like((await answersOf(row.id))[0], { question_id: "q4", language: "mr", duration_s: 120, merged: false });
  let card = await getCard(t, kidToken);
  like(card, { status: "asked", merging: true, version: null });
  assert.deepEqual(card.asked, [{ id: "q4", text: "How do you make it?" }]);

  await settle();
  ask = (await get(t, dad, row.id)).data;
  like(ask, { answered: true, voiceRecipe: "ready" });
  card = await getCard(t, kidToken);
  like(card, { status: "answered", merging: false });
  assert.notEqual(card.version, null);
  assert.equal(card.answers.length, 1);
  like(card.answers[0], { id: "q4", words: FAKE_WORDS, english: `(English) ${FAKE_WORDS}`, audioUrl: anyString, durationS: 120 });
  assert.equal(model.calls.transcribe, 1);
  assert.equal(model.calls.version, 1);

  // A second one replaces the first (the old clip goes) and her version is written again.
  const second = await voiceUpload(t, dad, row.id, 500);
  await ok(send(t, dad, row.id, second, { language: "en" }));
  assert.equal((await get(t, dad, row.id)).data.voiceRecipe, "writing");
  await settle();
  assert.ok((await fileRow(first)).delete_requested_at);
  const answers = await answersOf(row.id);
  assert.equal(answers.length, 1);
  like(answers[0], { question_id: "q4", audio_key: second, language: "en", english: null, merged: true });
  assert.deepEqual((await getCard(t, kidToken)).asked, [{ id: "q4", text: "How do you make it?" }]);
  assert.equal((await get(t, dad, row.id)).data.voiceRecipe, "ready");
  assert.equal(model.calls.version, 2);
});

test("the hourly sweep reaches her clips: a replaced one, and an upload she never sent", { skip }, async () => {
  const { t, dad } = await wangs();
  const { row } = await cravingCard(t, dad);
  const first = await voiceUpload(t, dad, row.id);
  await ok(send(t, dad, row.id, first));
  const second = await voiceUpload(t, dad, row.id);
  await ok(send(t, dad, row.id, second));
  const never = await voiceUpload(t, dad, row.id);
  await sweep({ log: { info: () => {}, warn: () => {}, error: () => {} } });
  assert.ok(store.removed.includes(first));
  assert.ok(!store.removed.includes(second)); // in use
  assert.ok(!store.removed.includes(never)); // not an hour old yet
  await advance(61 * MIN);
  await sweep({ log: { info: () => {}, warn: () => {}, error: () => {} } });
  assert.ok(store.removed.includes(never));
  assert.ok(!store.removed.includes(second));
  // Too late: the same not-found.
  assert.equal((await send(t, dad, row.id, never)).status, 404);
});

test("two sends of one clip at once are one answer, and one merge", { skip }, async () => {
  const { t, dad } = await wangs();
  const { row } = await cravingCard(t, dad);
  const clip = await voiceUpload(t, dad, row.id);
  const replies = await Promise.all(Array.from({ length: 4 }, () => send(t, dad, row.id, clip)));
  assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200]);
  assert.equal((await answersOf(row.id)).length, 1);
  await settle();
  assert.equal(model.calls.version, 1);
});

test("sendVoiceRecipe: a silent clip fails (she can send again); past $11 nothing is merged until a later day", { skip }, async () => {
  const { t, dad } = await wangs();
  const { row } = await cravingCard(t, dad);
  await ok(send(t, dad, row.id, await voiceUpload(t, dad, row.id, 50))); // under 100 bytes: the fake Ink hears nothing
  await settle();
  like((await get(t, dad, row.id)).data, { answered: false, voiceRecipe: "failed" });
  assert.equal(model.calls.version, 0);

  const other = await cravingCard(t, dad, { dish: "dal", kidName: "Amy" });
  await seedSpend(11);
  await ok(send(t, dad, other.row.id, await voiceUpload(t, dad, other.row.id)));
  await settle();
  assert.equal(model.calls.transcribe, 1); // only the silent clip was heard
  assert.equal(model.calls.version, 0);
  like((await get(t, dad, other.row.id)).data, { answered: false, voiceRecipe: "writing" });
  assert.equal((await getCard(t, other.kidToken)).merging, false);
});

test("sendVoiceRecipe takes the next free own question, and refuses when q4–q6 all have her answers", { skip }, async () => {
  const { t, dad } = await wangs();
  const { kidToken, askToken, row } = await cravingCard(t, dad);
  // The kid asks q1 and an own question (q4); Mom answers q4 on the web.
  assert.equal((await askMom(t, kidToken, [{ id: "q1", text: "How much ketchup?" }, { text: "Which pot?" }])).status, 200);
  assert.equal((await answer(t, askToken, "q4")).status, 200);
  await ok(send(t, dad, row.id, await voiceUpload(t, dad, row.id)));
  assert.deepEqual((await rowOf(kidToken)).asked, [
    { id: "q1", text: "How much ketchup?" },
    { id: "q4", text: "Which pot?" },
    { id: "q5", text: "How do you make it?" },
  ]);
  await settle();

  // With q4, q5 and q6 answered, a fresh card has nothing free.
  const full = await cravingCard(t, dad, { dish: "dal", kidName: "Amy" });
  assert.equal((await askMom(t, full.kidToken, [{ text: "Which pot?" }, { text: "How long?" }, { text: "What heat?" }])).status, 200);
  for (const q of ["q4", "q5", "q6"]) assert.equal((await answer(t, full.askToken, q, { ip: "192.0.2.90" })).status, 200);
  const clip = await voiceUpload(t, dad, full.row.id);
  like(await refusedWith(send(t, dad, full.row.id, clip), 409, "This one already has her answer."), { data: { error: "closed" } });
  assert.equal((await fileRow(clip)).attached_at, null); // refused before it was taken
});

test("deleting the link's maker deletes her links; the cards stay for the kid, without her answer", { skip }, async () => {
  const { t, dad, leo } = await wangs();
  const { kidToken, row } = await cravingCard(t, dad);
  await ok(call(t, dad, "POST", "/v1/cravings/link/revoke"));
  await cravingLink(t, dad);
  await cravingLink(t, leo);
  await ok(day(t, dad, row.id, 3));
  const clip = await voiceUpload(t, dad, row.id);
  await ok(send(t, dad, row.id, clip));
  await settle();
  assert.equal((await links()).length, 3);

  await purgeDishForPerson(dad.personId);
  assert.deepEqual((await links()).map((l) => l.person_id), [leo.personId]); // Leo's is his
  const kept = await rowOf(kidToken);
  assert.equal(kept.requested_of, null);
  assert.equal(kept.filming_day, null);
  assert.equal(kept.voice_recipe_q, null);
  assert.ok((await fileRow(clip)).delete_requested_at);
  like(await getCard(t, kidToken), { version: null, answers: [], filmingDay: null });
});

after(async () => {
  if (hasDatabase) await db().end();
});
