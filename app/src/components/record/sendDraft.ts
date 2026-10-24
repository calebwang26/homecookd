// Sends a recording: the background upload (lib/uploads.ts), the live progress card (Convex
// jobs.create with the dish, her language, the kid and homie's recording), and who gets the recipe
// once it's written (POST /pending-sends). Send's big button uses it, and so does Grandma's done
// screen, which sends a phone recording by itself (components/record/DoneView).
//
//   const job = await sendDraft({ me, draft, clips, kid, recipients, toLabel, dish, hello })
import type { Profile } from '@/lib/api';
import { convexPersonIdByName, createJob } from '@/lib/live/convex';
import { ensurePendingSend, startUpload, type StoredJob } from '@/lib/uploads';

import type { Draft, DraftClip } from './draft';

export const MAX_TITLE = 120; // the upload signer's limit
/** The signer needs a title; without a dish name Convex gets none and the writer names the recipe. */
const NO_DISH = 'family recipe';

export type SendInput = {
  me: Profile;
  draft: Pick<Draft, 'glasses' | 'language' | 'recordingId'>;
  /** The videos to send (the selected ones). */
  clips: DraftClip[];
  /** The one kid it's for (Convex jobs.create forKidId), or null for everyone / nobody. */
  kid: Profile | null;
  recipients: Profile[];
  /** "Leo", "everyone", or null. */
  toLabel: string | null;
  /** The dish's name, trimmed ('' = none). */
  dish: string;
  hello?: { path: string; duration_s: number } | null;
};

/** Starts the upload and returns once the job exists (the videos keep uploading in the background). */
export async function sendDraft({ me, draft, clips, kid, recipients, toLabel, dish, hello = null }: SendInput): Promise<StoredJob> {
  const title = dish.slice(0, MAX_TITLE);
  const totalS = clips.reduce((a, c) => a + (c.asset.duration ?? 0) / 1000, 0);
  const job = await startUpload({
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
    },
  });
  // The live progress (Convex jobs, hackathon): the worker finds the videos in "<job_id>/". A failure
  // here never stops the send; the row falls back to the status file.
  const { glasses, language, recordingId } = draft;
  void (async () => {
    const forKidId = (await convexPersonIdByName(kid?.name)) ?? undefined;
    await createJob(`${job.job_id}/`, glasses ? 'glasses' : 'phone', {
      title: title || undefined,
      language: language ?? undefined,
      forKidId,
      recordingId: recordingId ?? undefined,
    });
  })().catch((e) => console.warn('[send] jobs.create failed', String(e)));
  // Who gets it once it's written. If this fails, the home card keeps retrying.
  if (recipients.length > 0) await ensurePendingSend(job);
  return job;
}
