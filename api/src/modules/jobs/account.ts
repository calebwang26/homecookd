// What deleting an account does to recipes, jobs, recordings, cooking rows and pending sends (SCHEMA.md section 4). accounts/deletion.ts and purgeSteps.ts call this.
// It goes by person. The rule for a row with a file key: mark the key first, then delete
// the row. What only an outside purge can reach (raw videos' folders, published folders) is written on the person's account_deletions row first, so a crash can't lose it.
import type { PoolClient } from "pg";
import { db, type Queryable } from "../../db.js";
import { inBatches, markPurged, markPurgedIfKnown, ON_ITS_OWN, PURGE_BATCH, type PurgeRun } from "../../purge.js";
import { deletedPersonFamily } from "../people/reads.js";
import { recipesOfCook, type RecipeRow } from "../recipes/reads.js";
import { deleteRecipeUnlessLocked } from "../recipes/writes.js";
import { recipeWrites } from "../recipes/switch.js";
import * as recordings from "../recordings/data.js";
import type { JobRow } from "./data.js";
import { CANCELLED } from "./service.js";

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
 * A recipe with what can't outlive it. Questions never cascade, because a voice note must not be lost track of, so they go here too: a recipe the worker published a moment
 * ago has had nothing else look at it. Same for a dinner around it, called off here because its foreign key only nulls the recipe. Cooking rows and swaps cascade. A message
 * and a job keep their rows with the recipe's id nulled, by their foreign keys.
 */
async function deleteRecipe(c: Queryable, personId: string, recipeId: string): Promise<void> {
  const { rows } = await c.query(`select id, answer_audio_key from questions where recipe_id = $1`, [recipeId]);
  await markPurged(c, personId, rows.map((row) => row.answer_audio_key), "private", "voice");
  await c.query(`delete from questions where recipe_id = $1`, [recipeId]);
  await c.query(`update dinners set status = 'cancelled' where recipe_id = $1 and status <> 'cancelled'`, [recipeId]);
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
  await dropRecipes(c, familyId, personId, PURGE_BATCH); // the rest, past one transaction's worth, go in the batches
}

async function dropRecipes(c: Queryable, familyId: string, personId: string, max: number): Promise<number> {
  const rows = await recipesOfCook(c, personId, max);
  for (const r of rows) {
    await note(c, familyId, personId, recipeFiles(r));
    if (r.media_prefix) await markPurgedIfKnown(c, personId, [r.recipe_json_key, r.cover_key]);
    await deleteRecipe(c, personId, r.id);
  }
  return rows.length;
}

/**
 * Then in batches, each its own transaction, safe to run again: everything else, and any recipe the worker published a moment after the deletion. Their files are marked for
 * the sweep; what's outside it is on account_deletions. Says how many rows it changed.
 */
export async function purgeJobsForPerson(personId: string, run: PurgeRun = ON_ITS_OWN): Promise<number> {
  const familyId = await deletedPersonFamily(db(), personId);
  if (!familyId) throw new Error("this person hasn't deleted their account");

  let changed = 0;
  const batches = async (step: string, work: (c: PoolClient, max: number) => Promise<number>) => {
    changed += await inBatches(run, step, work);
  };

  await batches("recipes", async (c, max) => ((await recipeWrites(c)) === "locked" ? 0 : dropRecipes(c, familyId, personId, max)));

  await batches("cooking as the kid", (c, max) => recordings.deleteCookingOfKid(c, personId, max));
  await batches("cooking as the cook", (c, max) => recordings.forgetCookOnCooking(c, personId, max));
  for (const table of ["homie_prompts", "live_events", "live_windows"] as const) {
    await batches(table, (c, max) => recordings.deleteSavedWithRecordings(c, table, personId, max));
  }

  // Each recording after everything saved with it.
  await batches("recordings", async (c, max) => {
    const rows = await recordings.recordingsOf(c, personId, max);
    for (const r of rows) {
      await markPurged(c, personId, [await recordings.deleteFrame(c, r.id)], "private", "frame");
      await markPurged(c, personId, [r.cover_key], "private", "cover");
      await markPurged(c, personId, [r.video_key], "media", "video");
      // The plate photo too: either can live outside the ledger.
      const outside = [r.video_key, r.cover_key].filter((k): k is string => !!k);
      if (outside.length) await note(c, familyId, personId, { mediaKeys: outside });
      await recordings.deleteRecording(c, r.id);
    }
    return rows.length;
  });

  await batches("jobs", async (c, max) => {
    const { rows } = await c.query<Pick<JobRow, "id" | "upload_key" | "upload_id">>(`select id, upload_key, upload_id from jobs where cook_id = $1 limit $2`, [personId, max]);
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
  });

  // A pending send they made goes, with its hello; one to them loses them from its list.
  await batches("pending sends from them", async (c, max) => {
    const { rows } = await c.query(`select upload_id, hello_key from pending_sends where sender_id = $1 limit $2`, [personId, max]);
    await markPurged(c, personId, rows.map((row) => row.hello_key), "private", "voice");
    await c.query(`delete from pending_sends where upload_id = any($1::text[])`, [rows.map((row) => row.upload_id)]);
    return rows.length;
  });
  await batches("pending sends to them", async (c, max) => {
    const { rowCount } = await c.query(
      `update pending_sends set recipient_ids = array_remove(recipient_ids, $1)
        where upload_id in (select upload_id from pending_sends where family_id = $2 and $1 = any(recipient_ids) limit $3)`,
      [personId, familyId, max],
    );
    return rowCount ?? 0;
  });

  // A kid's face on someone else's filming goes too, or it shows as "Deleted".
  for (const table of ["recordings", "jobs"] as const) {
    await batches(`${table} for them`, async (c, max) => {
      const { rowCount } = await c.query(
        `update ${table} set for_kid_ids = array_remove(for_kid_ids, $1) where id in (select id from ${table} where family_id = $2 and $1 = any(for_kid_ids) limit $3)`,
        [personId, familyId, max],
      );
      return rowCount ?? 0;
    });
  }

  // Whatever else of theirs is still in the ledger: an upload nothing took, a plate photo.
  await batches("files", async (c, max) => {
    const { rowCount } = await c.query(
      `update files set delete_requested_at = now()
        where key in (select key from files where owner_person_id = $1 and delete_requested_at is null and deleted_at is null limit $2)`,
      [personId, max],
    );
    return rowCount ?? 0;
  });
  await db().query(`delete from idempotency_keys where scope = $1`, [personId]);
  return changed;
}
