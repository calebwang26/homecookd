// What deleting an account does to this area's tables (SCHEMA.md section 4, C1): what they sent goes, and what the other person sent stays, voice notes included.
// Nothing calls this yet: the account purge moves last. Batches of 500, each its own transaction, and safe to run again: a file is marked before its row goes, and
// each row leaves the person's lists as it's handled, so a restart picks up where it stopped.
//
// The purge's order matters: notes before the messages they name, because recipe_notes.answer_message_id refuses a delete.
import type { PoolClient } from "pg";
import { db, tx } from "../../db.js";
import { recipeIdsOfCook } from "../recipes/read.js";
import * as push from "./pushData.js";
import { markForDeletion } from "./uploads.js";

export const PURGE_BATCH = 500;

/** A batch that may be full again. Runs until one comes back short. */
async function batches(work: (c: PoolClient) => Promise<number>): Promise<void> {
  while ((await tx(work)) === PURGE_BATCH);
}

/** The at-once step (SCHEMA.md section 4): nothing reaches a deleted account, even before the purge runs. */
export async function dropPushTokens(c: PoolClient, personId: string): Promise<void> {
  await push.dropTokensOf(c, personId);
}

const lockAudio = async (c: PoolClient, where: string, params: unknown[]) => {
  const { rows } = await c.query(`select id, answer_audio_key from questions where ${where} limit ${PURGE_BATCH} for update`, params);
  await markForDeletion(c, rows.map((q) => q.answer_audio_key));
  return rows.map((q) => q.id as string);
};

/** Her recipes' questions, with the answers on them. Call this before deleting a recipe: `questions` never cascades. Returns how many went, up to a batch. */
export async function deleteQuestionsOnRecipes(c: PoolClient, recipeIds: string[]): Promise<number> {
  if (recipeIds.length === 0) return 0;
  const ids = await lockAudio(c, "recipe_id = any($1::text[])", [recipeIds]);
  await c.query(`delete from questions where id = any($1::text[])`, [ids]);
  return ids.length;
}

