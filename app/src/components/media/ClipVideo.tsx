// Inline Watch: the bible's clip box (Kid-Step: 260 tall, radius 28, photo, 68 px glass play
// button in the middle). Before the tap, "This step" at the bottom says what plays (never the whole
// recording). Tapping play creates the expo-video player, seeks to `start_s`, plays, and pauses
// itself at `end_s`. Then the bottom holds the controls (ProgressRow: back / forward 10 s and a bar
// to drag) over a soft shade; tap the video to pause / resume; at the end a "Watch again" pill
// replays the range.
// The photo and a spinner stay up until the video really moves, and while it stops to load more
// (a slow connection); after 30 s of nothing, "Couldn’t load the video. Tap to try again.", and a
// tap anywhere on the video tries again.
// Without a video URL the play button shows a gentle "No video for this one yet" note.
// `full` (cook mode) adds a Full screen button top-right, before and during play: StepPlayerFull
// opens on the same range where the clip was, and closing it leaves this clip paused at the time it
// got to (it loads first if it had never played). While full screen is open the inline player is
// unmounted (the photo stands in): it can't start under the full screen, and two players never load
// the same big file.
// `chapters` (each substep's start, seconds in the file) split the bar like YouTube's chapters, inline
// and full screen.
// `ref.playFrom(at)` (cook mode, tapping a substep): plays from `at` (seconds in the file, kept inside
// the step), starting the video first if it was still the photo. Ignored while full screen is open.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconButton, PauseIcon, PlayIcon, PressableScale, Txt } from '@/components/ui';
import { chapterMarks, useClipVideo } from '@/lib/media';
import { alpha, colors, radii } from '@/theme/tokens';

import { ProgressRow } from './ProgressRow';
import { FullScreenGlyph, StepPlayerFull } from './StepPlayerFull';

export type ClipVideoHandle = { playFrom: (at: number) => void };

export type ClipVideoProps = {
  url: string | null | undefined;
  poster?: string | null;
  start_s: number;
  end_s?: number | null;
  /** Box height (default 260, as in Kid-Step). Ignored when `fitVideo` is set. */
  height?: number;
  /** Size the box to the video's own shape instead of a fixed height (sheets). */
  fitVideo?: boolean;
  /** Width / height of the video, if known (recipe.media.width / height). */
  aspectHint?: number | null;
  radius?: number;
  /** Start playing on mount (sheets) instead of waiting for a tap (inline). */
  autoPlay?: boolean;
  /** That autoplay is the app's own, not the kid's tap (cook mode: her clip homie played; lib/media). */
  appPlays?: boolean;
  /** Full video with native controls (the recipe's "Full video"). */
  whole?: boolean;
  /** "This step" over the photo before it plays (cook mode). Sheets say it in their subtitle instead. Default true. */
  showScope?: boolean;
  /** e.g. "Watch this step: Brown the beef, 0:48". */
  accessibilityLabel?: string;
  /** A Full screen button: the full-screen player's top line and the cook's words for its caption. */
  full?: { label: string; quote?: string | null } | null;
  /** Where each substep starts (seconds in the file): gaps in the bar. */
  chapters?: readonly (number | null | undefined)[] | null;
  onEnded?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ClipVideoHandle>;
};

