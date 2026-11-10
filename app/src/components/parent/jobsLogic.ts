// A recording on its way, read from the worker's live stage (Convex jobs.mine), pure (node
// scripts/test-parent-jobs.mjs). ProcessingRow and PendingRecipes use these.
//   stageHint(stage, t)                        the row's line for each stage still going
//   uploadingView(live, received, expected, t) stage 'uploading': the worker is still waiting for the
//                                              video, so the sending half of the bar isn't full
//   uploadingRow(localState, live, …)          the same, unless this phone's own upload gave up: then
//                                              the row says so ("Some videos didn't send")
//   sendAgainRow(view, offer, look, t)         that row with her Send again (Caleb, Nov 10), or saying
//                                              plainly its videos aren't on this phone
//   noteRow(note, title, thumb)                a recording whose resend failed with no upload row left, as
//                                              a failed row of its own (isNoteRow); withNoteRows puts them in
//   liveJobFinished(worker, libraryIds, ...)   'done' and its recipe is in the library: drop the row
//   recipeIdsToLookUp(workers, known)          finished jobs whose library id isn't known yet
//   liveJobCancelled(worker)                   stopped (on this phone or another): drop the row
import type { JobStage } from '@/lib/live/convex';
import type { Unsent } from '@/lib/unsentLogic';
import type { StoredJob } from '@/lib/uploads';
import { english, type T, type WordKey } from '@/lib/words/words';

type Worker = { stage: JobStage; recipeId?: string; error?: string };

/** What Convex's jobs.cancel writes (convex/jobs.ts CANCELLED). */
const CANCELLED = 'Cancelled.';

export function liveJobCancelled(worker: Worker | undefined): boolean {
  return worker?.stage === 'failed' && worker.error === CANCELLED;
}

type Going = Exclude<JobStage, 'done' | 'failed'>;

const STAGE_HINT: Record<Going, WordKey> = {
  uploading: 'parent.stage.uploading',
  queued: 'parent.stage.queued',
  preparing: 'parent.stage.preparing',
  understanding: 'parent.stage.understanding',
  writing: 'parent.stage.writing',
  indexing: 'parent.stage.indexing',
};

/** The row's line for a stage still going ("Still sending the video"). */
export function stageHint(stage: Going, t: T = english): string {
  return t(STAGE_HINT[stage]);
}

/** The hint and the sending half's fill while the worker says the upload isn't complete. */
export function uploadingView(live: number | null, received: number, expected: number, t: T = english): { hint: string; send: number } {
  // This phone's own upload when it's running, else the server's file count; never full, it isn't in yet.
  const known = live ?? (expected > 0 && received > 0 ? received / expected : null);
  const hint = live !== null && live < 1 ? t('parent.processing.sendingPct', { pct: Math.round(live * 100) }) : stageHint('uploading', t);
  return { hint, send: Math.min(0.95, Math.max(0.05, known ?? 0.5)) };
}

/**
 * The row while the worker still waits for the video. This phone's own upload gave up (every try failed:
 * the stored job's local_state is 'failed'): it says so, as a row with no live stage does, instead of
 * "Sending your videos · 0%" over an upload that has stopped (on 1.1 every job has a live stage from the
 * start, so a failed upload never showed). Else the sending half (uploadingView).
 */
export function uploadingRow(
  localState: string | undefined,
  live: number | null,
  received: number,
  expected: number,
  t: T = english,
): { failed: true; hint: string } | { failed: false; hint: string; send: number } {
  if (localState === 'failed') return { failed: true, hint: t('parent.processing.someFailed') };
  return { failed: false, ...uploadingView(live, received, expected, t) };
}

/**
 * A row whose upload gave up, with her Send again (Caleb, Nov 10: "Yes, if he'll upload, should say send again").
 * 'send' (its videos are still on this phone): "Your videos didn't send" and the button, in `look`'s state.
 * 'kept' (no note left, but its files still are): "Your videos didn't send", never that they're gone, no button.
 * 'gone': says plainly its videos aren't on this phone, with no button that can't work (the x still clears it).
 */
export function sendAgainRow<V extends { hint: string }>(
  view: V,
  offer: 'send' | 'kept' | 'gone',
  look: 'offer' | 'sending' | 'error',
  t: T = english,
): V & { again: 'offer' | 'sending' | 'error' | null } {
  if (offer === 'send') return { ...view, hint: t('parent.processing.didntSend'), again: look };
  if (offer === 'kept') return { ...view, hint: t('parent.processing.didntSend'), again: null };
  return { ...view, hint: t('parent.processing.videosGone'), again: null };
}

/** A note row's id: never an upload's (the signer makes those). */
const NOTE_ROW = 'unsent:';

/** A recording's own failed row (noteRow), not an upload's: nothing on the server to ask about or stop. */
export const isNoteRow = (row: { job_id: string }) => row.job_id.startsWith(NOTE_ROW);

/**
 * A recording whose resend failed with no upload row left (unsentLogic failedNotes), as the failed row its upload
 * had: "Your videos didn't send" with Send again, found by its note the way Stop and Send again find any row's.
 * Never polled (the poll reads jobs.json) and never given a server job (ensureJob reads jobs.json too).
 */
export function noteRow(u: Pick<Unsent, 'recordingId' | 'local' | 'clips' | 'savedAt' | 'cookId'>, title: string, thumb: string | null): StoredJob {
  return {
    job_id: `${NOTE_ROW}${u.recordingId}`,
    status_url: '',
    title,
    cook_name: '',
    relation: '',
    created_at: u.savedAt,
    file_count: u.clips.length,
    local_state: 'failed',
    sender_id: u.cookId,
    recording_id: u.local ? null : u.recordingId,
    unsent_id: u.local ? u.recordingId : null,
    thumb_video_uri: thumb,
  };
}

/** The upload rows (newest first) with the note rows put in among them by when each was filmed. */
export function withNoteRows(rows: StoredJob[], notes: StoredJob[]): StoredJob[] {
  const at = (r: StoredJob) => Date.parse(r.created_at) || 0;
  const out = [...rows];
  for (const n of [...notes].sort((a, b) => at(b) - at(a))) {
    const i = out.findIndex((r) => !notes.includes(r) && at(r) < at(n));
    out.splice(i < 0 ? out.length : i, 0, n);
  }
  return out;
}

/**
 * The worker writes no status file in Convex mode, so a finished job never reads 'published': it is
 * done once the live stage is 'done' and its recipe (by its library id) is in the library, and, when
 * it was for someone, the backend knows who gets it.
 */
export function liveJobFinished(worker: Worker | undefined, libraryIdOf: Readonly<Record<string, string>>, inLibrary: ReadonlySet<string>, pendingSend: boolean): boolean {
  if (!worker || worker.stage !== 'done' || !worker.recipeId || pendingSend) return false;
  const id = libraryIdOf[worker.recipeId];
  return !!id && inLibrary.has(id);
}

/** Finished jobs' Convex recipe ids with no library id yet. */
export function recipeIdsToLookUp(workers: readonly Worker[], libraryIdOf: Readonly<Record<string, string>>): string[] {
  const ids = workers.filter((w) => w.stage === 'done' && w.recipeId && !libraryIdOf[w.recipeId]).map((w) => w.recipeId!);
  return [...new Set(ids)];
}
