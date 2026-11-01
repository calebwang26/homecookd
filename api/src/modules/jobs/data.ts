// The SQL for jobs and their uploads. Every query, and the index behind it:
//
//   Query                                    Index                        Limit
//   a family's jobs, newest                  jobs_family_recent           a page, 20
//   one job, any write to one                jobs primary key             1
//   a phone's retry of a job                 jobs_idempotency_unique      1
//   is this folder another family's?         jobs_upload_key              20
//   stop by upload folder                    jobs_family_upload           20
//   jobs waiting on their upload             jobs_unfinished              the sweep's batch
//   a person's jobs (the purge)              jobs_cook                    the purge's batch
//   an upload's files                        files_upload                 at most MAX_VIDEOS
//   a person's files (the purge)             files_owner                  the purge's batch
//   an upload nothing took                   files_orphans                the sweep's batch
//   files to delete from S3                  files_to_delete              the sweep's batch
//   a phone's retry of asking for links      idempotency_keys primary key 1
//
// `jobs.stage` is written here only for 'uploading' to 'queued', and to 'failed' by a stop. Every other stage is the worker's (pipeline/queue_db.py).
import { db, type Queryable } from "../../db.js";
import { enqueue } from "../../outbox.js";
import type { After } from "../../paging.js";

export type JobRow = {
  id: string;
  family_id: string;
  cook_id: string;
  recipe_id: string | null;
  recording_id: string | null;
  upload_key: string;
  upload_id: string;
  source: "phone" | "glasses";
  title: string | null;
  language: string | null;
  for_kid_ids: string[];
  stage: "uploading" | "queued" | "preparing" | "understanding" | "writing" | "indexing" | "done" | "failed";
  progress: number;
  error: string | null;
  video_gaps: unknown[] | null;
  attempts: number;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  upload_finished_at: Date | null;
  finished_at: Date | null;
  cancelled_at: Date | null;
  cursor_at: string;
};

const JOB = `id, family_id, cook_id, recipe_id, recording_id, upload_key, upload_id, source, title, language, for_kid_ids, stage, progress, error, video_gaps, attempts,
  claimed_at, created_at, updated_at, upload_finished_at, finished_at, cancelled_at, created_at::text as cursor_at`;

export async function familyJobs(q: Queryable, familyId: string, before: After | null, limit: number): Promise<JobRow[]> {
  const { rows } = await q.query(
    `select ${JOB} from jobs
      where family_id = $1 ${before ? "and (created_at, id) < ($3::timestamptz, $4)" : ""}
      order by created_at desc, id desc limit $2`,
    before ? [familyId, limit, before.at, before.id] : [familyId, limit],
  );
  return rows;
}

/** The live poll's read (docs/build/LIVE-UPDATES.md), which needs no cursor. */
export const recentJobs = (familyId: string, limit: number) => familyJobs(db(), familyId, null, limit);

export async function jobById(q: Queryable, id: string): Promise<JobRow | null> {
  const { rows } = await q.query(`select ${JOB} from jobs where id = $1`, [id]);
  return rows[0] ?? null;
}

/** With a lock, so a stop and the worker's final transaction can't both win. */
export async function lockJob(q: Queryable, id: string): Promise<JobRow | null> {
  const { rows } = await q.query(`select ${JOB} from jobs where id = $1 for update`, [id]);
  return rows[0] ?? null;
}

export async function jobForFolder(q: Queryable, familyId: string, uploadKey: string): Promise<JobRow | null> {
  const { rows } = await q.query(`select ${JOB} from jobs where family_id = $1 and idempotency_key = $2`, [familyId, uploadKey]);
  return rows[0] ?? null;
}

/** Rows copied from Convex can name a folder with no file ledger behind it. */
export async function folderIsAnotherFamilys(q: Queryable, familyId: string, uploadKey: string): Promise<boolean> {
  const { rows } = await q.query(`select family_id from jobs where upload_key = $1 order by created_at desc limit 20`, [uploadKey]);
  return rows.some((row) => row.family_id !== familyId);
}

export async function jobsOfFolder(q: Queryable, familyId: string, uploadId: string): Promise<JobRow[]> {
  const { rows } = await q.query(`select ${JOB} from jobs where family_id = $1 and upload_id = $2 order by created_at desc limit 20`, [familyId, uploadId]);
  return rows;
}

export async function insertJob(
  c: Queryable,
  j: {
    familyId: string;
    cookId: string;
    recipeId: string | null;
    recordingId: string | null;
    uploadKey: string;
    source: string;
    title: string | null;
    language: string;
    forKidIds: string[];
  },
): Promise<string> {
  const { rows } = await c.query(
    `insert into jobs (family_id, cook_id, recipe_id, recording_id, upload_key, source, title, language, for_kid_ids, stage, progress, idempotency_key)
     values ($1, $2, $3, $4, $5::text, $6, $7, $8, $9, 'uploading', 0, $5::text)
     returning id`,
    [j.familyId, j.cookId, j.recipeId, j.recordingId, j.uploadKey, j.source, j.title, j.language, j.forKidIds],
  );
  return rows[0].id;
}