export async function purgeMessagesForPerson(personId: string, familyId: string): Promise<void> {
  await db().query(`delete from idempotency_keys where scope = $1`, [personId]);
  await push.dropTokensOf(db(), personId);
  while ((await push.dropLogOf(db(), personId, PURGE_BATCH)) === PURGE_BATCH);

  // Questions they asked, and the ones on their recipes, go with the answers on them. A voice answer is marked first.
  await batches(async (c) => {
    const ids = await lockAudio(c, "asked_by = $1", [personId]);
    await c.query(`delete from questions where id = any($1::text[])`, [ids]);
    return ids.length;
  });
  for (let after = ""; ; ) {
    const recipes = await recipeIdsOfCook(db(), personId, after, PURGE_BATCH);
    if (recipes.length === 0) break;
    after = recipes.at(-1)!;
    await batches((c) => deleteQuestionsOnRecipes(c, recipes));
    if (recipes.length < PURGE_BATCH) break;
  }
  // Their answer to someone else's question comes off it, so it waits for an answer again.
  await batches(async (c) => {
    const ids = await lockAudio(c, "answer_by = $1", [personId]);
    await c.query(
      `update questions set status = 'asked_cook', answer_by = null, answer_text = null, answer_audio_key = null, answer_transcript = null, answer_translation = null,
         answered_at = null, answer_transcribing_at = null
       where id = any($1::text[])`,
      [ids],
    );
    return ids.length;
  });

  // Recipe notes: answered by them or from a message of theirs, deleted. Asked by them: the question comes off, and the answer stays.
  await batches(async (c) => {
    const { rows } = await c.query(
      `delete from recipe_notes where id in (
         select n.id from recipe_notes n where n.answered_by = $1 limit $2
       ) returning answer_audio_key`,
      [personId, PURGE_BATCH],
    );
    await markForDeletion(c, rows.map((n) => n.answer_audio_key));
    return rows.length;
  });
  await batches(async (c) => {
    const { rowCount } = await c.query(
      `update recipe_notes set asked_by = null, question = null where id in (select id from recipe_notes where asked_by = $1 limit $2)`,
      [personId, PURGE_BATCH],
    );
    return rowCount ?? 0;
  });

  // Everything they sent, in pairs and the circle. A note saved from a message of theirs under someone else's name can't exist (a note's author is its sender), but
  // it would refuse the delete, so it goes too. Replies to these rows lose their reply_to through the foreign key.
  await batches(async (c) => {
    const { rows } = await c.query(
      `select id, audio_key, photo_key from messages where sender_id = $1 order by created_at desc limit $2 for update`,
      [personId, PURGE_BATCH],
    );
    const ids = rows.map((m) => m.id);
    await markForDeletion(c, rows.flatMap((m) => [m.audio_key, m.photo_key]));
    const notes = await c.query(`delete from recipe_notes where answer_message_id = any($1::text[]) returning answer_audio_key`, [ids]);
    await markForDeletion(c, notes.rows.map((n) => n.answer_audio_key));
    await c.query(`delete from messages where id = any($1::text[])`, [ids]);
    return rows.length;
  });

  // Their pairs stay, pointing at the tombstone, so the other person keeps their half. The time moves back to what's left, and read marks go.
  await tx(async (c) => {
    await c.query(
      `delete from thread_reads where person_id = $1
          or thread_id in (select id from threads where kind = 'pair' and (a_person_id = $1 or b_person_id = $1))`,
      [personId],
    );
    await c.query(
      `update threads t set last_message_at = (select max(m.created_at) from messages m where m.thread_id = t.id and m.kind <> 'reaction')
        where t.kind = 'pair' and (t.a_person_id = $1 or t.b_person_id = $1)`,
      [personId],
    );
    await c.query(
      `update threads t set last_message_at = (select max(m.created_at) from messages m where m.thread_id = t.id and m.kind <> 'reaction')
        where t.family_id = $1 and t.kind = 'circle'`,
      [familyId],
    );
  });

  // Recordings on their way: sent by them, deleted with the hello marked; to them, they're taken off the list.
  await batches(async (c) => {
    const { rows } = await c.query(
      `delete from pending_sends where upload_id in (select upload_id from pending_sends where sender_id = $1 limit $2) returning hello_key`,
      [personId, PURGE_BATCH],
    );
    await markForDeletion(c, rows.map((p) => p.hello_key));
    return rows.length;
  });
  await db().query(`update pending_sends set recipient_ids = array_remove(recipient_ids, $1) where family_id = $2 and $1 = any(recipient_ids)`, [personId, familyId]);

  await batches(async (c) => {
    const { rowCount } = await c.query(`update shares set sender_id = null where token in (select token from shares where sender_id = $1 limit $2)`, [personId, PURGE_BATCH]);
    return rowCount ?? 0;
  });
  await batches(async (c) => {
    const { rowCount } = await c.query(`delete from favorites where (person_id, library_id) in (select person_id, library_id from favorites where person_id = $1 limit $2)`, [personId, PURGE_BATCH]);
    return rowCount ?? 0;
  });
  await batches(async (c) => {
    const { rowCount } = await c.query(`delete from recipe_events where id in (select id from recipe_events where person_id = $1 limit $2)`, [personId, PURGE_BATCH]);
    return rowCount ?? 0;
  });
  await batches(async (c) => {
    const { rowCount } = await c.query(`update recipe_events set cook_id = null where id in (select id from recipe_events where cook_id = $1 limit $2)`, [personId, PURGE_BATCH]);
    return rowCount ?? 0;
  });

  // Their uploads nothing took. Attached ones were marked above, with their rows.
  await batches(async (c) => {
    const { rowCount } = await c.query(
      `update files set delete_requested_at = now()
        where key in (select key from files where owner_person_id = $1 and attached_at is null and delete_requested_at is null and deleted_at is null limit $2)`,
      [personId, PURGE_BATCH],
    );
    return rowCount ?? 0;
  });
}
