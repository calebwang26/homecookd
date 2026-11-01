// What deleting an account does, table by table (SCHEMA.md section 4). Each step takes at most `max` rows and says how many it changed, so fewer than `max` means it's done,
// and it finds only what's left, which is what makes the whole purge safe to stop anywhere and start again. The rule for any row holding a file key: the key is marked first,
// in the same transaction as the delete, so a crash can never lose the only record of a file that must come off S3.
//
// Who owns what: dish cards go through the dish module's own purge. The rest was written here before those areas merged. Each now has its own purge function (messages/account.ts,
// community/account.ts, jobs/account.ts), tested but not called yet, and these steps still do the work. Replacing them is a gate before the switch: CUTOVER.md. coverage.ts, with a
// test, holds this list to the real schema.
import type { Queryable } from "../../db.js";
import { blankFamilyIfEmpty } from "./data.js";
import { purgeDishForPerson } from "../dish/account.js";

export const PURGE_BATCH = 500;

export type Deletion = {
  id: string;
  family_id: string;
  person_id: string;
  recipe_ids: string[];
  job_ids: string[];
  upload_keys: string[];
  media_keys: string[];
  media_prefixes: string[];
  media_urls_legacy: string[];
  voice_clone_id: string | null;
  purged_at: Date | null;
  purge_run_at: Date | null;
  purge_restarts: number;
  requested_at: Date;
  external_purged_at: Date | null;
  external_attempts: number;
  external_tried_at: Date | null;
};

// The driver can't read an array of a domain, so the keys come back as plain text[].
export const DELETION = `id, family_id, person_id, recipe_ids, job_ids, upload_keys::text[] as upload_keys, media_keys::text[] as media_keys, media_prefixes::text[] as media_prefixes,
  media_urls_legacy, voice_clone_id, purged_at, purge_run_at, purge_restarts, requested_at, external_purged_at, external_attempts, external_tried_at`;

const present = (keys: (string | null | undefined)[]) => [...new Set(keys.filter((k): k is string => !!k))];

type Bucket = "private" | "media";
type Kind = "photo" | "voice" | "video" | "cover" | "frame";

/**
 * Marks files for the sweep. A key with no row in the ledger gets one, because the mark must not be lost: only a backfill bug could cause that, but the file would then be
 * unfindable once this row goes.
 */
export async function markFiles(q: Queryable, d: Pick<Deletion, "id">, keys: (string | null | undefined)[], bucket: Bucket, kind: Kind): Promise<void> {
  const list = present(keys);
  if (!list.length) return;
  await q.query(
    `insert into files (key, bucket, kind, delete_requested_at, purge_deletion_id)
     select k, $2, $3, now(), $4 from unnest($1::text[]) as k
     on conflict (key) do update set delete_requested_at = coalesce(files.delete_requested_at, now()), purge_deletion_id = coalesce(files.purge_deletion_id, excluded.purge_deletion_id)
       where files.deleted_at is null`,
    [list, bucket, kind, d.id],
  );
}

/** For keys that can name public library media, which has no row: only a row that's there is marked. */
async function markExisting(q: Queryable, d: Pick<Deletion, "id">, keys: (string | null | undefined)[]): Promise<void> {
  const list = present(keys);
  if (!list.length) return;
  await q.query(
    `update files set delete_requested_at = coalesce(delete_requested_at, now()), purge_deletion_id = coalesce(purge_deletion_id, $2) where key = any($1::text[]) and deleted_at is null`,
    [list, d.id],
  );
}

const union = (a: string[], b: (string | null | undefined)[]) => [...new Set([...a, ...present(b)])];

/** Adds what a step found to the deletion row, and to `d` for the steps after. */
async function note(q: Queryable, d: Deletion, found: { recipeIds?: string[]; jobIds?: string[]; uploadKeys?: (string | null)[]; mediaKeys?: (string | null)[]; prefixes?: (string | null)[] }) {
  const next = {
    recipe_ids: union(d.recipe_ids, found.recipeIds ?? []),
    job_ids: union(d.job_ids, found.jobIds ?? []),
    upload_keys: union(d.upload_keys, found.uploadKeys ?? []),
    media_keys: union(d.media_keys, found.mediaKeys ?? []),
    media_prefixes: union(d.media_prefixes, found.prefixes ?? []),
  };
  const size = (x: Pick<Deletion, "recipe_ids" | "job_ids" | "upload_keys" | "media_keys" | "media_prefixes">) =>
    x.recipe_ids.length + x.job_ids.length + x.upload_keys.length + x.media_keys.length + x.media_prefixes.length;
  if (size(next) === size(d)) return;
  await q.query(
    `update account_deletions set recipe_ids = $2, job_ids = $3, upload_keys = $4::text[]::s3_key[], media_keys = $5::text[]::s3_key[], media_prefixes = $6::text[]::s3_key[] where id = $1`,
    [d.id, next.recipe_ids, next.job_ids, next.upload_keys, next.media_keys, next.media_prefixes],
  );
  Object.assign(d, next);
}

