// Deleting an account, the most important thing in this area. Carries over convex/account.test.ts and accountPurge.test.ts with C1, C2, C3 and C5, and adds what they couldn't reach: a real
// scan of every table for what's left, deletion interrupted at every batch, and every proof a deleted person could try. Made-up data only. Anything a test expects gone holds "SECRET-R" and
// anything it expects to stay holds "KEEP-", so a leak in any column of any table fails, including columns nobody thought of.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { hashToken } from "../src/auth.js";
import { db, tx } from "../src/db.js";
import { MAY_STILL_NAME_THEM, TABLES } from "../src/modules/accounts/coverage.js";
import {
  ALERT_AFTER_RESTARTS,
  clearOldLists,
  dueOutside,
  MAX_OUTSIDE_ATTEMPTS,
  outsideWait,
  purgeOutside,
  PURGE_STUCK_MS,
  restartPurges,
  retryOutside,
  runPurge,
  startDeletion,
  useVoiceClones,
} from "../src/modules/accounts/deletion.js";
import { claimCard } from "../src/modules/accounts/links.js";
import { JOIN_LINK_SALT, seal } from "../src/modules/accounts/sealed.js";
import { cardOfToken } from "../src/modules/dish/links.js";
import { purgeCommunityForPerson } from "../src/modules/community/account.js";
import { purgeJobsForPerson, workerFolder } from "../src/modules/jobs/account.js";
import { purgeMessagesForPerson } from "../src/modules/messages/account.js";
import { accountsSweep } from "../src/modules/accounts/tasks.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { handleMessage } from "../src/scheduled.js";
import { FOLDER_MAX, S3_GRACE_MS } from "../src/modules/accounts/outside.js";
import { sweepUploads } from "../src/modules/jobs/tasks.js";
import { useMediaStore, useObjectStore, useUploadStore } from "../src/storage.js";
import { Api, appleToken, bearer, code, count, device, freshDatabase, googleToken, hasDatabase, type Keys, makeDevice, makeFamily, makeJoinLink, makePerson, row, setup, SIGNED_OUT } from "./accountsHelpers.js";
import { fakeStore, type FakeStore, silent } from "./dishHelpers.js";
import { session } from "./helpers.js";

const skip = !hasDatabase;
let api: Api;
let keys: Keys;
let seq = 0;
const n = () => (seq += 1);
const uniq = (prefix: string) => `${prefix}-${n()}-${randomBytes(3).toString("hex")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const q = (sql: string, args: unknown[] = []) => db().query(sql, args);
const one = async (sql: string, args: unknown[] = []) => (await q(sql, args)).rows[0];
const id = async (sql: string, args: unknown[] = []) => (await one(sql, args)).id as string;

before(async () => {
  if (skip) return;
  await freshDatabase();
  keys = await setup();
  api = new Api();
  useVoiceClones({ remove: async () => {} });
});

after(async () => {
  if (!skip) await db().end();
});

const FILE = (name: string) => `private/${uniq(name)}`;

/** Each kitchen starts from empty tables, so a scan for what's left sees only this test's rows. */
async function wipe() {
  const { rows } = await q(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`);
  // DELETE with FK checks off, not TRUNCATE: this runs about a hundred times, and truncating 47 tables and their indexes that often stalls Postgres for the test files after this one.
  await tx(async (c) => {
    await c.query(`set local session_replication_role = replica`);
    for (const r of rows) await c.query(`delete from ${r.tablename}`);
  });
}

type Kitchen = Awaited<ReturnType<typeof kitchen>>;

/**
 * The Pawars: Grandma Rajani (a cook, and the one who deletes), Aai (another cook) and Shreya. Rajani has something in every table section 4 names. The Zhangs (Mei and Serene) live nearby,
 * and their rows must not change.
 */
