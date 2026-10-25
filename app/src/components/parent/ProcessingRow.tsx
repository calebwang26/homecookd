// A recording that is still on its way, as a greyed row in the shared recipe list style (RecipeRow's
// card): a dimmed video frame with a spinner, "Your Sunday eggs", one honest hint with roughly how
// long is left (it may wrap to a second line) and a thin two-part bar (sending | writing the recipe).
//   Sending: the real upload from this phone ("Sending your videos · 42%", then "· about 5 min
//            left" once its speed is known), or the server's file count ("2 of 3 videos sent").
//   Writing: the server only says "processing", so the hint counts down the usual wait from the
//            moment the server started ("Writing it down · about 40 min left", "almost there",
//            then "taking longer than usual"), and the second half of the bar creeps toward 90%
//            over that wait. It never fills until the recipe really exists.
//   Ready:   the recipe exists but the send to Leo hasn't reached the server yet ("Ready · sending
//            it to Leo"), no spinner; Your recipes hides this row once the recipe card is listed.
// Live (hackathon, docs/build/STACK.md): once the videos are in, the worker's stage from Convex
// jobs.forFamily replaces the estimate: "Watching your video", "Writing the recipe"… and the second
// half of the bar is its real progress. Its 'uploading' (the worker found the video incomplete) is
// still the sending half: "Still sending the video", that half not full (components/parent/jobsLogic).
// Its 'done' opens the recipe once PendingRecipes knows its library id.
// A failed row says why in the worker's own words (or "send it again"), and tapping it opens Record
// to send the videos again. A quiet x on the right stops a recording (no confirm: the row says
// "Stopped" with Undo for a few seconds, PendingRecipes + stops.ts) or clears one that failed.
import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { useVideoFrame } from '@/components/record/videoFrame';
import { CloseIcon, IconButton, PotMark, PressableScale, Txt } from '@/components/ui';
import { plural } from '@/lib/format';
import type { LiveJob } from '@/lib/live/convex';
import { jobProgress, jobUploadLeftMs, needsPendingSend, PENDING_SEND_GIVE_UP, type JobStatus, type StoredJob } from '@/lib/uploads';
import { colors } from '@/theme/tokens';

import { STAGE_HINT, uploadingView } from './jobsLogic';
import { rowStyles } from './RecipeRow';

// No live upload in this app session, the server still waiting for files, and this old: the upload
// stopped (a force-quit stops iOS background uploads and we can't tell from here).
const STALE_UPLOAD_MS = 24 * 3600 * 1000;
// The usual wait once the videos are in (the worker polls, then writes): within the hour, or by
// tomorrow for recordings over 45 minutes.
const USUAL_WRITE_MS = 60 * 60 * 1000;
const USUAL_WRITE_LONG_MS = 12 * 3600 * 1000;
const LONG_RECORDING_S = 45 * 60;
// Inside this much of the usual wait, the hint says "almost there" instead of a number.
const ALMOST_MS = 5 * 60 * 1000;

/** "about 40 min left", rounded so it reads as the estimate it is. */
function timeLeft(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return 'less than a minute left';
  if (min < 10) return `about ${Math.ceil(min)} min left`;
  if (min < 55) return `about ${Math.ceil(min / 5) * 5} min left`;
  return `about ${plural(Math.round(min / 60), 'hr')} left`;
}

export type ProcessingView = {
  /** The one meta line. */
  hint: string;
  problem: boolean;
  /** Spinner on the thumb. */
  busy: boolean;
  /** Fill of each half of the bar (0..1), or null for no bar. */
  bar: { send: number; write: number } | null;
  /** The right-hand button: x stops (cancel) or clears (remove); Undo; a spinner while it stops. */
  action: 'cancel' | 'remove' | 'undo' | 'stopping' | null;
  /** Set once the recipe exists (the row opens it). */
  recipeId: string | null;
};