type RecipeRow = { id: string; media_prefix: string | null; recipe_json_key: string | null; cover_key: string | null };
export const RECIPE_FILES = `id, media_prefix, recipe_json_key, cover_key`;

/** Her recipes with their questions; their cooking rows and swaps cascade, and another family's dinner around one is called off and keeps its `dish` text. */
export async function dropRecipes(q: Queryable, d: Deletion, rows: RecipeRow[]): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  // Only recipes the pipeline made from her uploads have a folder of hers: a seeded demo's files are the public library's.
  const own = rows.filter((r) => r.media_prefix);
  await note(q, d, { recipeIds: ids, prefixes: own.map((r) => r.media_prefix), mediaKeys: own.flatMap((r) => [r.recipe_json_key, r.cover_key]) });
  await markExisting(q, d, own.flatMap((r) => [r.recipe_json_key, r.cover_key]));
  const questions = await q.query(`select answer_audio_key from questions where recipe_id = any($1::text[]) and answer_audio_key is not null`, [ids]);
  await markFiles(q, d, questions.rows.map((r) => r.answer_audio_key), "private", "voice");
  await q.query(`delete from questions where recipe_id = any($1::text[])`, [ids]);
  await q.query(`update dinners set status = 'cancelled' where recipe_id = any($1::text[]) and status <> 'cancelled'`, [ids]);
  await q.query(`delete from recipes where id = any($1::text[])`, [ids]);
}

export type Step = {
  name: string;
  /** Rows changed, at most `max`. */
  run: (q: Queryable, d: Deletion, max: number) => Promise<number>;
  /** Runs its own transactions, so it isn't given one. */
  outside?: boolean;
};

const del = (sql: string) => async (q: Queryable, d: Deletion, max: number) => (await q.query(sql, [d.person_id, max])).rowCount ?? 0;

