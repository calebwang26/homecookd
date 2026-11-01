// All the dish ask's SQL. Every query, and the index behind it (SCHEMA.md section 3, plus 009_dish_sweeps.sql):
//
//   Query                                     Index                                 Limit
//   a card by the kid's or Mom's token        dish_asks.kid_token_hash, ask_token_hash (unique)   one row
//   a card by id                              dish_asks primary key                 one row
//   a card's answers                          dish_answers (ask_id, question_id)    6: one per question
//   an answer by id                           dish_answers primary key              one row
//   Mom's page in her language                dish_ask_translations primary key     one row
//   an upload by its capability               files.capability_hash (unique)        one row
//   a card's uploads (delete)                 files_ask                             50
//   mark files for deletion                   files primary key                     the card's own keys
//   today's spend                             daily_spend primary key               one row
//   orphan sweep                              files_dish_orphans                    200 a pass
//   S3 delete sweep                           files_dish_to_delete                  200 a pass
//   drop deleted rows                         files_deleted_old                     500 a pass
//   claim a clip, save its words              dish_answers primary key              one row
//   C4: old ip_key on cards, files            dish_asks_ip_key_old, files_ip_key_old  500 a pass
//   a person's cards (purge)                  dish_asks_person_recent, dish_asks_requested_recent  100 a pass
//   a person's craving links (purge)          craving_links_person_newest           100 a pass
//   a card's model calls                      model_calls_ask                       written here, read by reports
//   the day's alert already sent?             idempotency_keys primary key          one row
// There are no list routes: a page is one card. Tokens are looked up by their sha256, so a lookup's timing says nothing about the
// token, and no route compares a raw token to anything. A craving link's raw token isn't read here: its routes wait for the sync.
import { db, type Queryable } from "../../db.js";
import type { ModelCall } from "./model.js";
import type { MissQuestion, QuestionId, Relation } from "./recipe/types.js";
import type { CardStatus, StoredRecipe } from "./values.js";

export type CardRow = {
  id: string;
  kid_token_hash: string;
  ask_token_hash: string;
  dish: string;
  relation: Relation;
  kid_name: string | null;
  photo_keys: string[];
  dish_voice_note_key: string | null;
  kid_voice_note_key: string | null;
  kid_voice_s: number | null;
  guess: StoredRecipe;
  version: StoredRecipe | null;
  asked: MissQuestion[];
  message: string;
  mom_page_lang: string | null;
  status: CardStatus;
  merge_tries: number;
  merge_started_at: Date | null;
  merged_at: Date | null;
  asked_at: Date | null;
  asked_via: string | null;
  opened_at: Date | null;
  finished_at: Date | null;
  questions_at: Date | null;
  gen_ms: number;
  created_at: Date;
  ip_key: string | null;
  person_id: string | null;
  requested_of: string | null;
  kid_claimed_at: Date | null;
  cook_claimed_at: Date | null;
  filming_day: number | null;
  voice_recipe_q: QuestionId | null;
};

export type AnswerRow = {
  id: string;
  ask_id: string;
  question_id: QuestionId;
  audio_key: string;
  duration_s: number;
  language: string;
  words: string | null;
  english: string | null;
  english_settled: boolean;
  merged: boolean;
  hearing_at: Date | null;
  created_at: Date;
};

export type FileRow = {
  key: string;
  kind: string;
  content_type: string | null;
  size_bytes: string | null;
  ask_id: string | null;
  uploaded_at: Date | null;
  attached_at: Date | null;
  delete_requested_at: Date | null;
  deleted_at: Date | null;
};

// The driver can't read an array of a domain, so the keys come back as plain text[].
const CARD = `id, kid_token_hash, ask_token_hash, dish, relation, kid_name, photo_keys::text[] as photo_keys, dish_voice_note_key,
  kid_voice_note_key, kid_voice_s, guess, version, asked, message, mom_page_lang, status, merge_tries, merge_started_at, merged_at,
  asked_at, asked_via, opened_at, finished_at, questions_at, gen_ms, created_at, ip_key, person_id, requested_of, kid_claimed_at,
  cook_claimed_at, filming_day, voice_recipe_q`;

