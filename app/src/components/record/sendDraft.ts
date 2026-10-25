// Sends a recording: the background upload (lib/uploads.ts), the live progress card (Convex
// jobs.create with the dish, her language, the kids and homie's recording), and who gets the recipe
// once it's written (POST /pending-sends). Send's big button uses it, and so does Grandma's done
// screen, which sends a phone recording by itself (components/record/DoneView). A recording filmed in
// the app has a note on the phone (lib/unsentRecordings): the upload job goes on the note, and the note
// goes only once Convex has the job and every file is uploaded, so if the app dies before both, the next
// launch sends it again (components/record/useResendUnsent). Everything runs as `me` (their Convex
// session), so that resend can send as the cook while someone else is in.
//
//   const job = await sendDraft({ me, draft, clips, kids, recipients, toLabel, dish, hello })
//   await jobCreated(job.job_id)   its jobs.create is over (a stop waits for it, then stops that job)
//   await makeJob(uploadId, as, { kids, glasses, language, recordingId, title })   jobs.create alone
import type { Profile } from '@/lib/api';
import { convexKidIds, createJob } from '@/lib/live/convex';
import { dropUnsent, markUnsentJob } from '@/lib/unsentRecordings';
import { ensurePendingSend, startUpload, uploadFinished, type StoredJob } from '@/lib/uploads';

import type { Draft, DraftClip } from './draft';

export const MAX_TITLE = 120; // the upload signer's limit

/** Each upload's jobs.create, in this app session. */
const creating = new Map<string, Promise<void>>();

/** Resolves once this upload's jobs.create is over (made or failed); at once when it isn't running here. */
export function jobCreated(uploadId: string): Promise<void> {
  return creating.get(uploadId) ?? Promise.resolve();
}
/** The signer needs a title; without a dish name Convex gets none and the writer names the recipe. */
const NO_DISH = 'family recipe';

export type SendInput = {
  me: Profile;
  draft: Pick<Draft, 'glasses' | 'language' | 'recordingId'>;
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
};

export type JobFields = Pick<Draft, 'glasses' | 'language' | 'recordingId'> & { kids: Profile[]; title: string };

/** jobs.create for the upload in "<uploadId>/", as the cook `as` (a profile id). Throws when it fails. */
export async function makeJob(uploadId: string, as: string, { kids, glasses, language, recordingId, title }: JobFields): Promise<void> {
  const forKidIds = await convexKidIds(kids, as);
  await createJob(
    `${uploadId}/`,
    glasses ? 'glasses' : 'phone',
    { title: title || undefined, language: language ?? undefined, forKidIds, recordingId: recordingId ?? undefined },
    as,
  );
}

/** Starts the upload and returns once the job exists (the videos keep uploading in the background). */
export async function sendDraft({ me, draft, clips, kids, recipients, toLabel, dish, hello = null }: SendInput): Promise<StoredJob> {
  const title = dish.slice(0, MAX_TITLE);
  const totalS = clips.reduce((a, c) => a + (c.asset.duration ?? 0) / 1000, 0);
  const { glasses, language, recordingId } = draft;
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
      thumb_video_uri: clips[0]?.asset.uri ?? null,
      recording_id: recordingId ?? null,
    },
  });
  // The live progress (Convex jobs, hackathon): the worker finds the videos in "<job_id>/". A failure
  // here never stops the send; the row falls back to the status file.
  if (recordingId) markUnsentJob(recordingId, job.job_id);
  const made = makeJob(job.job_id, me.id, { kids, glasses, language, recordingId, title }).then(
    () => true,
    (e) => (console.warn('[send] jobs.create failed', String(e)), false),
  );
  creating.set(
    job.job_id,
    made.then(() => {}),
  );
  // The note goes once the job exists and the videos are all in (a 45-minute upload takes a while).
  if (recordingId) {
    void Promise.all([made, uploadFinished(job.job_id)]).then(([jobMade, uploaded]) => {
      if (jobMade && uploaded) dropUnsent(recordingId);
    });
  }
  // Who gets it once it's written. If this fails, the home card keeps retrying.
  if (recipients.length > 0) await ensurePendingSend(job);
  return job;
}
