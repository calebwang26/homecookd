// After the app died with a recording not fully sent (a crash at "Done! Sending it to Shreya", a
// swipe-away mid-upload, also a Send-screen upload of camera-roll videos): sends it again in the
// background, as the cook who filmed it, whoever is in on the phone (lib/unsentRecordings; the phone
// opens as usual). A recording the app died in while she was still filming is never sent from here:
// her Home asks her (StoppedEarlyCard). It runs once the family is loaded and
// each time the app comes back to the front, each recording once per run of the app unless it's
// waiting (Convex couldn't answer, or the worker hasn't said yet). Convex first says what exists
// (lib/unsentLogic resendStep); then it makes only a missing job, or stops a job the worker says is
// missing files (an hour on) and sends again the way the done view does (sendDraft). A Send-screen
// note (`local`) has no Convex recording: its job is found by its upload folder (uploadJob). The recording's
// old rows on Home go first (found by its recording id), so one "Sending your videos" row shows. A
// note stopped on Home while this ran is left alone (re-read before acting).
//
//   useResendUnsent();   (app/_layout, inside the session)
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Profile } from '@/lib/api';
import { cancelLiveJob, recordingJob, uploadJob } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { clipFile, resendStep, sendsBySelf, type Unsent, type UnsentClip } from '@/lib/unsentLogic';
import { clipsHere, countResend, dropUnsent, loadUnsent, savedHere, stillUnsent, unsentUri } from '@/lib/unsentRecordings';
import { cancelJobUploads, loadJobs, removeJob, uploadsSupportedHere } from '@/lib/uploads';

import { chunkClip } from './cameraLogic';
import type { DraftClip } from './draft';
import { makeJob, MAX_TITLE, sendDraft } from './sendDraft';
import { doneTo } from './who';

/** A note's videos still on the phone, as the clips a send takes. */
export function keptClips(here: UnsentClip[]): DraftClip[] {
  return here.map((c, i) => {
    const d = chunkClip({ uri: unsentUri(c), startedAt: c.startedAt, durationMs: c.durationMs, width: c.width, height: c.height }, i + 1);
    return { ...d, asset: { ...d.asset, ...clipFile(c.path, i + 1) } };
  });
}

/** Looked at in this run of the app: each one once (unless Convex couldn't answer). */
const looked = new Set<string>();
let running = false;

/** This recording's upload rows on Home (jobs.json): the one on its note, and any found by its recording id. */
const rowsOf = (u: Unsent) => loadJobs().filter((j) => j.job_id === u.jobId || j.recording_id === u.recordingId || j.unsent_id === u.recordingId);

async function resendOne(u: Unsent, cook: Profile, profiles: Profile[], learners: Profile[]) {
  const here = clipsHere(u);
  const recordingId = u.local ? null : u.recordingId;
  const job = u.local ? await uploadJob(u.jobId, cook.id) : await recordingJob(u.recordingId, cook.id);
  const row = loadJobs().find((j) => j.job_id === u.jobId);
  const step = resendStep(u, { convexJob: job, upload: row?.local_state ?? null, clipsHere: here.length, now: Date.now() });
  if (step === 'wait') return void looked.delete(u.recordingId);
  if (!stillUnsent(u.recordingId)) return; // stopped on Home meanwhile
  const to = doneTo(cook.id, profiles, learners, u);
  const title = (u.dish ?? '').trim().slice(0, MAX_TITLE);
  if (step === 'done') return dropUnsent(u.recordingId);
  if (step === 'give-up') {
    // TODO(caleb): a way to send a given-up recording by hand (its videos stay in documents/recordings/).
    console.warn('[unsent] gave up sending', u.recordingId);
    return dropUnsent(u.recordingId);
  }
  if (step === 'create') {
    countResend(u.recordingId);
    await makeJob(u.jobId!, cook.id, { kids: to.picked, glasses: !!u.glasses, language: u.language, recordingId, title });
    return dropUnsent(u.recordingId);
  }
  // 'gone': nothing to send. A job is left alone (its files may have arrived); with none, its rows are dead.
  if (step === 'gone') {
    if (!job) for (const r of rowsOf(u)) removeJob(r.job_id);
    return dropUnsent(u.recordingId);
  }
  // 'redo', 'send': the job the worker says is missing files is stopped first, and the old rows go.
  countResend(u.recordingId);
  if (job && !(await cancelLiveJob(job.id, cook.id))) return dropUnsent(u.recordingId); // it finished meanwhile
  for (const r of rowsOf(u)) {
    cancelJobUploads(r.job_id);
    removeJob(r.job_id);
  }
  if (!stillUnsent(u.recordingId)) return;
  await sendDraft({
    me: cook,
    draft: { glasses: !!u.glasses, language: u.language, recordingId },
    clips: keptClips(here),
    kids: to.picked,
    recipients: to.recipients,
    toLabel: to.label,
    dish: title,
    hello: u.hello ?? null,
    note: u.recordingId,
  });
}

async function resendAll(familyId: string, profiles: Profile[], learners: Profile[]) {
  if (running) return;
  running = true;
  try {
    for (const u of loadUnsent()) {
      if (!sendsBySelf(u) || u.familyId !== familyId || looked.has(u.recordingId) || savedHere(u.recordingId)) continue;
      const cook = profiles.find((p) => p.id === u.cookId);
      if (!cook) {
        // Not in this family any more: kept until it's too old to send.
        if (resendStep(u, { convexJob: undefined, upload: null, clipsHere: 0, now: Date.now() }) === 'give-up') dropUnsent(u.recordingId);
        continue;
      }
      looked.add(u.recordingId);
      await resendOne(u, cook, profiles, learners).catch((e) => console.warn('[unsent] resend failed', String(e).slice(0, 160)));
    }
  } finally {
    running = false;
  }
}

export function useResendUnsent() {
  const { status, family, profiles, learners } = useSession();
  const people = useRef({ profiles, learners });
  useEffect(() => {
    people.current = { profiles, learners };
  });
  const familyId = family?.id ?? null;
  const ready = status === 'ready' && !!familyId && uploadsSupportedHere;
  useEffect(() => {
    if (!ready || !familyId) return;
    const go = () => void resendAll(familyId, people.current.profiles, people.current.learners);
    go();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') go();
    });
    return () => sub.remove();
  }, [ready, familyId]);
}
