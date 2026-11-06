// Sends a recording: the background upload (lib/uploads.ts), the live progress card (Convex
// jobs.create with the dish, her language, the kids and homie's recording), and who gets the recipe
// once it's written (POST /pending-sends). Send's big button uses it, and so does Grandma's done
// screen, which sends a phone recording by itself (components/record/DoneView). A send has a note on
// the phone (lib/unsentRecordings; made by components/record/sendKept, or at "I'm done"): the upload job
// goes on the note, and the note goes only once Convex has the job and every file is uploaded, so if
// the app dies before both, the next launch sends it again (components/record/useResendUnsent). Everything runs as `me` (their Convex
// session), so that resend can send as the cook while someone else is in. Every upload row keeps what
// jobs.create needs, and the home card asks again until Convex has the job (ensureJob, jobRetry.ts).
//
//   const job = await sendDraft({ me, draft, clips, kids, recipients, toLabel, dish, hello, note })
//   await jobCreated(job.job_id)   its jobs.create is over (a stop waits for it, then stops that job)
//   await makeJob(uploadId, as, { kids, glasses, language, recordingId, title })   jobs.create alone
//   void ensureJob(row, liveKnown)   the home card: jobs.create again for a row Convex doesn't have yet
// Nothing here runs without this phone's yes to the AI companies (lib/aiConsent): the screens ask
// first, sendDraft refuses, and the home card's retries wait for it.
import { getAiConsent, requireAiConsent } from '@/lib/aiConsent';
import type { Profile } from '@/lib/api';
import { convexKidIds, createJob } from '@/lib/live/convex';
import { dropUnsent, markUnsentJob, stillUnsent } from '@/lib/unsentRecordings';
import { ensurePendingSend, startUpload, updateJobMeta, uploadFinished, type StoredJob } from '@/lib/uploads';

import type { Draft, DraftClip } from './draft';
import { afterFailure, jobNext } from './jobRetry';

export const MAX_TITLE = 120; // the upload signer's limit

/** Each upload's jobs.create, in this app session. */
const creating = new Map<string, Promise<void>>();
/** Uploads whose jobs.create is running right now. */
const inFlight = new Set<string>();

/** Resolves once this upload's jobs.create is over (made or failed); at once when it isn't running here. */
export function jobCreated(uploadId: string): Promise<void> {
  return creating.get(uploadId) ?? Promise.resolve();
}
/** The signer needs a title; without a dish name Convex gets none and the writer names the recipe. */
const NO_DISH = 'family recipe';

export type SendInput = {
  me: Profile;
  draft: Pick<Draft, 'glasses' | 'language' | 'recordingId'> & Partial<Pick<Draft, 'dishAskId'>>;
  /** The videos to send (the selected ones). */
  clips: DraftClip[];
  /** The kids it's for (Convex jobs.create forKidIds): every kid for everyone, none for nobody. */
  kids: Profile[];
  recipients: Profile[];
  /** "Leo", "Leo & Zoe", "everyone", or null. */
  toLabel: string | null;
  /** The dish's name, trimmed ('' = none). */
  dish: string;
  hello?: { path: string; duration_s: number } | null;
  /** The phone's note for this send (lib/unsentRecordings), by default the recording's own. */
  note?: string | null;
  /** The card's thumbnail video, when it isn't the first clip (sendKept: the original pick, not its copy, which goes once sent). */
  thumb?: string | null;
};

export type JobFields = Pick<Draft, 'glasses' | 'language' | 'recordingId'> & { kids: { id: string; name: string }[]; title: string; dishAskId?: string | null };

/**
 * Convex said no to what was asked (a ConvexError carries its sentence in `data`): not a dropped line,
 * and not "signed out" (call() starts a new session; the next try asks with everything again).
 */
const refused = (e: unknown) => {
  const data = (e as { data?: unknown } | null)?.data;
  return typeof data === 'string' && !/signed out/i.test(data);
};

/**
 * jobs.create for the upload in "<uploadId>/", as the cook `as` (a profile id). Throws when it fails.
 * A refusal of the details (a kid Convex doesn't take, the language) asks again without them, then
 * (not from a recording, whose job must stay linked to it for the resend after a crash) with nothing
 * but the folder: the recipe matters more than who it's for.
 */