const one = async (q: Queryable, where: string, value: string, lock: boolean): Promise<CardRow | null> => {
  const { rows } = await q.query(`select ${CARD} from dish_asks where ${where} = $1${lock ? " for update" : ""}`, [value]);
  return rows[0] ?? null;
};

// `lock`: inside tx(), holds the card's row until commit. This is what Convex's serialized mutations gave us for free: a card is always
// read, decided on and written whole, so two requests can't overwrite each other.
export const cardByKidHash = (q: Queryable, hash: string, lock = false) => one(q, "kid_token_hash", hash, lock);
export const cardByAskHash = (q: Queryable, hash: string, lock = false) => one(q, "ask_token_hash", hash, lock);
export const cardById = (q: Queryable, id: string, lock = false) => one(q, "id", id, lock);

export async function insertCard(
  q: Queryable,
  card: {
    kidTokenHash: string;
    askTokenHash: string;
    dish: string;
    relation: Relation;
    kidName: string | null;
    guess: StoredRecipe;
    message: string;
    genMs: number;
    ipKey: string;
  },
): Promise<string> {
  const { rows } = await q.query(
    `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, kid_name, guess, message, status, gen_ms, ip_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9) returning id`,
    [card.kidTokenHash, card.askTokenHash, card.dish, card.relation, card.kidName, JSON.stringify(card.guess), card.message, card.genMs, card.ipKey],
  );
  return rows[0].id;
}

const JSON_COLUMNS = new Set(["guess", "version", "asked"]);

/** Writes these columns of one card. The names come from CardRow, never from a request. */
export async function patchCard(q: Queryable, id: string, fields: Partial<CardRow>): Promise<void> {
  const names = Object.keys(fields) as (keyof CardRow)[];
  if (names.length === 0) return;
  const sets = names.map((name, i) => `${name} = $${i + 2}${name === "photo_keys" ? "::text[]::s3_key[]" : ""}`);
  const values = names.map((name) => {
    const value = fields[name];
    return JSON_COLUMNS.has(name) && value !== null ? JSON.stringify(value) : value;
  });
  await q.query(`update dish_asks set ${sets.join(", ")} where id = $1`, [id, ...values]);
}

/** Her page was opened: the first time sets opened_at, and two polls at once can't disagree. */
export async function markOpened(q: Queryable, id: string, now: Date, lang: string | null): Promise<Pick<CardRow, "opened_at" | "mom_page_lang">> {
  const { rows } = await q.query(
    `update dish_asks set opened_at = coalesce(opened_at, $2), mom_page_lang = coalesce($3, mom_page_lang) where id = $1
     returning opened_at, mom_page_lang`,
    [id, now, lang],
  );
  return rows[0];
}

/** Her answers, one per question at most (q1–q6), in question order. */
export async function answersOf(q: Queryable, askId: string): Promise<AnswerRow[]> {
  const { rows } = await q.query(`select * from dish_answers where ask_id = $1 order by question_id limit 6`, [askId]);
  return rows;
}