async function kitchen(options: { events?: number } = {}) {
  await wipe();
  const pawars = await makeFamily(`KEEP-Pawars ${n()}`);
  const zhangs = await makeFamily(`KEEP-Zhangs ${n()}`);
  const f = pawars.id;
  const z = zhangs.id;
  const R = await makePerson(f, `SECRET-R Rajani ${n()}`);
  const aai = await makePerson(f, `KEEP-Aai ${n()}`);
  const shreya = await makePerson(f, `KEEP-Shreya ${n()}`, "kid");
  const mei = await makePerson(z, `KEEP-Mei ${n()}`);
  const serene = await makePerson(z, `KEEP-Serene ${n()}`, "kid");
  const email = `secret-r-${n()}@example.com`;
  await q(
    `update people set relation = 'SECRET-R Aaji', avatar_key = 'a1', email = $2, tz = 'Asia/Kolkata', share_cooking = true, language = 'mr', voice_clone_consented_at = now(),
            cartesia_voice_id = 'voice_r', approx_lat = 42.36, approx_lng = -71.09, campus = 'SECRET-R MIT' where id = $1`,
    [R, email],
  );

  // How she signs in.
  const appleSub = uniq("SECRET-R-sub");
  await q(`insert into identities (provider, subject, person_id, email) values ('apple', $1, $2, $3)`, [appleSub, R, email]);
  const phone = await makeDevice(f, R);
  const phone2 = await makeDevice(f, R);
  await q(`update devices set label = 'SECRET-R phone' where person_id = $1`, [R]);
  const sessionOnPhone = await session(f, R);
  await q(`update sessions set device_id = $2 where token_hash = $1`, [hashToken(sessionOnPhone), phone.id]);
  const oldSession = await session(f, R); // copied from Convex: no phone on it
  const shreyaPhone = await makeDevice(f, shreya);
  await q(`insert into push_tokens (token, family_id, person_id, device_id, platform) values ($1, $2, $3, $4, 'ios')`, [`ExponentPushToken[SECRET-R-${n()}]`, f, R, phone.id]);
  await q(`insert into push_log (person_id, kind, status, title, body) values ($1, 'message', 'sent', 'SECRET-R title', 'SECRET-R body')`, [R]);

  // Recipes, jobs, recordings.
  const prefix = `${uniq("poha")}/`; // as the worker names a recipe folder
  const poha = await id(
    `insert into recipes (family_id, cook_id, title, status, media_prefix, recipe_json_key, cover_key, memories, shared_at, story_card_text)
     values ($1, $2, 'SECRET-R poha', 'ready', $3, $4, $5, '["SECRET-R story"]', now(), 'SECRET-R card') returning id`,
    [f, R, prefix, `${prefix}recipe.json`, `${prefix}poster.jpg`],
  );
  const upma = await id(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'SECRET-R upma', 'processing') returning id`, [f, R]);
  const seeded = await id(`insert into recipes (family_id, cook_id, title, status, recipe_json_key) values ($1, $2, 'SECRET-R demo', 'ready', 'library/demo/recipe.json') returning id`, [f, R]);
  const thalipeeth = await id(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'KEEP-Thalipeeth', 'ready') returning id`, [f, aai]);
  const mooncakes = await id(`insert into recipes (family_id, cook_id, title, status, shared_at) values ($1, $2, 'KEEP-Mooncakes', 'ready', now()) returning id`, [z, mei]);
  const job = (recipe: string | null, upload: string, stage: string) =>
    id(`insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage, title) values ($1, $2, $3, $4, 'phone', $5, 'SECRET-R job') returning id`, [f, R, recipe, upload, stage]);
  const uploadA = `${uniq("up-poha")}/`;
  const uploadB = `${uniq("up-upma")}/`;
  const jobDone = await job(poha, uploadA, "done");
  const jobRunning = await job(upma, uploadB, "writing");
  await q(`insert into model_calls (job_id, recipe_id, purpose, provider, model, ok, cost_usd) values ($1, $2, 'extract', 'anthropic', 'claude', true, 0.5)`, [jobDone, poha]);
  const video = `glasses/${uniq("video")}.mp4`;
  const plate = FILE("plate");
  const frame = FILE("frame");
  // Filmed by someone else, for her.
  const forHerRecording = await id(`insert into recordings (family_id, cook_id, source, status, dish, for_kid_ids) values ($1, $2, 'phone', 'ended', 'KEEP-for her', $3) returning id`, [f, aai, [R, shreya]]);
  const forHerJob = await id(`insert into jobs (family_id, cook_id, upload_key, source, stage, for_kid_ids) values ($1, $2, $3, 'phone', 'done', $4) returning id`, [f, aai, `${uniq("for-her")}/`, [R, shreya]]);
  const recording = await id(`insert into recordings (family_id, cook_id, source, status, dish, video_key, cover_key) values ($1, $2, 'glasses', 'recording', 'SECRET-R dish', $3, $4) returning id`, [
    f,
    R,
    video,
    plate,
  ]);
  await q(`insert into homie_prompts (recording_id, kind, text, text_en, at_s, status, answer_transcript) values ($1, 'amount', 'SECRET-R', 'SECRET-R', 5, 'answered', 'SECRET-R said')`, [recording]);
  for (let i = 0; i < (options.events ?? 4); i += 1) {
    await q(`insert into live_events (recording_id, session_id, session_started_at, kind, at_s, title, text, confidence) values ($1, 'g1', now(), 'step', $2, 'Stir', 'SECRET-R story', 0.9)`, [recording, i]);
  }
  await q(`insert into live_windows (recording_id, session_id, session_started_at, start_s, end_s, ok) values ($1, 'g1', now(), 0, 30, true)`, [recording]);
  await q(`insert into live_frames (recording_id, frame_key, at) values ($1, $2, now())`, [recording, frame]);

  // Messages, with C1's two halves.
  const circle = await id(`insert into threads (family_id, kind) values ($1, 'circle') returning id`, [f]);
  const [a, b] = [R, shreya].sort((x, y) => (Buffer.from(x) < Buffer.from(y) ? -1 : 1));
  const pair = await id(`insert into threads (family_id, kind, a_person_id, b_person_id, last_message_at) values ($1, 'pair', $2, $3, now()) returning id`, [f, a, b]);
  const send = (thread: string, sender: string, kind: string, body: string | null, keysFor: { audio?: string; photo?: string; replyTo?: string } = {}) =>
    id(`insert into messages (family_id, thread_id, sender_id, kind, body, audio_key, photo_key, reply_to) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [
      f,
      thread,
      sender,
      kind,
      body,
      keysFor.audio ?? null,
      keysFor.photo ?? null,
      keysFor.replyTo ?? null,
    ]);
  const rVoice = FILE("r-voice");
  const rPhoto = FILE("r-photo");
  const shreyaVoice = FILE("shreya-voice");
  const rMessage = await send(circle, R, "text", "SECRET-R come home soon");
  await send(circle, R, "system", "SECRET-R joined");
  await send(pair, R, "voice", null, { audio: rVoice });
  await send(circle, R, "cooked", null, { photo: rPhoto });
  const shreyaReply = await send(circle, shreya, "text", "KEEP-reply", { replyTo: rMessage });
  const shreyaMessage = await send(pair, shreya, "voice", "KEEP-shreya note", { audio: shreyaVoice });
  await q(`insert into thread_reads (thread_id, person_id) values ($1, $2), ($1, $3), ($4, $2), ($4, $3)`, [pair, R, shreya, circle]);

  // Notes: answered by her (from her message), and asked by her (answered by Aai).
  const noteAudio = FILE("note");
  const noteAnswer = await send(circle, R, "text", "SECRET-R answer");
  await q(
    `insert into recipe_notes (family_id, library_id, question_message_id, question, asked_by, answer_message_id, answer_text, answer_audio_key, answered_by)
     values ($1, 'poha', null, 'KEEP-question', $2, $3, 'SECRET-R answer', $4, $5)`,
    [f, shreya, noteAnswer, noteAudio, R],
  );
  const rQuestion = await send(circle, R, "question", "SECRET-R question");
  const aaiAnswer = await send(circle, aai, "text", "KEEP-aai answer");
  const noteAsked = await id(
    `insert into recipe_notes (family_id, library_id, question_message_id, question, asked_by, answer_message_id, answer_text, answered_by)
     values ($1, 'poha', $2, 'SECRET-R question', $3, $4, 'KEEP-aai note', $5) returning id`,
    [f, rQuestion, R, aaiAnswer, aai],
  );

  // Questions.
  const onPoha = FILE("q-poha");
  const onThali = FILE("q-thali");
  const askedByHer = FILE("q-asked");
  const pohaQuestion = await id(`insert into questions (family_id, recipe_id, asked_by, text, status, answer_by, answer_text, answer_audio_key) values ($1, $2, $3, 'How long?', 'answered', $4, 'SECRET-R two minutes', $5) returning id`, [f, poha, shreya, R, onPoha]);
  const aaiQuestion = await id(`insert into questions (family_id, recipe_id, asked_by, text, status, answer_by, answer_text, answer_audio_key, answer_transcript, answered_at) values ($1, $2, $3, 'KEEP-how long', 'answered', $4, 'SECRET-R three', $5, 'SECRET-R words', now()) returning id`, [f, thalipeeth, shreya, R, onThali]);
  const herQuestion = await id(`insert into questions (family_id, recipe_id, asked_by, text, status, answer_by, answer_audio_key) values ($1, $2, $3, 'SECRET-R which flour', 'answered', $4, $5) returning id`, [f, thalipeeth, R, aai, askedByHer]);

  // Cooking.
  const shreyaOnPoha = await id(`insert into cooking_sessions (family_id, kid_id, recipe_id, step_order) values ($1, $2, $3, 2) returning id`, [f, shreya, poha]);
  await q(`insert into cooking_sessions (family_id, kid_id, library_id, step_order) values ($1, $2, 'bhakri', 1)`, [f, R]);
  await q(`update cooking_sessions set ended_at = now() where id = $1`, [shreyaOnPoha]);
  const shreyaOnLibrary = await id(`insert into cooking_sessions (family_id, kid_id, library_id, cook_id, step_order) values ($1, $2, 'bhakri', $3, 1) returning id`, [f, shreya, R]);

  // Waiting to be delivered.
  const hello = FILE("hello");
  const sentByHer = uniq("send-r");
  const sentToHer = uniq("send-a");
  await q(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, hello_key) values ($1, $2, $3, $4, $5)`, [sentByHer, f, R, [shreya], hello]);
  await q(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids) values ($1, $2, $3, $4)`, [sentToHer, f, aai, [R, shreya]]);

  // Dish cards: hers as the kid, with Mom still here; asked of her as Mom; a craving link.
  const card = (fields: { person?: string; asked?: string; craving?: string }, message: string) =>
    id(
      `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, kid_name, guess, message, status, family_id, person_id, requested_of, craving_id)
       values ($1, $2, 'dal', 'mom', $3, '{"dish": "KEEP-guess"}', $4, 'asked', $5, $6, $7, $8) returning id`,
      [sha(uniq("k")), sha(uniq("a")), fields.person === R ? "SECRET-R kid" : "KEEP-kid", message, f, fields.person ?? null, fields.asked ?? null, fields.craving ?? null],
    );
  const craving = await id(`insert into craving_links (family_id, person_id, token, message) values ($1, $2, $3, 'SECRET-R what do you miss') returning id`, [f, R, uniq("crave")]);
  const herCard = await card({ person: R, asked: aai }, "SECRET-R message");
  const askedOfHer = await card({ person: shreya, asked: R, craving }, "KEEP-message");
  const answerClip = `dish/${uniq("clip")}`;
  await q(`insert into files (key, bucket, kind, ask_id, capability_hash, uploaded_at, attached_at, family_id) values ($1, 'private', 'voice', $2, $3, now(), now(), $4)`, [answerClip, askedOfHer, sha(uniq("cap")), f]);
  await q(`insert into dish_answers (ask_id, question_id, audio_key, duration_s, words) values ($1, 'q1', $2, 3, 'SECRET-R her words')`, [askedOfHer, answerClip]);
  await q(`update dish_asks set version = '{"said": "SECRET-R version"}' where id = $1`, [askedOfHer]);
  await q(`insert into dish_ask_translations (ask_id, lang, source_hash, guess, questions, message) values ($1, 'hi', $2, '{}', '[]', 'SECRET-R translated')`, [herCard, sha("x")]);

  // Community.
  const dinner = (host: string, family: string, recipe: string | null, dish: string, address: string) =>
    id(
      `insert into dinners (host_id, host_family_id, recipe_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status, invite_token)
       values ($1, $2, $3, $4, now() + interval '1 day', 'home', $5, $6, 42.36, -71.09, 4, 'open', $7) returning id`,
      [host, family, recipe, dish, address, address, uniq("inv")],
    );
  const herDinner = await dinner(R, f, poha, "SECRET-R poha night", "SECRET-R 12 Elm St");
  await q(`insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) values ($1, $2, $3, 'pending')`, [herDinner, serene, z]);
  await q(`insert into dinner_invite_opens (dinner_id, device_id) values ($1, 'phone-1')`, [herDinner]);
  const theirPohaNight = await dinner(mei, z, poha, "KEEP-Kanda Poha", "KEEP-3 Oak St");
  const theirOwn = await dinner(mei, z, mooncakes, "KEEP-Mooncakes", "KEEP-3 Oak St");
  await q(`insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) values ($1, $2, $3, 'pending')`, [theirOwn, R, f]);
  await q(`insert into swap_requests (requester_id, requester_family_id, their_recipe_id, my_recipe_id, other_family_id, status) values ($1, $2, $3, $4, $5, 'pending')`, [serene, z, poha, mooncakes, f]);
  await q(`insert into swap_requests (requester_id, requester_family_id, their_recipe_id, my_recipe_id, other_family_id, status) values ($1, $2, $3, $4, $5, 'pending')`, [R, f, mooncakes, thalipeeth, z]);
  await q(`insert into reports (reporter_family_id, reporter_person_id, kind, target_id, target_family_id, status) values ($1, $2, 'recipe', $3, $4, 'open')`, [f, R, mooncakes, z]);
  await q(`insert into blocks (family_id, blocked_family_id, label) values ($1, $2, 'SECRET-R Rajani''s family')`, [z, f]);

  // Invites, links, moves, the sign-up log.
  const inviteRow = (person: string | null, inviter: string | null, phoneNumber: string | null = null) =>
    id(`insert into invites (family_id, inviter_id, person_id, token_hash, code_hash, phone, expires_at) values ($1, $2, $3, $4, $5, $6, now() + interval '1 day') returning id`, [f, inviter, person, sha(uniq("t")), sha(uniq("c")), phoneNumber]);
  const inviteNaming = await inviteRow(R, aai, "5551112222");
  const familyInvite = await inviteRow(null, R);
  const inviteOther = await inviteRow(aai, R);
  const link = await makeJoinLink(f, R);
  const askingPhone = await makeDevice(f, null, "invite");
  const askToBeHer = await id(`insert into move_requests (family_id, person_id, device_id) values ($1, $2, $3) returning id`, [f, R, askingPhone.id]);
  const decidedPhone = await makeDevice(f, null, "invite");
  const decidedByHer = await id(`insert into move_requests (family_id, person_id, device_id, status, decided_at, decided_by) values ($1, $2, $3, 'approved', now(), $4) returning id`, [f, aai, decidedPhone.id, R]);
  const linkSignup = `link:${uniq("card")}:cook`;
  await q(`insert into signups (name, email, share_token, family_id, person_id) values ('SECRET-R Rajani', $1, $2, $3, $4)`, [email, linkSignup, f, R]);
  const joinSignup = await id(`insert into signups (name, email, share_token, family_id, person_id) values ('SECRET-R Rajani', $1, 'join:x', $2, $3) returning id`, [email, f, R]);
  const oldSignup = await id(`insert into signups (name, email, family_id) values ('SECRET-R old', $1, $2) returning id`, [email, f]); // an old row: no person on it, only her email

  // What she did with recipes, and the rest.
  await q(`insert into shares (token, family_id, library_id, sender_id) values ($1, $2, 'poha', $3)`, [randomBytes(5).toString("hex"), f, R]);
  await q(`insert into favorites (person_id, library_id) values ($1, 'poha')`, [R]);
  await q(`insert into recipe_events (family_id, person_id, library_id, kind) values ($1, $2, 'poha', 'viewed')`, [f, R]);
  const eventOfShreya = await id(`insert into recipe_events (family_id, person_id, library_id, kind, cook_id) values ($1, $2, 'bhakri', 'cooked', $3) returning id`, [f, shreya, R]);
  await q(`insert into idempotency_keys (scope, key, route) values ($1, 'k1', '/x')`, [R]);
  const owned = FILE("owned");
  await q(`insert into files (key, bucket, kind, family_id, owner_person_id, uploaded_at) values ($1, 'private', 'voice', $2, $3, now())`, [owned, f, R]);
  await q(`insert into files (key, bucket, kind, family_id, owner_person_id, uploaded_at) values ($1, 'private', 'voice', $2, $3, now())`, [shreyaVoice, f, shreya]);

  return {
    forHerRecording, forHerJob, f, z, R, aai, shreya, mei, serene, email, appleSub, pawars, zhangs, phone, phone2, sessionOnPhone, oldSession, shreyaPhone, poha, upma, seeded, thalipeeth, mooncakes, jobDone, jobRunning,
    uploadA, uploadB, prefix, video, plate, frame, recording, circle, pair, rVoice, rPhoto, shreyaVoice, rMessage, shreyaReply, shreyaMessage, noteAudio, noteAsked, onPoha, onThali, askedByHer,
    pohaQuestion, aaiQuestion, herQuestion, shreyaOnPoha, shreyaOnLibrary, hello, sentToHer, sentByHer, craving, herCard, askedOfHer, answerClip, herDinner, theirPohaNight, theirOwn,
    inviteNaming, familyInvite, inviteOther, link, askToBeHer, decidedByHer, linkSignup, joinSignup, oldSignup, eventOfShreya, owned, askingPhone,
  };
}

// The driver can't read an array of a domain, so the keys are read as plain text[], and the later column wins.
const deletionOf = (personId: string) =>
  one(`select *, upload_keys::text[] as upload_keys, media_keys::text[] as media_keys, media_prefixes::text[] as media_prefixes from account_deletions where person_id = $1`, [personId]);

/** Where a word survives, table by table. Reads whole rows, so no column is missed. */
async function whereIs(word: string): Promise<string[]> {
  const tables = (await q(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename as string);
  const found: string[] = [];
  for (const t of tables) {
    const n2 = await count(`${t} t`, `to_jsonb(t)::text like $1`, [`%${word}%`]);
    if (n2) found.push(`${t}: ${n2}`);
  }
  return found;
}

/** Every column with a foreign key to people, and whether it names this person. */
async function namesThem(personId: string): Promise<string[]> {
  const { rows } = await q(
    `select c.conrelid::regclass::text as tab, a.attname as col
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'people'::regclass`,
  );
  const found: string[] = [];
  for (const { tab, col } of rows) {
    if ((await count(tab, `${col} = $1`, [personId])) > 0) found.push(`${tab}.${col}`);
  }
  return found.sort();
}

const isMarked = async (key: string) => !!(await row("files", "key = $1 and delete_requested_at is not null", [key]));

/** Everything section 4 says about Rajani's rows, checked in one place so every path to "purged" is held to all of it. */
async function assertPurged(k: Kitchen) {
  const me = await row("people", "id = $1", [k.R]);
  assert.deepEqual(
    [me.name, me.relation, me.email, me.tz, me.language, me.campus, me.approx_lat, me.cartesia_voice_id, me.avatar_key, me.share_cooking, me.voice_clone_consented_at],
    ["Deleted", null, null, null, null, null, null, null, null, null, null],
  );
  assert.ok(me.deleted_at);
  const d = await deletionOf(k.R);
  assert.ok(d.purged_at, "the purge says it's finished");

  assert.deepEqual(await whereIs("SECRET-R"), [], "nothing of hers is left, in any column of any table");
  assert.deepEqual((await namesThem(k.R)).filter((c) => !MAY_STILL_NAME_THEM.includes(c)), [], "no column points at her but the ones allowed");

  for (const key of [k.rVoice, k.rPhoto, k.noteAudio, k.onPoha, k.onThali, k.askedByHer, k.plate, k.frame, k.video, k.hello, k.owned, k.answerClip]) {
    assert.ok(await isMarked(key), `the file was marked before its row went: ${key}`);
  }

  // What others made stays (C1).
  assert.ok(!(await isMarked(k.shreyaVoice)), "Shreya's voice note to her stays");
  assert.ok(await row("messages", "id = $1 and audio_key = $2", [k.shreyaMessage, k.shreyaVoice]));
  assert.equal((await row("messages", "id = $1", [k.shreyaReply])).reply_to, null, "a reply to something gone has nothing to point at");
  assert.ok(await row("threads", "id = $1", [k.pair]), "their pair stays, pointing at the tombstone");
  assert.equal(await count("thread_reads", "thread_id = $1", [k.pair]), 0);
  const note = await row("recipe_notes", "id = $1", [k.noteAsked]);
  assert.deepEqual([note.asked_by, note.question, note.question_message_id, note.answer_text], [null, null, null, "KEEP-aai note"], "her question leaves Aai's note; the answer stays");

  // Her answer on someone else's question comes off, and it waits for an answer again.
  const q1 = await row("questions", "id = $1", [k.aaiQuestion]);
  assert.deepEqual([q1.status, q1.answer_by, q1.answer_text, q1.answer_audio_key, q1.answer_transcript, q1.answered_at, q1.text], ["asked_cook", null, null, null, null, null, "KEEP-how long"]);
  assert.equal(await row("questions", "id = $1", [k.pohaQuestion]), undefined);
  assert.equal(await row("questions", "id = $1", [k.herQuestion]), undefined);

  // Others around her.
  assert.equal(await row("cooking_sessions", "id = $1", [k.shreyaOnPoha]), undefined, "a cooking row on her recipe cascades");
  assert.equal((await row("cooking_sessions", "id = $1", [k.shreyaOnLibrary])).cook_id, null);
  assert.deepEqual((await row("pending_sends", "upload_id = $1", [k.sentToHer])).recipient_ids, [k.shreya]);
  assert.equal(await row("pending_sends", "upload_id = $1", [k.sentByHer]), undefined);
  assert.equal((await row("recipe_events", "id = $1", [k.eventOfShreya])).cook_id, null);

  // Community.
  assert.equal(await row("dinners", "id = $1", [k.herDinner]), undefined);
  assert.equal(await count("dinner_requests", "dinner_id = $1", [k.herDinner]), 0);
  assert.equal(await count("dinner_invite_opens", "dinner_id = $1", [k.herDinner]), 0);
  const night = await row("dinners", "id = $1", [k.theirPohaNight]);
  assert.deepEqual([night.status, night.recipe_id, night.dish], ["cancelled", null, "KEEP-Kanda Poha"], "another family's dinner of her dish is theirs: called off, not deleted");
  assert.equal(await count("swap_requests", "their_recipe_id = $1 or my_recipe_id = $1 or requester_id = $2", [k.poha, k.R]), 0);
  const report = await row("reports", "target_id = $1", [k.mooncakes]);
  assert.deepEqual([report.reporter_person_id, report.reporter_family_id], [null, k.f], "the family's hide stays");
  assert.equal((await row("blocks", "family_id = $1 and blocked_family_id = $2", [k.z, k.f])).label, "A family");

  // Dish cards (C3).
  const hers = await row("dish_asks", "id = $1", [k.herCard]);
  assert.deepEqual([hers.person_id, hers.kid_name, hers.message, hers.requested_of, hers.guess.dish], [null, null, "", k.aai, "KEEP-guess"], "with Mom still here the card stays for her, without the kid's words; the guess stays");
  assert.equal(await count("dish_ask_translations", "ask_id = $1", [k.herCard]), 0);
  const asked = await row("dish_asks", "id = $1", [k.askedOfHer]);
  assert.deepEqual([asked.requested_of, asked.version, asked.message], [null, null, "KEEP-message"], "as Mom, her answers and version go; the card stays for the kid");
  assert.equal(await count("dish_answers", "ask_id = $1", [k.askedOfHer]), 0);
  assert.equal(await count("craving_links", "person_id = $1", [k.R]), 0);

  // Invites, links, moves, the sign-up log.
  assert.equal(await row("invites", "id = $1", [k.inviteNaming]), undefined);
  const family = await row("invites", "id = $1", [k.familyInvite]);
  assert.deepEqual([family.inviter_id, family.status], [null, "revoked"]);
  assert.deepEqual([(await row("invites", "id = $1", [k.inviteOther])).inviter_id, (await row("invites", "id = $1", [k.inviteOther])).status], [null, "pending"]);
  const link = await row("join_links", "id = $1", [k.link.id]);
  assert.deepEqual([link.inviter_id, link.revoked_at], [null, null], "the family's link keeps working");
  assert.equal(await row("move_requests", "id = $1", [k.askToBeHer]), undefined);
  assert.equal((await row("move_requests", "id = $1", [k.decidedByHer])).decided_by, null);
  const linkRow = await row("signups", "share_token = $1", [k.linkSignup]);
  assert.deepEqual([linkRow.name, linkRow.email], ["Deleted", null], "a link: row stays, to keep one join per side");
  assert.equal(await row("signups", "id = $1", [k.joinSignup]), undefined);
  assert.equal(await row("signups", "id = $1", [k.oldSignup]), undefined, "an old row with no person is found by her email");

  // Sign-in.
  assert.equal(await count("sessions", "person_id = $1", [k.R]), 0);
  assert.equal(await count("identities", "person_id = $1", [k.R]), 0);
  assert.equal(await count("push_tokens", "person_id = $1", [k.R]), 0);
  for (const phone of [k.phone, k.phone2]) {
    const row2 = await row("devices", "id = $1", [phone.id]);
    assert.deepEqual([row2.person_id, row2.label], [null, null]);
    assert.ok(row2.revoked_at);
  }

  // Someone else's filming for her stays, without her.
  assert.deepEqual((await row("recordings", "id = $1", [k.forHerRecording])).for_kid_ids, [k.shreya]);
  assert.deepEqual((await row("jobs", "id = $1", [k.forHerJob])).for_kid_ids, [k.shreya]);

  // What the outside purge will need.
  assert.deepEqual([...d.upload_keys].sort(), [k.uploadA, k.uploadB].sort());
  assert.deepEqual([...d.media_prefixes].sort(), [k.prefix, workerFolder(k.jobDone), workerFolder(k.jobRunning)].sort(), "a job stopped part way can leave files under its own folder");
  assert.ok(d.media_keys.includes(k.video));
  assert.ok(d.media_keys.includes(`${k.prefix}recipe.json`));
  assert.ok(!d.media_keys.includes("library/demo/recipe.json"), "a seeded demo's files are the public library's");
  assert.deepEqual([...d.recipe_ids].sort(), [k.poha, k.upma, k.seeded].sort());
  assert.deepEqual([...d.job_ids].sort(), [k.jobDone, k.jobRunning].sort());
  assert.equal(await count("model_calls", "job_id is null and recipe_id is null and cost_usd = 0.5"), await count("model_calls", "cost_usd = 0.5"), "cost history stays, with its ids gone");
}

const purge = async (personId: string, options = {}) => {
  const did = await startDeletion(personId, "person");
  await runPurge(did!, {}, options);
  return did!;
};

// ---- the coverage guard

test("every table in the schema says what deletion does to it", { skip }, async () => {
  const tables = (await q(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`)).rows.map((r) => r.tablename as string).sort();
  assert.deepEqual(tables, Object.keys(TABLES).sort());
});