/** Whatever a sign-in racing the delete managed to make. startDeletion did all this at once; here it's the check that nothing came back. */
async function signInLeftovers(q: Queryable, d: Deletion, max: number): Promise<number> {
  let n = 0;
  const count = async (sql: string, args: unknown[]) => {
    n += (await q.query(sql, args)).rowCount ?? 0;
  };
  await count(`delete from sessions where id in (select id from sessions where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`update devices set person_id = null, label = null, revoked_at = coalesce(revoked_at, now()) where id in (select id from devices where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`delete from identities where person_id = $1`, [d.person_id]);
  await count(`delete from push_tokens where person_id = $1`, [d.person_id]);
  await count(`delete from invites where id in (select id from invites where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`delete from move_requests where id in (select id from move_requests where person_id = $1 limit $2)`, [d.person_id, max]);
  return n;
}

/** Everything they sent, in pairs and the circle. What others sent stays, voice notes included (C1). A note made from one of these goes, or loses their question (SCHEMA.md). */
async function messages(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, audio_key, photo_key from messages where sender_id = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const notes = await q.query(`select answer_audio_key from recipe_notes where answer_message_id = any($1::text[]) and answer_audio_key is not null`, [ids]);
  await markFiles(q, d, [...rows.map((r) => r.audio_key), ...notes.rows.map((r) => r.answer_audio_key)], "private", "voice");
  await markFiles(q, d, rows.map((r) => r.photo_key), "private", "photo");
  await q.query(`delete from recipe_notes where answer_message_id = any($1::text[])`, [ids]);
  await q.query(`update recipe_notes set asked_by = null, question = null where question_message_id = any($1::text[])`, [ids]);
  await q.query(`delete from messages where id = any($1::text[])`, [ids]);
  return rows.length;
}

async function notesAnswered(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, answer_audio_key from recipe_notes where answered_by = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await markFiles(q, d, rows.map((r) => r.answer_audio_key), "private", "voice");
  await q.query(`delete from recipe_notes where id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.length;
}

/** The questions they asked, with any answer on them. */
async function questionsAsked(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, answer_audio_key from questions where asked_by = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await markFiles(q, d, rows.map((r) => r.answer_audio_key), "private", "voice");
  await q.query(`delete from questions where id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.length;
}

/** Their answer to anyone else's question comes off it, so it waits for an answer again. */
async function questionsAnswered(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, answer_audio_key from questions where answer_by = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await markFiles(q, d, rows.map((r) => r.answer_audio_key), "private", "voice");
  await q.query(
    `update questions set status = 'asked_cook', answer_by = null, answer_text = null, answer_audio_key = null, answer_transcript = null, answer_translation = null, answered_at = null
      where id = any($1::text[])`,
    [rows.map((r) => r.id)],
  );
  return rows.length;
}

const childOfRecordings = (table: string) =>
  del(`delete from ${table} where id in (select x.id from ${table} x join recordings r on r.id = x.recording_id where r.cook_id = $1 limit $2)`);

async function liveFrames(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(
    `select f.recording_id, f.frame_key from live_frames f join recordings r on r.id = f.recording_id where r.cook_id = $1 limit $2`,
    [d.person_id, max],
  );
  if (!rows.length) return 0;
  await markFiles(q, d, rows.map((r) => r.frame_key), "private", "frame");
  await q.query(`delete from live_frames where recording_id = any($1::text[])`, [rows.map((r) => r.recording_id)]);
  return rows.length;
}

/** Their recordings, after everything saved with them (the three cascading tables are cleared in batches first, so one long recording can't outgrow a statement). */
async function recordings(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, video_key, cover_key from recordings where cook_id = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await note(q, d, { mediaKeys: rows.map((r) => r.video_key) });
  await markFiles(q, d, rows.map((r) => r.video_key), "media", "video");
  await markFiles(q, d, rows.map((r) => r.cover_key), "private", "cover");
  await q.query(`delete from recordings where id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.length;
}

/** Theirs deleted, with `upload_key` noted first. */
async function jobs(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select id, upload_key from jobs where cook_id = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await note(q, d, { jobIds: rows.map((r) => r.id), uploadKeys: rows.map((r) => r.upload_key) });
  await q.query(`delete from jobs where id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.length;
}

async function pendingSent(q: Queryable, d: Deletion, max: number): Promise<number> {
  const { rows } = await q.query(`select upload_id, hello_key from pending_sends where sender_id = $1 limit $2`, [d.person_id, max]);
  if (!rows.length) return 0;
  await markFiles(q, d, rows.map((r) => r.hello_key), "private", "voice");
  await q.query(`delete from pending_sends where upload_id = any($1::text[])`, [rows.map((r) => r.upload_id)]);
  return rows.length;
}

const pendingTo = (q: Queryable, d: Deletion, max: number) =>
  q
    .query(
      `update pending_sends set recipient_ids = array_remove(recipient_ids, $1)
        where upload_id in (select upload_id from pending_sends where family_id = $2 and $1 = any(recipient_ids) limit $3)`,
      [d.person_id, d.family_id, max],
    )
    .then((r) => r.rowCount ?? 0);

/** Marked by person, so a file nothing else named still goes. Anonymous kids' uploads have no owner: the dish purge finds those by their card. */
const filesOwned = (q: Queryable, d: Deletion, max: number) =>
  q
    .query(
      `update files set delete_requested_at = coalesce(delete_requested_at, now()), purge_deletion_id = $2
        where key in (select key from files where owner_person_id = $1 and purge_deletion_id is null limit $3)`,
      [d.person_id, d.id, max],
    )
    .then((r) => r.rowCount ?? 0);

/** A `link:` row stays, nameless, to keep "one join per side"; any other goes. */
async function signups(q: Queryable, d: Deletion, max: number): Promise<number> {
  const kept = await q.query(
    `update signups set email = null, name = 'Deleted', person_id = null
      where id in (select id from signups where person_id = $1 and share_token like 'link:%' limit $2)`,
    [d.person_id, max],
  );
  const gone = await q.query(`delete from signups where id in (select id from signups where person_id = $1 and (share_token is null or share_token not like 'link:%') limit $2)`, [
    d.person_id,
    max,
  ]);
  return (kept.rowCount ?? 0) + (gone.rowCount ?? 0);
}

/** Theirs, and any on their pairs. */
const threadReads = del(
  `delete from thread_reads where (thread_id, person_id) in (
     select r.thread_id, r.person_id from thread_reads r join threads t on t.id = r.thread_id
      where r.person_id = $1 or (t.kind = 'pair' and (t.a_person_id = $1 or t.b_person_id = $1)) limit $2)`,
);

/** Their pairs stay, pointing at the tombstone, so the other person keeps their half (C1). The time they sort by mustn't point at a message that's gone. */
const threadTimes = (q: Queryable, d: Deletion, max: number) =>
  q
    .query(
      `with mine as (
         select id from threads where kind = 'pair' and (a_person_id = $1 or b_person_id = $1) union select id from threads where kind = 'circle' and family_id = $2
       ), times as (
         select t.id, (select max(m.created_at) from messages m where m.thread_id = t.id and m.kind <> 'reaction') as last from threads t join mine on mine.id = t.id
       ), due as (
         select times.id, times.last from times join threads t on t.id = times.id where t.last_message_at is distinct from times.last limit $3
       )
       update threads t set last_message_at = due.last from due where t.id = due.id`,
      [d.person_id, d.family_id, max],
    )
    .then((r) => r.rowCount ?? 0);

// Recipes first, so a late one's questions, cooking and swaps go with the rest.
export const STEPS: Step[] = [
  {
    name: "recipes",
    run: async (q, d, max) => {
      const { rows } = await q.query(`select ${RECIPE_FILES} from recipes where cook_id = $1 limit $2`, [d.person_id, max]);
      await dropRecipes(q, d, rows);
      return rows.length;
    },
  },
  { name: "sign-in leftovers", run: signInLeftovers },
  { name: "messages", run: messages },
  { name: "recipe notes answered", run: notesAnswered },
  { name: "recipe notes asked", run: del(`update recipe_notes set asked_by = null, question = null where id in (select id from recipe_notes where asked_by = $1 limit $2)`) },
  { name: "questions asked", run: questionsAsked },
  { name: "questions answered", run: questionsAnswered },
  { name: "cooking as the kid", run: del(`delete from cooking_sessions where id in (select id from cooking_sessions where kid_id = $1 limit $2)`) },
  { name: "cooking as the cook", run: del(`update cooking_sessions set cook_id = null where id in (select id from cooking_sessions where cook_id = $1 limit $2)`) },
  { name: "homie prompts", run: childOfRecordings("homie_prompts") },
  { name: "live events", run: childOfRecordings("live_events") },
  { name: "live windows", run: childOfRecordings("live_windows") },
  { name: "live frames", run: liveFrames },
  { name: "recordings", run: recordings },
  { name: "jobs", run: jobs },
  { name: "pending sends from them", run: pendingSent },
  { name: "pending sends to them", run: pendingTo },
  { name: "dish cards", run: (_q, d) => purgeDishForPerson(d.person_id), outside: true },
  { name: "dinners they host", run: del(`delete from dinners where id in (select id from dinners where host_id = $1 limit $2)`) },
  { name: "dinners they asked for", run: del(`delete from dinner_requests where id in (select id from dinner_requests where guest_id = $1 limit $2)`) },
  { name: "swaps", run: del(`delete from swap_requests where id in (select id from swap_requests where requester_id = $1 limit $2)`) },
  { name: "reports", run: del(`update reports set reporter_person_id = null where id in (select id from reports where reporter_person_id = $1 limit $2)`) },
  {
    name: "blocks",
    run: (q, d, max) =>
      q
        .query(`update blocks set label = 'A family' where id in (select id from blocks where blocked_family_id = $1 and label <> 'A family' limit $2)`, [d.family_id, max])
        .then((r) => r.rowCount ?? 0),
  },
  { name: "invites they sent", run: del(`update invites set inviter_id = null where id in (select id from invites where inviter_id = $1 limit $2)`) },
  { name: "join links", run: del(`update join_links set inviter_id = null where id in (select id from join_links where inviter_id = $1 limit $2)`) },
  { name: "moves they decided", run: del(`update move_requests set decided_by = null where id in (select id from move_requests where decided_by = $1 limit $2)`) },
  { name: "signups", run: signups },
  { name: "thread reads", run: threadReads },
  { name: "thread times", run: threadTimes },
  { name: "shares", run: del(`update shares set sender_id = null where token in (select token from shares where sender_id = $1 limit $2)`) },
  { name: "favorites", run: del(`delete from favorites where (person_id, library_id) in (select person_id, library_id from favorites where person_id = $1 limit $2)`) },
  { name: "recipe events", run: del(`delete from recipe_events where id in (select id from recipe_events where person_id = $1 limit $2)`) },
  { name: "recipe events' cook", run: del(`update recipe_events set cook_id = null where id in (select id from recipe_events where cook_id = $1 limit $2)`) },
  { name: "push log", run: del(`delete from push_log where id in (select id from push_log where person_id = $1 limit $2)`) },
  { name: "idempotency keys", run: del(`delete from idempotency_keys where (scope, key) in (select scope, key from idempotency_keys where scope = $1 limit $2)`) },
  { name: "files", run: filesOwned },
  { name: "the family, if they were its last", run: (q, d) => blankFamilyIfEmpty(q, d.family_id).then((did) => (did ? 1 : 0)) },
];
