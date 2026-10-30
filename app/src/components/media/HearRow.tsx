// "Hear Miles · 0:30": the cook's voice, played in place (kid QA round 2: no sheet, so the step stays
// in view). One compact green-tint row: a round ink play button and the label; tap anywhere on it. Once it
// plays, the row opens under it: the sentence she is roughly saying (Fraunces italic) and the bar with
// back / forward 10 (ProgressRow). Pausing keeps it open; the × at its right stops her and folds it
// back to the bubble, and so does the video or another voice taking over (one voice at a time,
// lib/media). Nothing without a recording.
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { CloseIcon, IconButton, PauseIcon, PlayIcon, PressableScale, Txt } from '@/components/ui';
import { mmss } from '@/lib/format';
import { subtitleAt, useClipAudio, type AudioClip } from '@/lib/media';
import { colors } from '@/theme/tokens';

import { ProgressRow } from './ProgressRow';

export function HearRow({
  clip,
  cookName,
  quote,
  label,
  accessibilityLabel,
  style,
}: {
  clip: AudioClip | null;
  cookName: string;
  /** Her words for this range: shown a sentence at a time while it plays. */
  quote?: string | null;
  /** Default "Hear Dad"; the length is added ("Hear Dad · 0:30"). */
  label?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const hear = useClipAudio(clip);
  if (!hear.available) return null;

  const open = hear.isCurrent && hear.phase !== 'idle';
  const len = hear.duration > 0 ? ` · ${mmss(hear.duration)}` : '';
  const title = open && hear.playing ? `Listening to ${cookName}…` : `${label ?? `Hear ${cookName}`}${len}`;
  const line = open ? subtitleAt(quote, hear.progress) : null;

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, style]}>
      <View style={styles.headRow}>
        <PressableScale
          scaleTo={0.98}
          haptic
          onPress={hear.phase === 'ended' ? hear.replay : hear.toggle}
          accessibilityRole="button"
          accessibilityLabel={hear.playing ? `Pause ${cookName}` : (accessibilityLabel ?? `${label ?? `Hear ${cookName}`}${len}`)}
          style={styles.head}>
          <View style={styles.button}>
            {hear.phase === 'loading' ? (
              <ActivityIndicator color={colors.card} />
            ) : hear.playing ? (
              <PauseIcon size={18} color={colors.card} />
            ) : (
              <PlayIcon size={18} color={colors.card} />
            )}
          </View>
          <Txt variant="label" size={16} weight={700} color={colors.ink} numberOfLines={1} style={styles.title} accessibilityLiveRegion="polite">
            {title}
          </Txt>
        </PressableScale>
        {open ? (
          <IconButton
            tone="clear"
            size={44}
            icon={<CloseIcon size={18} color={colors.ink} />}
            accessibilityLabel={`Stop ${cookName} and close`}
            onPress={hear.stop}
          />
        ) : null}
      </View>
      {open ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.body}>
          {line ? (
            <Txt variant="quote" size={17} leading={1.4} color={colors.ink} numberOfLines={3} style={styles.line}>
              {`“${line}”`}
            </Txt>
          ) : null}
          <ProgressRow
            elapsed={hear.elapsed}
            duration={hear.duration}
            progress={hear.progress}
            onSeek={hear.seek}
            disabled={hear.phase === 'loading' || hear.phase === 'error'}
            tone="tint"
          />
          {hear.phase === 'error' ? (
            <Txt variant="caption" color={colors.danger} style={styles.line}>
              Couldn’t load the recording. Try again.
            </Txt>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.greenTint, borderRadius: 20, padding: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  head: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  body: { gap: 4, paddingTop: 8 },
  line: { paddingHorizontal: 8 },
});