export function ClipVideo({ ref, ...props }: ClipVideoProps) {
  const { url, poster, height = 260, radius = radii.panel, autoPlay = false, accessibilityLabel, style, fitVideo, aspectHint, showScope = true, full } = props;
  const [active, setActive] = useState(autoPlay && !!url);
  // The playing clip's own handle, and where a play asked for before it existed starts.
  const live = useRef<ClipVideoHandle>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [note, setNote] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Full screen open (from where, in the file; null = the step's start), and where it left off.
  const [fullAt, setFullAt] = useState<{ at: number | null } | null>(null);
  const [resume, setResume] = useState<{ at: number } | null>(null);
  const canFull = !!full && !!url && !props.whole;
  useImperativeHandle(ref, () => ({
    playFrom: (at) => {
      if (!url || props.whole || fullAt) return;
      if (live.current) return live.current.playFrom(at);
      setStartAt(at);
      setActive(true);
    },
  }));
  const fullPlayer =
    canFull && fullAt && url ? (
      <StepPlayerFull
        url={url}
        start_s={props.start_s}
        end_s={props.end_s ?? null}
        at={fullAt.at}
        label={full.label}
        quote={full.quote}
        chapters={props.chapters}
        aspectHint={aspectHint}
        onClose={(at) => {
          setFullAt(null);
          setResume({ at });
          setActive(true);
        }}
      />
    ) : null;

  const box: StyleProp<ViewStyle> = [
    styles.box,
    { borderRadius: radius },
    fitVideo ? { aspectRatio: aspectHint || 16 / 9 } : { height },
    style,
  ];

  if (active && url && !fullAt) {
    return (
      <ActiveClip
        key={`${url}:${props.start_s}:${props.end_s}:${props.whole}:${attempt}`}
        ref={live}
        {...props}
        startAt={startAt}
        url={url}
        boxStyle={box}
        onRetry={() => setAttempt((n) => n + 1)}
        resume={resume}
        onFull={canFull ? (at) => setFullAt({ at }) : undefined}
      />
    );
  }

  const len = props.end_s != null ? props.end_s - props.start_s : 0;
  const posterBox = (
    <PressableScale
      scaleTo={0.98}
      onPress={() => (url ? setActive(true) : setNote(true))}
      accessibilityLabel={accessibilityLabel ?? (props.whole ? 'Watch the full video' : 'Watch this step')}
      style={box}>
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <View style={[StyleSheet.absoluteFill, styles.blank]} />}
      <View style={styles.center} pointerEvents="none">
        <View style={styles.play}>
          <PlayIcon size={26} color={colors.ink} />
        </View>
      </View>
      {url && !props.whole && showScope && len > 0 ? (
        <View style={styles.band} pointerEvents="none">
          <Shade />
          <Txt variant="caption" color={colors.card} style={styles.scope}>
            This step
          </Txt>
        </View>
      ) : null}
      {note ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.noteWrap} pointerEvents="none">
          <View style={styles.note}>
            <Txt variant="label" size={14} weight={600}>
              No video for this one yet
            </Txt>
          </View>
        </Animated.View>
      ) : null}
    </PressableScale>
  );
  if (!canFull) return posterBox;
  // The button sits beside the poster's play target, not inside it (a screen reader reaches both).
  return (
    <View style={styles.posterWrap}>
      {posterBox}
      <FullButton onPress={() => setFullAt({ at: null })} />
      {fullPlayer}
    </View>
  );
}

/** The round Full screen button, top-right on the clip. */
function FullButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton tone="glass" size={44} icon={<FullScreenGlyph color={colors.ink} />} accessibilityLabel="Full screen" onPress={onPress} style={styles.fullButton} />
  );
}