test("no column points at a deleted person but the stated ones, and no word of hers is left: the whole kitchen", { skip }, async () => {
  const k = await kitchen();
  assert.notDeepEqual(await whereIs("SECRET-R"), [], "the check can see her before");
  await purge(k.R);
  await assertPurged(k);
  assert.equal((await deletionOf(k.R)).voice_clone_id, "voice_r", "kept for the outside purge, on the deletion's row and nowhere else");
  // `files.owner_person_id` is allowed only until the sweep removes the row. A pair names her in whichever column her id sorts into.
  const side = (await row("threads", "id = $1", [k.pair])).a_person_id === k.R ? "threads.a_person_id" : "threads.b_person_id";
  assert.deepEqual(await namesThem(k.R), ["account_deletions.person_id", "files.owner_person_id", side].sort());
});

// ---- what happens at once

test("at once, in one transaction: a tombstone, every way in closed, nothing of hers worked on, her recipes gone", { skip }, async () => {
  const k = await kitchen();
  // Hers, around no recipe: only the at-once step takes it off the map.
  const hosted = await id(
    `insert into dinners (host_id, host_family_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status, invite_token)
     values ($1, $2, 'SECRET-R hosted', now() + interval '1 day', 'home', 'SECRET-R', 'SECRET-R', 42.36, -71.09, 4, 'open', $3) returning id`,
    [k.R, k.f, uniq("inv")],
  );
  await startDeletion(k.R, "person");
  const me = await row("people", "id = $1", [k.R]);
  assert.deepEqual([me.name, me.email], ["Deleted", null]);
  assert.equal(await count("sessions", "person_id = $1", [k.R]), 0);
  assert.equal(await count("identities", "person_id = $1", [k.R]), 0);
  assert.equal(await count("push_tokens", "person_id = $1", [k.R]), 0);
  assert.equal(await count("devices", "person_id = $1", [k.R]), 0);
  assert.equal(await count("recipes", "cook_id = $1", [k.R]), 0);
  assert.equal(await count("invites", "person_id = $1", [k.R]), 0);
  const job = await row("jobs", "id = $1", [k.jobRunning]);
  assert.deepEqual([job.stage, job.error], ["failed", "Cancelled."]);
  assert.ok(job.cancelled_at);
  assert.equal((await row("dinners", "id = $1", [hosted])).status, "cancelled");
  assert.equal((await row("jobs", "id = $1", [k.jobDone])).stage, "done", "a finished job isn't changed");
  assert.equal((await row("recordings", "id = $1", [k.recording])).status, "abandoned");
  assert.equal((await row("dinners", "id = $1", [k.herDinner])).status, "cancelled");
  assert.equal((await row("dinners", "id = $1", [k.theirPohaNight])).status, "cancelled");
  assert.ok(await row("outbox", "payload->>'task' = 'accounts.purge' and payload->>'deletionId' = $1", [(await deletionOf(k.R)).id]));
  assert.equal(await count("signups", "email = $1", [k.email]), 0);
  assert.equal((await row("families", "id = $1", [k.f])).moss_sync_again, true, "Moss is told to sync");
});

