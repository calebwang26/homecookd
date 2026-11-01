// What deleting an account does to the dish ask: convex/dishAsks.test.ts's three, with C3 and the new ip_key rule (SCHEMA.md section 4). Nothing
// calls purgeDishForPerson yet, and `person_id` and `requested_of` stay null in real use until the sync exists, so these set them by hand, as
// Convex's linkedCards helper does.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { purgeDishForPerson } from "../src/modules/dish/account.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { handleMessage } from "../src/scheduled.js";
import {
  advance,
  answer,
  answersOf,
  askMom,
  fileId,
  finish,
  getCard,
  hasDatabase,
  like,
  makeCard,
  MIN,
  MOM_ASKED,
  newBackend,
  peek,
  post,
  rowOf,
  settle,
  silent,
  store,
} from "./dishHelpers.js";
import { family, person } from "./helpers.js";

const skip = !hasDatabase;

/** Leo (the kid) and Dad (asked as Mom), on one card with a photo, two voice notes and an answer merged; plus a family-only card and a stranger's. */
async function linkedCards() {
  const t = await newBackend();
  const familyId = await family();
  const leo = await person(familyId, "kid");
  const dad = await person(familyId, "cook");
  const photo = await fileId(t, "photo");
  const c = await makeCard(t, { dish: "tomato egg", kidName: "Leo", photos: [photo], voiceNote: await fileId(t, "voice") });
  await askMom(t, c.kidToken, MOM_ASKED);
  await post(t, "/dish/cards/update", { kidToken: c.kidToken, voiceNote: await fileId(t, "voice") });
  await answer(t, c.askToken, "q1");
  await finish(t, c.askToken);
  await settle();
  await peek(t, c.askToken, "hi"); // a translation that copies the message
  const familyOnly = await makeCard(t, { dish: "dal" });
  const stranger = await makeCard(t, { dish: "pozole" }, "192.0.2.40");
  const row = await rowOf(c.kidToken);
  const link = (patch: { person_id?: string; requested_of?: string; family_id?: string }) =>
    db().query(
      `update dish_asks set person_id = coalesce($2, person_id), requested_of = coalesce($3, requested_of), family_id = coalesce($4, family_id) where id = $1`,
      [row.id, patch.person_id ?? null, patch.requested_of ?? null, patch.family_id ?? null],
    );
  await db().query("update dish_asks set family_id = $2 where id = $1", [(await rowOf(familyOnly.kidToken)).id, familyId]);
  const [clip] = await answersOf(row.id);
  return { t, familyId, leo, dad, c, row, link, clip, familyOnly, stranger };
}

const kidFiles = (row: Awaited<ReturnType<typeof rowOf>>) => [...row.photo_keys, row.kid_voice_note_key!, row.dish_voice_note_key!];
const translations = async (id: string) => (await db().query("select lang from dish_ask_translations where ask_id = $1", [id])).rows;
const deleteAccount = async (personId: string) => {
  await db().query("update people set deleted_at = now(), name = 'Deleted', email = null where id = $1", [personId]).catch(() => {});
  await purgeDishForPerson(personId);
  await sweep({ log: silent });
};

test("the kid deletes, Mom is still here: the card stays for her, without the kid's name, photos, voice note, message or ip_key", { skip }, async () => {
  const { t, familyId, leo, dad, c, row, link, clip, familyOnly, stranger } = await linkedCards();
  await link({ person_id: leo, requested_of: dad, family_id: familyId });
  assert.ok(row.ip_key);
  assert.equal((await translations(row.id)).length, 1);
  await deleteAccount(leo);
  const kept = await rowOf(c.kidToken);
  like(kept, { requested_of: dad, photo_keys: [], status: "answered", person_id: null, kid_name: null, kid_voice_note_key: null, dish_voice_note_key: null, ip_key: null });
  assert.equal(kept.message, "", "C3: the kid's message goes");
  assert.ok(kept.guess, "C3: the guess stays, because her version is built on it");
  assert.ok(kept.version);
  assert.deepEqual(await translations(row.id), [], "C3: translations copy the message");
  for (const key of kidFiles(row)) assert.ok(!store.objects.has(key), key);
  const live = (await db().query("select key from files where delete_requested_at is null and deleted_at is null")).rows;
  assert.deepEqual(live.map((f) => f.key), [clip.audio_key]);
  assert.equal((await answersOf(row.id)).length, 1); // her answer is hers
  assert.ok(store.objects.has(clip.audio_key));
  like(await peek(t, c.askToken), { kidName: null, photoUrls: [], kidVoiceUrl: null, message: "" });
  // Their family alone deletes nothing; a stranger's card is untouched.
  assert.equal((await post(t, "/dish/cards/get", { kidToken: familyOnly.kidToken })).status, 200);
  assert.equal((await post(t, "/dish/cards/get", { kidToken: stranger.kidToken })).status, 200);
});

