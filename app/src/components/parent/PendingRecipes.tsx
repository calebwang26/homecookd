// Recordings still on their way (lib/uploads.ts jobs), shown at the top of "Your recipes" as greyed
// ProcessingRows.
//   const pending = usePendingRecipes();   pending.jobs, pending.views[job_id], pending.act (cancel / clear)
// Polls the job status on focus, every 60 s and on return to the app; retries the pending send
// (who gets it) until the backend has it; drops a job once its recipe is in the library and, when
// it was for someone, the backend knows who gets it (a late POST delivers right away). So a
// finished row disappears and the real recipe takes its place. The worker's live stage comes from
// Convex jobs.forFamily (matched by the upload folder, "<job_id>/"). In Convex mode the worker
// writes no status file, so a job is also done once its live stage is 'done' and its recipe (the
// job's Convex recipeId, mapped to a library id through recipes.list) is in the library.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { fadeOutFast, listEnter, useToast } from '@/components/ui';
import { requestCancel } from '@/lib/deletes';
import { cancelLiveJob, libraryIdOf as findLibraryId, useLiveJobs, type LiveJob } from '@/lib/live/convex';
import { refreshLibrary, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
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

import { liveJobFinished, recipeIdsToLookUp } from './jobsLogic';
import { describeJob, ProcessingRow, type ProcessingView } from './ProcessingRow';

const POLL_MS = 60_000;
/** Stages a Convex job is still in. */
const RUNNING = new Set(['uploading', 'queued', 'preparing', 'understanding', 'writing', 'indexing']);

/**
 * A Convex job this phone didn't send (the laptop's glasses jobs, another phone's) as a row: no upload
 * here, so it reads straight from the worker's live stage. Its id is the Convex job id.
 */
function liveOnlyJob(l: LiveJob): StoredJob {
  return {
    job_id: l._id,
    status_url: '',
    title: l.title || (l.source === 'glasses' ? 'glasses recording' : 'recording'),
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
  cancellingId: string | null;
  /** Cancel (with a confirm) or clear, per the row's action. */
  act: (job: StoredJob) => void;
  poll: () => Promise<void>;
};

export function usePendingRecipes(): PendingState {
  const { me } = useSession();
  const { entries } = useLibrary();
  const toast = useToast();
  const [jobs, setJobs] = useState<StoredJob[]>(() => loadJobs());
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  // The clock the rows read (the writing estimate moves with it): set on every poll and upload report.
  const [now, setNow] = useState(() => Date.now());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const liveJobs = useLiveJobs(me?.role === 'cook');

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
  const liveByJob = useMemo(() => new Map<string, LiveJob>(liveJobs.map((l) => [l.uploadPath.replace(/\/$/, ''), l])), [liveJobs]);
  // Jobs still running that no local row covers (the laptop's glasses jobs, another phone's uploads).
  const liveOnly = useMemo(() => {
    const mine = new Set(jobs.map((j) => j.job_id));
    return liveJobs.filter((l) => RUNNING.has(l.stage) && !mine.has(l.uploadPath.replace(/\/$/, '')));
  }, [liveJobs, jobs]);

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
      if (s?.status === 'cancelled') return true;
      if (liveJobFinished(liveByJob.get(j.job_id), libraryIdOf, ids, needsPendingSend(j))) return true;
      return s?.status === 'published' && !!s.recipe_id && ids.has(s.recipe_id) && !needsPendingSend(j);
    });
    if (done.length === 0) return;
    for (const j of done) {
      if (statuses[j.job_id]?.status === 'cancelled') cancelJobUploads(j.job_id);
      removeJob(j.job_id); // emits -> the subscription above re-reads the jobs
    }
  }, [jobs, statuses, libraryIds, liveByJob, libraryIdOf]);

  const doCancel = useCallback(
    async (job: StoredJob) => {
      setCancellingId(job.job_id);
      try {
        // The Convex job is what a worker takes: stop it there, so nothing is left clogging the queue.
        const live = liveByJob.get(job.job_id) ?? liveOnly.find((l) => l._id === job.job_id);
        if (live) await cancelLiveJob(live._id);
        if (liveOnly.some((l) => l._id === job.job_id)) {
          toast.show(`Stopped your ${job.title}`);
          return;
        }
        await requestCancel(job.job_id);
        cancelJobUploads(job.job_id);
        removeJob(job.job_id);
        setJobs(loadJobs());
        toast.show(`Stopped your ${job.title}`);
      } catch (err) {
        console.warn('[uploads] cancel failed', err);
        toast.show('Couldn’t stop it. Try again.', { tone: 'error' });
      } finally {
        setCancellingId(null);
      }
    },
    [toast, liveByJob, liveOnly],
  );

  const views = useMemo(
    () => ({
      ...Object.fromEntries(
        jobs.map((j) => {
          const live = liveByJob.get(j.job_id);
          return [j.job_id, describeJob(j, statuses[j.job_id], now, live, live?.recipeId ? libraryIdOf[live.recipeId] : undefined)];
        }),
      ),
      ...Object.fromEntries(liveOnly.map((l) => [l._id, describeJob(liveOnlyJob(l), undefined, now, l)])),
    }),
    [jobs, statuses, now, liveByJob, libraryIdOf, liveOnly],
  );

  const act = useCallback(
    (job: StoredJob) => {
      if (views[job.job_id]?.action === 'remove') {
        // A stalled or half-sent upload is still open on the server: close it there too, quietly.
        if ((statuses[job.job_id]?.status ?? 'uploading') === 'uploading') {
          cancelJobUploads(job.job_id);
          requestCancel(job.job_id).catch((err) => console.warn('[uploads] quiet cancel failed', err));
        }
        removeJob(job.job_id);
        setJobs(loadJobs());
        return;
      }
      if (cancellingId) return;
      const title = `Stop making your ${job.title}?`;
      const message = 'No recipe will be made from these videos.';
      if (Platform.OS === 'web') {
        if (globalThis.confirm?.(`${title}\n\n${message}`)) void doCancel(job);
        return;
      }
      Alert.alert(title, message, [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: () => void doCancel(job) },
      ]);
    },
    [views, statuses, cancellingId, doCancel],
  );

  // Only this cook's recordings (another profile on this phone has their own list), then every other job of
  // the family still in the pipeline, so nothing is ever processing out of sight.
  const visible = useMemo(
    () => [
      ...jobs.filter((j) => statuses[j.job_id]?.status !== 'cancelled' && (!me || !j.sender_id || j.sender_id === me.id)),
      ...liveOnly.map(liveOnlyJob),
    ],
    [jobs, statuses, me, liveOnly],
  );

  return { jobs: visible, views, cancellingId, act, poll };
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
              cancelling={pending.cancellingId === job.job_id}
              onAction={() => pending.act(job)}
              onOpen={(id) => router.push({ pathname: '/my-recipe/[id]', params: { id } })}
              onRetry={() => router.push('/record')}
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
