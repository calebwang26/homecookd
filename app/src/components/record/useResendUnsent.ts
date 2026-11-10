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
// Her own "Send again" on a row whose upload gave up (Caleb, Nov 10) sends that note now through the same
// steps, by hand (no give-up for its tries or age). A note is never sent from here twice at once.
//
//   useResendUnsent();   (app/_layout, inside the session)
//   await sendNoteAgain(noteId, profiles, learners, onStarted)   Home's Send again (components/parent/sendAgain)
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Profile } from '@/lib/api';
import { AWS_ON } from '@/lib/aws/config';
import { cancelLiveJob, recordingJob, uploadJob } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { clipFile, resendStep, sendsBySelf, type ResendStep, type Unsent, type UnsentClip } from '@/lib/unsentLogic';
import { cleanOrphanCopies, clipsHere, countResend, dropUnsent, loadUnsent, markUnsentJob, savedHere, stillUnsent, unsentUri } from '@/lib/unsentRecordings';
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
/** Being sent from here right now (a launch's pass or her Send again): never two at once. */
const inFlight = new Set<string>();
let running = false;
/** The kept copies no note lists were tidied in this run of the app (once). */
let tidied = false;

/** This recording's upload rows on Home (jobs.json): the one on its note, and any found by its recording id. */
const rowsOf = (u: Unsent) => loadJobs().filter((j) => j.job_id === u.jobId || j.recording_id === u.recordingId || j.unsent_id === u.recordingId);

/** One note, as a launch does it (`byHand`: her Send again). 'unreachable': the server couldn't say what exists. */
async function resendOne(u: Unsent, cook: Profile, profiles: Profile[], learners: Profile[], byHand = false, onStarted?: () => void): Promise<ResendStep | 'unreachable'> {
  inFlight.add(u.recordingId);
  try {
    return await resendNote(u, cook, profiles, learners, byHand, onStarted);
  } finally {
    inFlight.delete(u.recordingId);
  }
}

async function resendNote(u: Unsent, cook: Profile, profiles: Profile[], learners: Profile[], byHand: boolean, onStarted?: () => void): Promise<ResendStep | 'unreachable'> {
  const here = clipsHere(u);
  const recordingId = u.local ? null : u.recordingId;
  const seen = loadJobs().find((j) => j.job_id === u.jobId);
  // On AWS there are no recording rows: every note's job is found by its upload.
  const job = u.local || AWS_ON ? await uploadJob(u.jobId, seen?.convex_job === 'ok', cook.id) : await recordingJob(u.recordingId, cook.id);
  const row = loadJobs().find((j) => j.job_id === u.jobId);
  const step = resendStep(u, { convexJob: job, upload: row?.local_state ?? null, clipsHere: here.length, now: Date.now(), byHand });
  if (step === 'wait') {
    looked.delete(u.recordingId);
    return job === undefined ? 'unreachable' : 'wait';
  }
  if (!stillUnsent(u.recordingId)) return 'done'; // stopped on Home meanwhile
  const to = doneTo(cook.id, profiles, learners, u);
  const title = (u.dish ?? '').trim().slice(0, MAX_TITLE);
  if (step === 'done') {
    dropUnsent(u.recordingId);
    return step;
  }
  if (step === 'give-up') {
    // Never by hand: her Send again on Home is a fresh first try (its videos stay in documents/recordings/).
    console.warn('[unsent] gave up sending', u.recordingId);
    dropUnsent(u.recordingId);
    return step;
  }
  if (step === 'create') {
    countResend(u.recordingId);
    await makeJob(u.jobId!, cook.id, { kids: to.picked, glasses: !!u.glasses, language: u.language, recordingId, title });
    dropUnsent(u.recordingId);
    return step;
  }
  // 'gone': nothing to send. A job is left alone (its files may have arrived); with none, its rows are dead.
  if (step === 'gone') {
    if (!job) for (const r of rowsOf(u)) removeJob(r.job_id);
    dropUnsent(u.recordingId);
    return step;
  }
  // 'redo', 'send': the job the worker says is missing files is stopped first, and the old rows go.
  countResend(u.recordingId);
  if (job && !(await cancelLiveJob(job.id, cook.id))) {
    dropUnsent(u.recordingId); // it finished meanwhile
    return 'done';
  }
  // That job is stopped now, by us, to send again: the note no longer points at it. Else a send that fails below
  // before its new upload exists leaves the note on a job that reads "Cancelled.", which the next look takes for
  // her own stop ('done') and drops the note: the recording never sent, and no row for it (it happened at launch).
  if (job) markUnsentJob(u.recordingId, null);
  for (const r of rowsOf(u)) {
    cancelJobUploads(r.job_id);
    removeJob(r.job_id);
  }
  if (!stillUnsent(u.recordingId)) return 'done';
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
    onStarted,
  });
  return step;
}

/**
 * Her "Send again" on Home: that note now, as its cook, the way a launch would (by hand: no give-up). 'sent': a
 * new send started, or nothing was left to do (the server has the files, or it was stopped); 'busy': it's being
 * sent from here already; 'waiting': its job is queued or being claimed, so it's on its way without a send;
 * 'unreachable': the server couldn't say what exists (never a second copy on a guess); 'gone': its note or its
 * videos aren't on this phone. A send that throws leaves the note for the next pass (and says why to her).
 */
export async function sendNoteAgain(
  noteId: string,
  profiles: Profile[],
  learners: Profile[],
  onStarted?: () => void,
): Promise<'sent' | 'busy' | 'waiting' | 'unreachable' | 'gone'> {
  if (inFlight.has(noteId)) return 'busy';
  const u = loadUnsent().find((x) => x.recordingId === noteId);
  if (!u || !clipsHere(u).length) return 'gone';
  const cook = profiles.find((p) => p.id === u.cookId);
  if (!cook) return 'unreachable'; // the family isn't loaded (her own row is hers)
  looked.add(noteId); // a launch's pass in this run leaves it to this
  let step: ResendStep | 'unreachable';
  try {
    step = await resendOne(u, cook, profiles, learners, true, onStarted);
  } catch (e) {
    looked.delete(noteId); // didn't send: the next pass (the app back to the front) sends it by itself
    throw e;
  }
  if (step === 'unreachable') {
    looked.delete(noteId);
    return 'unreachable';
  }
  // Queued or being claimed: the server has it already (nothing sent from here).
  if (step === 'wait') return 'waiting';
  return step === 'gone' ? 'gone' : 'sent';
}

async function resendAll(familyId: string, profiles: Profile[], learners: Profile[]) {
  if (running) return;
  running = true;
  if (!tidied) {
    tidied = true;
    cleanOrphanCopies();
  }
  try {
    for (const u of loadUnsent()) {
      if (!sendsBySelf(u) || u.familyId !== familyId || looked.has(u.recordingId) || inFlight.has(u.recordingId) || savedHere(u.recordingId)) continue;
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