const stopped = { hint: 'Stopped', problem: false, busy: false, bar: null, recipeId: null };
/** A row just stopped: Undo while it waits, a spinner while the real stop runs. */
export const STOPPED_VIEW: Record<'waiting' | 'stopping', ProcessingView> = {
  waiting: { ...stopped, action: 'undo' },
  stopping: { ...stopped, action: 'stopping' },
};

/**
 * `libraryId`: the finished live job's recipe in the library (PendingRecipes looks it up), so the
 * row opens it.
 */
export function describeJob(job: StoredJob, status: JobStatus | undefined, now: number, worker?: LiveJob, libraryId?: string): ProcessingView {
  const server = status?.status ?? 'uploading';
  const ok = { problem: false, busy: true, bar: null, action: null, recipeId: null };
  const problem = { problem: true, busy: false, bar: null, action: 'remove' as const, recipeId: null };

  // The worker's live stage, once the videos are in (a published recipe still goes the usual way).
  const uploaded = job.local_state === 'uploaded' || server === 'processing';
  if (worker && server !== 'published' && (uploaded || worker.stage !== 'queued')) {
    if (worker.stage === 'failed') return { ...problem, hint: worker.error || 'We couldn’t finish this one · send it again' };
    if (worker.stage === 'done') return { ...ok, recipeId: libraryId ?? null, hint: 'Almost done', bar: { send: 1, write: 1 } };
    if (worker.stage === 'uploading') {
      // The worker looked and the video isn't all there yet: still the sending half.
      const { hint, send } = uploadingView(jobProgress(job.job_id), status?.files_received ?? 0, status?.files_expected || job.file_count);
      return { ...ok, hint, bar: { send, write: 0 }, action: 'cancel' };
    }
    return { ...ok, hint: STAGE_HINT[worker.stage], bar: { send: 1, write: Math.max(0.04, Math.min(1, worker.progress)) }, action: 'cancel' };
  }

  // The worker's reason is plain and says what to do ("That recording is over 4 hours. Try splitting it…").
  if (server === 'failed') return { ...problem, hint: status?.message || 'We couldn’t finish this one · send it again' };
  if (server === 'published') {
    const recipeId = status?.recipe_id ?? null;
    if (needsPendingSend(job)) {
      const who = job.recipient_label || 'them';
      if ((job.pending_send_attempts ?? 0) >= PENDING_SEND_GIVE_UP) {
        return { ...problem, recipeId, hint: `Ready, but it didn’t reach ${who} yet` };
      }
      return { ...ok, busy: false, recipeId, hint: `Ready · sending it to ${who}` };
    }
    return { ...ok, recipeId, hint: 'Almost done', bar: { send: 1, write: 1 } };
  }
  if (job.local_state === 'failed') return { ...problem, hint: 'Some videos didn’t send · send them again' };

  if (server === 'processing' || job.local_state === 'uploaded') {
    const long = (job.duration_s ?? 0) > LONG_RECORDING_S;
    const usual = long ? USUAL_WRITE_LONG_MS : USUAL_WRITE_MS;
    // The worker writes the status once when it starts; a message while processing = paused.
    const paused = server === 'processing' && !!status?.message;
    const started = server === 'processing' && !paused && status?.updated_at ? Date.parse(status.updated_at) : NaN;
    const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
    const left = usual - elapsed;
    const hint = paused
      ? 'Paused for now · it starts on its own'
      : left < 0
        ? 'Writing it down · taking longer than usual'
        : `Writing it down · ${left <= ALMOST_MS ? 'almost there' : timeLeft(left)}`;
    return { ...ok, hint, bar: { send: 1, write: Math.max(0.04, Math.min(0.9, elapsed / usual)) }, action: 'cancel' };
  }

  const live = jobProgress(job.job_id);
  if (live === null && now - Date.parse(job.created_at) > STALE_UPLOAD_MS) {
    return { ...problem, hint: 'The upload stopped. Send it again.' };
  }
  const received = status?.files_received ?? 0;
  const expected = status?.files_expected || job.file_count;
  const uploadLeft = live !== null ? jobUploadLeftMs(job.job_id, now) : null;
  const hint =
    uploadLeft !== null
      ? `Sending your videos · ${timeLeft(uploadLeft)}`
      : live !== null
        ? `Sending your videos · ${Math.round(live * 100)}%`
        : received > 0
          ? `${received} of ${expected} videos sent`
          : 'Sending your videos';
  const send = live ?? (expected > 0 ? received / expected : 0);
  return { ...ok, hint, bar: { send, write: 0 }, action: 'cancel' };
}

