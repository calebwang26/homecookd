// A cook's videos going to S3, in place of cloud/signer. The api signs one PUT per video and writes down which files it expects, so only it can say an upload is
// complete: the worker can't tell 2 of 3 clips from all of them (WORKER-MIGRATION.md, open question 1). Bytes never pass through here.
//
//   POST /v1/video-uploads with an Idempotency-Key       the folder and its links
//   POST /v1/video-uploads/:id/links                     new links, when one has run out
//   POST /v1/jobs                                  at any time after the first call (service.ts)
//   POST /v1/video-uploads/:id/complete                  asks S3; when all are in, a job waiting on them is queued. The phone calls it, and a sweep does too, in case it never can
import { createHash, randomUUID } from "node:crypto";
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { ApiError, invalid, notFound, providerDown, refused } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { uploadStore } from "../../storage.js";
import * as data from "./data.js";

const MAX_VIDEOS = 20; // cloud/signer MAX_FILES
const MAX_HOURS = 4; // cloud/signer MAX_HOURS, pipeline/worker.py
/** The signer's limit (Caleb, Nov 1). A 3-hour iPhone recording is about 10 GB. */
export const MAX_VIDEO_BYTES = 20 * 1024 ** 3;
/** A presigned PUT is one S3 request, and S3 takes at most 5 GiB in one. Past that a video goes up in parts: JOBS-MIGRATION.md, decision 1. */
export const ONE_PUT_BYTES = 5 * 1024 ** 3;
/** S3 wants at least 5 MiB and at most 10,000 parts. A dropped part costs this much to send again. */
export const PART_BYTES = 64 * 1024 ** 2;
const PARTS_AT_ONCE = 100;
const CONTENT_TYPE = /^video\/[a-z0-9][a-z0-9.+-]{0,60}$/i;
const EXTENSION: Record<string, string> = { "video/quicktime": ".mov", "video/mp4": ".mp4", "video/x-m4v": ".m4v" };
const ROUTE = "POST /v1/video-uploads";

/** A person's limits. Generous, because a phone retries; they're here to stop a broken loop or a stolen session signing without end. */
export const RATE = {
  uploads: { bucket: "job-upload", max: 30, windowS: 3600 },
  uploadsDay: { bucket: "job-upload-day", max: 100, windowS: 86_400 },
  links: { bucket: "job-links", max: 120, windowS: 3600 },
  complete: { bucket: "job-complete", max: 240, windowS: 3600 },
  jobs: { bucket: "job-create", max: 240, windowS: 3600 },
};

export const limited = (personId: string, ...limits: (typeof RATE)[keyof typeof RATE][]) => hit(subjectKey(personId), limits);

export type VideoAsked = { contentType: string; size: number; durationS?: number };


/** The signer's checks and its sentences. */
function checkVideos(videos: VideoAsked[]): void {
  if (videos.length < 1 || videos.length > MAX_VIDEOS) throw invalid("videos", `Pick 1 to ${MAX_VIDEOS} videos.`);
  let totalS = 0;
  for (const v of videos) {
    if (!CONTENT_TYPE.test(v.contentType)) throw invalid("videos", "Every file must be a video.");
    if (v.size > MAX_VIDEO_BYTES) throw refused(413, "too_large", "That video is too big to send. Try splitting it into shorter videos.");
    if ((v.durationS ?? 0) > 24 * 3600) throw invalid("videos", "A video's length doesn't look right.");
    totalS += v.durationS ?? 0;
  }
  if (totalS > MAX_HOURS * 3600) throw invalid("videos", `That's more than ${MAX_HOURS} hours of video. Please pick fewer videos.`);
}

/** S3 being down isn't the caller's fault, and every call here is safe to repeat. */
async function storage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw Object.assign(providerDown(502, "The upload service is having trouble. Please try again in a minute."), { cause: error });
  }
}

const inParts = (f: data.UploadFile) => Number(f.size_bytes) > ONE_PUT_BYTES;
const partCount = (size: number) => Math.ceil(size / PART_BYTES);
const partSize = (size: number, partNumber: number) => (partNumber < partCount(size) ? PART_BYTES : size - PART_BYTES * (partCount(size) - 1));

type Link =
  | { index: number; method: "PUT"; url: string; headers: Record<string, string>; expiresInS: number }
  | { index: number; method: "PARTS"; partBytes: number; partCount: number };

