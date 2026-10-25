// The rules for in-app recordings that haven't fully reached the worker yet (lib/unsentRecordings),
// pure (node scripts/test-recording-ui.mjs): where each video is kept (a path inside documents/, because
// iOS moves the app's folder when the app updates), and what a launch does with a recording that's
// still waiting, from what Convex and the phone's upload row say.

export type UnsentClip = {
  /** Inside documents/ ("recordings/<id>/part-01.mp4"), or a full file:// uri when it's elsewhere. */
  path: string;
  durationMs: number;
  width: number;
  height: number;
  /** When this file began filming (epoch ms). */
  startedAt: number;
};

export type Unsent = {
  recordingId: string;
  /** The family it was filmed in (Supabase id) and the cook who filmed it (Supabase profile id). */
  familyId: string | null;
  cookId: string;
  clips: UnsentClip[];
  /** The pre-record sheet's answers, as the done view sends them. */
  dish: string | null;
  language: string | null;
  forKids: string[] | null;
  everyone: boolean;
  requestFrom: string | null;
  savedAt: string;
  /** The upload signer's job, once one was made (its row in jobs.json). */
  jobId: string | null;
  /** Sends (or jobs.create calls) started after a relaunch. */
  resends: number;
};

/** A recording that fails to send this many launches in a row stops being sent by itself (its videos stay). */
export const MAX_RESENDS = 3;
/** Nor one older than this (the signer's upload links last 7 days, and a cook may have left the family). */
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** Where a file is inside documents/, or its full uri when it isn't in there. */
export function docPath(uri: string, documentsUri: string): string {
  const base = documentsUri.endsWith('/') ? documentsUri : `${documentsUri}/`;
  return uri.startsWith(base) ? decodeURIComponent(uri.slice(base.length)) : uri;
}

export const isFullUri = (path: string) => /^[a-z]+:\/\//i.test(path);

export function withUnsent(list: Unsent[], next: Unsent): Unsent[] {
  return [next, ...list.filter((u) => u.recordingId !== next.recordingId)];
}

export function patchUnsent(list: Unsent[], recordingId: string, patch: Partial<Unsent>): Unsent[] {
  return list.map((u) => (u.recordingId === recordingId ? { ...u, ...patch } : u));
}

export function withoutUnsent(list: Unsent[], recordingId: string): Unsent[] {
  return list.filter((u) => u.recordingId !== recordingId);
}

/** Stopped or cleared on Home (that upload row): its note goes, found by the row's job or recording. */
export function withoutUnsentFor(list: Unsent[], row: { job_id: string; recording_id?: string | null }): Unsent[] {
  return list.filter((u) => u.jobId !== row.job_id && (!row.recording_id || u.recordingId !== row.recording_id));
}

/**
 * Worker stages that mean it has every file: past its upload check (pipeline/worker.py
 * _complete_upload). Not 'preparing': the worker sets that the moment it claims a job, before it looks,
 * and holds it while it waits up to 45 s for missing files.
 */
const HAS_FILES = new Set(['understanding', 'writing', 'indexing', 'done']);
/** What a stopped job says (convex/jobs.ts CANCELLED). */
export const CANCELLED = 'Cancelled.';
/**
 * The worker saying files are missing ('uploading') is believed only this long after "I'm done": iOS
 * may still be finishing a background upload the app was killed during, and the job shows the same.
 */
export const REDO_AFTER_MS = 60 * 60_000;

/**
 * What a launch does with one that's waiting:
 *   'wait'      Convex couldn't say, or the job is queued, being claimed ('preparing'), or failed for its
 *               own reason (her row says so): ask again later, never a second copy on a guess
 *   'done'      nothing to do: the worker has every file, the job was stopped, it isn't among the
 *               family's newest jobs (long since handled), or this phone saw every file go
 *   'create'    the upload finished but jobs.create never did: make the job for those videos
 *   'redo'      the worker says files are missing ('uploading') and it's been an hour (or this phone saw
 *               the upload fail): stop that job, send again
 *   'send'      no job and no finished upload: send again
 *   'gone'      none of its videos are on the phone: nothing to send (its job is left alone: the files
 *               may have arrived)
 *   'give-up'   too many tries, or too old (the videos stay in documents/recordings/)
 * `convexJob`: undefined = Convex couldn't say, null = no job. `upload`: this phone's row for the note's
 * job (null: none). `clipsHere`: how many of its videos are still on the phone.
 */
export type ResendStep = 'wait' | 'done' | 'create' | 'redo' | 'send' | 'gone' | 'give-up';

export type JobSeen = { stage: string | null; error?: string | null };

export function resendStep(
  u: Pick<Unsent, 'resends' | 'savedAt'>,
  at: { convexJob: JobSeen | null | undefined; upload: 'uploading' | 'uploaded' | 'failed' | null; clipsHere: number; now: number },
): ResendStep {
  if (at.now - Date.parse(u.savedAt) > MAX_AGE_MS) return 'give-up';
  if (at.convexJob === undefined) return 'wait';
  const uploaded = at.upload === 'uploaded';
  if (at.convexJob) {
    const { stage, error } = at.convexJob;
    if (stage === null || HAS_FILES.has(stage) || (stage === 'failed' && error === CANCELLED) || uploaded) return 'done';
    if (stage !== 'uploading') return 'wait';
    if (!at.clipsHere) return 'gone';
    if (at.upload !== 'failed' && at.now - Date.parse(u.savedAt) < REDO_AFTER_MS) return 'wait';
    return u.resends >= MAX_RESENDS ? 'give-up' : 'redo';
  }
  if (uploaded) return u.resends >= MAX_RESENDS ? 'give-up' : 'create';
  if (!at.clipsHere) return 'gone';
  return u.resends >= MAX_RESENDS ? 'give-up' : 'send';
}
