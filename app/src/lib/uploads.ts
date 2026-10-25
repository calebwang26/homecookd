// Background uploads of cooking videos from the camera roll.
//
// Flow: POST the job to EXPO_PUBLIC_UPLOAD_URL -> get one signed GCS PUT URL per file ->
// start an iOS background URLSession upload per file (expo-file-system `createUploadTask`
// with sessionType 'background') -> persist the job locally right away. The OS keeps the
// transfers going if the app is backgrounded or the phone is locked. The library screen
// polls each job's public status_url until the recipe is published.
import type { ImagePickerAsset } from 'expo-image-picker';
import { File, Paths, UploadTask, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { webGetItem, webSetItem } from './legacyKeys';

import { api, ApiError } from './api';
import { cacheBuster, fetchJson } from './http';
import { convexSession, convexSignedIn } from './live/convex';

// Public signer endpoint (default for store builds without app/.env). The signer lets in a phone with
// a Convex session (it checks the token with Convex). The shared FAMILY_CODE is only for dev builds
// that still set it, and is deliberately not defaulted: baked into a store build, it would put
// everyone in the demo family (session.tsx).
export const UPLOAD_URL = (process.env.EXPO_PUBLIC_UPLOAD_URL || 'https://edible-upload-vyatb2n6oq-uw.a.run.app').trim();
const FAMILY_CODE = (process.env.EXPO_PUBLIC_FAMILY_CODE ?? '').trim();

/** Screens pass the signed-in person's id from useSession() (the module snapshot can lag a render). */
export function uploadsConfigured(profileId?: string | null): boolean {
  return !!UPLOAD_URL && (!!FAMILY_CODE || convexSignedIn(profileId ?? undefined));
}

/** Headers for a signer call: the Convex session when there is one (`as`: that person's, by default whoever is in), the family code when it's set. */
export async function signerHeaders(as?: string): Promise<Record<string, string>> {
  const token = convexSignedIn(as) ? await convexSession(as) : null;
  if (!token && !FAMILY_CODE) throw new Error('Please sign in again.');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(FAMILY_CODE ? { 'X-Edible-Family': FAMILY_CODE } : {}),
  };
}

/** Background uploads need the native file system; the web build can only preview the form. */
export const uploadsSupportedHere = Platform.OS !== 'web';

/** The worker refuses longer recordings (pipeline/worker.py MAX_HOURS); check before uploading GBs. */
export const MAX_RECORDING_HOURS = 4;

// A file whose PUT fails with a network error, 408, 429 or 5xx is retried (the signed URL is valid
// for 7 days). Other 4xx answers won't get better on retry.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000];

export type LocalState = 'uploading' | 'uploaded' | 'failed';

export type StoredJob = {
  job_id: string;
  status_url: string;
  title: string;
  cook_name: string;
  relation: string;
  created_at: string;
  file_count: number;
  local_state: LocalState;
} & JobMeta;

/**
 * Optional extras the Send screen keeps with a job (all optional, so jobs saved by older builds
 * still load): who it is for, the hello voice note, and a local video for the thumbnail.
 */
export type JobMeta = {
  /** The cook's profile id (x-profile-id for POST /pending-sends). */
  sender_id?: string | null;
  recipient_ids?: string[];
  /** For the card's copy: "on its way to Leo" / "to everyone". */
  recipient_label?: string | null;
  hello_path?: string | null;
  hello_duration_s?: number | null;
  /** 'ok' once POST /pending-sends succeeded (retried from the home card until then). */
  pending_send?: 'ok' | 'failed' | null;
  /** Failed POST /pending-sends attempts so far (the home card gives up showing "sending" after a few). */
  pending_send_attempts?: number;
  /** Total length of the picked videos (seconds), for an honest "ready by" line. */
  duration_s?: number | null;
  /** A local video file to draw the card's thumbnail from (may be gone after a relaunch). */
  thumb_video_uri?: string | null;
  /** homie's recording these videos are from (a resend after a crash finds its old rows by it). */
  recording_id?: string | null;
};

export type JobStatus = {
  id: string;
  title: string;
  cook_name: string;
  relation: string;
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  files_expected: number;
  files_received: number;
  recipe_id: string | null;
  message: string | null;
};

type CreateJobResponse = {
  job_id: string;
  status_url: string;
  uploads: { index: number; url: string; method: 'PUT'; headers: Record<string, string> }[];
};

// ---------------------------------------------------------------------------
// Local persistence: Paths.document/jobs.json on native, localStorage on web.

const JOBS_FILE = 'jobs.json';

function jobsFile(): File {
  return new File(Paths.document, JOBS_FILE);
}