/**
 * The one place a job starts to run: `queued` and its message commit together, and only from 'uploading', so a repeat sends nothing. This is what
 * pipeline/queue_worker.py waits for: {outboxId, requestId, payload: {jobId}} on the jobs queue, and its claim takes `queued`.
 */
export async function queueJob(c: Queryable, jobId: string, uploadFinishedAt: Date, requestId?: string): Promise<boolean> {
  const { rowCount } = await c.query(
    `update jobs set stage = 'queued', progress = 0, upload_finished_at = coalesce(upload_finished_at, $2), updated_at = now()
      where id = $1 and stage = 'uploading' and cancelled_at is null`,
    [jobId, uploadFinishedAt],
  );
  if (!rowCount) return false;
  await enqueue(c, { queue: "jobs", payload: { jobId }, requestId });
  return true;
}

/** Stops a job for good. It's over, so `finished_at` is set, and a worker mid-way finds `cancelled_at` on its next write (queue_db.py). */
export async function cancelJobRow(c: Queryable, jobId: string, message: string, keepUpload: boolean): Promise<boolean> {
  const { rowCount } = await c.query(
    `update jobs set stage = 'failed', progress = 0, error = $2, claimed_at = null, cancelled_at = now(), finished_at = now(), updated_at = now(), keep_upload = $3
      where id = $1 and stage not in ('done', 'failed')`,
    [jobId, message, keepUpload],
  );
  return !!rowCount;
}

export async function failUploadingJob(c: Queryable, jobId: string, message: string): Promise<boolean> {
  const { rowCount } = await c.query(
    `update jobs set stage = 'failed', progress = 0, error = $2, finished_at = now(), updated_at = now() where id = $1 and stage = 'uploading'`,
    [jobId, message],
  );
  return !!rowCount;
}

