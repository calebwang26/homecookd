// Recordings still on their way (lib/uploads.ts jobs), shown at the top of "Your recipes" as greyed
// ProcessingRows.
//   const pending = usePendingRecipes();   pending.jobs, pending.views[job_id], pending.act (stop / undo / clear)
// Stop (Caleb, Oct 24: "let me actually cancel these uploads"): the x stops it with no confirm. The row
// says "Stopped" with Undo for a few seconds (stops.ts), then the real stop runs: Convex first (what a
// worker takes: jobs.cancel, or jobs.cancelUpload by the upload's folder when there's no job id here),
// then this phone's upload. The signer's cancel marker is best-effort: it refuses an upload Convex
// doesn't know yet, which used to fail the whole stop with "Couldn't stop it". The stop first waits
// for this upload's jobs.create (sendDraft), and a running Convex job from a stopped upload that shows
// up later anyway is stopped too. Leaving the app (app switcher, home) runs a waiting stop at once.
// Polls the job status on focus, every 60 s and on return to the app; retries the pending send
// (who gets it) until the backend has it; drops a job once its recipe is in the library and, when
// it was for someone, the backend knows who gets it (a late POST delivers right away). So a
// finished row disappears and the real recipe takes its place. The worker's live stage comes from
// Convex jobs.mine, only this cook's own (Caleb, Nov 1) (matched by the upload folder, "<job_id>/"). In Convex mode the worker
// writes no status file, so a job is also done once its live stage is 'done' and its recipe (the
// job's Convex recipeId, mapped to a library id through recipes.list) is in the library.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ensureJob, jobCreated } from '@/components/record/sendDraft';
import { sendNoteAgain } from '@/components/record/useResendUnsent';
import { fadeOutFast, listEnter, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { errorMessage } from '@/lib/api';
import { requestCancel } from '@/lib/deletes';
import { cancelLiveJob, cancelLiveUpload, libraryIdOf as findLibraryId, useLiveJobs, type LiveJob } from '@/lib/live/convex';
import { refreshLibrary, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { noteForRow, sendAgainOffer } from '@/lib/unsentLogic';
import { clipsHere, dropUnsentFor, loadUnsent, subscribeUnsent, unsentVersion } from '@/lib/unsentRecordings';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import {
  cancelJobUploads,
  ensurePendingSend,
  fetchJobStatus,
  loadJobs,
  needsPendingSend,
  removeJob,
  subscribeUploads,
  type JobStatus,
  type StoredJob,
} from '@/lib/uploads';

import { liveJobCancelled, liveJobFinished, recipeIdsToLookUp, sendAgainRow } from './jobsLogic';
import { describeJob, ProcessingRow, stoppedView, type ProcessingView } from './ProcessingRow';
import { sendAgain, sendAgainLook, useSendAgainVersion } from './sendAgain';
import { flushStops, inTime, markGone, stopSoon, undoStop, UNDO_MS, UNDO_MS_SCREEN_READER, useStops } from './stops';

const POLL_MS = 60_000;
/** How long a stop waits for Convex (it queues a mutation while offline) or for jobs.create. */
const STOP_WAIT_MS = 15_000;

// Once for the app: a stop waiting out its Undo runs as soon as she leaves the app (timers may never
// fire in the background, and a swipe-away from the app switcher would lose it).
AppState.addEventListener('change', (s) => {
  if (s !== 'active') flushStops();
});
// VoiceOver on: a longer Undo. (React Native Web always says a screen reader is on.)
let screenReader = false;
if (Platform.OS !== 'web') {
  void AccessibilityInfo.isScreenReaderEnabled().then((on) => (screenReader = on));
  AccessibilityInfo.addEventListener('screenReaderChanged', (on) => (screenReader = on));
}
/** Running Convex jobs from stopped uploads that this phone already asked to stop again. */
const restopped = new Set<string>();

const uploadIdOf = (l: LiveJob) => l.uploadPath.replace(/\/$/, '');
/** Stages a Convex job is still in. */
const RUNNING = new Set(['uploading', 'queued', 'preparing', 'understanding', 'writing', 'indexing']);

/**
 * Her own Convex job this phone didn't send (the laptop's glasses jobs, her other phone's) as a row: no upload
 * here, so it reads straight from the worker's live stage. Its id is the Convex job id.
 */
function liveOnlyJob(l: LiveJob, t: T): StoredJob {
  return {
    job_id: l._id,
    status_url: '',
    title: l.title || t(l.source === 'glasses' ? 'parent.pending.glassesRecording' : 'parent.pending.recording'),
    cook_name: '',
    relation: '',
    created_at: new Date(l._creationTime ?? Date.now()).toISOString(),
    file_count: 1,
    local_state: 'uploaded',
  };
}

export type PendingState = {
  /** This cook's jobs still on screen, newest first. */
  jobs: StoredJob[];
  views: Record<string, ProcessingView>;
  /** Stop (Undo for a few seconds), undo that, or clear, per the row's action. */
  act: (job: StoredJob) => void;
  /** Her Send again on a row whose upload gave up (view.again): its kept videos, sent again (sendAgain). */
  again: (job: StoredJob) => void;
  poll: () => Promise<void>;
};

export function usePendingRecipes(): PendingState {
  const { me, profiles, learners } = useSession();
  const { entries } = useLibrary();
  const toast = useToast();
  const { t } = useWords();
  const [jobs, setJobs] = useState<StoredJob[]>(() => loadJobs());
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  // The clock the rows read (the writing estimate moves with it): set on every poll and upload report.
  const [now, setNow] = useState(() => Date.now());
  const stops = useStops();
  const liveJobs = useLiveJobs(me?.role === 'cook');
  // The kept recordings (Send again needs a row's note and its videos on the phone), and each one's Send again.
  const notesVersion = useSyncExternalStore(subscribeUnsent, unsentVersion, unsentVersion);
  const againVersion = useSendAgainVersion();

  // Re-read jobs and progress whenever an upload reports in.
  useEffect(
    () =>
      subscribeUploads(() => {
        setJobs(loadJobs());
        setNow(Date.now());
      }),
    [],
  );

  const poll = useCallback(async () => {
    const current = loadJobs();
    setJobs(current);
    setNow(Date.now());
    if (current.length === 0) return;
    // Who gets it: retry a pending send the Send screen couldn't save.
    for (const j of current) if (needsPendingSend(j)) void ensurePendingSend(j);
    const results = await Promise.all(current.map(async (j) => [j.job_id, await fetchJobStatus(j)] as const));
    setStatuses((prev) => {
      const next = { ...prev };
      for (const [id, s] of results) if (s) next[id] = s;
      return next;
    });
    if (results.some(([, s]) => s?.status === 'published')) void refreshLibrary();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void poll();
      const timer = setInterval(() => void poll(), POLL_MS);
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') void poll();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [poll]),
  );

  // The worker's live job per upload folder ("<job_id>/").
  const liveByJob = useMemo(() => new Map<string, LiveJob>(liveJobs.map((l) => [uploadIdOf(l), l])), [liveJobs]);
  // Jobs still running that no local row covers (her glasses jobs, her uploads from another phone),
  // except one from an upload she just stopped (its jobs.create landed late: stopped below).
  const liveOnly = useMemo(() => {
    const mine = new Set(jobs.map((j) => j.job_id));
    return liveJobs.filter((l) => RUNNING.has(l.stage) && !mine.has(uploadIdOf(l)) && stops.get(uploadIdOf(l)) !== 'gone');
  }, [liveJobs, jobs, stops]);

  // Every row sent from this phone gets its Convex job: jobs.create again until Convex lists it (jobRetry).
  useEffect(() => {
    for (const j of jobs) if (stops.get(j.job_id) == null) ensureJob(j, liveByJob.has(j.job_id));
  }, [jobs, liveByJob, stops, now]);

  // A Convex job still running for an upload she stopped (made after the stop, or before Convex had
  // jobs.cancelUpload): stop it too, once.
  useEffect(() => {
    for (const l of liveJobs) {
      if (!RUNNING.has(l.stage) || stops.get(uploadIdOf(l)) !== 'gone' || restopped.has(l._id)) continue;
      restopped.add(l._id);
      cancelLiveJob(l._id).catch((err) => {
        restopped.delete(l._id); // tried again on the next update
        console.warn('[uploads] late stop failed', err);
      });
    }
  }, [liveJobs, stops]);

  // A finished live job's library id, from its Convex recipe id (asked again when the library changes).
  const libraryIds = entries.map((e) => e.id).join('|');
  const [libraryIdOf, setLibraryIdOf] = useState<Record<string, string>>({});
  const lookUp = recipeIdsToLookUp(liveJobs, libraryIdOf).join('|');
  useEffect(() => {
    if (!lookUp) return;
    let alive = true;
    void Promise.all(lookUp.split('|').map(async (id) => [id, await findLibraryId(id).catch(() => null)] as const)).then((pairs) => {
      const found = pairs.filter((p): p is readonly [string, string] => !!p[1]);
      if (alive && found.length) setLibraryIdOf((prev) => ({ ...prev, ...Object.fromEntries(found) }));
    });
    return () => {
      alive = false;
    };
  }, [lookUp, libraryIds]);

  // Published (or live 'done'), in the library and (if it was for someone) handed to them: the job is
  // done. Cancelled (maybe from another phone): stop & drop.
  useEffect(() => {
    const ids = new Set(libraryIds.split('|'));
    const done = jobs.filter((j) => {
      const s = statuses[j.job_id];
      if (s?.status === 'cancelled' || liveJobCancelled(liveByJob.get(j.job_id))) return true;
      if (liveJobFinished(liveByJob.get(j.job_id), libraryIdOf, ids, needsPendingSend(j))) return true;
      return s?.status === 'published' && !!s.recipe_id && ids.has(s.recipe_id) && !needsPendingSend(j);
    });
    if (done.length === 0) return;
    for (const j of done) {
      if (statuses[j.job_id]?.status === 'cancelled' || liveJobCancelled(liveByJob.get(j.job_id))) cancelJobUploads(j.job_id);
      removeJob(j.job_id); // emits -> the subscription above re-reads the jobs
    }
  }, [jobs, statuses, libraryIds, liveByJob, libraryIdOf]);

  // The real stop, once Undo's few seconds are over. Only Convex failing (no connection) keeps the
  // recipe going: then the row comes back and says so.
  const stop = useCallback(
    async (job: StoredJob): Promise<boolean> => {
      const liveOnlyRow = liveOnly.some((l) => l._id === job.job_id);
      const live = liveByJob.get(job.job_id);
      try {
        if (liveOnlyRow) await inTime(cancelLiveJob(job.job_id), STOP_WAIT_MS);
        else if (live) await inTime(cancelLiveJob(live._id), STOP_WAIT_MS);
        else {
          // Sent from this phone a moment ago: let its job be made, then stop it by the upload's folder.
          await inTime(jobCreated(job.job_id), STOP_WAIT_MS).catch(() => {});
          await inTime(cancelLiveUpload(job.job_id), STOP_WAIT_MS);
        }
      } catch (err) {
        console.warn('[uploads] stop failed', err);
        toast.show(t('parent.pending.stopFailed'), { tone: 'error' });
        return false;
      }
      if (liveOnlyRow) return true; // another phone's or the laptop's upload: nothing to stop here
      cancelJobUploads(job.job_id);
      requestCancel(job.job_id).catch((err) => console.warn('[uploads] signer cancel (best-effort)', err));
      removeJob(job.job_id);
      dropUnsentFor(job); // and a crash note that would send it again (lib/unsentRecordings)
      setJobs(loadJobs());
      return true;
    },
    [toast, liveByJob, liveOnly, t],
  );

  const views = useMemo(() => {
    const all: Record<string, ProcessingView> = {
      ...Object.fromEntries(
        jobs.map((j) => {
          const live = liveByJob.get(j.job_id);
          return [j.job_id, describeJob(j, statuses[j.job_id], now, live, live?.recipeId ? libraryIdOf[live.recipeId] : undefined, t)];
        }),
      ),
      ...Object.fromEntries(liveOnly.map((l) => [l._id, describeJob(liveOnlyJob(l, t), undefined, now, l, undefined, t)])),
    };
    for (const [id, state] of stops) if (all[id] && state !== 'gone') all[id] = stoppedView(state, t);
    // A row whose upload from this phone gave up: Send again when its videos are still here (Caleb, Nov 10).
    const notes = loadUnsent();
    for (const j of jobs) {
      const v = all[j.job_id];
      if (!v?.uploadFailed || stops.has(j.job_id)) continue;
      const note = noteForRow(notes, j);
      all[j.job_id] = sendAgainRow(v, sendAgainOffer(note, note ? clipsHere(note).length : 0), note ? sendAgainLook(note.recordingId) : 'offer', t);
    }
    return all;
    // notesVersion and againVersion: the kept recordings and each Send again, read above from their stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, statuses, now, liveByJob, libraryIdOf, liveOnly, stops, t, notesVersion, againVersion]);

  const act = useCallback(
    (job: StoredJob) => {
      const action = views[job.job_id]?.action;
      if (action === 'undo') {
        undoStop(job.job_id);
        return;
      }
      if (action === 'cancel') {
        stopSoon(job.job_id, () => stop(job), screenReader ? UNDO_MS_SCREEN_READER : UNDO_MS);
        AccessibilityInfo.announceForAccessibility(t('parent.pending.stoppedAnnounce', { dish: job.title }));
        return;
      }
      if (action === 'remove') {
        // A stalled or half-sent upload is still open on the server: close it there too, quietly.
        if ((statuses[job.job_id]?.status ?? 'uploading') === 'uploading') {
          cancelJobUploads(job.job_id);
          requestCancel(job.job_id).catch((err) => console.warn('[uploads] quiet cancel failed', err));
        }
        // Its live job, if one still runs (on 1.1 a failed upload's job waits in 'uploading'), is stopped by the
        // effect above, once, and never comes back as a row of its own (requestCancel does nothing on AWS).
        markGone(job.job_id);
        removeJob(job.job_id);
        dropUnsentFor(job);
        setJobs(loadJobs());
      }
    },
    [views, statuses, stop, t],
  );

  // One tap, one send (Send's own machine, per recording): her yes to the AI companies, then that note sent again
  // the way a launch does; a failure says why and the button comes back. The old row goes once the new send starts.
  const again = useCallback(
    (job: StoredJob) => {
      const note = noteForRow(loadUnsent(), job);
      if (!note) return;
      void sendAgain(note.recordingId, {
        consent: () => ensureAiConsent(),
        send: async (started) => {
          let begun = false;
          const r = await sendNoteAgain(note.recordingId, profiles, learners, () => {
            begun = true;
            started();
          });
          if (r === 'unreachable') throw new Error(t('parent.processing.cantReach'));
          if (r === 'gone') throw new Error(t('parent.processing.videosGone'));
          // Nothing was left to send (the server has the files, or it's already on its way): the row moves on by itself.
          if (!begun) started();
          setJobs(loadJobs());
        },
        failed: (e) => toast.show(errorMessage(e, t('parent.stopped.didntSend')), { tone: 'error' }),
      });
    },
    [profiles, learners, t, toast],
  );

  // Only this cook's recordings (another profile on this phone has their own list), then every other job of
  // the family still in the pipeline, so nothing is ever processing out of sight. A stopped one is gone.
  const visible = useMemo(
    () =>
      [
        ...jobs.filter((j) => statuses[j.job_id]?.status !== 'cancelled' && (!me || !j.sender_id || j.sender_id === me.id)),
        ...liveOnly.map((l) => liveOnlyJob(l, t)),
      ].filter((j) => stops.get(j.job_id) !== 'gone'),
    [jobs, statuses, me, liveOnly, stops, t],
  );

  return { jobs: visible, views, act, again, poll };
}

/** The rows for `jobs` (a filtered subset of pending.jobs is fine). */
export function PendingList({ pending, jobs = pending.jobs, startIndex = 0 }: { pending: PendingState; jobs?: StoredJob[]; startIndex?: number }) {
  if (jobs.length === 0) return null;
  return (
    <View style={styles.list}>
      {jobs.map((job, i) => {
        const view = pending.views[job.job_id];
        if (!view) return null;
        return (
          <Animated.View key={job.job_id} entering={listEnter(startIndex + i)} exiting={fadeOutFast}>
            <ProcessingRow
              job={job}
              view={view}
              onAction={() => pending.act(job)}
              onOpen={(id) => router.push({ pathname: '/my-recipe/[id]', params: { id } })}
              onRetry={() => router.push('/record')}
              onSendAgain={() => pending.again(job)}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
});
