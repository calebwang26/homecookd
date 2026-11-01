// What deleting an account does to recipes, jobs, recordings, cooking rows and pending sends (SCHEMA.md section 4). NOTHING CALLS THIS YET: the account purge moves last, and
// until then the sync's sync.purge_person is where it would go when this area moves. It goes by person. The rule for a row with a file key: mark the key first, then delete
// the row. What only an outside purge can reach (raw videos' folders, published folders) is written on the person's account_deletions row first, so a crash can't lose it.
import { db, tx, type Queryable } from "../../db.js";
import { deletedPersonFamily } from "../people/reads.js";
import { recipesOfCook, type RecipeRow } from "../recipes/reads.js";
import { deleteRecipeUnlessLocked } from "../recipes/writes.js";
import { recipeWrites } from "../recipes/switch.js";
import * as recordings from "../recordings/data.js";
import type { JobRow } from "./data.js";
import { CANCELLED } from "./service.js";

export const PURGE_BATCH = 500;

type Noted = { recipeIds?: string[]; jobIds?: string[]; uploadKeys?: string[]; mediaKeys?: string[]; mediaPrefixes?: string[] };

const mergeList = (column: string, param: number, type: string) => `${column} = (select coalesce(array_agg(distinct x), '{}')::${type}[] from unnest(${column}::text[] || $${param}::text[]) x)`;

/** Writes down what was found, adding to what's there: a retry finds the row it already made (account_deletions.person_id is unique). */
async function note(c: Queryable, familyId: string, personId: string, found: Noted): Promise<void> {
  await c.query(`insert into account_deletions (family_id, person_id) values ($1, $2) on conflict (person_id) do nothing`, [familyId, personId]);
  await c.query(
    `update account_deletions set
       ${mergeList("recipe_ids", 2, "text")}, ${mergeList("job_ids", 3, "text")}, ${mergeList("upload_keys", 4, "s3_key")},
       ${mergeList("media_keys", 5, "s3_key")}, ${mergeList("media_prefixes", 6, "s3_key")}
     where person_id = $1`,
    [personId, found.recipeIds ?? [], found.jobIds ?? [], found.uploadKeys ?? [], found.mediaKeys ?? [], found.mediaPrefixes ?? []],
  );
}

async function markFiles(c: Queryable, keys: (string | null)[]): Promise<void> {
  const present = keys.filter((key): key is string => !!key);
  if (present.length === 0) return;
  await c.query(`update files set delete_requested_at = coalesce(delete_requested_at, now()) where key = any($1::text[]) and deleted_at is null`, [present]);
}

/**
 * pipeline/queue_worker.py recipe_folder: a job with no recipe folder yet publishes under this one, so a job stopped part way can leave files nothing else names. Checked
 * against the worker's own code by the contract test.
 */
export const workerFolder = (jobId: string) => `recipe-${jobId.toLowerCase().replace(/[^a-z0-9]/g, "")}/`;

/** Only recipes the pipeline made from her uploads have a folder: a seeded demo's files are the public library's, and stay. */
function recipeFiles(r: RecipeRow): Noted {
  if (!r.media_prefix) return { recipeIds: [r.id] };
  return { recipeIds: [r.id], mediaPrefixes: [r.media_prefix], mediaKeys: [r.recipe_json_key, r.cover_key].filter((key): key is string => !!key) };
}

/**
 * A recipe with what can't outlive it. Questions never cascade, because a voice note must not be lost track of, and they're Messages' table: on this branch Messages has no
 * module, so this reaches `questions` directly, as Community's draft does, and hands over when it lands. Cooking rows and swaps cascade. A dinner, a message and a job keep
 * their rows with the recipe's id nulled, by their foreign keys.
 */
async function deleteRecipe(c: Queryable, recipeId: string): Promise<void> {
  const { rows } = await c.query(`select id, answer_audio_key from questions where recipe_id = $1`, [recipeId]);
  await markFiles(c, rows.map((row) => row.answer_audio_key));
  await c.query(`delete from questions where recipe_id = $1`, [recipeId]);
  await deleteRecipeUnlessLocked(c, recipeId);
}

/**
 * At once, in the deletion's own transaction, after the person is blanked: nothing of theirs is worked on again, and their recipes are gone for the whole family. With the
 * copy still read-only the sync has done the recipes already, and owns them.
 */
