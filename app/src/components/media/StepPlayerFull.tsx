// One step's clip, full screen (kid QA round 2, notes 7 and 9; mockup A-Recorded-Watch). A dark Modal
// with the step's video whole (contain). It plays only the step, never the whole recording: the bar,
// back / forward 10 and Play all stay inside the step's range. Top: exit and "Step 2 · 3:10".
// Bottom: the cook's line roughly being said (Fraunces italic), the bar (split at each substep), then
// back 10 / play / forward 10. Tapping the video pauses or plays (a screen reader gets the round button only).
// It opens where the inline clip was and plays (its own player; starting pauses the inline one: one
// voice at a time). Exit, or Android back, hands back where it stopped (`onClose(at)`), so the inline
// clip waits there, paused. Mount it to open, unmount to close.
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { VideoView } from 'expo-video';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { IconButton, PauseIcon, PlayIcon, Txt } from '@/components/ui';
import { chapterMarks, subtitleAt, useClipVideo } from '@/lib/media';
import { useModalClaim } from '@/lib/sheets/coordinator';
import { alpha, colors } from '@/theme/tokens';

import { ProgressRow, SkipGlyph } from './ProgressRow';

const SKIP_S = 10;
const DARK = '#111915'; // the kit's dark ground

export type StepPlayerFullProps = {
  url: string;
  start_s: number;
  end_s: number | null;
  /** Seconds in the file to start at (where the inline clip was); null = the step's start. */
  at: number | null;
  /** "Step 2 · 3:10". */
  label: string;
  /** The cook's words for this step: the caption, a sentence at a time. */
  quote?: string | null;
  /** Where each substep starts (seconds in the file): gaps in the bar. */
  chapters?: readonly (number | null | undefined)[] | null;
  aspectHint?: number | null;
  /** Exit, with the time (seconds in the file) it stopped at. */
  onClose: (at: number) => void;
};

export function StepPlayerFull(props: StepPlayerFullProps) {
  // A failed load retries with a fresh player.
  const [attempt, setAttempt] = useState(0);
  const [at, setAt] = useState(props.at);
  const retry = (t: number) => {
    setAt(t);
    setAttempt((n) => n + 1);
  };
  return <Player key={attempt} {...props} at={at} onRetry={retry} />;
}

function Player({ url, start_s, end_s, at, label, quote, chapters, aspectHint, onClose, onRetry }: StepPlayerFullProps & { onRetry: (at: number) => void }) {
  // A sheet must not present over this Modal, nor while it fades out after unmounting (lib/sheets/coordinator).
  useModalClaim();
  const insets = useSafeAreaInsets();
  const v = useClipVideo(url, start_s, end_s, { at, aspectHint });
  const [firstFrame, setFirstFrame] = useState(false);
  // The dark stays over the video until it really moves: iOS can draw the file's first frame (the
  // start of the whole recording) before the seek to the step lands.
  const [from] = useState(at ?? start_s);
  const [shown, setShown] = useState(false);
  if (!shown && ((v.phase === 'playing' && Math.abs(v.now - from) > 0.25) || (firstFrame && (v.phase === 'paused' || v.phase === 'ended')))) setShown(true);
  const loading = v.phase === 'loading' || v.buffering || (v.phase === 'playing' && !shown);
  const close = () => onClose(v.now);
  const line = subtitleAt(quote, v.progress);
  const ended = v.phase === 'ended';
  const from0 = Math.max(0, Math.floor(start_s || 0));
  const marks = chapterMarks(chapters, from0, from0 + v.duration);

  return (
    <Modal visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <StatusBar style="light" />
      <View style={styles.page}>
        <VideoView player={v.player} style={styles.fill} contentFit="contain" nativeControls={false} fullscreenOptions={{ enable: false }} allowsPictureInPicture={false} onFirstFrameRender={() => setFirstFrame(true)} />
        {shown ? null : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DARK }]} />}
        {v.phase === 'error' ? (
          <Pressable style={styles.center} onPress={() => onRetry(v.now)} accessibilityRole="button" accessibilityLabel="Retry video">
            <View style={styles.note}>
              <Txt variant="label" size={14} weight={600}>
                Couldn’t load the video. Tap to try again.
              </Txt>
            </View>
          </Pressable>
        ) : (
          <Pressable style={StyleSheet.absoluteFill} onPress={ended ? v.replay : v.toggle} accessible={false} focusable={false} importantForAccessibility="no" aria-hidden />
        )}
        {loading && v.phase !== 'error' ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color={colors.card} size="large" />
          </View>
        ) : null}

        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <LinearGradient pointerEvents="none" colors={[alpha.photoShade, alpha.photoShadeTop]} style={StyleSheet.absoluteFill} />
          <IconButton tone="glassDark" icon={<FullScreenGlyph exit color={colors.card} />} accessibilityLabel="Exit full screen" onPress={close} />
          <Txt variant="label" size={15} weight={600} color={colors.card} numberOfLines={1} style={styles.label}>
            {label}
          </Txt>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <LinearGradient pointerEvents="none" colors={[alpha.photoShadeTop, alpha.photoShade]} style={styles.shade} />
          {line ? (
            <Animated.View key={line} entering={FadeIn.duration(200)} pointerEvents="none" accessibilityLiveRegion="polite">
              <Txt variant="quote" size={20} leading={1.3} color={colors.card} numberOfLines={3}>
                {`“${line}”`}
              </Txt>
            </Animated.View>
          ) : null}
          <ProgressRow elapsed={v.elapsed} duration={v.duration} progress={v.progress} onSeek={v.seek} marks={marks} skips={false} disabled={v.phase === 'loading' || v.phase === 'error'} tone="video" />
          <View style={styles.buttons} pointerEvents="box-none">
            <IconButton tone="clear" size={56} disabled={v.phase === 'loading'} icon={<SkipGlyph back color={colors.card} />} accessibilityLabel="Back 10 seconds" onPress={() => v.seek(v.elapsed - SKIP_S)} />
            <IconButton
              tone="cream"
              size={64}
              haptic
              accessibilityLabel={v.phase === 'playing' ? 'Pause' : ended ? 'Watch again' : 'Play'}
              onPress={ended ? v.replay : v.toggle}
              icon={(c) => (v.phase === 'playing' ? <PauseIcon size={24} color={c} /> : <PlayIcon size={24} color={c} />)}
            />
            <IconButton tone="clear" size={56} disabled={v.phase === 'loading'} icon={<SkipGlyph back={false} color={colors.card} />} accessibilityLabel="Forward 10 seconds" onPress={() => v.seek(v.elapsed + SKIP_S)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Four corners: pointing out (go full screen) or in (`exit`). 24 px, 2 px round strokes. */
export function FullScreenGlyph({ exit = false, color = colors.ink, size = 22 }: { exit?: boolean; color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={exit ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: DARK },
  // width/height (not absoluteFill) so the web <video> element is sized to the box too.
  fill: { width: '100%', height: '100%' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  note: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: alpha.glassChip },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, paddingBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 48, gap: 6 },
  shade: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
});