export async function answerById(q: Queryable, id: string): Promise<AnswerRow | null> {
  const { rows } = await q.query(`select * from dish_answers where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function insertAnswer(
  q: Queryable,
  a: { askId: string; questionId: QuestionId; audioKey: string; durationS: number; language: string; now: Date },
): Promise<string> {
  const { rows } = await q.query(
    `insert into dish_answers (ask_id, question_id, audio_key, duration_s, language, created_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [a.askId, a.questionId, a.audioKey, a.durationS, a.language, a.now],
  );
  return rows[0].id;
}

/** A re-record: the new clip, with nothing heard yet. */
export async function replaceAnswer(q: Queryable, id: string, a: { audioKey: string; durationS: number; language: string; now: Date }): Promise<void> {
  await q.query(
    `update dish_answers set audio_key = $2, duration_s = $3, language = $4, created_at = $5,
       merged = false, words = null, english = null, english_settled = false, hearing_at = null
     where id = $1`,
    [id, a.audioKey, a.durationS, a.language, a.now],
  );
}

/**
 * One holder hears a clip at a time, so she's paid for once and has one set of words. Null when there's nothing to take: someone is on it, it's
 * done, or it's no longer the answer's clip. A holder that died stops counting after `staleMs`.
 */
export async function claimHearing(q: Queryable, id: string, audioKey: string, now: Date, staleMs: number): Promise<AnswerRow | null> {
  const { rows } = await q.query(
    `update dish_answers set hearing_at = $3
      where id = $1 and audio_key = $2 and (words is null or not english_settled)
        and (hearing_at is null or hearing_at <= $3::timestamptz - make_interval(secs => $4))
      returning *`,
    [id, audioKey, now, staleMs / 1000],
  );
  return rows[0] ?? null;
}

export async function releaseHearing(q: Queryable, id: string, audioKey: string, claimedAt: Date): Promise<void> {
  await q.query(`update dish_answers set hearing_at = null where id = $1 and audio_key = $2 and hearing_at = $3`, [id, audioKey, claimedAt]);
}

/**
 * Her words, once: the first to land stays, so a slow holder can't overwrite what a merge already quoted. Null when that wasn't this call.
 * `english` undefined leaves the English unsettled.
 */
export async function saveWords(q: Queryable, id: string, audioKey: string, words: string, english: string | null | undefined): Promise<AnswerRow | null> {
  const settle = english !== undefined;
  const { rows } = await q.query(
    `update dish_answers set words = $3, english = case when $4 then $5 else english end, english_settled = english_settled or $4
      where id = $1 and audio_key = $2 and words is null
      returning *`,
    [id, audioKey, words, settle, english ?? null],
  );
  return rows[0] ?? null;
}

/** Their English, once. */
export async function saveEnglish(q: Queryable, id: string, audioKey: string, english: string | null): Promise<AnswerRow | null> {
  const { rows } = await q.query(
    `update dish_answers set english = $3, english_settled = true
      where id = $1 and audio_key = $2 and not english_settled
      returning *`,
    [id, audioKey, english],
  );
  return rows[0] ?? null;
}

export async function markAnswersMerged(q: Queryable, askId: string, audioKeys: string[]): Promise<void> {
  await q.query(`update dish_answers set merged = true where ask_id = $1 and not merged and audio_key = any($2::text[])`, [askId, audioKeys]);
}

export async function deleteAnswers(q: Queryable, askId: string): Promise<void> {
  await q.query(`delete from dish_answers where ask_id = $1`, [askId]);
}

export async function deleteCardRow(q: Queryable, id: string): Promise<void> {
  await q.query(`delete from dish_asks where id = $1`, [id]);
}

// ---------------------------------------------------------------------------------------------
// Mom's page in her language

export type TranslationRow = {
  source_hash: string;
  guess: StoredRecipe;
  questions: MissQuestion[];
  message: string;
  version: StoredRecipe | null;
};

export async function translationOf(q: Queryable, askId: string, lang: string): Promise<TranslationRow | null> {
  const { rows } = await q.query(
    `select source_hash, guess, questions, message, version from dish_ask_translations where ask_id = $1 and lang = $2`,
    [askId, lang],
  );
  return rows[0] ?? null;
}

export async function saveTranslation(
  q: Queryable,
  t: { askId: string; lang: string; sourceHash: string; guess: StoredRecipe; questions: MissQuestion[]; message: string; version: StoredRecipe | null },
): Promise<void> {
  await q.query(
    `insert into dish_ask_translations (ask_id, lang, source_hash, guess, questions, message, version)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (ask_id, lang) do update set source_hash = excluded.source_hash, guess = excluded.guess, questions = excluded.questions,
       message = excluded.message, version = excluded.version, created_at = now()`,
    [t.askId, t.lang, t.sourceHash, JSON.stringify(t.guess), JSON.stringify(t.questions), t.message, t.version ? JSON.stringify(t.version) : null],
  );
}

export async function deleteTranslations(q: Queryable, askId: string): Promise<void> {
  await q.query(`delete from dish_ask_translations where ask_id = $1`, [askId]);
}

// ---------------------------------------------------------------------------------------------
// Uploads

export async function insertFile(
  q: Queryable,
  f: { key: string; kind: "photo" | "voice"; contentType: string; size: number; capabilityHash: string; ipKey: string; askId: string | null },
): Promise<void> {
  await q.query(
    `insert into files (key, bucket, kind, content_type, size_bytes, capability_hash, ip_key, ask_id)
     values ($1, 'private', $2, $3, $4, $5, $6, $7)`,
    [f.key, f.kind, f.contentType, f.size, f.capabilityHash, f.ipKey, f.askId],
  );
}

const FILE = `key, kind, content_type, size_bytes, ask_id, uploaded_at, attached_at, delete_requested_at, deleted_at`;

export async function fileByCapability(q: Queryable, hash: string): Promise<FileRow | null> {
  const { rows } = await q.query(`select ${FILE} from files where capability_hash = $1`, [hash]);
  return rows[0] ?? null;
}

export async function confirmFile(q: Queryable, key: string, size: number): Promise<void> {
  await q.query(`update files set uploaded_at = coalesce(uploaded_at, now()), size_bytes = $2 where key = $1`, [key, size]);
}

/**
 * Takes a fresh upload for a card: it can happen only once, whoever gets there first. The WHERE is the whole check, so two requests at
 * once can't both win. Null when the file isn't free.
 */
export async function attachFreeFile(q: Queryable, hash: string, askId: string, kind: "photo" | "voice"): Promise<string | null> {
  const { rows } = await q.query(
    `update files set ask_id = $2, attached_at = now()
      where capability_hash = $1 and kind = $3 and ask_id is null and attached_at is null
        and uploaded_at is not null and delete_requested_at is null and deleted_at is null
      returning key`,
    [hash, askId, kind],
  );
  return rows[0]?.key ?? null;
}

/** Takes a clip uploaded for this card's answer. Its link named the card, so no other card's token reaches it. */
export async function attachClip(q: Queryable, hash: string, askId: string): Promise<string | null> {
  const { rows } = await q.query(
    `update files set attached_at = now()
      where capability_hash = $1 and ask_id = $2 and attached_at is null
        and uploaded_at is not null and delete_requested_at is null and deleted_at is null
      returning key`,
    [hash, askId],
  );
  return rows[0]?.key ?? null;
}

/** S3 can't join a transaction: this marks the row, and a sweep does the S3 call (SCHEMA.md, "Deleting is durable"). */
export async function markFilesForDeletion(q: Queryable, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await q.query(
    `update files set delete_requested_at = coalesce(delete_requested_at, now()) where key = any($1::text[]) and deleted_at is null`,
    [keys],
  );
}

export async function fileKeysOfCard(q: Queryable, askId: string): Promise<string[]> {
  const { rows } = await q.query(`select key from files where ask_id = $1 limit 50`, [askId]);
  return rows.map((row) => row.key);
}

// ---------------------------------------------------------------------------------------------
// The budget

export async function spentOn(q: Queryable, day: string): Promise<number> {
  const { rows } = await q.query(`select usd from daily_spend where scope = 'dish_ask' and day = $1`, [day]);
  return rows[0] ? Number(rows[0].usd) : 0;
}

export async function addSpend(q: Queryable, day: string, usd: number): Promise<void> {
  await q.query(
    `insert into daily_spend (scope, day, usd) values ('dish_ask', $1, $2)
     on conflict (scope, day) do update set usd = daily_spend.usd + excluded.usd`,
    [day, usd],
  );
}

/** The first caller to find the day at its budget gets the total back; everyone after gets null. So the team is told once. */
export async function claimBudgetAlert(q: Queryable, day: string, budget: number): Promise<number | null> {
  const { rows } = await q.query(
    `update daily_spend set alerted_at = now()
      where scope = 'dish_ask' and day = $1 and alerted_at is null and usd >= $2
      returning usd`,
    [day, budget],
  );
  return rows[0] ? Number(rows[0].usd) : null;
}

export async function insertModelCalls(q: Queryable, askId: string | null, calls: ModelCall[]): Promise<void> {
  for (const c of calls) {
    await q.query(
      `insert into model_calls (ask_id, purpose, provider, model, prompt_version, attempt, input_tokens, output_tokens, thinking_tokens,
         cost_usd, price_known, seconds, ok, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, left($14, 200))`,
      [askId, c.purpose, c.provider, c.model, c.promptVersion, c.attempt, c.inputTokens, c.outputTokens, c.thinkingTokens, c.costUsd, c.priceKnown, c.seconds, c.ok, c.error],
    );
  }
}

/** The day's alert goes once, however often its message arrives. False when it was already marked. */
export async function markAlertSent(key: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `insert into idempotency_keys (scope, key, route) values ('scheduled', $1, 'dish.budget_alert') on conflict do nothing`,
    [key],
  );
  return Boolean(rowCount);
}

