// Every send gets its Convex job (Oct 24). jobs.create used to run once, fire-and-forget, after the
// upload started: when it failed, or the app died first (build 5's crash at "Done! Sending it to …"),
// the send had no job, so no recipe was ever made and the row just said "Writing it down". Now the
// row keeps what jobs.create needs (JobMeta.job_fields), and the home card asks again until Convex has
// the job (jobs.create is idempotent per upload folder), backing off; after the last try the row says
// it couldn't start. Pure, so scripts/test-parent-jobs.mjs runs it.
//   jobNext(job, { now, liveKnown, inFlight })  -> 'skip' | 'mark-ok' | 'create'
//   afterFailure(job, now)                      -> the meta to save after a failed try
import type { JobMeta, LocalState } from '@/lib/uploads';

/** The wait before each next try; one try per entry, then the row says it failed (about 2 hours). */
export const JOB_RETRY_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];

type Row = JobMeta & { local_state?: LocalState };

export function jobNext(job: Row, at: { now: number; liveKnown: boolean; inFlight: boolean }): 'skip' | 'mark-ok' | 'create' {
  if (!job.job_fields || !job.sender_id || job.convex_job === 'ok') return 'skip';
  // Convex already lists it (the first try's answer was lost, or another phone made it).
  if (at.liveKnown) return 'mark-ok';
  if (at.inFlight || job.convex_job === 'failed' || job.local_state === 'failed') return 'skip';
  const tries = job.convex_job_attempts ?? 0;
  const wait = tries === 0 ? 0 : (JOB_RETRY_MS[tries - 1] ?? Infinity);
  return at.now - (job.convex_job_tried_at ?? 0) >= wait ? 'create' : 'skip';
}

export function afterFailure(job: Row, now: number): JobMeta {
  const attempts = (job.convex_job_attempts ?? 0) + 1;
  return { convex_job_attempts: attempts, convex_job_tried_at: now, convex_job: attempts > JOB_RETRY_MS.length ? 'failed' : null };
}

/** The row's line once every try failed. */
export const JOB_FAILED_HINT = 'We couldn’t start this recipe. Tap to send it again.';
