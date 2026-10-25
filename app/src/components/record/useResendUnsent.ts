// After a crash or a kill at "Done! Sending it to Shreya": the cook's Home sends her in-app recordings
// that never reached the worker (lib/unsentRecordings), the way the done view does (sendDraft). For
// each one, Convex's recording says first whether its job already exists (then the note just goes);
// with no answer it tries again the next time Home opens. The upload row the crashed send left in
// jobs.json goes too (its video never got there), so Home shows one "Sending your videos" row.
//
//   useResendUnsent();   (parent/home)
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import type { Profile } from '@/lib/api';
import { recordingJobId } from '@/lib/live/convex';
import { getSession, useSession } from '@/lib/session';
import { resendStep, type Unsent } from '@/lib/unsentLogic';
import { clipsOnPhone, countResend, dropUnsent, loadUnsent, savedHere, unsentUri } from '@/lib/unsentRecordings';
import { removeJob, uploadsConfigured, uploadsSupportedHere } from '@/lib/uploads';

import { chunkClip } from './cameraLogic';
import { sendDraft } from './sendDraft';
import { doneTo } from './who';

/** Looked at in this run of the app: each one once (unless Convex couldn't answer). */
const looked = new Set<string>();
let running = false;

async function resendOne(u: Unsent, me: Profile, profiles: Profile[], learners: Profile[]) {
  const step = resendStep(u, { convexJobId: await recordingJobId(u.recordingId), filesHere: clipsOnPhone(u) });
  if (step === 'wait') return void looked.delete(u.recordingId);
  if (step !== 'send') {
    if (step !== 'sent' && u.jobId) removeJob(u.jobId);
    // TODO(caleb): a way to send a given-up recording by hand (its videos stay in documents/recordings/).
    if (step === 'give-up') console.warn('[unsent] gave up sending', u.recordingId);
    return dropUnsent(u.recordingId);
  }
  countResend(u.recordingId);
  if (u.jobId) removeJob(u.jobId);
  const clips = u.clips.map((c, i) => chunkClip({ uri: unsentUri(c), startedAt: c.startedAt, durationMs: c.durationMs, width: c.width, height: c.height }, i + 1));
  const to = doneTo(me.id, profiles, learners, u);
  await sendDraft({
    me,
    draft: { glasses: false, language: u.language, recordingId: u.recordingId },
    clips,
    kids: to.picked,
    recipients: to.recipients,
    toLabel: to.label,
    dish: (u.dish ?? '').trim(),
  });
}

async function resendAll(me: Profile, familyId: string, profiles: Profile[], learners: Profile[]) {
  if (running) return;
  running = true;
  try {
    // The uploads and Convex read who's in from the session's snapshot, published after this screen's
    // effects: wait a tick, and only go when it says her.
    await new Promise((r) => setTimeout(r, 0));
    if (getSession()?.me?.id !== me.id) return;
    for (const u of loadUnsent()) {
      if (u.cookId !== me.id || u.familyId !== familyId || looked.has(u.recordingId) || savedHere(u.recordingId)) continue;
      looked.add(u.recordingId);
      await resendOne(u, me, profiles, learners).catch((e) => console.warn('[unsent] resend failed', String(e).slice(0, 160)));
    }
  } finally {
    running = false;
  }
}

export function useResendUnsent() {
  const { status, me, family, profiles, learners } = useSession();
  const people = useRef({ profiles, learners });
  useEffect(() => {
    people.current = { profiles, learners };
  });
  const familyId = family?.id ?? null;
  const ready = status === 'ready' && me?.role === 'cook' && !!familyId && uploadsSupportedHere && uploadsConfigured(me?.id);
  useFocusEffect(
    useCallback(() => {
      if (!ready || !me || !familyId) return;
      void resendAll(me, familyId, people.current.profiles, people.current.learners);
    }, [ready, me, familyId]),
  );
}
