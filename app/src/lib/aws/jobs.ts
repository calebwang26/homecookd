// Jobs and recipes for 1.1: a cook's video uploads, the job that turns them into a recipe, stopping it, and
// reading recipes. Contract: docs/build/contracts/JOBS.md on aws-migration. Screens move onto these behind
// AWS_ON (config.ts); nothing calls them while it's off.
//
// A processing video is its cook's alone (Caleb, Nov 1): the api answers jobs, uploads and unfinished recipes
// only to the cook who filmed them, so no list here is family-wide. Every write is safe to repeat as sent.
// The bytes go straight to S3 on the links these return (the upload engine, not this file).

import { request } from './client';

export type JobStage = 'uploading' | 'queued' | 'preparing' | 'understanding' | 'writing' | 'indexing' | 'done' | 'failed';

/** What a video goes up as: one PUT, or (over 5 GiB in production) numbered parts. */
export type UploadLink =
  | { index: number; method: 'PUT'; url: string; headers: Record<string, string>; expiresInS: number }
  | { index: number; method: 'PARTS'; partBytes: number; partCount: number };

export type VideoSpec = { contentType: string; size: number; durationS?: number };

export type NewUpload = { uploadId: string; uploadPath: string; uploads: UploadLink[]; expiresInS: number | null };

export type PartLink = { partNumber: number; method: 'PUT'; url: string; headers: Record<string, string>; expiresInS: number };

/** Each entry of /v1/live/jobs's data, and the first fields of a Job: the app's LiveJob, unchanged. */
export type LiveJob = {
  _id: string;
  _creationTime?: number;
  uploadPath: string;
  source: 'phone' | 'glasses';
  stage: JobStage;
  progress: number;
  error?: string;
  recipeId?: string;
  title?: string;
};

export type Job = LiveJob & {
  familyId?: string;
  cookId?: string;
  language?: string;
  forKidIds?: string[];
  updatedAt?: number;
  uploadFinishedAt?: number;
  finishedAt?: number;
  /** She stopped it: then `stage` is `failed` and `error` "Cancelled.". */
  cancelledAt?: number;
};

export type Recipe = {
  _id: string;
  _creationTime: number;
  familyId: string;
  cookId: string;
  cookName?: string;
  title: string;
  status: 'processing' | 'ready' | 'failed';
  libraryId?: string;
  /** The whole recipe, public on the media CDN; missing until `ready`. */
  recipeJsonUrl?: string;
  coverUrl?: string;
  steps?: { order: number; title: string; text: string; quote?: string; quoteOriginal?: string }[];
  stepCount?: number;
  memoriesOptIn?: boolean;
  language?: string;
  /** On the Community map since. */
  sharedAt?: number;
  /** The team took it off the map after a report (sharedAt is cleared; sharing again is 409 taken_down). */
  hiddenAt?: number;
};

export type Complete = { complete: boolean; missing: number[]; cancelled: boolean; job: { jobId: string; stage: JobStage } | null };

const enc = encodeURIComponent;
const up = (uploadId: string, rest: string) => `/v1/video-uploads/${enc(uploadId)}${rest}`;

