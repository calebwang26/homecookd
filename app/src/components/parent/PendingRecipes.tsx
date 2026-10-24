// Recordings still on their way (lib/uploads.ts jobs), shown at the top of "Your recipes" as greyed
// ProcessingRows.
//   const pending = usePendingRecipes();   pending.jobs, pending.views[job_id], pending.act (cancel / clear)
// Polls the job status on focus, every 60 s and on return to the app; retries the pending send
// (who gets it) until the backend has it; drops a job once its recipe is in the library and, when
// it was for someone, the backend knows who gets it (a late POST delivers right away). So a
// finished row disappears and the real recipe takes its place.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { fadeOutFast, listEnter, useToast } from '@/components/ui';
import { requestCancel } from '@/lib/deletes';
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

import { describeJob, ProcessingRow, type ProcessingView } from './ProcessingRow';

const POLL_MS = 60_000;

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

  // Published, in the library and (if it was for someone) handed to them: the job is done.
  // Cancelled (maybe from another phone): stop & drop.
  const libraryIds = entries.map((e) => e.id).join('|');
  useEffect(() => {
    const ids = new Set(libraryIds.split('|'));
    const done = jobs.filter((j) => {
      const s = statuses[j.job_id];
      if (s?.status === 'cancelled') return true;
      return s?.status === 'published' && !!s.recipe_id && ids.has(s.recipe_id) && !needsPendingSend(j);
    });
    if (done.length === 0) return;
    for (const j of done) {
      if (statuses[j.job_id]?.status === 'cancelled') cancelJobUploads(j.job_id);
      removeJob(j.job_id); // emits -> the subscription above re-reads the jobs
    }
  }, [jobs, statuses, libraryIds]);

  const doCancel = useCallback(
    async (job: StoredJob) => {
      setCancellingId(job.job_id);
      try {
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
    [toast],
  );

  const views = useMemo(
    () => Object.fromEntries(jobs.map((j) => [j.job_id, describeJob(j, statuses[j.job_id], now)])),
    [jobs, statuses, now],
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

  // Only this cook's recordings (another profile on this phone has their own list).
  const visible = useMemo(
    () => jobs.filter((j) => statuses[j.job_id]?.status !== 'cancelled' && (!me || !j.sender_id || j.sender_id === me.id)),
    [jobs, statuses, me],
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