export async function unmarkAlertSent(key: string): Promise<void> {
  await db().query(`delete from idempotency_keys where scope = 'scheduled' and key = $1`, [key]);
}

// ---------------------------------------------------------------------------------------------
// The sweep

// The sweep can reach one bucket (objectStore() is the private one): another row's key would be "deleted" from the wrong bucket, S3 would say fine, and the
// row would say deleted while the file lives on. It decides orphans for anonymous uploads only (messages/tasks.ts gives signed-in ones a longer wait), and
// does the S3 delete for those and for signed-in uploads marked by anything. The partial indexes say the same (010_dish_hearing.sql, 050_messages.sql).
const SWEEPABLE = `bucket = 'private' and capability_hash is not null`;
const DELETABLE = `bucket = 'private' and (capability_hash is not null or owner_person_id is not null)`;

export async function markOrphanFiles(olderThanMs: number, batch: number): Promise<number> {
  const { rowCount } = await db().query(
    `update files set delete_requested_at = now()
      where key in (select key from files
                     where ${SWEEPABLE} and attached_at is null and delete_requested_at is null and deleted_at is null
                       and created_at < now() - make_interval(secs => $1)
                     order by created_at limit $2)`,
    [olderThanMs / 1000, batch],
  );
  return rowCount ?? 0;
}