function ActiveClip({
  url,
  poster,
  start_s,
  end_s,
  whole,
  fitVideo,
  aspectHint,
  onEnded,
  boxStyle,
  onRetry,
  resume,
  onFull,
  chapters,
  startAt,
  appPlays,
  ref,
}: ClipVideoProps & {
  url: string;
  /** Where the first play starts (seconds in the file; null = the step's start). */
  startAt: number | null;
  boxStyle: StyleProp<ViewStyle>;
  onRetry: () => void;
  /** Back from full screen: wait here (seconds in the file), paused. */
  resume: { at: number } | null;
  /** Full screen, from where this clip is (null when it had ended: the step's start). */
  onFull?: (at: number | null) => void;
}) {
  const v = useClipVideo(url, start_s, end_s ?? null, { whole, aspectHint, at: startAt, appPlays });
  useImperativeHandle(ref, () => ({ playFrom: v.playFrom }));
  const [firstFrame, setFirstFrame] = useState(false);
  const [shown, setShown] = useState(false);
  const isEnded = v.phase === 'ended';
  const endedCb = useRef(onEnded);
  useEffect(() => {
    endedCb.current = onEnded;
  });
  useEffect(() => {
    if (isEnded) endedCb.current?.();
  }, [isEnded]);
  // Back from full screen (or opened by it): the time it got to, paused. Still loading, it lands
  // there once ready.
  const seek = useRef(v.seek);
  useEffect(() => {
    seek.current = v.seek;
  });
  const startS = Math.max(0, Math.floor(start_s || 0));
  const marks = chapterMarks(chapters, startS, startS + v.duration);
  useEffect(() => {
    if (resume) seek.current(resume.at - startS);
  }, [resume, startS]);

  // The photo stays until the video really moves: iOS can draw the file's first frame before the
  // seek to the step lands, and a black box reads as broken.
  if (!shown && (v.elapsed > 0.25 || (firstFrame && (whole || v.phase === 'paused' || v.phase === 'ended')))) setShown(true);
  const spinning = v.phase === 'loading' || v.buffering || (v.phase === 'playing' && !shown);
  return (
    <View style={[boxStyle, fitVideo ? { aspectRatio: v.aspect } : null]}>
      <VideoView
        // Step clips never go full screen: its timeline would be the whole recording.
        fullscreenOptions={{ enable: !!whole }}
        player={v.player}
        style={styles.fill}
        contentFit={fitVideo ? 'contain' : 'cover'}
        nativeControls={!!whole}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {poster && !shown ? <Image pointerEvents="none" source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {whole || v.phase === 'error' || v.phase === 'loading' ? null : (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={v.toggle}
            accessibilityRole="button"
            accessibilityLabel={v.phase === 'playing' ? 'Pause' : 'Play'}
          />
          <View style={styles.center} pointerEvents="none">
            {v.phase === 'paused' || v.phase === 'idle' ? (
              <Animated.View entering={FadeIn.duration(150)} style={styles.play}>
                <PlayIcon size={26} color={colors.ink} />
              </Animated.View>
            ) : null}
          </View>
          {v.phase === 'ended' ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.center} pointerEvents="box-none">
              <PressableScale onPress={v.replay} accessibilityLabel="Watch again" style={styles.again}>
                <PlayIcon size={16} color={colors.ink} />
                <Txt variant="label" size={15} weight={700}>
                  Watch again
                </Txt>
              </PressableScale>
            </Animated.View>
          ) : null}
          {v.phase === 'playing' && !spinning && !onFull ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.pauseHint} pointerEvents="none">
              <PauseIcon size={14} color={colors.ink} />
            </Animated.View>
          ) : null}
          {/* box-none: a tap beside the controls still pauses / plays. */}
          <View style={[styles.band, styles.controls]} pointerEvents="box-none">
            <Shade />
            <ProgressRow elapsed={v.elapsed} duration={v.duration} progress={v.progress} onSeek={v.seek} marks={marks} tone="video" />
          </View>
        </>
      )}
      {onFull && v.phase !== 'error' ? (
        // Still loading (back from full screen), it is where full screen left it, not where it says.
        <FullButton
          onPress={() => {
            v.pause();
            onFull(v.phase === 'ended' ? null : v.phase === 'loading' ? (resume?.at ?? null) : v.now);
          }}
        />
      ) : null}
      {spinning && v.phase !== 'error' ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.play}>
            <ActivityIndicator color={colors.ink} />
          </View>
        </View>
      ) : null}
      {v.phase === 'error' ? (
        // The whole video is the retry: the note says "tap", and a kid taps the video.
        <Pressable style={styles.center} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry video">
          <View style={styles.note}>
            <Txt variant="label" size={14} weight={600}>Couldn’t load the video. Tap to try again.</Txt>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** How far above the band its shade starts, so text over a bright frame still reads. */
const SHADE_RISE = 24;

/** The hero's photo shade (transparent to photoShade), as a band's background. */
function Shade() {
  return <LinearGradient pointerEvents="none" colors={[alpha.photoShadeTop, alpha.photoShade]} style={styles.shade} />;
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: colors.ink },
  blank: { backgroundColor: colors.well },
  // width/height (not absoluteFill) so the web <video> element is sized to the box too.
  fill: { width: '100%', height: '100%' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: alpha.glassButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseHint: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: alpha.glassChip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  again: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: alpha.glassPill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fullButton: { position: 'absolute', top: 12, right: 12 },
  posterWrap: { alignSelf: 'stretch' },
  noteWrap: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' },
  note: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: alpha.glassChip },
  // The bottom of the clip: only as tall as what it holds; its shade fades in from above it.
  band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  shade: { position: 'absolute', left: 0, right: 0, top: -SHADE_RISE, bottom: 0 },
  scope: { paddingHorizontal: 16, paddingVertical: 10 },
  controls: { paddingHorizontal: 4 },
});