test("a deleted person's rows can't be half-written: a failure in the first transaction leaves them as they were", { skip }, async () => {
  const k = await kitchen();
  // A question that can't be deleted: an FK from a table the code doesn't know about would do this. Here, a trigger stands in for any failure.
  await q(`create function fail_now() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
  await q(`create trigger fail_recipes before delete on recipes for each statement execute function fail_now()`);
  try {
    await assert.rejects(startDeletion(k.R, "person"));
  } finally {
    await q(`drop trigger fail_recipes on recipes`);
    await q(`drop function fail_now`);
  }
  assert.equal((await row("people", "id = $1", [k.R])).deleted_at, null);
  assert.equal(await count("account_deletions", "person_id = $1", [k.R]), 0);
  assert.equal(await count("sessions", "person_id = $1", [k.R]), 2, "still signed in, so the phone can try again");
  await purge(k.R);
  await assertPurged(k);
});

test("safe to run twice, at the start and at the end: one row, the same result", { skip }, async () => {
  const k = await kitchen();
  const first = await startDeletion(k.R, "person");
  assert.equal(await startDeletion(k.R, "person"), first);
  assert.equal(await count("account_deletions", "person_id = $1", [k.R]), 1);
  await runPurge(first!, {});
  const stamped = (await deletionOf(k.R)).purged_at.getTime();
  assert.equal(await runPurge(first!, {}), "done");
  assert.equal((await deletionOf(k.R)).purged_at.getTime(), stamped);
  assert.equal(await startDeletion(k.R, "person"), first);
  await assertPurged(k);
});

test("two deletes at once make one deletion row and one tombstone", { skip }, async () => {
  const k = await kitchen();
  const [a, b] = await Promise.all([startDeletion(k.R, "person"), startDeletion(k.R, "person")]);
  assert.equal(a, b);
  assert.equal(await count("account_deletions", "person_id = $1", [k.R]), 1);
  await Promise.all([runPurge(a!, {}), runPurge(b!, {})]);
  await assertPurged(k);
});

// ---- the batches

test("a kid deleting takes only what's theirs", { skip }, async () => {
  const k = await kitchen();
  await q(`insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'gone with her', 'asked_cook')`, [k.f, k.thalipeeth, k.shreya]);
  await purge(k.shreya);
  const d = await deletionOf(k.shreya);
  assert.deepEqual([d.recipe_ids, d.upload_keys], [[], []]);
  assert.equal((await row("messages", "id = $1", [k.rMessage])).body, "SECRET-R come home soon", "Grandma's message stays");
  assert.ok(await isMarked(k.shreyaVoice), "her voice note is hers");
  assert.equal(await row("messages", "id = $1", [k.shreyaMessage]), undefined);
  assert.equal(await count("questions", "asked_by = $1", [k.shreya]), 0);
  assert.equal(await row("questions", "id = $1", [k.pohaQuestion]), undefined, "her question with the answer on it");
  assert.ok(await isMarked(k.onPoha));
  assert.equal(await count("cooking_sessions", "kid_id = $1", [k.shreya]), 0);
  assert.equal(await count("recipes", "cook_id = $1", [k.R]), 3, "Grandma's recipes stay");
  assert.ok(await row("recordings", "id = $1", [k.recording]));
  assert.ok(await row("dinners", "id = $1 and status = 'open'", [k.herDinner]));
  assert.deepEqual((await row("pending_sends", "upload_id = $1", [k.sentToHer])).recipient_ids, [k.R], "she's off the list");
  assert.equal((await row("dish_asks", "id = $1", [k.askedOfHer])).kid_name, null, "with Mom still here her own card stays, nameless");
});

test("another family is untouched", { skip }, async () => {
  const k = await kitchen();
  const snapshot = async () => ({
    recipes: await count("recipes", "family_id = $1", [k.z]),
    people: await count("people", "family_id = $1 and deleted_at is null", [k.z]),
    name: (await row("people", "id = $1", [k.mei])).name,
    family: (await row("families", "id = $1", [k.z])).name,
    code: (await row("families", "id = $1", [k.z])).code_hash,
    own: (await row("dinners", "id = $1", [k.theirOwn])).status,
  });
  const before2 = await snapshot();
  await purge(k.R);
  assert.deepEqual(await snapshot(), before2);
  assert.equal(await count("swap_requests", "requester_id = $1", [k.serene]), 0, "their swap ask was for her recipe, so it went with it");
  assert.equal(await count("dinner_requests", "dinner_id = $1", [k.theirOwn]), 0, "her own ask at their dinner goes");
});

test("nothing of hers is worked on after she deletes; what turns up later is purged and listed", { skip }, async () => {
  const k = await kitchen();
  const did = await startDeletion(k.R, "person");
  // A recipe, a job and a message that turn up before the purge runs: a worker that was a moment late.
  const late = await id(`insert into recipes (family_id, cook_id, title, status, media_prefix) values ($1, $2, 'SECRET-R late', 'ready', 'recipes/late/') returning id`, [k.f, k.R]);
  const lateUpload = `${uniq("late")}/`;
  const lateJob = await id(`insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage) values ($1, $2, $3, $4, 'phone', 'done') returning id`, [k.f, k.R, late, lateUpload]);
  await runPurge(did!, {});
  const d = await deletionOf(k.R);
  assert.ok(d.job_ids.includes(lateJob));
  assert.ok(d.upload_keys.includes(lateUpload));
  assert.ok(d.recipe_ids.includes(late));
  assert.ok(d.media_prefixes.includes("recipes/late/"));
  assert.equal(await count("recipes", "cook_id = $1", [k.R]), 0);
  assert.equal(await count("jobs", "cook_id = $1", [k.R]), 0);
});

test("a recipe that lands after Community and Messages have had their turn: its dinner is called off and the answer on it is marked", { skip }, async () => {
  const k = await kitchen();
  const did = await startDeletion(k.R, "person");
  const lateFile = FILE("late-answer");
  let dinner = "";
  await runPurge(did!, {}, {
    fault: async (point: string, step: string) => {
      // The last batch of Messages' purge, and the recipes' batch is next.
      if (dinner || point !== "after-commit" || step !== "uploads nothing took") return;
      const late = await id(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'SECRET-R later still', 'ready') returning id`, [k.f, k.R]);
      await q(`insert into questions (family_id, recipe_id, asked_by, text, status, answer_by, answer_audio_key) values ($1, $2, $3, 'KEEP-how long', 'answered', $3, $4)`, [k.f, late, k.shreya, lateFile]);
      dinner = await id(
        `insert into dinners (host_id, host_family_id, recipe_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status, invite_token)
         values ($1, $2, $3, 'KEEP-a dish', now() + interval '1 day', 'home', 'KEEP-home', 'KEEP-address', 42.36, -71.09, 4, 'open', $4) returning id`,
        [k.mei, k.z, late, uniq("inv")],
      );
    },
  });
  assert.ok(dinner);
  const called = await row("dinners", "id = $1", [dinner]);
  assert.deepEqual([called.status, called.recipe_id], ["cancelled", null]);
  assert.ok(await isMarked(lateFile));
  assert.equal(await count("questions", "answer_audio_key = $1", [lateFile]), 0);
});

test("a file an area marks names this deletion, and a key with no row in the ledger still gets one", { skip }, async () => {
  const k = await kitchen();
  const did = await startDeletion(k.R, "person");
  const unknown = FILE("no-ledger-row");
  await q(`insert into messages (family_id, thread_id, sender_id, kind, audio_key) values ($1, $2, $3, 'voice', $4)`, [k.f, k.circle, k.R, unknown]);
  await runPurge(did!, {});
  assert.equal((await row("files", "key = $1", [unknown])).purge_deletion_id, did, "the only record of it can't go with the message");
  for (const key of [k.rVoice, k.rPhoto, k.noteAudio, k.onThali, k.askedByHer, k.plate, k.frame, k.hello]) {
    const file = await row("files", "key = $1", [key]);
    assert.ok(file.delete_requested_at, key);
    assert.equal(file.purge_deletion_id, did, key);
  }
});

test("a row that turns up during the purge is caught: it finishes only after a pass finds nothing", { skip }, async () => {
  const k = await kitchen();
  const did = await startDeletion(k.R, "person");
  let added = 0;
  const late = () => q(`insert into messages (family_id, thread_id, sender_id, kind, body) values ($1, $2, $3, 'text', 'SECRET-R late message')`, [k.f, k.circle, k.R]);
  const result = await runPurge(did!, {}, {
    fault: async (point: string, step: string, changed: number) => {
      if (point !== "after-commit") return;
      // The messages step has already run this pass when one more arrives.
      if (added === 0 && step === "jobs") {
        added = 1;
        await late();
      } else if (added === 1 && step === "messages" && changed > 0) {
        // The next pass takes that one, and nothing else changes. Only its count can send the purge round again for this one.
        added = 2;
        await late();
      }
    },
  });
  assert.equal(result, "done");
  assert.equal(added, 2);
  await assertPurged(k);
});

test("each area's purge says how many rows it changed, and none once nothing's left, so a pass can finish", { skip }, async () => {
  const k = await kitchen();
  await startDeletion(k.R, "person");
  const parts = [() => purgeCommunityForPerson(k.R, k.f), () => purgeMessagesForPerson(k.R, k.f), () => purgeJobsForPerson(k.R)];
  for (const part of parts) assert.ok((await part()) > 0);
  for (const part of parts) assert.equal(await part(), 0);
});

test("a long area's purge keeps the deletion marked as running, so the schedule leaves it alone", { skip }, async () => {
  const k = await kitchen();
  const did = await startDeletion(k.R, "person");
  let seen: Date | undefined;
  const longAgo = new Date(Date.now() - 2 * PURGE_STUCK_MS);
  await runPurge(did!, {}, {
    fault: async (point: string, step: string) => {
      if (point !== "after-commit" || seen) return;
      // Two batches of Messages' one purge: only the batch in between can have moved it.
      if (step === "push log") await q(`update account_deletions set purge_run_at = $2 where id = $1`, [did, longAgo]);
      if (step === "messages") seen = (await deletionOf(k.R)).purge_run_at;
    },
  });
  assert.ok(seen && seen.getTime() > longAgo.getTime() + PURGE_STUCK_MS);
});

test("a large purge works through small batches, and queues itself when out of time", { skip }, async () => {
  const k = await kitchen({ events: 40 });
  const did = await startDeletion(k.R, "person");
  const result = await runPurge(did!, {}, { batch: 2, budgetMs: 0 });
  assert.equal(result, "more");
  assert.ok(await row("outbox", "payload->>'task' = 'accounts.purge' and payload->>'deletionId' = $1 and sent_at is null", [did]));
  assert.equal((await deletionOf(k.R)).purged_at, null, "not finished");
  assert.equal(await runPurge(did!, {}, { batch: 2 }), "done");
  await assertPurged(k);
});

test("more recipes than one transaction takes: the rest go in the batches", { skip }, async () => {
  const f = await makeFamily();
  const big = await makePerson(f.id);
  await q(`insert into recipes (family_id, cook_id, title, status) select $1, $2, 'SECRET-R ' || g, 'ready' from generate_series(1, 520) g`, [f.id, big]);
  const did = await startDeletion(big, "person");
  assert.equal(await count("recipes", "cook_id = $1", [big]), 20);
  await runPurge(did!, {});
  assert.equal(await count("recipes", "cook_id = $1", [big]), 0);
  assert.equal((await deletionOf(big)).recipe_ids.length, 520);
});

// ---- interrupted at every batch

/** How many batches change something, in a clean run of the same kitchen. */
async function batchesThatChange(batch: number): Promise<number> {
  const k = await kitchen();
  let changes = 0;
  await purge(k.R, {
    batch,
    fault: (point: string, _step: string, changed: number) => {
      if (point === "before-commit" && changed > 0) changes += 1;
    },
  });
  await assertPurged(k);
  return changes;
}

class Crash extends Error {}

for (const point of ["before-commit", "after-commit"] as const) {
  test(`deletion interrupted at every batch (${point}) and resumed ends the same, and no file key is ever lost`, { skip, timeout: 240_000 }, async () => {
    const batch = 3;
    const total = await batchesThatChange(batch);
    assert.ok(total > 25, `expected many batches, saw ${total}`);
    for (let crashAt = 1; crashAt <= total; crashAt += 1) {
      const k = await kitchen();
      const did = await startDeletion(k.R, "person");
      let seen = 0;
      const fault = (at: string, _step: string, changed: number) => {
        if (at === point && changed > 0) {
          seen += 1;
          if (seen === crashAt) throw new Crash();
        }
      };
      await assert.rejects(runPurge(did!, {}, { batch, fault }), Crash, `batch ${crashAt} of ${total}`);

      // At the moment of the crash, a row that went had its key marked first.
      const stillHeld = [
        [k.rVoice, "messages", "audio_key"],
        [k.rPhoto, "messages", "photo_key"],
        [k.noteAudio, "recipe_notes", "answer_audio_key"],
        [k.onThali, "questions", "answer_audio_key"],
        [k.askedByHer, "questions", "answer_audio_key"],
        [k.plate, "recordings", "cover_key"],
        [k.frame, "live_frames", "frame_key"],
        [k.hello, "pending_sends", "hello_key"],
      ] as const;
      for (const [key, table, col] of stillHeld) {
        const held = await count(table, `${col} = $1`, [key]);
        if (!held) assert.ok(await isMarked(key), `batch ${crashAt}: ${table}.${col} went without its file being marked`);
      }
      assert.equal((await deletionOf(k.R)).purged_at, null, `batch ${crashAt}: not finished yet`);

      // Resumed the way it really is: the schedule finds it stopped and queues it.
      await q(`update account_deletions set purge_run_at = now() - make_interval(secs => $2) where id = $1`, [did, PURGE_STUCK_MS / 1000 + 60]);
      await restartPurges();
      assert.ok((await deletionOf(k.R)).purge_restarts >= 1);
      await handleMessage(JSON.stringify({ payload: { task: "accounts.purge", deletionId: did } }), silent);
      await assertPurged(k);
    }
  });
}

test("a purge that stopped is started again by the schedule; one still running is left alone", { skip }, async () => {
  const k = await kitchen();
  const stopped = await startDeletion(k.R, "person");
  await q(`update account_deletions set requested_at = now() - interval '2 hours', purge_run_at = null where id = $1`, [stopped]);
  const running = await startDeletion(k.mei, "person");
  await q(`update account_deletions set purge_run_at = now() - interval '1 minute' where id = $1`, [running]);
  await restartPurges();
  assert.equal((await row("account_deletions", "id = $1", [stopped])).purge_restarts, 1);
  assert.equal((await row("account_deletions", "id = $1", [running])).purge_restarts, 0);
  await q(`update account_deletions set purge_run_at = now() - interval '2 hours', purge_restarts = $2 where id = $1`, [stopped, ALERT_AFTER_RESTARTS + 2]);
  await restartPurges();
  assert.equal((await row("account_deletions", "id = $1", [stopped])).purge_restarts, ALERT_AFTER_RESTARTS + 3, "it keeps trying: someone's deletion isn't given up on");
  await runPurge(stopped!, {});
  await assertPurged(k);
});

