// The jobs area's work on the `scheduled` queue. Each can arrive twice. A task that throws leaves its message on the queue, and after 3 tries it goes to the dead-letter
// queue, which alarms. Logs get ids and counts, never a title.
import * as Sentry from "@sentry/node";
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { afterOf, type After } from "../../paging.js";
import { storeFor, VIDEO_LINK_S } from "../../storage.js";
import type { Trace } from "../dish/budget.js";
import { failRecipeIfOpen } from "../recipes/writes.js";
import * as data from "./data.js";
import { NO_UPLOAD } from "./service.js";
import { landed, settleUpload } from "./uploads.js";

type Payload = Record<string, unknown>;

/** How long a phone has to finish an upload, as the signer's links gave. */
export const UPLOAD_DAYS = 7;
const GRACE_S = VIDEO_LINK_S + 3600; // a link still in a phone's hands could put a file back
const KEEP_DELETED_DAYS = 7;
export const SWEEP = { ms: 60_000, batch: 50 };
/** Longer than a budget pause, which waits for the next UTC day. */
const STUCK_QUEUED_HOURS = 26;

/** Files first, as everyone takes them. What landed stays: footage is irreplaceable, and the sweep's alarm asks a person. */
async function failOverdue(job: data.JobRow): Promise<void> {
  await tx(async (c) => {
    await data.lockUpload(c, job.upload_id);
    if (!(await data.failUploadingJob(c, job.id, NO_UPLOAD))) return;
    if (job.recipe_id) await failRecipeIfOpen(c, job.recipe_id);
    await data.markUnlandedForDeletion(c, job.upload_id);
  });
}

/** The phone's last word on this job: its start, a new link, or a clip landing. A phone mid-upload on day 6.9 isn't overdue. */
const lastWord = (job: data.JobRow, files: data.UploadFile[]) =>
  Math.max(job.created_at.getTime(), ...files.flatMap((f) => [f.last_link_at?.getTime() ?? 0, f.uploaded_at?.getTime() ?? 0]));

/** S3 is asked first: a phone can land everything and die before saying so. Then it's only marked if nothing landed and still no job holds it. */
async function expireIfNothingLanded(uploadId: string): Promise<void> {
  const arrived = await landed(await data.uploadFiles(db(), uploadId));
  await tx(async (c) => {
    for (const a of arrived) await data.markUploaded(c, a.key, a.at);
    const files = await data.lockUpload(c, uploadId);
    if (files.length && files.every((f) => !f.uploaded_at && !f.attached_at)) await data.markUploadForDeletion(c, uploadId);
  });
}

/** Someone should look. One Sentry issue however many sweeps see it, with counts and never a name. */
function notice(message: string, count: number, trace: Trace): void {
  if (count === 0) return;
  trace.log.error({ count }, message);
  Sentry.captureMessage(message, { level: "warning", extra: { count } });
}

/**
 * Every few minutes. A job waits on its upload here if the phone never got to say it finished (the app was closed, the battery died), which the old worker's 30-second
 * re-queue used to catch; a job whose upload never comes fails visibly after 7 days. Then what's marked leaves S3. One message works for up to a minute, then queues itself.
 * A failed S3 call fails the message, so it's tried again and someone hears.
 */
