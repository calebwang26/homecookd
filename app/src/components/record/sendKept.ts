// A send with a note on the phone (lib/unsentRecordings), so that if the app dies before every video is
// up and Convex has the job (a swipe-away mid-upload: iOS then cancels its background uploads), the
// next launch sends it again by itself (useResendUnsent, the same rules as an in-app recording). Send's
// big button and the done view use it. The picked videos are first copied out of the cache iOS may
// empty (keepForSend; an in-app recording's are in documents/ already), then the note is written: keyed
// by homie's recording when there is one (replacing its note from "I'm done" with what Send picked),
// else by its own id (camera-roll videos, `local`). A send that fails before any upload exists puts the
// note back as it was (or drops it): she sees it didn't send and tries again herself, so a second copy
// never goes behind her back.
//
//   const job = await sendKept({ ...sendDraft's input, familyId, forKids, everyone, requestFrom })
import { askFilmed } from '@/lib/askReminders';
import { newNoteId, type Unsent } from '@/lib/unsentLogic';
import { dropUnsent, keepForSend, loadUnsent, putUnsent, saveUnsent } from '@/lib/unsentRecordings';
import type { StoredJob } from '@/lib/uploads';

import { sendDraft, type SendInput } from './sendDraft';

export type KeptInput = SendInput & {
  familyId: string | null;
  /** Who it's for, as the note keeps it (who.ts doneTo reads it back for a resend). */
  forKids: Unsent['forKids'];
  everyone: boolean;
  requestFrom: string | null;
};

export async function sendKept({ familyId, forKids, everyone, requestFrom, ...input }: KeptInput): Promise<StoredJob> {
  const { draft, me } = input;
  const recordingId = draft.recordingId ?? null;
  const note = recordingId ?? newNoteId(Date.now(), Math.random());
  const before = loadUnsent().find((u) => u.recordingId === note);
  const { clips, copies } = await keepForSend(input.clips, note);
  saveUnsent({
    recordingId: note,
    local: !recordingId,
    cookId: me.id,
    familyId,
    clips,
    copies,
    dish: input.dish || null,
    language: draft.language ?? null,
    glasses: draft.glasses,
    forKids,
    everyone,
    requestFrom,
    hello: input.hello ?? null,
  });
  try {
    const job = await sendDraft({ ...input, clips, note, thumb: input.clips[0]?.asset.uri ?? null });
    // Filmed for a kid's ask (Record came from its reminder): the ask is answered and its reminder stops.
    void askFilmed().catch(() => {});
    return job;
  } catch (e) {
    // No upload was made (sendDraft throws only before one exists): nothing new for a launch to resume.
    if (!loadUnsent().find((u) => u.recordingId === note)?.jobId) {
      if (before) putUnsent(before);
      else dropUnsent(note);
    }
    throw e;
  }
}