// ---- the family (C2)

test("when the family's last person deletes, its name and codes go, its phones and links stop, and the row stays", { skip }, async () => {
  const f = await makeFamily("SECRET-F family");
  await q(`update families set public_name = 'SECRET-F public', code_enc = 'v1:x.y' where id = $1`, [f.id]);
  const a = await makePerson(f.id, "Solo A");
  const b = await makePerson(f.id, "Solo B");
  const aPhone = await makeDevice(f.id, a);
  await makeDevice(f.id, b);
  const emptyPhone = await makeDevice(f.id, null, "invite");
  const link = await makeJoinLink(f.id, a);
  const operator = await makeJoinLink(f.id, null, { expires: null });
  const invite = await id(`insert into invites (family_id, inviter_id, token_hash, code_hash, expires_at) values ($1, $2, $3, $4, now() + interval '1 day') returning id`, [f.id, b, sha(uniq("t")), sha(uniq("c"))]);

  await purge(a);
  assert.ok((await row("families", "id = $1", [f.id])).name.startsWith("SECRET-F"), "someone's still there");
  assert.equal((await api.get("/family", code(f.code))).status, 200);

  await purge(b);
  const fam = await row("families", "id = $1", [f.id]);
  assert.deepEqual([fam.name, fam.public_name, fam.code_hash, fam.code_enc], ["Deleted", null, null, null]);
  assert.ok(fam.blanked_at);
  assert.deepEqual(await whereIs("SECRET-F"), []);

  assert.equal((await api.get("/family", code(f.code))).status, 401, "the code is gone");
  assert.equal((await api.get("/family", device(emptyPhone.key))).data.error, SIGNED_OUT, "a phone with no person stops too");
  assert.equal((await api.get("/family", device(aPhone.key))).data.error, SIGNED_OUT);
  for (const token of [link.token, operator.token]) {
    assert.equal((await api.post("/invites/peek", { token })).status, 404);
    const joined = await api.apple({ id_token: await appleToken(keys, uniq("sub")), join_token: token, name: "Latecomer", role: "learner" });
    assert.ok(joined.status === 410 || joined.status === 404, `a dead family takes nobody in, got ${joined.status}`);
  }
  assert.equal((await row("invites", "id = $1", [invite])).status, "revoked");
  assert.equal(await count("people", "family_id = $1 and name = 'Latecomer'", [f.id]), 0);
});

test("a removed person doesn't keep a family open; a phone-less face does", { skip }, async () => {
  const f = await makeFamily("SECRET-G family");
  const leaver = await makePerson(f.id, "Leaver");
  await q(`update people set removed_at = now() where id = $1`, [leaver]);
  const last = await makePerson(f.id, "Last");
  await purge(last);
  assert.equal((await row("families", "id = $1", [f.id])).name, "Deleted");

  const h = await makeFamily("KEEP-H family");
  const grandma = await makePerson(h.id, "Grandma");
  await makePerson(h.id, "Face");
  await purge(grandma);
  assert.equal((await row("families", "id = $1", [h.id])).name, "KEEP-H family");
});

test("the last two deleting at once still blank it, and a join racing the last delete either gets in or is refused, never half", { skip }, async () => {
  const f = await makeFamily("SECRET-I family");
  const a = await makePerson(f.id, "A");
  const b = await makePerson(f.id, "B");
  const [da, db2] = await Promise.all([startDeletion(a, "person"), startDeletion(b, "person")]);
  await Promise.all([runPurge(da!, {}), runPurge(db2!, {})]);
  assert.equal((await row("families", "id = $1", [f.id])).name, "Deleted");

  const g = await makeFamily("KEEP-J family");
  const c = await makePerson(g.id, "C");
  const link = await makeJoinLink(g.id, c);
  const [joined, deleted] = await Promise.all([api.apple({ id_token: await appleToken(keys, uniq("sub")), join_token: link.token, name: "Racer", role: "learner" }), startDeletion(c, "person")]);
  await runPurge(deleted!, {});
  const fam = await row("families", "id = $1", [g.id]);
  if (joined.status === 200) {
    assert.equal(fam.name, "KEEP-J family", "they got in first, so the family lives");
    assert.equal(fam.blanked_at, null);
  } else {
    assert.equal(fam.name, "Deleted");
    assert.equal(await count("people", "family_id = $1 and name = 'Racer'", [g.id]), 0);
  }
});

// ---- no way back as a tombstone

test("a deleted person trying every proof: refused each way, and nothing brings the tombstone back", { skip }, async () => {
  const k = await kitchen();
  const familyInvite = await api.post("/invites", {}, device(k.shreyaPhone.key, k.shreya));
  const appleWho = await appleToken(keys, k.appleSub);
  const google = await googleToken(keys, "google-for-r");
  await q(`insert into identities (provider, subject, person_id) values ('google', 'google-for-r', $1)`, [k.R]);
  const live = (await api.post("/v1/sessions/start", { deviceKey: k.shreyaPhone.key, profileId: k.shreya })).data.sessionToken;
  const did = await startDeletion(k.R, "person");
  await runPurge(did!, {});

  // Session tokens, on the phone and old ones with no phone.
  for (const token of [k.sessionOnPhone, k.oldSession]) {
    assert.equal((await api.get("/v1/me", bearer(token))).status, 401);
    assert.equal((await api.post("/v1/account/delete", {}, bearer(token))).status, 401);
  }
  // Her device keys.
  for (const phone of [k.phone, k.phone2]) {
    const seen = await api.get("/family", device(phone.key));
    assert.deepEqual([seen.status, seen.data.error], [401, SIGNED_OUT]);
    const asIf = await api.post("/v1/sessions/start", { deviceKey: phone.key, profileId: k.R });
    assert.deepEqual([asIf.status, asIf.data.error], [401, SIGNED_OUT]);
  }
  // Another phone in the family naming her, for a session or for anything else.
  const named = await api.post("/v1/sessions/start", { deviceKey: k.shreyaPhone.key, profileId: k.R });
  assert.deepEqual([named.status, named.data.error], [403, "This account was deleted."], "the words the app matches");
  assert.equal((await api.post("/invites", {}, device(k.shreyaPhone.key, k.R))).status, 403);
  assert.equal((await api.get("/family", device(k.shreyaPhone.key, k.R))).status, 403);
  // The family code naming her.
  assert.equal((await api.post("/invites", {}, code(k.pawars.code, k.R))).status, 403);
  // She isn't on any list.
  const family = await api.get("/family", device(k.shreyaPhone.key, k.shreya));
  const names = [...family.data.profiles, ...family.data.former_profiles].map((p: { id: string }) => p.id);
  assert.ok(!names.includes(k.R));
  // A join link claiming her, by id and by the name a tombstone carries.
  const claim = await api.apple({ id_token: await appleToken(keys, uniq("sub")), join_token: k.link.token, claim_profile_id: k.R });
  assert.deepEqual([claim.status, claim.data.error], [409, "That person isn't in this family."]);
  assert.equal((await api.post("/invites/peek", { token: k.link.token, name: "Deleted" })).data.claimable, null);
  // An old invite that named her, and a family invite claiming her.
  const viaInvite = await api.apple({ id_token: await appleToken(keys, uniq("sub")), join_token: new URL(familyInvite.data.invite.url).searchParams.get("t"), claim_profile_id: k.R });
  assert.equal(viaInvite.status, 409);
  // A phone asking to move in as her.
  const asking = await makeDevice(k.f, null, "invite");
  assert.equal((await api.post("/move-requests", { profile_id: k.R }, device(asking.key))).status, 404);
  // Removing her again is just fine, as the app's next call after deleting does.
  assert.equal((await api.post(`/profiles/${k.R}/remove`, {}, device(k.shreyaPhone.key, k.R))).status, 200);
  assert.equal((await api.post(`/profiles/${k.R}/remove`, {}, device(k.phone.key, k.R))).status, 401, "from her own phone: the app reads this as signed out");

  // Her Apple and Google accounts are free, and each signs in as someone NEW.
  const apple = await api.apple({ id_token: appleWho });
  assert.equal(apple.data.needs_name, true, "she counts as new: nobody signs in as a tombstone");
  const again = await api.apple({ id_token: appleWho, name: "Rajani Again", role: "cook" });
  assert.equal(again.status, 200);
  assert.notEqual(again.data.profile_id, k.R);
  const newFamily = (await row("people", "id = $1", [again.data.profile_id])).family_id;
  assert.notEqual(newFamily, k.f, "and not in the old family");
  assert.equal((await api.google({ id_token: google })).data.needs_name, true);
  // The tombstone is still a tombstone, and someone else signing in doesn't bring it back.
  assert.equal((await row("people", "id = $1", [k.R])).name, "Deleted");
  assert.equal(await count("identities", "person_id = $1", [k.R]), 0);
  assert.equal((await api.get("/v1/me", bearer(live))).status, 200, "Shreya is unaffected");
  // A stale Apple link, had a bug left one, is dropped rather than followed.
  await q(`insert into identities (provider, subject, person_id) values ('apple', 'stale-sub', $1)`, [k.R]);
  assert.equal((await api.apple({ id_token: await appleToken(keys, "stale-sub") })).data.needs_name, true);
  assert.equal(await count("identities", "subject = 'stale-sub'"), 0);
});

test("the database refuses a tombstone that keeps anything personal", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Half Done");
  await assert.rejects(q(`update people set deleted_at = now() where id = $1`, [p]), /people_tombstone_blank/);
  await q(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [p]);
  await assert.rejects(q(`update people set email = 'back@example.com' where id = $1`, [p]), /people_tombstone_blank/);
});

// ---- refuses no one

test("a phone that's someone's in this family can delete a phone-less person, and it refuses no one else: a person with nothing, the last in a family, a memorial person", { skip }, async () => {
  const f = await makeFamily();
  const mom = await makePerson(f.id, "Mom");
  const grandma = await makePerson(f.id, "Grandma");
  const memorial = await makePerson(f.id, "Remembered");
  await q(`update people set memorial = true where id = $1`, [memorial]);
  const momPhone = await makeDevice(f.id, mom);
  const del = async (profileId: string) => {
    const s = await api.post("/v1/sessions/start", { deviceKey: momPhone.key, profileId });
    assert.equal(s.status, 200, profileId);
    const res = await api.post("/v1/account/delete", {}, bearer(s.data.sessionToken));
    assert.deepEqual([res.status, res.data.deleted], [200, true]);
  };
  await del(grandma);
  await del(memorial);
  assert.equal((await api.get("/family", device(momPhone.key, mom))).status, 200, "the lent phone stays signed in");
  const removed = await api.post(`/profiles/${grandma}/remove`, {}, device(momPhone.key, grandma));
  assert.deepEqual([removed.status, removed.data.ok], [200, true], "the app's next call after a delete");
  await del(mom);
  assert.equal((await api.get("/family", device(momPhone.key))).status, 401);
  assert.equal((await row("families", "id = $1", [f.id])).name, "Deleted");
});

test("a repeat after a lost answer reads as signed out, which the app already handles", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Retry");
  const phone = await makeDevice(f.id, p);
  const s = (await api.post("/v1/sessions/start", { deviceKey: phone.key, profileId: p })).data.sessionToken;
  assert.equal((await api.post("/v1/account/delete", {}, bearer(s))).status, 200);
  assert.equal((await api.post("/v1/account/delete", {}, bearer(s))).status, 401);
});

test("someone who left the family with a live session can still delete their account, and nothing else", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Left");
  const s = await session(f.id, p);
  await q(`update people set removed_at = now() where id = $1`, [p]);
  assert.equal((await api.get("/v1/circle", bearer(s))).status, 403, "the family is closed to them");
  assert.equal((await api.get("/v1/apple/revoke-ready", bearer(s))).status, 200, "the app asks this first");
  assert.equal((await api.post("/v1/apple/revoke", {}, bearer(s))).status, 200);
  const deleted = await api.post("/v1/account/delete", {}, bearer(s));
  assert.deepEqual([deleted.status, deleted.data.deleted], [200, true]);
  assert.ok((await row("people", "id = $1", [p])).deleted_at, "they're gone");
  assert.equal(await count("account_deletions", "person_id = $1", [p]), 1, "and their purge is on its way");
  assert.equal((await api.post("/v1/account/delete", {}, bearer(s))).status, 401, "signed out by it");
});

