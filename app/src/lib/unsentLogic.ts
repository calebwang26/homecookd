// The rules for recordings that haven't fully reached the worker yet (lib/unsentRecordings), pure
// (node scripts/test-recording-ui.mjs): where each video is kept (a path inside documents/, because
// iOS moves the app's folder when the app updates), what a launch does with one that's still waiting,
// from what Convex and the phone's upload row say, and (Oct 26) which recording the app died in while
// she was still filming, so Home can ask her about it.

export type UnsentClip = {
  /** Inside documents/ ("recordings/<id>/part-01.mp4"), or a full file:// uri when it's elsewhere. */
  path: string;
  durationMs: number;
  width: number;
  height: number;
  /** When this file began filming (epoch ms). */
  startedAt: number;
  /** A copy of a camera-roll pick (its original stays in Photos): deleted once the note goes. */
  copy?: boolean;
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
  /**
   * 'filming': written each time a 5-minute file is saved while she films, before "I'm done". Never
   * sent by itself: Home asks her (stoppedEarly). Unset: being sent (from "I'm done", Send, or Home).
   */
  state?: 'filming';
  /**
   * Not a Convex recording (Oct 26): a send from the Send screen ("Videos I already took"). Its
   * `recordingId` is only this note's own id (newNoteId); its Convex job is found by its upload folder.
   */
  local?: boolean;
  /** Imported glasses videos (jobs.create `source`). */
  glasses?: boolean;
  /** The hello voice note recorded on Send, already uploaded. */
  hello?: { path: string; duration_s: number } | null;
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

/**
 * A file saved while she films: the recording's 'filming' note, with every file so far. Never over a
 * note that is being sent already (a file that says it's saved after "I'm done").
 */
export function withFilming(list: Unsent[], next: Unsent): Unsent[] {
  const now = list.find((u) => u.recordingId === next.recordingId);
  if (now && now.state !== 'filming') return list;
  return withUnsent(list, { ...next, state: 'filming', savedAt: now?.savedAt ?? next.savedAt });
}

/**
 * The recordings to ask her about on Home: the app died (or the screen closed) while she was filming.
 * Only her own, in this family, not being filmed right now in this run of the app, with a file saved.
 */
export function stoppedEarly(list: Unsent[], at: { cookId: string | null | undefined; familyId: string | null | undefined; filmingNow: (recordingId: string) => boolean }): Unsent[] {
  if (!at.cookId) return [];
  return list.filter(
    (u) => u.state === 'filming' && u.cookId === at.cookId && u.familyId === (at.familyId ?? null) && u.clips.length > 0 && !at.filmingNow(u.recordingId),
  );
}

/** Her [Send it] on Home: the note is sent now (its clock starts again; no job yet). */
export function asSending(u: Unsent, now: number): Unsent | null {
  // Only once: a second tap (or another run) must never reset a send already on its way.
  if (u.state !== 'filming') return null;
  const next: Unsent = { ...u, savedAt: new Date(now).toISOString(), jobId: null, resends: 0 };
  delete next.state;
  return next;
}

/**
 * A Send-screen upload's Convex job, from the family's newest jobs (jobs.forFamily keeps 20): found, or
 * `{ stage: null }` (done, long since handled, like recordingJob) when this phone saw Convex take the job
 * (its row's convex_job 'ok') but it's no longer among the newest, or null: no job.
 */
export function jobForUpload(
  jobs: { _id: string; uploadPath: string; stage: string; error?: string }[],
  uploadId: string | null,
  convexHadIt: boolean,
): { id: string; stage: string | null; error: string | null } | null {
  if (!uploadId) return null;
  const job = jobs.find((j) => j.uploadPath === `${uploadId}/`);
  if (job) return { id: job._id, stage: job.stage, error: job.error ?? null };
  return convexHadIt ? { id: '', stage: null, error: null } : null;
}

/**
 * The copies under documents/sends/ that no note lists (the app died between the copy and the note, or a
 * note put back without them), and not part of a send being prepared right now: delete them.
 * `paths`: "sends/<id>/<file>".
 */
export function orphanCopies(paths: string[], notes: Pick<Unsent, 'clips'>[], busy: (noteId: string) => boolean): string[] {
  const listed = new Set(notes.flatMap((u) => u.clips.map((c) => c.path)));
  return paths.filter((p) => !listed.has(p) && !busy(p.split('/')[1] ?? ''));
}

/** A launch sends it again by itself: not one she's still to be asked about. */
export const sendsBySelf = (u: Pick<Unsent, 'state'>) => u.state !== 'filming';

/** How much was filmed (ms). */
export const filmedLength = (clips: Pick<UnsentClip, 'durationMs'>[]) => clips.reduce((a, c) => a + (c.durationMs || 0), 0);

/** A Send-screen note's own id (no Convex recording behind it). */
export function newNoteId(now: number, random: number): string {
  return `send-${now.toString(36)}-${Math.floor(random * 36 ** 6).toString(36)}`;
}

/**
 * Where a picked video is copied before it uploads, or null when it's kept already: ImagePicker leaves
 * its copies in Caches/ (and the camera in tmp/), which iOS may empty while the app is closed.
 * "sends/<noteId>/part-01.mov", keeping its own extension.
 */
export function copyPath(uri: string, documentsUri: string, noteId: string, n: number): string | null {
  if (!isFullUri(uri) || !/^file:/i.test(uri) || !isFullUri(docPath(uri, documentsUri))) return null;
  const ext = (/\.([a-z0-9]{2,4})$/i.exec(uri.split('?')[0])?.[1] ?? 'mov').toLowerCase();
  return `sends/${noteId}/part-${String(n).padStart(2, '0')}.${ext}`;
}

/** The name and type a kept video uploads with: an in-app file is part-NN.mp4, a camera-roll copy keeps its own (.mov). */
export function clipFile(path: string, n: number): { fileName: string; mimeType: string | undefined } {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(path.split('?')[0])?.[1]?.toLowerCase() ?? 'mp4';
  return { fileName: `part-${String(n).padStart(2, '0')}.${ext}`, mimeType: ext === 'mp4' ? 'video/mp4' : undefined };
}

export function patchUnsent(list: Unsent[], recordingId: string, patch: Partial<Unsent>): Unsent[] {
  return list.map((u) => (u.recordingId === recordingId ? { ...u, ...patch } : u));
}

export function withoutUnsent(list: Unsent[], recordingId: string): Unsent[] {
  return list.filter((u) => u.recordingId !== recordingId);
}

/** Stopped or cleared on Home (that upload row): its note goes, found by the row's job, recording or note. */
export function withoutUnsentFor(list: Unsent[], row: { job_id: string; recording_id?: string | null; unsent_id?: string | null }): Unsent[] {
  const ids = [row.recording_id, row.unsent_id].filter(Boolean);
  return list.filter((u) => u.jobId !== row.job_id && !ids.includes(u.recordingId));
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