export const jobs = {
  /** Links for one upload (1 to 20 videos, in the order the worker reads them). One Idempotency-Key per upload, saved before the call. */
  newUpload: (videos: VideoSpec[], idempotencyKey: string, as?: string | null) =>
    request<NewUpload>('/v1/video-uploads', { auth: 'session', as, body: { videos }, idempotencyKey }),
  /** Fresh links for the videos not in yet (a PUT answered 403: its link ran out). */
  links: (uploadId: string, as?: string | null) =>
    request<Omit<NewUpload, 'uploadPath'>>(up(uploadId, '/links'), { auth: 'session', as, body: {} }),
  /** Links for some parts of a PARTS video, at most 100 numbers a call. */
  parts: (uploadId: string, index: number, partNumbers: number[], as?: string | null) =>
    request<{ uploadId: string; index: number; parts: PartLink[] }>(up(uploadId, '/parts'), { auth: 'session', as, body: { index, partNumbers } }),
  /** Join a PARTS video once every part has its ETag (exactly as S3 sent it, quotes included). */
  finishParts: (uploadId: string, index: number, parts: { partNumber: number; etag: string }[], as?: string | null) =>
    request<{ finished: boolean }>(up(uploadId, '/parts/finish'), { auth: 'session', as, body: { index, parts } }),
  /** Is it all in? `missing` lists the videos S3 doesn't have yet; once all are in, the job is queued. */
  complete: (uploadId: string, as?: string | null) => request<Complete>(up(uploadId, '/complete'), { auth: 'session', as, body: {} }),
  /** Stop by upload, before POST /v1/jobs has answered. Never a 404. */
  cancelUpload: (uploadId: string, as?: string | null) =>
    request<{ stopped: boolean }>(up(uploadId, '/cancel'), { auth: 'session', as, body: {} }),
  /** The job, made straight after the links (before the bytes land). The same uploadId answers the same job. */
  create: (input: { uploadId: string; title?: string; language?: string; forKidIds?: string[]; dishAskId?: string; filmedInApp?: boolean }, as?: string | null) =>
    request<{ jobId: string; recipeId: string | null }>('/v1/jobs', { auth: 'session', as, body: { ...input, source: 'phone' } }),
  list: (cursor?: string | null, as?: string | null) =>
    request<{ jobs: Job[]; nextCursor: string | null }>(`/v1/jobs${cursor ? `?cursor=${enc(cursor)}` : ''}`, { auth: 'session', as }),
  get: (jobId: string) => request<Job>(`/v1/jobs/${enc(jobId)}`, { auth: 'session' }),
  /** `stopped: false` once it's done or failed. Not hers: 404. */
  cancel: (jobId: string, as?: string | null) =>
    request<{ stopped: boolean }>(`/v1/jobs/${enc(jobId)}/cancel`, { auth: 'session', as, body: {} }),
};

export const recipes = {
  /** One page (100): the family's ready recipes and her own of any status, newest first. */
  page: (cursor?: string | null, as?: string | null) =>
    request<{ recipes: Recipe[]; nextCursor: string | null }>(`/v1/recipes${cursor ? `?cursor=${enc(cursor)}` : ''}`, { auth: 'session', as }),
  /** Every page. Families have tens of recipes, so this stops after `maxPages` as a guard. */
  async all(maxPages = 20, as?: string | null): Promise<Recipe[]> {
    const out: Recipe[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const page: { recipes: Recipe[]; nextCursor: string | null } = await recipes.page(cursor, as);
      out.push(...page.recipes);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  },
  get: (id: string) => request<Recipe>(`/v1/recipes/${enc(id)}`, { auth: 'session' }),
  memoriesOptIn: (id: string, optIn: boolean) =>
    request<{ ok: true }>(`/v1/recipes/${enc(id)}/memories-opt-in`, { auth: 'session', body: { optIn } }),
  /** Takes her recipe off the Community map (the cook only). Already off: ok, nothing changes. Her story card is kept. */
  unshare: (id: string, as?: string | null) => request<{ ok: true }>(`/v1/recipes/${enc(id)}/unshare`, { auth: 'session', as, body: {} }),
};

/** Before asking for links (JOBS.md flow 6): 1 to 20 videos, each a video/* of 1 byte to 20 GiB, 4 hours in all. */
export const LIMITS = { videos: 20, bytes: 21_474_836_480, totalS: 14_400 } as const;

export type VideoProblem = 'count' | 'type' | 'size' | 'length';

export function checkVideos(videos: VideoSpec[]): VideoProblem | null {
  if (videos.length < 1 || videos.length > LIMITS.videos) return 'count';
  if (videos.some((v) => !/^video\/[\w.+-]+$/i.test(v.contentType))) return 'type';
  if (videos.some((v) => !Number.isInteger(v.size) || v.size < 1 || v.size > LIMITS.bytes)) return 'size';
  const total = videos.reduce((s, v) => s + (v.durationS ?? 0), 0);
  return total > LIMITS.totalS ? 'length' : null;
}

/** Part n (from 1) of a PARTS video: its byte range [start, end). Every part is partBytes long but the last. */
export function partRange(size: number, partBytes: number, n: number): { start: number; end: number } {
  const start = (n - 1) * partBytes;
  return { start, end: Math.min(n * partBytes, size) };
}

/** A finished or failed job: nothing more will change. */
export const isOver = (j: Pick<LiveJob, 'stage'>) => j.stage === 'done' || j.stage === 'failed';