export function loadJobs(): StoredJob[] {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = webGetItem('homecookd.jobs');
    } else {
      const f = jobsFile();
      raw = f.exists ? f.textSync() : null;
    }
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredJob[]) : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs: StoredJob[]) {
  const raw = JSON.stringify(jobs, null, 2);
  try {
    if (Platform.OS === 'web') {
      webSetItem('homecookd.jobs', raw);
    } else {
      const f = jobsFile();
      if (!f.exists) f.create({ intermediates: true });
      f.write(raw);
    }
  } catch (e) {
    console.warn('[uploads] could not save jobs.json', e);
  }
  emit();
}

function updateJob(jobId: string, patch: Partial<StoredJob>) {
  saveJobs(loadJobs().map((j) => (j.job_id === jobId ? { ...j, ...patch } : j)));
}

/** Patch a stored job's extras (JobMeta). */
export function updateJobMeta(jobId: string, patch: JobMeta) {
  updateJob(jobId, patch);
}

export function removeJob(jobId: string) {
  saveJobs(loadJobs().filter((j) => j.job_id !== jobId));
  progress.delete(jobId);
  progressStarted.delete(jobId);
}

// ---------------------------------------------------------------------------
// Live progress (only while this JS runtime is alive) + a tiny subscribe API.

type FileProgress = { sent: number; total: number };
const progress = new Map<string, FileProgress[]>();
// When each job's uploads started in this session (for a rough time left).
const progressStarted = new Map<string, number>();
const listeners = new Set<() => void>();
let lastEmit = 0;

function emit(throttle = false) {
  const now = Date.now();
  if (throttle && now - lastEmit < 500) return;
  lastEmit = now;
  for (const l of listeners) l();
}

export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 0..1 if this job's upload tasks are alive in this session, otherwise null. */
export function jobProgress(jobId: string): number | null {
  const files = progress.get(jobId);
  if (!files || files.length === 0) return null;
  const total = files.reduce((a, f) => a + f.total, 0);
  const sent = files.reduce((a, f) => a + f.sent, 0);
  return total > 0 ? Math.min(1, sent / total) : 0;
}

/** Rough ms left for this job's live upload, from its average speed so far; null until that means something. */
export function jobUploadLeftMs(jobId: string, now = Date.now()): number | null {
  const files = progress.get(jobId);
  const started = progressStarted.get(jobId);
  if (!files || files.length === 0 || started === undefined) return null;
  const total = files.reduce((a, f) => a + f.total, 0);
  const sent = files.reduce((a, f) => a + f.sent, 0);
  const elapsed = now - started;
  if (total <= 0 || sent <= 0 || sent >= total || elapsed < 10_000) return null;
  return ((total - sent) / sent) * elapsed;
}

// The native task is cancelled when its JS object is garbage-collected
// (FileSystemUploadTask.sharedObjectWillRelease cancels it), so keep strong references.
const liveTasks = new Set<UploadTask>();
// The same tasks per job, so a cancelled job can stop its own uploads.
const jobTasks = new Map<string, UploadTask[]>();
// Jobs cancelled in this session: their uploads stop quietly (no retry, no 'failed' state).
const cancelledJobs = new Set<string>();

function trackTask(jobId: string, task: UploadTask) {
  liveTasks.add(task);
  jobTasks.set(jobId, [...(jobTasks.get(jobId) ?? []), task]);
}

function untrackTask(jobId: string, task: UploadTask) {
  liveTasks.delete(task);
  const rest = (jobTasks.get(jobId) ?? []).filter((t) => t !== task);
  if (rest.length > 0) jobTasks.set(jobId, rest);
  else jobTasks.delete(jobId);
}

/** Stops this job's background uploads that are alive in this JS session (call once the server agreed). */
export function cancelJobUploads(jobId: string) {
  cancelledJobs.add(jobId);
  for (const task of jobTasks.get(jobId) ?? []) {
    try {
      task.cancel(); // rejects the pending uploadAsync(); the upload loop below then stops quietly
    } catch (e) {
      console.warn('[uploads] could not cancel an upload task', e);
    }
  }
}

/** Each upload started in this app session: true once every file is in, false when one failed or it was stopped. */
const finishing = new Map<string, Promise<boolean>>();

/** Resolves when this job's files are all uploaded (true) or not (false); false at once when it isn't running here. */
export function uploadFinished(jobId: string): Promise<boolean> {
  return finishing.get(jobId) ?? Promise.resolve(false);
}

// ---------------------------------------------------------------------------