export async function sweepUploads(trace: Trace, after: After | null = null): Promise<void> {
  const started = Date.now();
  const inTime = () => Date.now() - started < SWEEP.ms;
  let failures = 0;
  let more = false;

  // A full batch carries on from its last job on a new message, so a pile of slow uploads can't keep the sweep from the rest.
  let reached: After | null = null;
  const waiting = await data.jobsWaitingOnUpload(db(), after, SWEEP.batch);
  for (const job of waiting) {
    if (!inTime()) break;
    try {
      const files = await data.uploadFiles(db(), job.upload_id);
      const settled = await settleUpload(job.upload_id, job.family_id, trace.requestId, files);
      // No job found by its key: a row copied from Convex with no ledger behind it. It can only ever run out of time.
      const stillWaiting = settled.job === null || settled.job.stage === "uploading";
      if (stillWaiting && lastWord(job, await data.uploadFiles(db(), job.upload_id)) < Date.now() - UPLOAD_DAYS * 86_400_000) await failOverdue(job);
    } catch (error) {
      failures += 1;
      trace.log.error({ jobId: job.id, err: { type: (error as Error).name } }, "checking an upload failed");
    }
    reached = { at: job.cursor_at, id: job.id };
  }
  const carryOn = waiting.length === SWEEP.batch && reached;

  const nothingTook = await data.uploadsNothingTook(UPLOAD_DAYS, SWEEP.batch);
  for (const uploadId of nothingTook) {
    if (!inTime()) break;
    try {
      await expireIfNothingLanded(uploadId);
    } catch (error) {
      failures += 1;
      trace.log.error({ err: { type: (error as Error).name } }, "checking an upload nothing took failed");
    }
  }
  if (nothingTook.length === SWEEP.batch) more = true;

  notice("Landed videos are waiting on a person", await data.landedWaitingOnAPerson(UPLOAD_DAYS, NO_UPLOAD), trace);
  notice("Jobs are stuck queued with no message", await data.jobsStuckQueued(STUCK_QUEUED_HOURS), trace);
  let openCards = 0;
  for (const recipeId of await data.endedJobsWithOpenCards(SWEEP.batch)) {
    if (!(await tx((c) => failRecipeIfOpen(c, recipeId)))) openCards += 1;
  }
  notice("Ended jobs have cards still saying processing, and recipe writes are off", openCards, trace);

  while (inTime()) {
    const files = await data.filesToDelete(GRACE_S, SWEEP.batch);
    let removed = 0;
    for (const file of files) {
      try {
        await storeFor(file.bucket).remove(file.key);
        await data.markFileDeleted(file.key);
        removed += 1;
      } catch (error) {
        failures += 1;
        trace.log.error({ err: { type: (error as Error).name } }, "an S3 delete failed");
      }
    }
    if (files.length < SWEEP.batch || removed === 0) break; // done, or S3 is down and going on would only repeat it
    if (!inTime()) more = true;
  }
  await data.dropDeletedFileRows(KEEP_DELETED_DAYS);

  if ((more || carryOn) && failures === 0) {
    const place: Record<string, string> = carryOn && reached ? { afterAt: reached.at, afterId: reached.id } : {};
    await enqueue(db(), { queue: "scheduled", payload: { task: "jobs.sweep", ...place }, requestId: trace.requestId });
  }
  if (failures > 0) throw new Error(`${failures} upload or S3 calls failed`);
}

/**
 * The worker's follow-on message when a recipe goes live ({kind: 'recipe_published', jobId, recipeId}, pipeline/queue_db.py finish). Nothing more is owed here yet, so it
 * only has to be understood: without this it would fail three times and alarm. What Convex did at this moment (Moss, a follow-up's translation, delivering a pending send,
 * the push) waits for the areas that own it: JOBS-MIGRATION.md, "Deferred". Each must be safe to repeat when it's added here.
 */
async function recipePublished(payload: Payload, trace: Trace): Promise<void> {
  const { jobId, recipeId } = payload;
  if (typeof jobId !== "string" || typeof recipeId !== "string") throw new Error("a recipe_published message is missing its ids");
  trace.log.info?.({ jobId, recipeId }, "recipe published");
}

export const jobTasks: Record<string, (payload: Payload, trace: Trace) => Promise<void>> = {
  "jobs.sweep": (payload, trace) =>
    sweepUploads(trace, typeof payload.afterAt === "string" && typeof payload.afterId === "string" ? afterOf(payload.afterAt, payload.afterId) : null),
  recipe_published: recipePublished,
};