/** `index` is the file's place in what was asked for, from 1, as the signer's was. A video in parts has no link yet: the phone asks for its parts' links as it needs them. */
const linksFor = (files: data.UploadFile[], only: (f: data.UploadFile) => boolean) =>
  storage(() =>
    Promise.all(
      files.flatMap((f, i): Promise<Link>[] => {
        if (!only(f)) return [];
        const size = Number(f.size_bytes);
        if (inParts(f)) return [Promise.resolve({ index: i + 1, method: "PARTS" as const, partBytes: PART_BYTES, partCount: partCount(size) })];
        return [
          uploadStore()
            .presignPut(f.key, f.content_type, size)
            .then((p) => ({ index: i + 1, url: p.url, method: "PUT" as const, headers: p.headers, expiresInS: p.expiresInS })),
        ];
      }),
    ),
  );

const notIn = (f: data.UploadFile) => !f.uploaded_at;
const linkLife = (uploads: Link[]) => uploads.flatMap((u) => (u.method === "PUT" ? [u.expiresInS] : []))[0] ?? null;
const cancelled = (files: data.UploadFile[]) => files.some((f) => f.delete_requested_at);

/** The folder is random, so a key holds nothing a cook typed (the signer's held a slug of her dish's name). */
export async function requestUpload(signed: Signed, videos: VideoAsked[], idempotencyKey: string): Promise<{ status: number; body: object }> {
  checkVideos(videos);
  await limited(signed.personId, RATE.uploads, RATE.uploadsDay);
  const requestHash = createHash("sha256").update(JSON.stringify(videos.map((v) => [v.contentType.toLowerCase(), v.size]))).digest("hex");
  const { uploadId, first } = await tx(async (c) => {
    const newId = randomUUID();
    if (await data.claimUploadKey(c, signed.personId, idempotencyKey, ROUTE, requestHash, newId)) {
      for (const [i, v] of videos.entries()) {
        const type = v.contentType.toLowerCase();
        const key = `${newId}/${String(i + 1).padStart(2, "0")}${EXTENSION[type] ?? ".mov"}`;
        await data.insertUploadFile(c, { key, uploadId: newId, contentType: type, size: v.size, familyId: signed.familyId, personId: signed.personId });
      }
      return { uploadId: newId, first: true };
    }
    const earlier = await data.readUploadKey(c, signed.personId, idempotencyKey);
    if (!earlier || earlier.route !== ROUTE || earlier.request_hash !== requestHash) throw new ApiError(409, "idempotency_conflict");
    return { uploadId: earlier.resource_id, first: false };
  });
  const files = await data.uploadFiles(db(), uploadId);
  if (files.length === 0 || cancelled(files)) throw notFound();
  const uploads = await linksFor(files, notIn);
  return {
    status: first ? 201 : 200,
    body: { uploadId, uploadPath: `${uploadId}/`, uploads, expiresInS: linkLife(uploads) },
  };
}

/** The caller's own upload, or the one answer for everything else: a guess, another family's, another person's. */
async function ownUpload(q: Queryable, signed: Signed, uploadId: string): Promise<data.UploadFile[]> {
  const files = await data.uploadFiles(q, uploadId);
  if (files.length === 0 || files.some((f) => f.family_id !== signed.familyId || f.owner_person_id !== signed.personId)) throw notFound();
  return files;
}

export async function newLinks(signed: Signed, uploadId: string) {
  await limited(signed.personId, RATE.links);
  const files = await ownUpload(db(), signed, uploadId);
  if (cancelled(files)) throw notFound();
  await data.noteLinks(db(), uploadId); // a phone still at it: the overdue clock starts again
  const uploads = await linksFor(files, notIn);
  return { uploadId, uploads, expiresInS: linkLife(uploads) };
}

const fileInParts = async (signed: Signed, uploadId: string, index: number) => {
  const files = await ownUpload(db(), signed, uploadId);
  if (cancelled(files)) throw notFound();
  const file = files[index - 1];
  if (!file) throw invalid("index", "That isn't one of this upload's videos.");
  if (!inParts(file)) throw invalid("index", "That video goes up in one piece.");
  return file;
};