export function contentTypeFor(asset: ImagePickerAsset): string {
  if (asset.mimeType && asset.mimeType.startsWith('video/')) return asset.mimeType;
  const name = (asset.fileName || asset.uri).toLowerCase();
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

export function fileNameFor(asset: ImagePickerAsset, i: number): string {
  if (asset.fileName) return asset.fileName;
  const last = asset.uri.split('/').pop();
  return last && last.length > 0 ? decodeURIComponent(last) : `video-${i + 1}.mov`;
}

/**
 * The file is still on the phone. A file that isn't must never reach a native upload task: iOS throws
 * an exception there ("Cannot read file at …") that no JS can catch, and the app closes (Oct 24, the
 * in-app camera's clip). The web build can't tell (it never uploads).
 */
export function fileOnPhone(uri: string): boolean {
  if (Platform.OS === 'web') return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export const MISSING_VIDEO = 'A video isn’t on this phone any more. Record or pick it again.';

export function fileSizeFor(asset: ImagePickerAsset): number {
  // Prefer the size of the exact file we will upload; fall back to the picker's number.
  if (Platform.OS !== 'web') {
    try {
      const size = new File(asset.uri).size;
      if (size > 0) return size;
    } catch {
      // fall through
    }
  }
  return typeof asset.fileSize === 'number' && asset.fileSize > 0 ? asset.fileSize : 0;
}

export type StartUploadInput = {
  title: string;
  cook_name: string;
  relation: string;
  assets: ImagePickerAsset[];
  /** Extras saved with the job (who it is for, the hello, a thumbnail source). */
  meta?: JobMeta;
  /** Who is sending (a profile id; their Convex session signs the upload), by default whoever is in. */
  as?: string;
};

/**
 * Creates the job, persists it, starts one background upload per file and returns
 * WITHOUT waiting for the uploads to finish.
 */
export async function startUpload(input: StartUploadInput): Promise<StoredJob> {
  if (!uploadsConfigured(input.as)) throw new Error("Uploads aren't set up yet.");
  if (!uploadsSupportedHere) throw new Error('Uploads work from the homecookd app on your phone.');
  if (input.assets.some((a) => !fileOnPhone(a.uri))) throw new Error(MISSING_VIDEO);

  const files = input.assets.map((a, i) => ({
    name: fileNameFor(a, i),
    content_type: contentTypeFor(a),
    size: fileSizeFor(a),
    duration_s: Math.round((a.duration ?? 0) / 1000), // ImagePickerAsset.duration is in ms
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let job: CreateJobResponse;
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: await signerHeaders(input.as),
      body: JSON.stringify({ title: input.title, cook_name: input.cook_name, relation: input.relation, files }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let reason = text.slice(0, 160);
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed?.error === 'string') reason = parsed.error; // the signer answers {"error": "..."}
      } catch {
        // not JSON (e.g. a gateway error page); keep the raw snippet
      }
      throw new Error(`The upload service said no (${res.status}). ${reason}`.trim());
    }
    job = (await res.json()) as CreateJobResponse;
  } finally {
    clearTimeout(timer);
  }
  if (!job?.job_id || !job.status_url || !Array.isArray(job.uploads) || job.uploads.length === 0) {
    throw new Error('The upload service sent back something unexpected.');
  }

  const stored: StoredJob = {
    job_id: job.job_id,
    status_url: job.status_url,
    title: input.title,
    cook_name: input.cook_name,
    relation: input.relation,
    created_at: new Date().toISOString(),
    file_count: input.assets.length,
    local_state: 'uploading',
    ...input.meta,
  };
  // Persist BEFORE the uploads finish, so the library can track the job after a relaunch.
  saveJobs([stored, ...loadJobs().filter((j) => j.job_id !== stored.job_id)]);

  // `index` is the position in the `files` array we sent. TODO: confirm 0- vs 1-based with
  // the upload worker; we accept either.
  const zeroBased = job.uploads.some((u) => u.index === 0);
  const fileProgress: FileProgress[] = job.uploads.map((_, i) => ({ sent: 0, total: files[i]?.size ?? 0 }));
  progress.set(job.job_id, fileProgress);
  progressStarted.set(job.job_id, Date.now());

  // Start every file now (async map); do NOT await them one by one.
  const runs = job.uploads.map(async (u, i) => {
    const assetIndex = typeof u.index === 'number' ? (zeroBased ? u.index : u.index - 1) : i;
    const asset = input.assets[assetIndex] ?? input.assets[i];
    // GCS V4 signed URL: raw bytes as the body & exactly the signed Content-Type.
    const headers = u.headers ?? { 'Content-Type': files[assetIndex]?.content_type ?? 'video/quicktime' };
    for (let attempt = 1; ; attempt++) {
      if (!fileOnPhone(asset.uri)) throw new Error(`Upload ${i + 1} failed: ${MISSING_VIDEO}`);
      const task = new File(asset.uri).createUploadTask(u.url, {
        httpMethod: 'PUT',
        headers,
        uploadType: UploadType.BINARY_CONTENT,
        sessionType: 'background',
        onProgress: ({ bytesSent, totalBytes }) => {
          fileProgress[i] = { sent: bytesSent, total: totalBytes > 0 ? totalBytes : fileProgress[i].total };
          emit(true);
        },
      });
      trackTask(job.job_id, task);
      let problem = '';
      let retryable = true;
      try {
        const result = await task.uploadAsync();
        if (result.status >= 200 && result.status < 300) {
          fileProgress[i] = { sent: fileProgress[i].total, total: fileProgress[i].total };
          return;
        }
        problem = `(${result.status}) ${result.body?.slice(0, 200) ?? ''}`;
        retryable = result.status === 408 || result.status === 429 || result.status >= 500;
      } catch (e) {
        problem = String(e);
      } finally {
        untrackTask(job.job_id, task);
      }
      if (cancelledJobs.has(job.job_id)) return;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw new Error(`Upload ${i + 1} failed ${problem}`.trim());
      console.warn(`[uploads] file ${i + 1} attempt ${attempt} failed, retrying`, problem);
      fileProgress[i] = { sent: 0, total: fileProgress[i].total };
      emit();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 30_000));
      if (cancelledJobs.has(job.job_id)) return;
    }
  });

  const settled = Promise.allSettled(runs).then((results) => {
    if (cancelledJobs.has(stored.job_id)) return false; // cancelled & already removed: nothing to report
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) console.warn('[uploads] some files failed', failed.map((f) => String(f.reason)));
    updateJob(stored.job_id, { local_state: failed.length > 0 ? 'failed' : 'uploaded' });
    emit();
    return failed.length === 0;
  });
  finishing.set(stored.job_id, settled);

  return stored;
}