test("the kid deletes and no Mom is left on the card: the card goes, with her answers and every file", { skip }, async () => {
  const { t, familyId, leo, dad, c, row, link, clip, familyOnly } = await linkedCards();
  await link({ person_id: leo, family_id: familyId });
  // A second card asked of a Mom who has deleted her account already goes too.
  const other = await makeCard(t, { dish: "upma" }, "192.0.2.41");
  const otherRow = await rowOf(other.kidToken);
  await db().query("update dish_asks set person_id = $2, requested_of = $3 where id = $1", [otherRow.id, leo, dad]);
  await db().query("update people set deleted_at = now(), name = 'Deleted' where id = $1", [dad]);
  await deleteAccount(leo);
  assert.equal(await rowOf(c.kidToken).catch(() => null), null);
  assert.equal(await rowOf(other.kidToken).catch(() => null), null);
  assert.deepEqual(await answersOf(row.id), []);
  assert.deepEqual(await translations(row.id), []);
  for (const key of [...kidFiles(row), clip.audio_key]) assert.ok(!store.objects.has(key), key);
  like(await post(t, "/dish/cards/get", { kidToken: c.kidToken }), { status: 404 });
  assert.equal((await post(t, "/dish/cards/get", { kidToken: familyOnly.kidToken })).status, 200);
  // model_calls stays for cost history, with no id.
  const calls = (await db().query("select ask_id from model_calls where purpose = 'dish_merge'")).rows;
  assert.deepEqual(calls, [{ ask_id: null }]);
});

test("Mom deletes: her answers, clips and version go; the card waits for an answer again and stays for the kid", { skip }, async () => {
  const { t, familyId, leo, dad, c, row, link, clip } = await linkedCards();
  await link({ person_id: leo, requested_of: dad, family_id: familyId });
  await deleteAccount(dad);
  const kept = await rowOf(c.kidToken);
  like(kept, { person_id: leo, status: "asked", kid_name: "Leo", merge_tries: 0, requested_of: null, version: null, finished_at: null, filming_day: null, mom_page_lang: null });
  assert.deepEqual(await answersOf(row.id), []);
  assert.deepEqual(await translations(row.id), []);
  assert.ok(!store.objects.has(clip.audio_key));
  for (const key of kidFiles(row)) assert.ok(store.objects.has(key), "the kid's photo and voice notes stay");
  const card = await getCard(t, c.kidToken);
  like(card, { status: "asked", version: null, answers: [], merging: false, asked: MOM_ASKED });
  assert.deepEqual((await peek(t, c.askToken)).questions, MOM_ASKED); // her link asks again
});

test("deleting a person deletes their craving links; a card made from one stays by the rules above", { skip }, async () => {
  const { t, familyId, dad, c } = await linkedCards();
  const { rows } = await db().query("insert into craving_links (family_id, person_id, token, message) values ($1, $2, $3, 'hello') returning id", [familyId, dad, "L".repeat(22)]);
  await db().query("update dish_asks set craving_id = $2, requested_of = $3 where kid_token_hash = $1", [(await rowOf(c.kidToken)).kid_token_hash, rows[0].id, dad]);
  await deleteAccount(dad);
  assert.equal((await db().query("select 1 from craving_links")).rowCount, 0);
  like(await rowOf(c.kidToken), { craving_id: undefined, requested_of: null });
  assert.equal((await post(t, "/dish/cards/get", { kidToken: c.kidToken })).status, 200);
});

test("a purge is safe to run twice, and a card's family alone never reaches it", { skip }, async () => {
  const { t, familyId, leo, dad, c, link, familyOnly } = await linkedCards();
  await link({ person_id: leo, requested_of: dad, family_id: familyId });
  await deleteAccount(leo);
  const once = await rowOf(c.kidToken);
  await deleteAccount(leo);
  assert.deepEqual(await rowOf(c.kidToken), once);
  like(await rowOf(familyOnly.kidToken), { guess: { dish: "tomato egg" } });
  assert.equal((await post(t, "/dish/cards/get", { kidToken: familyOnly.kidToken })).status, 200);
});

test("C4: an anonymous card's ip_key goes after 90 days, and a file's too; a newer one stays; the sweep repeats harmlessly", { skip }, async () => {
  const t = await newBackend();
  const old = await makeCard(t, { dish: "dal", photos: [await fileId(t, "photo")] });
  await advance(91 * 24 * 60 * MIN);
  const fresh = await makeCard(t, { dish: "pozole", photos: [await fileId(t, "photo")] });
  const run = () => handleMessage(JSON.stringify({ payload: { task: "dish.sweep" } }), silent);
  await run();
  await run();
  assert.equal((await rowOf(old.kidToken)).ip_key, null);
  assert.ok((await rowOf(fresh.kidToken)).ip_key);
  const fileKeys = (await db().query("select ip_key from files order by created_at")).rows;
  assert.equal(fileKeys[0].ip_key, null);
  assert.ok(fileKeys[1].ip_key);
  assert.equal((await post(t, "/dish/cards/get", { kidToken: old.kidToken })).status, 200, "the card itself stays");
});

after(async () => {
  if (hasDatabase) await db().end();
});
