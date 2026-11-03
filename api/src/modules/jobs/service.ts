// The rules for a video job (convex/jobs.ts). The worker runs it (pipeline/queue_worker.py) and the cook's phone watches. A job waits as `uploading` until its files are
// all in, and only then becomes `queued` with its queue message: uploads.ts and queueJob in data.ts.
import { requireCook, type Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { invalid, notFound } from "../../errors.js";
import { afterCursor, pageOf } from "../../paging.js";
import { isRequestOf } from "../dish/links.js";
import { areFamilyKids, forKids, languageOf } from "../people/reads.js";
import { notMoved, recipeWrites } from "../recipes/switch.js";
import { failRecipeIfOpen, insertProcessingRecipe } from "../recipes/writes.js";
import { lockOwnRecording, noteRecordingJob } from "../recordings/data.js";
import * as data from "./data.js";
import type { JobRow } from "./data.js";
import { allIn, finishedAt, limited, RATE } from "./uploads.js";

export const CANCELLED = "Cancelled."; // convex/jobs.ts; pipeline/queue_worker.py MSG_CANCELLED
export const NO_UPLOAD = "We couldn't find the video for this recipe. Please try adding it again."; // pipeline/queue_worker.py MSG_NO_UPLOAD
const UPLOAD_FIRST = "Upload the video before sending it.";
const PAGE = 20; // jobs.forFamily's .take(20)
const UPLOAD_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

const ms = (at: Date | null) => at?.getTime() ?? undefined;

// The live poll's part, as the live-updates draft wrote it (docs/build/LIVE-UPDATES.md). Its route reads `liveJobs`.
const FINISHED = new Set(["done", "failed"]);
/** A job untouched for this long has lost its phone or worker, so it stops holding every phone at the fast rate. */
const STALE_MS = 2 * 3_600_000;

export type LiveJob = {
  _id: string;
  _creationTime: number;
  uploadPath: string;
  source: "phone" | "glasses";
  stage: string;
  progress: number;
  error?: string;
  recipeId?: string;
  title?: string;
};

export function toLiveJob(row: JobRow): LiveJob {
  // The cook's stop is final from the moment she asks, even before a worker has acknowledged it.
  const stopped = row.cancelled_at !== null && !FINISHED.has(row.stage);
  return {
    _id: row.id,
    _creationTime: row.created_at.getTime(),
    uploadPath: row.upload_key,
    source: row.source,
    stage: stopped ? "failed" : row.stage,
    progress: stopped ? 0 : row.progress,
    ...(stopped ? { error: row.error ?? CANCELLED } : row.error === null ? {} : { error: row.error }),
    ...(row.recipe_id === null ? {} : { recipeId: row.recipe_id }),
    ...(row.title === null ? {} : { title: row.title }),
  };
}

/** Her newest 20. `active` says something here may still move, so a phone should look again soon. */
export async function liveJobs(signed: Signed, now = Date.now()): Promise<{ data: LiveJob[]; active: boolean }> {
  const rows = await data.recentJobs(signed.familyId, signed.personId, PAGE);
  const jobs = rows.map(toLiveJob);
  const active = rows.some((row, i) => !FINISHED.has(jobs[i].stage) && now - row.updated_at.getTime() < STALE_MS);
  return { data: jobs, active };
}

/** The app's LiveJob, plus Convex's other fields and the two times the 30-minute target needs. */
export const jobView = (j: JobRow) => ({
  ...toLiveJob(j),
  familyId: j.family_id,
  cookId: j.cook_id,
  recordingId: j.recording_id ?? undefined,
  language: j.language ?? undefined,
  forKidId: j.for_kid_ids.length === 1 ? j.for_kid_ids[0] : undefined,
  forKidIds: j.for_kid_ids.length ? j.for_kid_ids : undefined,
  claimedAt: ms(j.claimed_at),
  videoGaps: j.video_gaps ?? undefined,
  updatedAt: j.updated_at.getTime(),
  uploadFinishedAt: ms(j.upload_finished_at),
  finishedAt: ms(j.finished_at),
  cancelledAt: ms(j.cancelled_at),
});

export type JobInput = {
  uploadId: string;
  source: "phone" | "glasses";
  title?: string;
  language?: string;
  forKidId?: string;
  forKidIds?: string[];
  recordingId?: string;
  /** The request card this recording answers (V2-LINKING.md §1.4), for its "filmed" push. */
  dishAskId?: string;
};

/**
 * Safe to repeat per upload folder: the phone asks again until it hears back, and a second call gets the job the first one made, never a second recipe. A stopped
 * one stays stopped. An upload belongs to the person who asked for its links, never another family's videos: a worker reads them, and deletes them when the job is stopped.
 */
export async function createJob(signed: Signed, input: JobInput, requestId?: string): Promise<{ status: number; jobId: string; recipeId: string | null }> {
  requireCook(signed);
  await limited(signed.personId, RATE.jobs);
  const uploadId = input.uploadId.trim();
  if (!UPLOAD_ID.test(uploadId)) throw invalid("uploadId", UPLOAD_FIRST);
  const uploadKey = `${uploadId}/`;

  return await tx(async (c) => {
    const files = await data.lockUpload(c, uploadId);
    const existing = await data.jobForFolder(c, signed.familyId, uploadKey);
    if (existing) return { status: 200, jobId: existing.id, recipeId: existing.recipe_id };

    const mine = files.length > 0 && files.every((f) => f.family_id === signed.familyId && f.owner_person_id === signed.personId && !f.delete_requested_at);
    if (!mine || (await data.folderIsAnotherFamilys(c, signed.familyId, uploadKey))) throw invalid("uploadId", UPLOAD_FIRST);

    const writes = await recipeWrites(c);
    if (writes === "locked") throw notMoved(); // the worker couldn't save its recipe, so it would spend her money for nothing

    const recording = input.recordingId ? await lockOwnRecording(c, input.recordingId, signed.familyId, signed.personId) : null;
    if (input.recordingId && !recording) throw notFound("That recording isn't yours.");

    const title = (input.title?.trim() || recording?.dish?.trim() || "").slice(0, 120) || null;
    const language = await chooseLanguage(c, signed, input, recording?.language);
    // The kids picked on Send, else the ones picked before homie's recording.
    const named = forKids(input);
    const kids = named.length ? named : (recording?.for_kid_ids ?? []);
    if (!(await areFamilyKids(c, signed.familyId, kids))) throw invalid("forKidIds", "That person isn't in your family.");
    // Only a card asked of her, in her family. Any other is left off and the job made all the same: a recording is never refused over a push.
    const dishAskId = input.dishAskId && (await isRequestOf(c, input.dishAskId, signed.personId, signed.familyId)) ? input.dishAskId : null;

    // A "processing" card shows in the library right away; the worker fills it in. With the recipes switch off there's no card, and it makes the row when it publishes.
    const recipeId =
      writes === "open" ? await insertProcessingRecipe(c, { familyId: signed.familyId, cookId: signed.personId, title: title ?? "New recipe", language }) : null;
    const jobId = await data.insertJob(c, {
      familyId: signed.familyId,
      cookId: signed.personId,
      recipeId,
      recordingId: recording?.id ?? null,
      uploadKey,
      source: input.source,
      title,
      language,
      forKidIds: kids,
      dishAskId,
    });
    if (recording) await noteRecordingJob(c, recording.id, jobId);
    await data.attachUpload(c, uploadId);
    if (allIn(files)) await data.queueJob(c, jobId, finishedAt(files), requestId);
    return { status: 201, jobId, recipeId };
  });
}

async function chooseLanguage(c: Queryable, signed: Signed, input: JobInput, recordingLanguage?: string): Promise<string> {
  if (input.language !== undefined) {
    const code = input.language.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) throw invalid("language", "Pick a language from the list.");
    return code;
  }
  return recordingLanguage ?? (await languageOf(c, signed.personId)) ?? "en";
}