/**
 * Reads the job's public status JSON. 404 means the worker hasn't seen it yet -> 'uploading'.
 * Returns null on network errors so the caller keeps the last known state.
 */
export async function fetchJobStatus(job: StoredJob): Promise<JobStatus | null> {
  try {
    const { status, data } = await fetchJson(cacheBuster(job.status_url));
    if (status === 404 || status === 403) {
      // GCS answers 403 for a missing object when the bucket isn't publicly listable.
      return {
        id: job.job_id,
        title: job.title,
        cook_name: job.cook_name,
        relation: job.relation,
        status: 'uploading',
        created_at: job.created_at,
        updated_at: job.created_at,
        files_expected: job.file_count,
        files_received: 0,
        recipe_id: null,
        message: null,
      };
    }
    if (data && typeof data === 'object' && 'status' in data) return data as JobStatus;
    return null;
  } catch {
    return null;
  }
}

/** Attempts after which the home card says the send didn't get through (it keeps retrying). */
export const PENDING_SEND_GIVE_UP = 5;

/** True while this job still has recipients the backend hasn't been told about. */
export function needsPendingSend(job: StoredJob): boolean {
  return !!job.recipient_ids?.length && !!job.sender_id && job.pending_send !== 'ok';
}

/**
 * Tells the backend who gets the recipe once the pipeline publishes it (POST /pending-sends).
 * Safe to call again: it only posts while the job's `pending_send` isn't 'ok'. A 409 means it was
 * already delivered, which also counts as done. Returns true when the backend has it.
 */
export async function ensurePendingSend(job: StoredJob): Promise<boolean> {
  if (job.pending_send === 'ok') return true;
  if (!job.recipient_ids || job.recipient_ids.length === 0 || !job.sender_id) return false;
  try {
    await api.pendingSend(
      {
        job_id: job.job_id,
        recipient_ids: job.recipient_ids,
        hello_path: job.hello_path ?? null,
        hello_duration_s: job.hello_duration_s ?? null,
      },
      { profileId: job.sender_id },
    );
    updateJob(job.job_id, { pending_send: 'ok' });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      updateJob(job.job_id, { pending_send: 'ok' });
      return true;
    }
    console.warn('[uploads] pending send not saved yet', e instanceof Error ? e.message : e);
    const attempts = (loadJobs().find((j) => j.job_id === job.job_id)?.pending_send_attempts ?? 0) + 1;
    updateJob(job.job_id, { pending_send: 'failed', pending_send_attempts: attempts });
    return false;
  }
}