/** Oldest first, from where the last batch stopped. Checking one doesn't touch `updated_at`: that says the job moved, and it would hold every phone at the live poll's fast rate. */
export async function jobsWaitingOnUpload(q: Queryable, after: After | null, limit: number): Promise<JobRow[]> {
  const { rows } = await q.query(
    `select ${JOB} from jobs
      where stage = 'uploading' ${after ? "and (created_at, id) > ($2::timestamptz, $3)" : ""}
      order by created_at, id limit $1`,
    after ? [limit, after.at, after.id] : [limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// An upload's files

export type UploadFile = {
  key: string;
  content_type: string;
  size_bytes: string;
  family_id: string;
  owner_person_id: string;
  uploaded_at: Date | null;
  attached_at: Date | null;
  delete_requested_at: Date | null;
  last_link_at: Date | null;
  multipart_id: string | null;
};

const FILE = `key, content_type, size_bytes, family_id, owner_person_id, uploaded_at, attached_at, delete_requested_at, last_link_at, multipart_id`;

export async function uploadFiles(q: Queryable, uploadId: string): Promise<UploadFile[]> {
  const { rows } = await q.query(`select ${FILE} from files where upload_id = $1 order by key`, [uploadId]);
  return rows;
}

/** Everyone changing an upload takes these first, in one order, so a job being made and the upload finishing can't each miss the other. */
export async function lockUpload(c: Queryable, uploadId: string): Promise<UploadFile[]> {
  const { rows } = await c.query(`select ${FILE} from files where upload_id = $1 order by key for update`, [uploadId]);
  return rows;
}

/** The first one saved stays, and it's the one returned. */
export async function saveMultipartId(q: Queryable, key: string, multipartId: string): Promise<string> {
  const { rows } = await q.query(`update files set multipart_id = coalesce(multipart_id, $2) where key = $1 returning multipart_id`, [key, multipartId]);
  return rows[0].multipart_id;
}

export async function insertUploadFile(
  c: Queryable,
  f: { key: string; uploadId: string; contentType: string; size: number; familyId: string; personId: string },
): Promise<void> {
  await c.query(
    `insert into files (key, bucket, kind, content_type, size_bytes, family_id, owner_person_id, upload_id)
     values ($1, 'uploads', 'video', $2, $3, $4, $5, $6)`,
    [f.key, f.contentType, f.size, f.familyId, f.personId, f.uploadId],
  );
}

export async function markUploaded(c: Queryable, key: string, at: Date): Promise<void> {
  await c.query(`update files set uploaded_at = coalesce(uploaded_at, $2) where key = $1 and delete_requested_at is null`, [key, at]);
}

export async function attachUpload(c: Queryable, uploadId: string): Promise<void> {
  await c.query(`update files set attached_at = coalesce(attached_at, now()) where upload_id = $1`, [uploadId]);
}

/** A job that ran out of time: what never arrived expires, and what did stays. Footage is irreplaceable, so a person decides. */
export async function markUnlandedForDeletion(c: Queryable, uploadId: string): Promise<void> {
  await c.query(`update files set delete_requested_at = coalesce(delete_requested_at, now()) where upload_id = $1 and uploaded_at is null and deleted_at is null`, [uploadId]);
}

export async function noteLinks(q: Queryable, uploadId: string): Promise<void> {
  await q.query(`update files set last_link_at = now() where upload_id = $1`, [uploadId]);
}

export async function markUploadForDeletion(c: Queryable, uploadId: string): Promise<void> {
  await c.query(`update files set delete_requested_at = coalesce(delete_requested_at, now()) where upload_id = $1 and deleted_at is null`, [uploadId]);
}

/** A retry of asking for links: true when this call is the first. Waits on another call with the same key, so two at once make one upload. */
export async function claimUploadKey(c: Queryable, personId: string, key: string, route: string, requestHash: string, uploadId: string): Promise<boolean> {
  const { rowCount } = await c.query(
    `insert into idempotency_keys (scope, key, route, request_hash, resource_id, status_code) values ($1, $2, $3, $4, $5, 201) on conflict (scope, key) do nothing`,
    [personId, key, route, requestHash, uploadId],
  );
  return !!rowCount;
}

export async function readUploadKey(c: Queryable, personId: string, key: string): Promise<{ route: string; request_hash: string; resource_id: string } | null> {
  const { rows } = await c.query(`select route, request_hash, resource_id from idempotency_keys where scope = $1 and key = $2`, [personId, key]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// The sweep. `dish.sweep` keeps the anonymous private uploads, and this takes every other file the purge can mark in the two buckets the api can reach.

const REACHES = `bucket in ('uploads', 'private') and capability_hash is null`;

/**
 * Uploads no job took, with nothing landed and no phone asking for a link in this long. These may still have a file in S3 that nobody reported, so the sweep asks S3 before
 * it marks anything. An upload with a landed clip is never here: that's footage, and it waits for a person.
 */
export async function uploadsNothingTook(olderThanDays: number, limit: number): Promise<string[]> {
  const { rows } = await db().query(
    `select distinct upload_id, min(created_at) from files f
      where upload_id is not null and attached_at is null and delete_requested_at is null and deleted_at is null and uploaded_at is null
        and coalesce(last_link_at, created_at) < now() - make_interval(days => $1)
        and not exists (select 1 from files o where o.upload_id = f.upload_id and o.uploaded_at is not null)
      group by upload_id order by 2 limit $2`,
    [olderThanDays, limit],
  );
  return rows.map((r) => r.upload_id);
}

/** Landed footage nothing will ever use without a person: no job took it, or its job ran out of time or was stopped by someone else. */
export async function landedWaitingOnAPerson(olderThanDays: number, overdueMessage: string): Promise<number> {
  const { rows } = await db().query(
    `select count(*)::int as n from (
       select 1 from files f
        where f.upload_id is not null and f.uploaded_at is not null and f.delete_requested_at is null and f.deleted_at is null
          and coalesce(f.last_link_at, f.created_at) < now() - make_interval(days => $1)
          and (f.attached_at is null
               or exists (select 1 from jobs j where j.upload_id = f.upload_id and j.family_id = f.family_id and j.stage = 'failed' and (j.keep_upload or j.error = $2)))
        limit 1000) waiting`,
    [olderThanDays, overdueMessage],
  );
  return rows[0].n;
}

/** Queued with no change in this long: longer than a budget pause, so its message is gone. A worker stopping on a job's last receive leaves one like this. */
export async function jobsStuckQueued(olderThanHours: number): Promise<number> {
  const { rows } = await db().query(
    `select count(*)::int as n from (select 1 from jobs where stage = 'queued' and updated_at < now() - make_interval(hours => $1) limit 1000) stuck`,
    [olderThanHours],
  );
  return rows[0].n;
}

/** A job that's over with a card that still says "processing": recipe writes were off when it ended. */
export async function endedJobsWithOpenCards(limit: number): Promise<string[]> {
  const { rows } = await db().query(
    `select r.id from recipes r join jobs j on j.recipe_id = r.id where r.status = 'processing' and j.stage = 'failed' order by r.created_at limit $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/** Marked at least `graceS` ago: an upload link still in a phone's hands could put a file back until it expires. */
export async function filesToDelete(graceS: number, limit: number): Promise<{ key: string; bucket: "uploads" | "private" }[]> {
  const { rows } = await db().query(
    `select key, bucket from files
      where ${REACHES} and delete_requested_at is not null and deleted_at is null and delete_requested_at < now() - make_interval(secs => $1)
      order by delete_requested_at limit $2`,
    [graceS, limit],
  );
  return rows;
}

export async function markFileDeleted(key: string): Promise<void> {
  await db().query(`update files set deleted_at = coalesce(deleted_at, now()) where key = $1`, [key]);
}

export async function dropDeletedFileRows(olderThanDays: number, limit = 500): Promise<number> {
  const { rowCount } = await db().query(
    `delete from files where key in (select key from files where ${REACHES} and deleted_at < now() - make_interval(days => $1) limit $2)`,
    [olderThanDays, limit],
  );
  return rowCount ?? 0;
}