export async function listJobs(signed: Signed, cursor?: string) {
  const rows = await data.jobsOfCook(db(), signed.familyId, signed.personId, afterCursor(cursor), PAGE + 1);
  const page = pageOf(rows, PAGE);
  return { jobs: page.rows.map(jobView), nextCursor: page.nextCursor };
}

export async function getJob(signed: Signed, id: string) {
  const job = await data.jobById(db(), id);
  if (!job || job.family_id !== signed.familyId || job.cook_id !== signed.personId) throw notFound();
  return jobView(job);
}

/**
 * One job stopped, with everything that says so, under the upload's locks: a worker mid-way finds it on its next write. The raw video goes, as Convex mode does. A job still
 * uploading has no message for the worker yet, so it gets one here. The sweep deletes the files again once the phone's upload links have run out.
 */
async function stopHeld(c: Queryable, jobId: string, requestId?: string): Promise<boolean> {
  const job = await data.lockJob(c, jobId);
  if (!job) throw notFound();
  const waitingOnUpload = job.stage === "uploading";
  if (!(await data.cancelJobRow(c, jobId, CANCELLED, false))) return false;
  if (job.recipe_id) await failRecipeIfOpen(c, job.recipe_id);
  await data.markUploadForDeletion(c, job.upload_id);
  if (waitingOnUpload) await enqueue(c, { queue: "jobs", payload: { jobId }, requestId });
  return true;
}

async function stop(jobId: string, signed: Signed, requestId?: string): Promise<boolean> {
  return await tx(async (c) => {
    // Files before the job, as everyone else takes them.
    const seen = await data.jobById(c, jobId);
    if (!seen || seen.family_id !== signed.familyId || seen.cook_id !== signed.personId) throw notFound();
    await data.lockUpload(c, seen.upload_id);
    return await stopHeld(c, jobId, requestId);
  });
}

/** The cook stops her own job. False once it's over. Anyone else's job answers the same as one that doesn't exist. */
export async function cancelJob(signed: Signed, id: string, requestId?: string): Promise<boolean> {
  requireCook(signed);
  return await stop(id, signed, requestId);
}

/**
 * The same stop by the upload folder, for a phone that doesn't have the job's id yet. True when one was stopped. No job yet: her files are marked, so a late POST /v1/jobs
 * is refused and the sweep takes them, and the answer is false, as it was on Convex. A folder that isn't hers changes nothing and reads the same.
 */
export async function cancelUpload(signed: Signed, uploadId: string, requestId?: string): Promise<boolean> {
  requireCook(signed);
  const id = uploadId.trim();
  if (!UPLOAD_ID.test(id)) return false;
  // All under the files' locks, which createJob holds until it commits: a job being made as she stops is seen here, and stopped.
  return await tx(async (c) => {
    const files = await data.lockUpload(c, id);
    const jobs = await data.jobsOfFolder(c, signed.familyId, signed.personId, id);
    let stopped = false;
    for (const job of jobs) {
      if (await stopHeld(c, job.id, requestId)) stopped = true;
    }
    const hers = files.length > 0 && files.every((f) => f.family_id === signed.familyId && f.owner_person_id === signed.personId);
    // Only with no job: a finished job's raw video stays (SYSTEM-DESIGN.md, "Keep the raw input").
    if (hers && jobs.length === 0) await data.markUploadForDeletion(c, id);
    return stopped;
  });
}