export async function makeJob(uploadId: string, as: string, { kids, glasses, language, recordingId, title, dishAskId }: JobFields): Promise<void> {
  const path = `${uploadId}/`;
  const source = glasses ? 'glasses' : 'phone';
  const forKidIds = await convexKidIds(kids, as);
  const tries: Record<string, unknown>[] = [
    { title: title || undefined, language: language ?? undefined, forKidIds, recordingId: recordingId ?? undefined, dishAskId: dishAskId ?? undefined },
    { title: title || undefined, recordingId: recordingId ?? undefined },
  ];
  if (!recordingId) tries.push({});
  for (let i = 0; ; i++) {
    try {
      return await createJob(path, source, tries[i], as);
    } catch (e) {
      if (!refused(e) || i === tries.length - 1) throw e;
      console.warn('[send] jobs.create refused; asking with less', String(e).slice(0, 160));
    }
  }
}

/** One jobs.create for this row, remembered on it: 'ok', or a failed try (the row backs off, then says so). */
function tryJob(row: StoredJob): Promise<boolean> {
  const fields = row.job_fields!;
  inFlight.add(row.job_id);
  const run = makeJob(row.job_id, row.sender_id!, { ...fields, recordingId: row.recording_id ?? null })
    .then(
      () => (updateJobMeta(row.job_id, { convex_job: 'ok' }), true),
      (e) => {
        console.warn('[send] jobs.create failed', String(e).slice(0, 160));
        updateJobMeta(row.job_id, afterFailure(row, Date.now()));
        return false;
      },
    )
    .finally(() => inFlight.delete(row.job_id));
  creating.set(
    row.job_id,
    run.then(() => {}),
  );
  return run;
}

/**
 * The home card, for each of its rows: jobs.create again when Convex doesn't have the job yet and
 * the backoff allows (`liveKnown`: Convex's live list has it). No-op for rows from older builds, and
 * for an in-app recording's row this run of the app didn't send: its note's resend owns it
 * (useResendUnsent), so the two never make two jobs for one recording.
 */
export function ensureJob(row: StoredJob, liveKnown: boolean): void {
  const note = row.unsent_id ?? row.recording_id;
  if (note && !creating.has(row.job_id) && stillUnsent(note)) return;
  if (getAiConsent() !== 'given') return;
  const step = jobNext(row, { now: Date.now(), liveKnown, inFlight: inFlight.has(row.job_id) });
  if (step === 'mark-ok') updateJobMeta(row.job_id, { convex_job: 'ok' });
  else if (step === 'create') void tryJob(row);
}

/** Starts the upload and returns once the job exists (the videos keep uploading in the background). */
export async function sendDraft({ me, draft, clips, kids, recipients, toLabel, dish, hello = null, note, thumb }: SendInput): Promise<StoredJob> {
  await requireAiConsent();
  const title = dish.slice(0, MAX_TITLE);
  const totalS = clips.reduce((a, c) => a + (c.asset.duration ?? 0) / 1000, 0);
  const { glasses, language, recordingId, dishAskId = null } = draft;
  const noteId = note ?? recordingId ?? null;
  const job = await startUpload({
    as: me.id,
    title: title || NO_DISH,
    cook_name: me.name,
    relation: me.relation?.trim() || me.name,
    assets: clips.map((c) => c.asset),
    meta: {
      sender_id: me.id,
      recipient_ids: recipients.map((p) => p.id),
      recipient_label: toLabel,
      hello_path: hello?.path ?? null,
      hello_duration_s: hello?.duration_s ?? null,
      pending_send: null,
      duration_s: Math.round(totalS),
      thumb_video_uri: thumb ?? clips[0]?.asset.uri ?? null,
      recording_id: recordingId ?? null,
      unsent_id: noteId !== recordingId ? noteId : null,
      job_fields: { glasses, language: language ?? null, title, kids: kids.map((k) => ({ id: k.id, name: k.name })), dishAskId },
    },
  });
  // The live progress (Convex jobs, hackathon): the worker finds the videos in "<job_id>/". A failure
  // here never stops the send: the home card asks again until Convex has the job (ensureJob).
  if (noteId) markUnsentJob(noteId, job.job_id);
  const made = tryJob(job);
  // The note goes once the job exists and the videos are all in (a 45-minute upload takes a while).
  if (noteId) {
    void Promise.all([made, uploadFinished(job.job_id)]).then(([jobMade, uploaded]) => {
      if (jobMade && uploaded) dropUnsent(noteId);
    });
  }
  // Who gets it once it's written. If this fails, the home card keeps retrying.
  if (recipients.length > 0) await ensurePendingSend(job);
  return job;
}