test("a phone with no person of its own gets no session, so it can't delete anyone: an opened invite, or a code phone, whoever holds the code", { skip }, async () => {
  const f = await makeFamily();
  const grandma = await makePerson(f.id, "Grandma");
  const left = await makePerson(f.id, "Left");
  await q(`update people set removed_at = now() where id = $1`, [left]);
  const invited = await makeDevice(f.id, null, "invite");
  const swapped = (await api.post("/devices", { device_label: "iPhone" }, code(f.code))).data.device_key as string;
  assert.equal((await api.get("/family", device(invited.key))).data.device_needs_profile, true);
  assert.equal((await api.get("/family", device(swapped))).data.device_needs_profile, true);
  for (const key of [invited.key, swapped]) {
    // Writing once as Grandma doesn't make the phone hers.
    const wrote = await api.post("/join-links", {}, device(key, grandma));
    assert.deepEqual([wrote.status, wrote.data.error], [403, "Add yourself first."]);
    const res = await api.post("/v1/sessions/start", { deviceKey: key, profileId: grandma });
    assert.deepEqual([res.status, res.data.error], [403, "Add yourself first."]);
    assert.equal((await api.post("/v1/sessions/start", { deviceKey: key, profileId: left })).status, 403);
  }
  assert.equal(await count("sessions", "person_id = $1", [grandma]), 0);
  assert.equal((await row("people", "id = $1", [grandma])).deleted_at, null);
  assert.equal(await count("devices", "person_id = $1", [grandma]), 0);
});

test("a plate photo the sweep has taken isn't reported forever: the deletion can finish", { skip }, async () => {
  const f = await makeFamily();
  const cook = await makePerson(f.id, "Cook");
  await makePerson(f.id, "Someone else");
  const plate = FILE("plate");
  await q(`insert into recordings (family_id, cook_id, source, status, cover_key) values ($1, $2, 'phone', 'ended', $3)`, [f.id, cook, plate]);
  const did = await purge(cook);
  assert.ok((await deletionOf(cook)).media_keys.includes(plate));
  await pastWait(did);
  const s3 = s3Fakes();
  try {
    assert.equal(await purgeOutside(did), "retry", "still there: the ledger has it, so it's the sweep's");
    assert.ok(!s3.media.removed.includes(plate));
  } finally {
    s3.done();
  }
  const store = fakeStore();
  useObjectStore(store);
  try {
    await sweep({ log: silent });
  } finally {
    useObjectStore(undefined);
  }
  assert.ok(store.removed.includes(plate));
  assert.equal(await purgeOutside(did), "done");
});

test("with the recipe copy read-only, a purge doesn't finish while the sync still holds her recipes", { skip }, async () => {
  const f = await makeFamily();
  const cook = await makePerson(f.id, "Cook");
  await makePerson(f.id, "Someone else");
  const recipe = await id(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'SECRET-held by the sync', 'ready') returning id`, [f.id, cook]);
  const copy = await one(`select read_only, moved_at from sync_copies where table_name = 'recipes'`);
  await q(`insert into sync_copies (table_name, read_only) values ('recipes', true) on conflict (table_name) do update set read_only = true, moved_at = null`);
  try {
    const did = await startDeletion(cook, "sync");
    assert.equal(await count("recipes", "id = $1", [recipe]), 1, "the sync owns them");
    assert.equal(await runPurge(did!, {}), "held", "not an error: the sync takes them within minutes");
    assert.equal((await deletionOf(cook)).purged_at, null);
    await tx(async (c) => {
      await c.query(`select set_config('homecookd.sync_writer', 'on', true)`);
      await c.query(`delete from recipes where id = $1`, [recipe]);
    });
    assert.equal(await runPurge(did!, {}), "done");
  } finally {
    if (copy) await q(`update sync_copies set read_only = $1, moved_at = $2 where table_name = 'recipes'`, [copy.read_only, copy.moved_at]);
    else await q(`delete from sync_copies where table_name = 'recipes'`);
  }
});

test("a phone from another family can't start a session as someone here", { skip }, async () => {
  const f = await makeFamily();
  const grandma = await makePerson(f.id, "Grandma");
  const g = await makeFamily();
  const theirs = await makeDevice(g.id, await makePerson(g.id, "Elsewhere"));
  assert.equal((await api.post("/v1/sessions/start", { deviceKey: theirs.key, profileId: grandma })).status, 403);
  assert.equal(await count("sessions", "person_id = $1", [grandma]), 0);
});

test("signing a sign-up off by email leaves another person's row alone, and takes an old row with no person", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Deleting");
  const other = await makePerson(f.id, "Other");
  const email = `${uniq("same")}@example.com`;
  await q(`update people set email = $2 where id = $1`, [p, email]);
  const theirs = await id(`insert into signups (name, email, family_id, person_id) values ('KEEP-other', $1, $2, $3) returning id`, [email, f.id, other]);
  const old = await id(`insert into signups (name, email, family_id) values ('SECRET-old', $1, $2) returning id`, [email, f.id]);
  await purge(p);
  assert.equal((await row("signups", "id = $1", [theirs])).name, "KEEP-other");
  assert.equal(await count("signups", "id = $1", [old]), 0);
});

// ---- dish cards: both people, in either order

const makeCard = async (familyId: string, kid: string | null, mom: string | null, fields: { kidToken?: string; photos?: string[]; voice?: string } = {}) =>
  id(
    `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, kid_name, guess, message, status, family_id, person_id, requested_of, photo_keys, kid_voice_note_key)
     values ($1, $2, 'dal', 'mom', 'SECRET-kid', '{"dish": "SECRET-guess"}', 'SECRET-message', 'asked', $3, $4, $5, $6::text[]::s3_key[], $7) returning id`,
    [sha(fields.kidToken ?? uniq("k")), sha(uniq("a")), familyId, kid, mom, fields.photos ?? [], fields.voice ?? null],
  );

test("a kid's card files name the deletion, so the outside purge can't say done while one's in S3, and a key with no row gets one", { skip }, async () => {
  const f = await makeFamily();
  const kid = await makePerson(f.id, "Kid");
  const mom = await makePerson(f.id, "Mom");
  const [known, unknown, voice] = [FILE("card-photo"), FILE("card-photo-no-row"), FILE("card-voice")];
  const card = await makeCard(f.id, kid, mom, { photos: [known, unknown], voice });
  // An anonymous upload, later claimed: nobody owns the row, so nothing but the mark ties it to her.
  await q(`insert into files (key, bucket, kind, ask_id, capability_hash, uploaded_at, attached_at, family_id) values ($1, 'private', 'photo', $2, $3, now(), now(), $4)`, [known, card, sha(uniq("cap")), f.id]);
  const did = await purge(kid);
  assert.equal((await one(`select cardinality(photo_keys) as n from dish_asks where id = $1`, [card])).n, 0);
  for (const key of [known, unknown, voice]) {
    const file = await row("files", "key = $1", [key]);
    assert.ok(file?.delete_requested_at, key);
    assert.equal(file.purge_deletion_id, did, key);
  }
  assert.equal(await purgeOutside(did), "retry");
  const d = await deletionOf(kid);
  assert.equal(d.external_purged_at, null);
  assert.match(d.external_error, /Not reached yet: 3 files marked and not deleted/);
  // A key with no row gets one the sweep can act on, or the deletion would stay open for good.
  const store = fakeStore();
  useObjectStore(store);
  try {
    await sweep({ log: silent });
    for (const key of [known, unknown, voice]) {
      assert.ok((await row("files", "key = $1", [key])).deleted_at, key);
      assert.ok(store.removed.includes(key), key);
    }
  } finally {
    useObjectStore(undefined);
  }
  assert.equal(await purgeOutside(did), "done");
});

for (const order of ["kid", "mom"] as const) {
  test(`a card goes once both have deleted, with the ${order === "kid" ? "kid" : "Mom"} going first`, { skip }, async () => {
    const f = await makeFamily();
    const kid = await makePerson(f.id, "Kid");
    const mom = await makePerson(f.id, "Mom");
    const card = await makeCard(f.id, kid, mom);
    await purge(order === "kid" ? kid : mom);
    assert.equal(await count("dish_asks", "id = $1", [card]), 1, "it stays for whoever's left");
    await purge(order === "kid" ? mom : kid);
    assert.equal(await count("dish_asks", "id = $1", [card]), 0);
  });
}

test("once the kid has deleted, their link stops: it opens nothing and claims nothing, and Mom's still works", { skip }, async () => {
  const f = await makeFamily();
  const kid = await makePerson(f.id, "Kid");
  const mom = await makePerson(f.id, "Mom");
  const kidToken = randomBytes(16).toString("hex").slice(0, 22);
  const card = await makeCard(f.id, kid, mom, { kidToken });
  const askHash = (await row("dish_asks", "id = $1", [card])).ask_token_hash;
  await purge(kid);
  assert.equal(await cardOfToken(db(), sha(kidToken)), null);
  const stranger = await makePerson(f.id, "Stranger");
  const res = await api.post("/v1/links/claim", { token: kidToken }, bearer(await session(f.id, stranger)));
  assert.equal(res.status, 404);
  assert.equal((await row("dish_asks", "id = $1", [card])).person_id, null);
  assert.equal((await cardOfToken(db(), askHash))?.card.id, card);
});

test("a card can't be claimed for someone whose deletion got there first", { skip }, async () => {
  const f = await makeFamily();
  const late = await makePerson(f.id, "Late");
  const kidToken = randomBytes(16).toString("hex").slice(0, 22);
  const card = await makeCard(f.id, null, null, { kidToken });
  await purge(late);
  await assert.rejects(claimCard({ personId: late, familyId: f.id } as Parameters<typeof claimCard>[0], { token: kidToken }), (error: { statusCode?: number; status?: number }) => (error.statusCode ?? error.status) === 403);
  assert.equal((await row("dish_asks", "id = $1", [card])).person_id, null);
});

// ---- the last person leaving

test("the last person leaving blanks the family: its name, its code and its join link stop", { skip }, async () => {
  const f = await makeFamily("SECRET-L family");
  const last = await makePerson(f.id, "Last");
  const link = await makeJoinLink(f.id, last);
  assert.equal((await api.post(`/profiles/${last}/remove`, {}, code(f.code, last))).status, 200);
  const family = await row("families", "id = $1", [f.id]);
  assert.deepEqual([family.name, family.code_hash, family.public_name], ["Deleted", null, null]);
  assert.ok(family.blanked_at);
  assert.equal((await api.get("/family", code(f.code))).status, 401, "the code opens nothing");
  assert.ok((await row("join_links", "id = $1", [link.id])).revoked_at, "no join link outlives it");
  assert.equal((await api.post(`/profiles/${last}/remove`, {}, code(f.code, last))).status, 401, "and a repeat reads as signed out");
});

const signedInFamily = async (name: string) => {
  const f = await makeFamily(name);
  const mom = await makePerson(f.id, "Mom");
  const phone = await makeDevice(f.id, mom);
  const grandma = await makePerson(f.id, "SECRET-Grandma");
  const recipe = await id(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'SECRET-her recipe', 'ready') returning id`, [f.id, grandma]);
  const link = await makeJoinLink(f.id, mom);
  return { f, mom, phone, grandma, recipe, link };
};

const assertEnded = async (x: Awaited<ReturnType<typeof signedInFamily>>) => {
  const family = await row("families", "id = $1", [x.f.id]);
  assert.deepEqual([family.name, family.code_hash], ["Deleted", null]);
  assert.ok((await row("join_links", "id = $1", [x.link.id])).revoked_at);
  const person = await row("people", "id = $1", [x.grandma]);
  assert.deepEqual([person.name, !!person.deleted_at], ["Deleted", true], "her tombstone, the same as anyone's");
  const d = await deletionOf(x.grandma);
  assert.ok(d, "and her own deletion row");
  assert.ok(await row("outbox", "payload->>'task' = 'accounts.purge' and payload->>'deletionId' = $1", [d.id]), "with its purge queued");
  await runPurge(d.id, {});
  assert.equal(await count("recipes", "id = $1", [x.recipe]), 0);
  assert.equal((await deletionOf(x.grandma)).recipe_ids.includes(x.recipe), true);
};

