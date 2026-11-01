// SQL for threads, messages, reads and recipe notes. Each query names the index behind it (SCHEMA.md, section 3).
//
//   A thread by id                     threads primary key
//   A pair, the circle                 threads_one_pair, threads_one_circle
//   My pairs, newest                   threads_a_recent, threads_b_recent
//   A thread's page, newest first      messages_thread_recent
//   My messages across threads         messages_thread_recent, once per thread of mine (never a scan of other people's pairs)
//   Questions in a thread              messages_thread_kind
//   Messages about a dish              messages_family_library
//   Replies to a message               messages_reply_to
//   Photos of my dishes                messages_family_recent, limited by time and to 200 rows
//   Unread                             thread_reads primary key, messages_thread_recent
//   A recipe's notes                   recipe_notes_family_library
//   A note by its answer               recipe_notes.answer_message_id (unique)
import type { PoolClient } from "pg";
import type { Queryable } from "../../db.js";
import type { Cursor } from "./values.js";

export type ThreadRow = {
  id: string;
  family_id: string;
  kind: "pair" | "circle";
  a_person_id: string | null;
  b_person_id: string | null;
  last_message_at: string | null;
};

export type MessageRow = {
  id: string;
  family_id: string;
  thread_id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  library_id: string | null;
  recipe_id: string | null;
  step_order: number | null;
  audio_key: string | null;
  clip_key: string | null;
  clip_start_s: number | null;
  clip_end_s: number | null;
  duration_s: number | null;
  transcript: string | null;
  photo_key: string | null;
  rating: number | null;
  reply_to: string | null;
  ai_drafted: boolean;
  created_at: string;
};

export type NoteRow = {
  id: string;
  library_id: string;
  step_order: number | null;
  question_message_id: string | null;
  question: string | null;
  asked_by: string | null;
  answer_message_id: string;
  answer_text: string | null;
  answer_audio_key: string | null;
  answer_clip_key: string | null;
  answer_duration_s: number | null;
  answered_by: string;
  created_at: string;
};

export const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const THREAD = `id, family_id, kind, a_person_id, b_person_id, ${iso("last_message_at")} as last_message_at`;
export const MESSAGE = (t = "m") =>
  `${t}.id, ${t}.family_id, ${t}.thread_id, ${t}.sender_id, ${t}.kind, ${t}.body, ${t}.library_id, ${t}.recipe_id, ${t}.step_order, ${t}.audio_key, ${t}.clip_key,
   ${t}.clip_start_s, ${t}.clip_end_s, ${t}.duration_s, ${t}.transcript, ${t}.photo_key, ${t}.rating, ${t}.reply_to, ${t}.ai_drafted, ${iso(`${t}.created_at`)} as created_at`;
const NOTE = `id, library_id, step_order, question_message_id, question, asked_by, answer_message_id, answer_text, answer_audio_key, answer_clip_key,
  answer_duration_s, answered_by, ${iso("created_at")} as created_at`;

// ---------------------------------------------------------------------------------------------
// Threads