export async function stopPersonsWork(c: Queryable, personId: string): Promise<void> {
  const familyId = await deletedPersonFamily(c, personId);
  if (!familyId) throw new Error("this person hasn't deleted their account");
  await c.query(
    `update jobs set stage = 'failed', progress = 0, error = $2, claimed_at = null, cancelled_at = now(), finished_at = now(), updated_at = now()
      where cook_id = $1 and stage not in ('done', 'failed')`,
    [personId, CANCELLED],
  );
  await recordings.abandonRecordingsOf(c, personId);
  if ((await recipeWrites(c)) === "locked") return;
  for (;;) {
    const rows = await recipesOfCook(c, personId, PURGE_BATCH);
    if (rows.length === 0) break;
    for (const r of rows) await note(c, familyId, personId, recipeFiles(r));
    for (const r of rows) await deleteRecipe(c, r.id);
    if (rows.length < PURGE_BATCH) break;
  }
}

const inBatches = async (step: () => Promise<number>) => {
  while ((await step()) === PURGE_BATCH);
};

/**
 * Then in batches, each its own transaction, safe to run again: everything else, and any recipe the worker published a moment after the deletion. Their files are marked for
 * the sweep; what's outside it is on account_deletions.
 */
export async function purgeJobsForPerson(personId: string): Promise<void> {
  const familyId = await deletedPersonFamily(db(), personId);
  if (!familyId) throw new Error("this person hasn't deleted their account");

  await inBatches(() =>
    tx(async (c) => {
      if ((await recipeWrites(c)) === "locked") return 0;
      const rows = await recipesOfCook(c, personId, PURGE_BATCH);
      for (const r of rows) await note(c, familyId, personId, recipeFiles(r));
      for (const r of rows) await deleteRecipe(c, r.id);
      return rows.length;
    }),
  );

  await inBatches(() => recordings.deleteCookingOfKid(db(), personId, PURGE_BATCH));
  await inBatches(() => recordings.forgetCookOnCooking(db(), personId, PURGE_BATCH));

  // Each recording after everything saved with it.
  await inBatches(() =>
    tx(async (c) => {
      const rows = await recordings.recordingsOf(c, personId, PURGE_BATCH);
      for (const r of rows) {
        const frame = await recordings.deleteFrame(c, r.id);
        await markFiles(c, [frame, r.cover_key, r.video_key]);
        // The plate photo too: either can live outside the ledger.
        const outside = [r.video_key, r.cover_key].filter((k): k is string => !!k);
        if (outside.length) await note(c, familyId, personId, { mediaKeys: outside });
        await recordings.deleteRecording(c, r.id);
      }
      return rows.length;
    }),
  );

  await inBatches(() =>
    tx(async (c) => {
      const { rows } = await c.query<Pick<JobRow, "id" | "upload_key" | "upload_id">>(`select id, upload_key, upload_id from jobs where cook_id = $1 limit $2`, [personId, PURGE_BATCH]);
      if (rows.length === 0) return 0;
      await note(c, familyId, personId, {
        jobIds: rows.map((j) => j.id),
        uploadKeys: rows.map((j) => j.upload_key),
        mediaPrefixes: rows.map((j) => workerFolder(j.id)),
      });
      await c.query(
        `update files set delete_requested_at = coalesce(delete_requested_at, now()) where upload_id = any($1::text[]) and deleted_at is null`,
        [rows.map((j) => j.upload_id)],
      );
      await c.query(`delete from jobs where id = any($1::text[])`, [rows.map((j) => j.id)]);
      return rows.length;
    }),
  );

  // A pending send they made goes, with its hello; one to them loses them from its list.
  await inBatches(() =>
    tx(async (c) => {
      const { rows } = await c.query(`select upload_id, hello_key from pending_sends where sender_id = $1 limit $2`, [personId, PURGE_BATCH]);
      await markFiles(c, rows.map((row) => row.hello_key));
      await c.query(`delete from pending_sends where upload_id = any($1::text[])`, [rows.map((row) => row.upload_id)]);
      return rows.length;
    }),
  );
  await inBatches(async () => {
    const { rowCount } = await db().query(
      `update pending_sends set recipient_ids = array_remove(recipient_ids, $1)
        where upload_id in (select upload_id from pending_sends where family_id = $2 and $1 = any(recipient_ids) limit $3)`,
      [personId, familyId, PURGE_BATCH],
    );
    return rowCount ?? 0;
  });

  // Whatever else of theirs is still in the ledger: an upload nothing took, a plate photo.
  await inBatches(async () => {
    const { rowCount } = await db().query(
      `update files set delete_requested_at = now()
        where key in (select key from files where owner_person_id = $1 and delete_requested_at is null and deleted_at is null limit $2)`,
      [personId, PURGE_BATCH],
    );
    return rowCount ?? 0;
  });
  await db().query(`delete from idempotency_keys where scope = $1`, [personId]);
}
