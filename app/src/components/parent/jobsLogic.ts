// A recording on its way, read from the worker's live stage (Convex jobs.forFamily), pure (node
// scripts/test-parent-jobs.mjs). ProcessingRow and PendingRecipes use these.
//   STAGE_HINT[stage]                          the row's line for each stage still going
//   uploadingView(live, received, expected)   stage 'uploading': the worker is still waiting for the
//                                              video, so the sending half of the bar isn't full
//   liveJobFinished(worker, libraryIds, ...)   'done' and its recipe is in the library: drop the row
//   recipeIdsToLookUp(workers, known)          finished jobs whose library id isn't known yet
//   liveJobCancelled(worker)                   stopped (on this phone or another): drop the row
import type { JobStage } from '@/lib/live/convex';

type Worker = { stage: JobStage; recipeId?: string; error?: string };

/** What Convex's jobs.cancel writes (convex/jobs.ts CANCELLED). */
const CANCELLED = 'Cancelled.';

export function liveJobCancelled(worker: Worker | undefined): boolean {
  return worker?.stage === 'failed' && worker.error === CANCELLED;
}

export const STAGE_HINT: Record<Exclude<JobStage, 'done' | 'failed'>, string> = {
  uploading: 'Still sending the video',
  queued: 'Waiting its turn',
  preparing: 'Getting your videos ready',
  understanding: 'Watching your video',
  writing: 'Writing the recipe',
  indexing: 'Finding each moment',
};

/** The hint and the sending half's fill while the worker says the upload isn't complete. */
export function uploadingView(live: number | null, received: number, expected: number): { hint: string; send: number } {
  // This phone's own upload when it's running, else the server's file count; never full, it isn't in yet.
  const known = live ?? (expected > 0 && received > 0 ? received / expected : null);
  const hint = live !== null && live < 1 ? `Sending your videos · ${Math.round(live * 100)}%` : STAGE_HINT.uploading;
  return { hint, send: Math.min(0.95, Math.max(0.05, known ?? 0.5)) };
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