export function ProcessingRow({
  job,
  view,
  onAction,
  onOpen,
  onRetry,
}: {
  job: StoredJob;
  view: ProcessingView;
  /** Stop, undo or clear, per view.action. */
  onAction: () => void;
  onOpen: (recipeId: string) => void;
  /** A problem row with no recipe: send the videos again. */
  onRetry: () => void;
}) {
  const frame = useVideoFrame(job.thumb_video_uri);
  const title = `Your ${job.title}`;
  const recipeId = view.recipeId;
  const open = recipeId ? () => onOpen(recipeId) : view.problem ? onRetry : undefined;

  const label = `${title}. ${view.busy ? 'Still being made. ' : ''}${view.hint}`;
  const body = (
    <>
      <View style={rowStyles.thumb}>
        {frame ? (
          <Image source={frame} style={[StyleSheet.absoluteFill, styles.dim]} contentFit="cover" transition={200} />
        ) : view.busy ? null : (
          <View style={styles.dim}>
            <PotMark size={38} />
          </View>
        )}
        {view.busy ? <ActivityIndicator color={colors.ink} /> : null}
      </View>
      <View style={rowStyles.text}>
        <Txt variant="title" size={17} color={colors.muted} numberOfLines={2}>
          {title}
        </Txt>
        <Txt
          variant="meta"
          size={15}
          weight={view.problem ? 600 : 400}
          color={view.problem ? colors.danger : colors.muted}
          numberOfLines={view.problem ? 5 : 2}>
          {view.hint}
        </Txt>
        {view.bar ? <StageBar send={view.bar.send} write={view.bar.write} /> : null}
      </View>
    </>
  );

  return (
    <View style={rowStyles.card}>
      {open ? (
        <PressableScale
          onPress={open}
          scaleTo={0.98}
          pressedOpacity={0.85}
          accessibilityRole={recipeId ? 'link' : 'button'}
          accessibilityLabel={label}
          accessibilityHint={recipeId ? undefined : 'Opens Record to send the videos again'}
          style={styles.main}>
          {body}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.main}>
          {body}
        </View>
      )}
      {view.action === 'stopping' ? (
        <View style={styles.action}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : view.action === 'undo' ? (
        <PressableScale
          onPress={onAction}
          haptic
          accessibilityRole="button"
          accessibilityLabel={`Undo: keep making your ${job.title}`}
          style={styles.undo}>
          <Txt variant="label" size={17} weight={700} color={colors.greenDeep}>
            Undo
          </Txt>
        </PressableScale>
      ) : view.action ? (
        <IconButton
          icon={(c) => <CloseIcon size={18} color={c} />}
          tone="clear"
          size={48}
          onPress={onAction}
          accessibilityLabel={view.action === 'cancel' ? `Stop making your ${job.title}` : `Clear your ${job.title}`}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

function StageBar({ send, write }: { send: number; write: number }) {
  return (
    <View
      style={styles.bar}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(((send + write) / 2) * 100) }}>
      <Segment value={send} />
      <Segment value={write} />
    </View>
  );
}

function Segment({ value }: { value: number }) {
  const fill = useDerivedValue(() => withTiming(value, { duration: 400 }), [value]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 16 },
  dim: { opacity: 0.4 },
  bar: { flexDirection: 'row', gap: 4, marginTop: 6 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.green },
  action: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginVertical: -8, marginRight: -8 },
  undo: { minWidth: 64, height: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', marginVertical: -8, marginRight: -8 },
});