export async function threadInFamily(q: Queryable, id: string, familyId: string): Promise<ThreadRow | null> {
  const { rows } = await q.query(`select ${THREAD} from threads where id = $1 and family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function threadsByIds(q: Queryable, ids: string[], familyId: string): Promise<ThreadRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(`select ${THREAD} from threads where id = any($1::text[]) and family_id = $2`, [ids, familyId]);
  return rows;
}

/** One pair per two people: two at once make one. */
export async function ensurePair(q: Queryable, familyId: string, x: string, y: string): Promise<ThreadRow> {
  const [a, b] = x < y ? [x, y] : [y, x];
  await q.query(
    `insert into threads (family_id, kind, a_person_id, b_person_id) values ($1, 'pair', $2, $3)
     on conflict (family_id, a_person_id, b_person_id) where kind = 'pair' do nothing`,
    [familyId, a, b],
  );
  const { rows } = await q.query(`select ${THREAD} from threads where family_id = $1 and kind = 'pair' and a_person_id = $2 and b_person_id = $3`, [familyId, a, b]);
  return rows[0];
}

/** The family's one circle, made on first use. */
export async function ensureCircle(q: Queryable, familyId: string): Promise<ThreadRow> {
  await q.query(`insert into threads (family_id, kind) values ($1, 'circle') on conflict (family_id) where kind = 'circle' do nothing`, [familyId]);
  const { rows } = await q.query(`select ${THREAD} from threads where family_id = $1 and kind = 'circle'`, [familyId]);
  return rows[0];
}

/** My pairs that have ever had a message: the threads the inbox and the question lists read. A family has few. */
export async function pairsOf(q: Queryable, personId: string, familyId: string): Promise<ThreadRow[]> {
  const { rows } = await q.query(
    `select ${THREAD} from threads
      where family_id = $2 and kind = 'pair' and (a_person_id = $1 or b_person_id = $1) and last_message_at is not null
      limit 500`,
    [personId, familyId],
  );
  return rows;
}

export type InboxRow = ThreadRow & {
  last_id: string | null;
  unread: number;
  library_id: string | null;
  postcards: number;
};

const SUMMARY = (person: string) => `
  coalesce(
    (select m.id from messages m where m.thread_id = t.id and m.kind not in ('reaction', 'system') order by m.created_at desc, m.id desc limit 1),
    (select m.id from messages m where m.thread_id = t.id and m.kind = 'system' order by m.created_at desc, m.id desc limit 1)
  ) as last_id,
  (select count(*)::int from messages m
    where m.thread_id = t.id and m.kind not in ('reaction', 'system') and m.sender_id <> ${person}
      and m.created_at > coalesce((select r.last_read_at from thread_reads r where r.thread_id = t.id and r.person_id = ${person}), '-infinity')) as unread,
  (select m.library_id from messages m where m.thread_id = t.id and m.kind <> 'reaction' and m.library_id is not null order by m.created_at desc, m.id desc limit 1) as library_id,
  (select count(*)::int from messages m where m.thread_id = t.id and m.kind = 'cooked' and m.photo_key is not null) as postcards`;

const THREAD_T = `t.id, t.family_id, t.kind, t.a_person_id, t.b_person_id, ${iso("t.last_message_at")} as last_message_at`;

export async function circleSummary(q: Queryable, threadId: string, personId: string): Promise<InboxRow> {
  const { rows } = await q.query(`select ${THREAD_T}, ${SUMMARY("$2")} from threads t where t.id = $1`, [threadId, personId]);
  return rows[0];
}

/** A page of my pairs, newest first. A pair with nothing left to show (only reactions, or what a deleted person sent) isn't a conversation. */
export async function pairSummaries(q: Queryable, personId: string, familyId: string, limit: number, cursor: Cursor | null): Promise<InboxRow[]> {
  const { rows } = await q.query(
    `select * from (
       select ${THREAD_T}, ${SUMMARY("$1")}, t.last_message_at as sort_at_raw
         from threads t
        where t.family_id = $2 and t.kind = 'pair' and (t.a_person_id = $1 or t.b_person_id = $1) and t.last_message_at is not null
          ${cursor ? `and (t.last_message_at, t.id) < ($4::timestamptz, $5)` : ""}
     ) s
     where s.last_id is not null
     order by s.sort_at_raw desc, s.id desc
     limit $3`,
    cursor ? [personId, familyId, limit, cursor.at, cursor.id] : [personId, familyId, limit],
  );
  return rows;
}

/** Everything unread for me, however many pairs I have. */
export async function unreadSummary(q: Queryable, personId: string, familyId: string, circleId: string): Promise<{ total: number; last_message_at: string | null }> {
  const { rows } = await q.query(
    `with mine as (
       select id, last_message_at from threads where id = $3
       union all
       select id, last_message_at from threads
        where family_id = $2 and kind = 'pair' and (a_person_id = $1 or b_person_id = $1) and last_message_at is not null
     )
     select coalesce(sum((select count(*) from messages m
              where m.thread_id = t.id and m.kind not in ('reaction', 'system') and m.sender_id <> $1
                and m.created_at > coalesce((select r.last_read_at from thread_reads r where r.thread_id = t.id and r.person_id = $1), '-infinity'))), 0)::int as total,
            ${iso("max(t.last_message_at)")} as last_message_at
       from mine t`,
    [personId, familyId, circleId],
  );
  return rows[0];
}

export async function markRead(q: Queryable, threadId: string, personId: string, at: string | null = null): Promise<void> {
  await q.query(
    `insert into thread_reads (thread_id, person_id, last_read_at) values ($1, $2, coalesce($3::timestamptz, now()))
     on conflict (thread_id, person_id) do update set last_read_at = greatest(thread_reads.last_read_at, excluded.last_read_at)`,
    [threadId, personId, at],
  );
}

// ---------------------------------------------------------------------------------------------
// Messages

export type NewMessage = {
  kind: string;
  body?: string | null;
  libraryId?: string | null;
  recipeId?: string | null;
  stepOrder?: number | null;
  audioKey?: string | null;
  clipKey?: string | null;
  clipStartS?: number | null;
  clipEndS?: number | null;
  durationS?: number | null;
  transcript?: string | null;
  photoKey?: string | null;
  rating?: number | null;
  replyTo?: string | null;
  aiDrafted?: boolean;
};

/**
 * One message, under the thread's row lock, stamped with the clock taken inside that lock. So within a thread, commit order is created_at order, and a poll
 * that reads "after my newest" can't miss a row that commits late. Null only for a reaction that's already there (the unique index).
 *
 * A reaction is a stamp under a message: it never moves the thread up the inbox and never marks it read, since its sender may not have opened the chat.
 * A system note marks nothing read either: its "sender" is the person it's about.
 */
export async function insertMessage(c: PoolClient, thread: ThreadRow, senderId: string, m: NewMessage, plusMs = 0): Promise<MessageRow | null> {
  await c.query(`select 1 from threads where id = $1 for update`, [thread.id]);
  const { rows } = await c.query(
    `insert into messages (family_id, thread_id, sender_id, kind, body, library_id, recipe_id, step_order, audio_key, clip_key, clip_start_s, clip_end_s,
                           duration_s, transcript, photo_key, rating, reply_to, ai_drafted, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, clock_timestamp() + make_interval(secs => $19))
     on conflict (thread_id, sender_id, reply_to, body) where kind = 'reaction' and reply_to is not null do nothing
     returning ${MESSAGE("messages")}`,
    [
      thread.family_id,
      thread.id,
      senderId,
      m.kind,
      m.body ?? null,
      m.libraryId ?? null,
      m.recipeId ?? null,
      m.stepOrder ?? null,
      m.audioKey ?? null,
      m.clipKey ?? null,
      m.clipStartS ?? null,
      m.clipEndS ?? null,
      m.durationS ?? null,
      m.transcript ?? null,
      m.photoKey ?? null,
      m.rating ?? null,
      m.replyTo ?? null,
      m.aiDrafted ?? false,
      plusMs / 1000,
    ],
  );
  const row: MessageRow | undefined = rows[0];
  if (!row) return null;
  if (row.kind === "reaction") return row;
  await c.query(`update threads set last_message_at = $2::timestamptz where id = $1`, [thread.id, row.created_at]);
  if (row.kind !== "system") await markRead(c, thread.id, senderId, row.created_at);
  return row;
}

export async function messageInFamily(q: Queryable, id: string, familyId: string): Promise<MessageRow | null> {
  const { rows } = await q.query(`select ${MESSAGE()} from messages m where m.id = $1 and m.family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function messageInFamilyForUpdate(q: Queryable, id: string, familyId: string): Promise<MessageRow | null> {
  const { rows } = await q.query(`select ${MESSAGE()} from messages m where m.id = $1 and m.family_id = $2 for update`, [id, familyId]);
  return rows[0] ?? null;
}

export async function messageById(q: Queryable, id: string): Promise<MessageRow | null> {
  const { rows } = await q.query(`select ${MESSAGE()} from messages m where m.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function messagesByIds(q: Queryable, ids: string[], familyId: string): Promise<MessageRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(`select ${MESSAGE()} from messages m where m.id = any($1::text[]) and m.family_id = $2`, [ids, familyId]);
  return rows;
}

export async function sameReaction(q: Queryable, threadId: string, senderId: string, replyTo: string, body: string): Promise<MessageRow | null> {
  const { rows } = await q.query(
    `select ${MESSAGE()} from messages m where m.thread_id = $1 and m.sender_id = $2 and m.reply_to = $3 and m.body = $4 and m.kind = 'reaction'`,
    [threadId, senderId, replyTo, body],
  );
  return rows[0] ?? null;
}

/** Newest first. `after` is what a poll sends: the created_at of the newest message it has. */
export async function threadMessages(q: Queryable, threadId: string, limit: number, cursor: Cursor | null, after: string | null): Promise<MessageRow[]> {
  const params: unknown[] = [threadId, limit];
  const filters: string[] = [];
  if (after) {
    params.push(after);
    filters.push(`and m.created_at > $${params.length}::timestamptz`);
  }
  if (cursor) {
    params.push(cursor.at, cursor.id);
    filters.push(`and (m.created_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  const { rows } = await q.query(
    `select ${MESSAGE()} from messages m where m.thread_id = $1 ${filters.join(" ")} order by m.created_at desc, m.id desc limit $2`,
    params,
  );
  return rows;
}

/** Newest across these threads, one bounded index read per thread. */
export async function messagesAcross(q: Queryable, threadIds: string[], limit: number, cursor: Cursor | null): Promise<MessageRow[]> {
  const { rows } = await q.query(
    `select r.* from unnest($1::text[]) as t(id)
     cross join lateral (
       select ${MESSAGE()}, m.created_at as raw_at from messages m
        where m.thread_id = t.id ${cursor ? "and (m.created_at, m.id) < ($3::timestamptz, $4)" : ""}
        order by m.created_at desc, m.id desc limit $2
     ) r
     order by r.raw_at desc, r.id desc limit $2`,
    cursor ? [threadIds, limit, cursor.at, cursor.id] : [threadIds, limit],
  );
  return rows;
}

export async function questionsInThreads(q: Queryable, threadIds: string[], kinds: string[], limit: number): Promise<MessageRow[]> {
  if (threadIds.length === 0) return [];
  const { rows } = await q.query(
    `select r.* from unnest($1::text[]) as t(id)
     cross join lateral (
       select ${MESSAGE()}, m.created_at as raw_at from messages m
        where m.thread_id = t.id and m.kind = any($2::text[])
        order by m.created_at desc, m.id desc limit $3
     ) r
     order by r.raw_at desc, r.id desc limit $3`,
    [threadIds, kinds, limit],
  );
  return rows;
}

export async function questionsAboutDish(q: Queryable, familyId: string, libraryId: string, limit: number): Promise<MessageRow[]> {
  const { rows } = await q.query(
    `select ${MESSAGE()} from messages m
      where m.family_id = $1 and m.library_id = $2 and m.kind in ('question', 'step')
      order by m.created_at desc, m.id desc limit $3`,
    [familyId, libraryId, limit],
  );
  return rows;
}

export type ReplyRow = { sender_id: string; reply_to: string; created_at: string };

export async function repliesTo(q: Queryable, ids: string[], familyId: string): Promise<ReplyRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query(
    `select sender_id, reply_to, ${iso("created_at")} as created_at from messages
      where reply_to = any($1::text[]) and family_id = $2 and kind <> 'reaction'
      order by messages.created_at, id limit 5000`,
    [ids, familyId],
  );
  return rows;
}

/** The next thing the person asked sent in a 1:1, for step questions from before reply_to existed. */
export async function nextFrom(q: Queryable, m: MessageRow, senderId: string): Promise<{ sender_id: string; created_at: string } | null> {
  const { rows } = await q.query(
    `select sender_id, ${iso("created_at")} as created_at from messages
      where thread_id = $1 and sender_id = $2 and kind not in ('system', 'reaction') and messages.created_at > $3::timestamptz
        and (reply_to is null or reply_to = $4)
      order by messages.created_at, id limit 1`,
    [m.thread_id, senderId, m.created_at, m.id],
  );
  return rows[0] ?? null;
}

export async function photosOfDishes(q: Queryable, familyId: string, sinceDays: number, limit: number): Promise<MessageRow[]> {
  const { rows } = await q.query(
    `select ${MESSAGE()} from messages m
      where m.family_id = $1 and m.created_at > now() - make_interval(days => $2)
      order by m.created_at desc, m.id desc limit $3`,
    [familyId, sinceDays, limit],
  );
  return rows;
}

export async function setPostcard(q: Queryable, id: string, familyId: string, photoKey: string, rating: number | null): Promise<void> {
  await q.query(`update messages set photo_key = $3, rating = $4 where id = $1 and family_id = $2`, [id, familyId, photoKey, rating]);
}

export async function clearReply(q: Queryable, id: string, familyId: string): Promise<void> {
  await q.query(`update messages set reply_to = null where id = $1 and family_id = $2`, [id, familyId]);
}

/** Which of these messages became a recipe note, for "Undo". */
export async function notesOfAnswers(q: Queryable, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select id, answer_message_id from recipe_notes where answer_message_id = any($1::text[])`, [ids]);
  return new Map(rows.map((row) => [row.answer_message_id, row.id]));
}

// ---------------------------------------------------------------------------------------------
// Recipe notes

export async function insertNote(
  c: Queryable,
  n: {
    familyId: string;
    libraryId: string;
    stepOrder: number | null;
    questionMessageId: string | null;
    question: string | null;
    askedBy: string | null;
    answerMessageId: string;
    answerText: string | null;
    answerAudioKey: string | null;
    answerClipKey: string | null;
    answerDurationS: number | null;
    answeredBy: string;
  },
): Promise<NoteRow> {
  await c.query(
    `insert into recipe_notes (family_id, library_id, step_order, question_message_id, question, asked_by, answer_message_id, answer_text, answer_audio_key,
                               answer_clip_key, answer_duration_s, answered_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (answer_message_id) do nothing`,
    [
      n.familyId,
      n.libraryId,
      n.stepOrder,
      n.questionMessageId,
      n.question,
      n.askedBy,
      n.answerMessageId,
      n.answerText,
      n.answerAudioKey,
      n.answerClipKey,
      n.answerDurationS,
      n.answeredBy,
    ],
  );
  const { rows } = await c.query(`select ${NOTE} from recipe_notes where answer_message_id = $1`, [n.answerMessageId]);
  return rows[0];
}

export async function noteInFamily(q: Queryable, id: string, familyId: string): Promise<NoteRow | null> {
  const { rows } = await q.query(`select ${NOTE} from recipe_notes where id = $1 and family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function deleteNote(q: Queryable, id: string, familyId: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from recipe_notes where id = $1 and family_id = $2`, [id, familyId]);
  return (rowCount ?? 0) > 0;
}

/** In the recipe's order: by step, then oldest first. Index: recipe_notes_family_library. */
export async function notesOfDish(q: Queryable, familyId: string, libraryId: string, limit: number, after: { step: number; at: string; id: string } | null): Promise<NoteRow[]> {
  const { rows } = await q.query(
    `select ${NOTE} from recipe_notes
      where family_id = $1 and library_id = $2 ${after ? "and (coalesce(step_order, 2147483647), recipe_notes.created_at, id) > ($4::int, $5::timestamptz, $6)" : ""}
      order by coalesce(step_order, 2147483647), recipe_notes.created_at, id limit $3`,
    after ? [familyId, libraryId, limit, after.step, after.at, after.id] : [familyId, libraryId, limit],
  );
  return rows;
}