/** The links for some of a video's parts, starting its upload at S3 the first time. Two phones' tries at once can both start one: the first saved wins, and the other's aborts by the bucket's rule. */
export async function partLinks(signed: Signed, uploadId: string, index: number, partNumbers: number[]) {
  await limited(signed.personId, RATE.links);
  const file = await fileInParts(signed, uploadId, index);
  const size = Number(file.size_bytes);
  if (partNumbers.length === 0 || partNumbers.length > PARTS_AT_ONCE || partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > partCount(size))) {
    throw invalid("partNumbers", `Ask for 1 to ${PARTS_AT_ONCE} parts of this video, numbered from 1 to ${partCount(size)}.`);
  }
  const multipartId = file.multipart_id ?? (await data.saveMultipartId(db(), file.key, await storage(() => uploadStore().startParts(file.key, file.content_type))));
  await data.noteLinks(db(), uploadId); // a phone still at it: the overdue clock starts again
  const parts = await storage(() =>
    Promise.all(
      partNumbers.map((n) => uploadStore().presignPart(file.key, multipartId, n, partSize(size, n)).then((p) => ({ partNumber: n, url: p.url, method: "PUT" as const, headers: p.headers, expiresInS: p.expiresInS }))),
    ),
  );
  return { uploadId, index, parts, expiresInS: parts[0]?.expiresInS ?? null };
}

/** Every part is up: S3 joins them, and the video has landed. Safe to repeat: one that's already whole isn't asked again. The phone then asks /complete, as for any other. */
export async function finishParts(signed: Signed, uploadId: string, index: number, parts: { partNumber: number; etag: string }[]) {
  await limited(signed.personId, RATE.complete);
  const file = await fileInParts(signed, uploadId, index);
  const expected = partCount(Number(file.size_bytes));
  const numbers = parts.map((p) => p.partNumber).sort((a, b) => a - b);
  if (numbers.length !== expected || numbers.some((n, i) => n !== i + 1)) throw invalid("parts", "That isn't every part of this video.");
  if (!file.multipart_id) throw invalid("index", "This video's upload hasn't started.");
  const multipartId = file.multipart_id;
  if ((await landed([file])).length === 0) {
    await storage(() => uploadStore().finishParts(file.key, multipartId, [...parts].sort((a, b) => a.partNumber - b.partNumber)));
  }
  return { finished: (await landed([file])).length > 0 };
}

/** What S3 has now, read before the transaction: an outside call must never hold a database connection. A wrong size can't arrive on a signed link, but it wouldn't count. */
export async function landed(files: data.UploadFile[]): Promise<{ key: string; at: Date }[]> {
  const waiting = files.filter((f) => notIn(f) && !f.delete_requested_at);
  const heads = await storage(() => Promise.all(waiting.map((f) => uploadStore().head(f.key))));
  return waiting.flatMap((f, i) => {
    const head = heads[i];
    return head && head.size === Number(f.size_bytes) ? [{ key: f.key, at: head.modified ?? new Date() }] : [];
  });
}

export type Settled = { complete: boolean; missing: number[]; cancelled: boolean; job: { jobId: string; stage: string } | null };

/** When the last of its files is in: all of them are marked, and a job waiting on them is queued with its message, all in one transaction. Safe to repeat. */
export async function settleUpload(uploadId: string, familyId: string, requestId: string | undefined, files: data.UploadFile[]): Promise<Settled> {
  const arrived = await landed(files);
  return await tx(async (c) => {
    for (const a of arrived) await data.markUploaded(c, a.key, a.at);
    const now = await data.lockUpload(c, uploadId);
    const missing = now.flatMap((f, i) => (f.uploaded_at ? [] : [i + 1]));
    const isCancelled = cancelled(now);
    const complete = now.length > 0 && missing.length === 0 && !isCancelled;
    const job = await data.jobForFolder(c, familyId, `${uploadId}/`);
    let stage = job?.stage ?? null;
    if (complete && job?.stage === "uploading" && (await data.queueJob(c, job.id, finishedAt(now), requestId))) stage = "queued";
    return { complete, missing, cancelled: isCancelled, job: job && stage ? { jobId: job.id, stage } : null };
  });
}

/** S3's time for the last file in: the start of the 30-minute target (SYSTEM-DESIGN.md), however late anyone asks. */
export const finishedAt = (files: data.UploadFile[]) => new Date(Math.max(...files.map((f) => f.uploaded_at?.getTime() ?? 0)));

export const allIn = (files: data.UploadFile[]) => files.length > 0 && files.every((f) => f.uploaded_at) && !cancelled(files);

export async function completeUpload(signed: Signed, uploadId: string, requestId?: string): Promise<Settled> {
  await limited(signed.personId, RATE.complete);
  return await settleUpload(uploadId, signed.familyId, requestId, await ownUpload(db(), signed, uploadId));
}