test("the last signed-in person deleting takes the phone-less people left, through the same deletion, and blanks the family", { skip }, async () => {
  const x = await signedInFamily("SECRET-N family");
  await purge(x.mom);
  await assertEnded(x);
});

test("the last signed-in person leaving does the same", { skip }, async () => {
  const x = await signedInFamily("SECRET-O family");
  assert.equal((await api.post(`/profiles/${x.mom}/remove`, {}, device(x.phone.key, x.mom))).status, 200);
  assert.ok((await row("people", "id = $1", [x.mom])).removed_at, "leaving isn't deleting");
  assert.equal((await row("people", "id = $1", [x.mom])).deleted_at, null);
  await assertEnded(x);
});

test("while someone signed in is still here, a family stays, and so do its phone-less people", { skip }, async () => {
  const x = await signedInFamily("KEEP-P family");
  const dad = await makePerson(x.f.id, "Dad");
  await makeDevice(x.f.id, dad);
  await purge(x.mom);
  assert.equal((await row("families", "id = $1", [x.f.id])).name, "KEEP-P family");
  assert.equal((await row("people", "id = $1", [x.grandma])).deleted_at, null);
});

test("someone who never signed in going ends nothing: Grandma from Mom's phone, or a family that only ever used its code", { skip }, async () => {
  const x = await signedInFamily("KEEP-Q family");
  await purge(x.grandma);
  assert.equal((await row("families", "id = $1", [x.f.id])).name, "KEEP-Q family");
  assert.equal((await row("people", "id = $1", [x.mom])).deleted_at, null);

  const f = await makeFamily("KEEP-R family");
  const leaver = await makePerson(f.id, "Leaver");
  const face = await makePerson(f.id, "Face");
  assert.equal((await api.post(`/profiles/${leaver}/remove`, {}, code(f.code, leaver))).status, 200);
  assert.equal((await row("families", "id = $1", [f.id])).name, "KEEP-R family");
  assert.equal((await row("people", "id = $1", [face])).deleted_at, null);
  assert.equal((await api.get("/family", code(f.code))).status, 200);
});

test("the sync passes on one person's deletion and no more", { skip }, async () => {
  const x = await signedInFamily("KEEP-S family");
  await startDeletion(x.mom, "sync");
  assert.equal((await row("people", "id = $1", [x.grandma])).deleted_at, null);
  assert.equal((await row("families", "id = $1", [x.f.id])).name, "KEEP-S family");
});

test("a database failure refuses: nothing changed, and the phone can try again", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Unlucky");
  const s = await session(f.id, p);
  const realConnect = db().connect.bind(db());
  // The session check still reads (pool.query connects with a callback); the delete's own transaction can't start.
  (db() as unknown as { connect: unknown }).connect = (callback?: never) =>
    callback ? realConnect(callback) : Promise.reject(Object.assign(new Error("down"), { code: "57P01" }));
  try {
    assert.equal((await api.post("/v1/account/delete", {}, bearer(s))).status, 500);
  } finally {
    (db() as unknown as { connect: unknown }).connect = realConnect;
  }
  assert.equal((await row("people", "id = $1", [p])).deleted_at, null);
  assert.equal((await api.post("/v1/account/delete", {}, bearer(s))).status, 200);
});

// ---- the whole way, through the queue

test("from the route through the queue: the purge runs, then the outside purge, each from its message", { skip }, async () => {
  const k = await kitchen();
  const res = await api.post("/v1/account/delete", {}, bearer(k.sessionOnPhone));
  assert.equal(res.status, 200);
  const d = await deletionOf(k.R);
  assert.equal(d.purged_at, null, "the rest happens after the answer");
  const drain = async () => {
    const { rows } = await q(`update outbox set sent_at = now() where sent_at is null returning payload`);
    for (const r of rows) {
      if (String(r.payload.task).startsWith("accounts.")) await handleMessage(JSON.stringify({ payload: r.payload }), silent);
    }
    return rows.length;
  };
  while ((await drain()) > 0);
  await assertPurged(k);
  const waiting = await deletionOf(k.R);
  assert.equal(waiting.voice_clone_id, null, "her voice clone was deleted");
  assert.deepEqual([waiting.external_attempts, waiting.external_purged_at], [0, null], "S3 waits out the links");

  await pastWait(waiting.id);
  const s3 = s3Fakes();
  try {
    await q(`insert into outbox (queue, payload) values ('scheduled', $1)`, [{ task: "accounts.outside", deletionId: waiting.id }]); // as accounts.sweep sends it
    while ((await drain()) > 0);
  } finally {
    s3.done();
  }
  const after2 = await deletionOf(k.R);
  assert.equal(after2.external_attempts, 1, "the sweep's files are still marked");
  assert.ok(after2.external_tried_at);
  assert.equal(after2.external_purged_at, null);
});

// ---- outside the database

function voiceStub(reply: () => void | Promise<void> = () => {}) {
  const seen: string[] = [];
  useVoiceClones({
    remove: async (voiceId) => {
      seen.push(voiceId);
      await reply();
    },
  });
  return seen;
}

/** Stands in for the wait before S3 (outside.ts S3_GRACE_MS), and for the sweep's own (jobs/tasks.ts GRACE_S). */
async function pastWait(deletionId: string) {
  await q(`update account_deletions set purged_at = purged_at - make_interval(secs => $2) where id = $1`, [deletionId, S3_GRACE_MS / 1000 + 1]);
  await q(`update files set delete_requested_at = delete_requested_at - make_interval(secs => $1) where delete_requested_at is not null`, [S3_GRACE_MS / 1000 + 1]);
}

function s3Fakes() {
  const stores = { uploads: fakeStore(), media: fakeStore(), private: fakeStore() };
  useUploadStore(stores.uploads);
  useMediaStore(stores.media);
  useObjectStore(stores.private);
  return {
    ...stores,
    done: () => {
      useUploadStore(undefined);
      useMediaStore(undefined);
      useObjectStore(undefined);
    },
  };
}

const put = (store: FakeStore, ...keys: string[]) => {
  for (const key of keys) store.objects.set(key, { bytes: new Uint8Array(1), contentType: "application/octet-stream" });
};

test("the outside purge waits as long as the sweep, then empties her upload and recipe folders, and is done once the sweep has the rest", { skip }, async () => {
  const k = await kitchen();
  const seen = voiceStub();
  const did = await startDeletion(k.R, "person");
  assert.equal(await purgeOutside(did!), "not_ready", "a late recipe could still add to the lists");
  await runPurge(did!, {});
  assert.equal(await purgeOutside(did!), "not_ready", "a link in a phone's hands could still put a file back");
  assert.deepEqual(seen, ["voice_r"], "her voice clone doesn't wait");

  const s3 = s3Fakes();
  try {
    const hers = {
      uploads: [`${k.uploadA}01.mov`, `${k.uploadA}02.mov`, `${k.uploadB}01.mov`],
      media: [`${k.prefix}recipe.json`, `${k.prefix}poster.jpg`, `${k.prefix}steps/1.jpg`, `${workerFolder(k.jobRunning)}${k.jobRunning.slice(0, 4)}-a1/part.mp4`],
    };
    // Someone else's folders that start the same way, and the public library.
    const theirs = { uploads: [`${k.uploadA.slice(0, -1)}-other/01.mov`], media: [`${k.prefix.slice(0, -1)}2/recipe.json`, "library/demo/recipe.json", "library.json"] };
    put(s3.uploads, ...hers.uploads, ...theirs.uploads);
    put(s3.media, ...hers.media, ...theirs.media, k.video);
    await pastWait(did!);

    assert.equal(await purgeOutside(did!), "retry", "the ledger's files are the sweep's, and it hasn't run");
    assert.deepEqual(seen, ["voice_r"], "deleted once");
    assert.deepEqual([...s3.uploads.objects.keys()].sort(), theirs.uploads);
    assert.deepEqual([...s3.media.objects.keys()].sort(), [...theirs.media, k.video].sort(), "the video has a row in the ledger, so the sweep takes it");
    const d = await deletionOf(k.R);
    assert.match(d.external_error, /^Not reached yet: \d+ files marked and not deleted$/, "nothing else is left");

    await sweepUploads(trace);
    await sweep({ log: silent });
    assert.ok(s3.media.removed.includes(k.video), "the sweep reaches the media bucket");
    for (const key of [k.rVoice, k.frame, k.plate]) assert.ok(s3.private.removed.includes(key), key);
    assert.equal(await purgeOutside(did!), "done");
    const done = await deletionOf(k.R);
    assert.equal(done.external_error, null);
    assert.equal(done.external_counts.voiceClones, 1);
    assert.deepEqual(done.external_counts, { voiceClones: 1, uploadObjects: hers.uploads.length, mediaObjects: hers.media.length }, "added up over both attempts, each file once");
    assert.deepEqual([...s3.media.objects.keys()].sort(), theirs.media.sort(), "the library and the other folder stay");
  } finally {
    s3.done();
  }
});

const trace = { requestId: "req-test", log: { info: () => {}, warn: () => {}, error: () => {} } };

/** A deletion with nothing else on it, past the wait, holding these lists. */
async function listed(lists: { upload_keys?: string[]; media_prefixes?: string[]; media_keys?: string[] }) {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Listed");
  await makePerson(f.id, "Someone else");
  voiceStub();
  const did = await purge(p);
  await q(
    `update account_deletions set upload_keys = $2::text[]::s3_key[], media_prefixes = $3::text[]::s3_key[], media_keys = $4::text[]::s3_key[] where id = $1`,
    [did, lists.upload_keys ?? [], lists.media_prefixes ?? [], lists.media_keys ?? []],
  );
  await pastWait(did);
  return { did, f };
}

test("a folder something else still names, one with an unexpected name, and one too big are left, each with its reason", { skip }, async () => {
  const other = await makeFamily();
  const cook = await makePerson(other.id, "Other cook");
  const shared = `${uniq("shared")}/`;
  const cover = `${uniq("covers")}/`;
  const busy = `${uniq("busy-upload")}/`;
  const big = `${uniq("big")}/`;
  await q(`insert into recipes (family_id, cook_id, title, status, media_prefix) values ($1, $2, 'KEEP-theirs', 'ready', $3)`, [other.id, cook, shared]);
  await q(`insert into recipes (family_id, cook_id, title, status, cover_key) values ($1, $2, 'KEEP-seeded', 'ready', $3)`, [other.id, cook, `${cover}poster.jpg`]);
  await q(`insert into jobs (family_id, cook_id, upload_key, source, stage) values ($1, $2, $3, 'phone', 'done')`, [other.id, cook, busy]);
  const { did } = await listed({
    upload_keys: [busy, "deep/folder/"],
    media_prefixes: [shared, cover, "library/", "glasses/", "recipes/odd/", big],
    media_keys: ["library/demo/poster.jpg"],
  });
  const s3 = s3Fakes();
  try {
    put(s3.uploads, `${busy}01.mov`, "deep/folder/01.mov");
    put(s3.media, `${shared}recipe.json`, `${cover}poster.jpg`, "library/demo/poster.jpg", "glasses/x.mp4", "recipes/odd/recipe.json");
    for (let i = 0; i <= FOLDER_MAX; i += 1) put(s3.media, `${big}${i}.jpg`);
    assert.equal(await purgeOutside(did), "retry");
    assert.deepEqual([s3.uploads.removed, s3.media.removed], [[], []], "nothing was deleted");
    const { external_error } = await deletionOf((await one(`select person_id from account_deletions where id = $1`, [did])).person_id);
    assert.match(external_error, /Not reached yet: 1 upload folders still in use/);
    assert.match(external_error, /Not reached yet: 1 upload folders with an unexpected name/);
    assert.match(external_error, /Not reached yet: 2 media folders still in use/);
    assert.match(external_error, /Not reached yet: 3 media folders with an unexpected name/);
    assert.match(external_error, /Not reached yet: 1 media files with an unexpected name/);
    assert.match(external_error, new RegExp(`Not reached yet: 1 media folders holding more than ${FOLDER_MAX} files`));
  } finally {
    s3.done();
  }
});