/** A real deletion (a file that was on a card) before an orphan, so a flood of abandoned uploads can't hold it up. */
export async function filesToDelete(batch: number): Promise<string[]> {
  const { rows } = await db().query(
    `select key from files
      where ${DELETABLE} and delete_requested_at is not null and deleted_at is null
      order by attached_at is null, delete_requested_at limit $1`,
    [batch],
  );
  return rows.map((row) => row.key);
}

export async function markFileDeleted(key: string): Promise<void> {
  await db().query(`update files set deleted_at = coalesce(deleted_at, now()) where key = $1`, [key]);
}

export async function dropDeletedFileRows(olderThanDays: number, batch = 500): Promise<number> {
  const { rowCount } = await db().query(
    `delete from files where key in (select key from files where ${DELETABLE} and deleted_at < now() - make_interval(days => $1) limit $2)`,
    [olderThanDays, batch],
  );
  return rowCount ?? 0;
}

/** C4. A claimed card's ip_key goes with its kid's account, so only anonymous cards age out here. */
export async function clearOldIpKeys(days: number, batch = 500): Promise<number> {
  const cards = await db().query(
    `update dish_asks set ip_key = null
      where id in (select id from dish_asks
                    where ip_key is not null and person_id is null and created_at < now() - make_interval(days => $1) limit $2)`,
    [days, batch],
  );
  const files = await db().query(
    `update files set ip_key = null
      where key in (select key from files where ip_key is not null and created_at < now() - make_interval(days => $1) limit $2)`,
    [days, batch],
  );
  return (cards.rowCount ?? 0) + (files.rowCount ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Account deletion's reads

export async function cardsOfKid(q: Queryable, personId: string, batch: number): Promise<string[]> {
  const { rows } = await q.query(`select id from dish_asks where person_id = $1 order by created_at desc limit $2`, [personId, batch]);
  return rows.map((row) => row.id);
}

export async function cardsAskedOf(q: Queryable, personId: string, batch: number): Promise<string[]> {
  const { rows } = await q.query(`select id from dish_asks where requested_of = $1 order by created_at desc limit $2`, [personId, batch]);
  return rows.map((row) => row.id);
}

export async function deleteCravingLinksOf(q: Queryable, personId: string, batch: number): Promise<number> {
  const { rowCount } = await q.query(
    `delete from craving_links where id in (select id from craving_links where person_id = $1 limit $2)`,
    [personId, batch],
  );
  return rowCount ?? 0;
}