test("S3 failing is a retry that names only the bucket; running out of time carries on in a new message without using an attempt", { skip }, async () => {
  const folder = `${uniq("recipe")}/`;
  const { did } = await listed({ upload_keys: [`${uniq("up")}/`], media_prefixes: [folder] });
  const s3 = s3Fakes();
  try {
    put(s3.media, `${folder}recipe.json`);
    s3.media.failLists = true;
    assert.equal(await purgeOutside(did), "retry");
    const row1 = await one(`select external_attempts, external_error from account_deletions where id = $1`, [did]);
    assert.deepEqual([row1.external_attempts, row1.external_error], [1, "S3 media: Error"]);

    s3.media.failLists = false;
    const queued = await count("outbox", "payload->>'task' = 'accounts.outside' and payload->>'deletionId' = $1", [did]);
    assert.equal(await purgeOutside(did, -1), "more");
    assert.equal(await count("outbox", "payload->>'task' = 'accounts.outside' and payload->>'deletionId' = $1", [did]), queued + 1);
    assert.equal((await one(`select external_attempts from account_deletions where id = $1`, [did])).external_attempts, 1, "not an attempt");
    assert.ok(s3.media.objects.has(`${folder}recipe.json`), "it stopped before the next folder");

    assert.equal(await purgeOutside(did), "done");
    assert.ok(!s3.media.objects.has(`${folder}recipe.json`));
    assert.equal(await purgeOutside(did), "done", "a second report changes nothing");
  } finally {
    s3.done();
  }
});

test("a folder is a folder because of the list it's on: one written down without its slash is refused, not taken for a missing file", { skip }, async () => {
  const folder = uniq("no-slash");
  const { did } = await listed({ media_prefixes: [folder] });
  const s3 = s3Fakes();
  try {
    put(s3.media, `${folder}/recipe.json`);
    assert.equal(await purgeOutside(did), "retry", "never done with the folder still there");
    assert.ok(s3.media.objects.has(`${folder}/recipe.json`));
    assert.match((await one(`select external_error from account_deletions where id = $1`, [did])).external_error, /Not reached yet: 1 media folders with an unexpected name/);
  } finally {
    s3.done();
  }
});

test(`a folder of exactly ${FOLDER_MAX} files is deleted, and one more waits for a person`, { skip }, async () => {
  const [at, over] = [`${uniq("at-max")}/`, `${uniq("over-max")}/`];
  const { did } = await listed({ media_prefixes: [at, over] });
  const s3 = s3Fakes();
  try {
    for (let i = 0; i < FOLDER_MAX; i += 1) put(s3.media, `${at}${i}.jpg`, `${over}${i}.jpg`);
    put(s3.media, `${over}last.jpg`);
    assert.equal(await purgeOutside(did), "retry");
    assert.equal([...s3.media.objects.keys()].filter((k) => k.startsWith(at)).length, 0);
    assert.equal([...s3.media.objects.keys()].filter((k) => k.startsWith(over)).length, FOLDER_MAX + 1);
    const row = await one(`select external_error, external_counts from account_deletions where id = $1`, [did]);
    assert.equal(row.external_error, `Not reached yet: 1 media folders holding more than ${FOLDER_MAX} files`);
    assert.equal(row.external_counts.mediaObjects, FOLDER_MAX);
  } finally {
    s3.done();
  }
});

test("a folder holding someone else's file that nothing has marked is left", { skip }, async () => {
  const folder = `${uniq("theirs-inside")}/`;
  const other = await makeFamily();
  const owner = await makePerson(other.id, "Owner");
  await q(`insert into files (key, bucket, kind, family_id, owner_person_id, uploaded_at) values ($1, 'media', 'video', $2, $3, now())`, [`${folder}video.mp4`, other.id, owner]);
  const { did } = await listed({ media_prefixes: [folder] });
  const s3 = s3Fakes();
  try {
    put(s3.media, `${folder}video.mp4`, `${folder}recipe.json`);
    assert.equal(await purgeOutside(did), "retry");
    assert.equal(s3.media.objects.size, 2, "nothing in it was deleted");
    assert.match((await one(`select external_error from account_deletions where id = $1`, [did])).external_error, /Not reached yet: 1 media folders still in use/);
  } finally {
    s3.done();
  }
});

test("one run at a time: a deletion another run holds is left to it, and a crashed run's claim lapses", { skip }, async () => {
  const folder = `${uniq("claimed")}/`;
  const { did } = await listed({ media_prefixes: [folder] });
  const s3 = s3Fakes();
  try {
    put(s3.media, `${folder}recipe.json`);
    await q(`update account_deletions set external_claimed_until = now() + interval '1 hour' where id = $1`, [did]);
    assert.equal(await purgeOutside(did), "busy");
    assert.ok(s3.media.objects.has(`${folder}recipe.json`), "untouched");
    assert.equal((await one(`select external_attempts from account_deletions where id = $1`, [did])).external_attempts, 0);

    await q(`update account_deletions set external_claimed_until = now() - interval '1 second' where id = $1`, [did]);
    assert.equal(await purgeOutside(did), "done");
    const row = await one(`select external_claimed_until, external_counts from account_deletions where id = $1`, [did]);
    assert.deepEqual([row.external_claimed_until, row.external_counts], [null, { mediaObjects: 1 }], "let go, and counted once");
  } finally {
    s3.done();
  }
});

test("with nothing outside left, it's done, with its counts; a second report changes nothing", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Clean");
  await q(`update people set cartesia_voice_id = 'voice_c' where id = $1`, [p]);
  voiceStub();
  const did = await purge(p);
  assert.equal(await purgeOutside(did), "done");
  const d = await deletionOf(p);
  assert.ok(d.external_purged_at);
  assert.deepEqual(d.external_counts, { voiceClones: 1 });
  assert.equal(d.external_error, null);
  assert.equal(await purgeOutside(did), "done");
  assert.equal((await deletionOf(p)).external_purged_at.getTime(), d.external_purged_at.getTime());
});

test("a Cartesia failure is tried again later, each wait longer, and given up loudly after the last attempt; a person can start it again", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Failing");
  await q(`update people set cartesia_voice_id = 'voice_f' where id = $1`, [p]);
  voiceStub(() => {
    throw new Error("HTTP 503");
  });
  const did = await purge(p);
  assert.equal(await purgeOutside(did), "retry");
  const d = await deletionOf(p);
  assert.deepEqual([d.external_attempts, d.external_error, d.voice_clone_id], [1, "Cartesia: HTTP 503", "voice_f"], "kept until Cartesia confirms it's gone");
  assert.ok(!(await dueOutside()).includes(did), "not again right away");
  await q(`update account_deletions set external_tried_at = now() - make_interval(secs => $2) where id = $1`, [did, outsideWait(1) / 1000 + 1]);
  assert.ok((await dueOutside()).includes(did));
  await q(`update account_deletions set external_attempts = 2, external_tried_at = now() - make_interval(secs => $2) where id = $1`, [did, outsideWait(1) / 1000 + 1]);
  assert.ok(!(await dueOutside()).includes(did), "the second wait is twice as long");

  await q(`update account_deletions set external_attempts = $2 where id = $1`, [did, MAX_OUTSIDE_ATTEMPTS - 1]);
  assert.equal(await purgeOutside(did), "gave_up");
  await q(`update account_deletions set external_tried_at = now() - interval '30 days' where id = $1`, [did]);
  assert.ok(!(await dueOutside()).includes(did), "stopped, and someone was told");
  voiceStub();
  assert.equal(await retryOutside(did), "queued");
  assert.ok((await dueOutside()).includes(did));
  assert.equal(await purgeOutside(did), "done");
  assert.equal(await retryOutside(did), "done", "never reopens one that's finished");
  assert.equal(await retryOutside("nope"), "missing");
});

test("the schedule queues what's due, and clears expired sessions and old lists", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Scheduled");
  voiceStub();
  const did = await purge(p);
  await q(`delete from outbox where sent_at is null`);
  await accountsSweep({});
  assert.ok(await row("outbox", "payload->>'task' = 'accounts.outside' and payload->>'deletionId' = $1", [did]));
  assert.equal(await handleMessage(JSON.stringify({ payload: { task: "accounts.sweep" } }), silent), undefined);
});

test("C5: the deletion row stays as proof; its lists clear 60 days after the outside purge, not before", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "Provable");
  voiceStub();
  await q(`insert into jobs (family_id, cook_id, upload_key, source, stage) values ($1, $2, $3, 'phone', 'done')`, [f.id, p, `${uniq("c5")}/`]);
  const did = await purge(p);
  const d = await deletionOf(p);
  assert.equal(d.upload_keys.length, 1);
  await q(`update account_deletions set external_purged_at = now() - interval '59 days' where id = $1`, [did]);
  await clearOldLists();
  assert.equal((await deletionOf(p)).upload_keys.length, 1, "at 59 days it stays");
  await q(`update account_deletions set external_purged_at = now() - interval '61 days' where id = $1`, [did]);
  await clearOldLists();
  const cleared = await deletionOf(p);
  assert.deepEqual([cleared.recipe_ids, cleared.job_ids, cleared.upload_keys, cleared.media_keys, cleared.media_prefixes, cleared.media_urls_legacy], [[], [], [], [], [], []]);
  assert.ok(cleared.lists_cleared_at);
  assert.ok(cleared.purged_at, "and the proof stays");
});

// ---- the switch

test("with the switch off, the route refuses and nothing changes; the sync's own call still reaches the copy", { skip }, async () => {
  const k = await kitchen();
  delete process.env.ACCOUNTS_OWNS_PEOPLE;
  try {
    const res = await api.post("/v1/account/delete", {}, bearer(k.sessionOnPhone));
    assert.deepEqual([res.status, res.data.error], [503, "accounts_not_moved"]);
    assert.equal((await row("people", "id = $1", [k.R])).deleted_at, null);
    // Every other write to families and people refuses too.
    assert.equal((await api.post("/profiles", { name: "New", role: "cook" }, code(k.pawars.code))).status, 503);
    assert.equal((await api.post(`/profiles/${k.aai}/remove`, {}, code(k.pawars.code, k.aai))).status, 503);
    assert.equal((await api.apple({ id_token: await appleToken(keys, uniq("sub")), name: "New", role: "cook" })).status, 503);
    assert.equal((await api.apple({ id_token: await appleToken(keys, uniq("sub")), join_token: k.link.token, name: "New", role: "cook" })).status, 503);
    assert.equal(await count("people", "name = 'New'"), 0);
    assert.equal(await count("families", "name like 'New%'"), 0);
    // A sign-in that writes neither still works, and so do reads.
    assert.equal((await api.get("/family", code(k.pawars.code))).status, 200);
    // The one exception: the sync passes on a deletion.
    const did = await startDeletion(k.R, "sync");
    assert.ok(did);
    await runPurge(did!, {});
    await assertPurged(k);
  } finally {
    process.env.ACCOUNTS_OWNS_PEOPLE = "1";
  }
});

test("only the switch's own functions and the deletion write families or people", () => {
  const dir = new URL("../src/modules/", import.meta.url).pathname;
  // sync/data.ts is the one-way copy, which stops when the switch goes on (SYNC-MIGRATION.md).
  const allowed = new Set(["accounts/data.ts", "accounts/deletion.ts", "accounts/purgeSteps.ts", "accounts/neighbors.ts", "sync/data.ts"]);
  const writers: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (!entry.endsWith(".ts")) continue;
    if (/(insert into|update|delete from)\s+(families|people)\b/.test(readFileSync(join(dir, entry), "utf8"))) writers.push(entry);
  }
  assert.deepEqual(writers.filter((f) => !allowed.has(f)), []);
  // neighbors.ts writes families only to ask for a Moss sync, and checks the switch itself. data.ts's writes each check it.
  const dataFile = readFileSync(join(dir, "accounts/data.ts"), "utf8");
  for (const fn of ["insertFamily", "insertPerson", "markPersonRemoved", "moveFace", "setRelationIfUnset"]) {
    assert.match(dataFile, new RegExp(`function ${fn}[^]*?assertOwnsPeople\\(\\)`), fn);
  }
});

test("a tombstone the sync copied over, with no deletion row yet, still gets its purge", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id, "SECRET-R Copied");
  await q(`insert into favorites (person_id, library_id) values ($1, 'poha')`, [p]);
  await q(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [p]);
  const did = await startDeletion(p, "sync");
  await runPurge(did!, {});
  assert.equal(await count("favorites", "person_id = $1", [p]), 0);
  assert.ok((await deletionOf(p)).purged_at);
  assert.equal(await startDeletion("no-such-person", "sync"), null);
});
