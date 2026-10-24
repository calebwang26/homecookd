// Hear the cook: a peach card that stands in for the video while listening. A pulsing dot and
// "Listening to Dad…", a round ink play/pause, the sentence she is roughly saying (Fraunces italic,
// the quote as a subtitle), and a progress row across the clip's range (back / forward 10 s, drag).
// Without audio it is "Dad's words": the whole quote as text, never cut to one sentence.
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { IconButton, PauseIcon, PlayIcon, Txt } from '@/components/ui';
import { subtitleAt, useClipAudio, type AudioClip } from '@/lib/media';
import { colors, radii } from '@/theme/tokens';

import { ProgressRow } from './ProgressRow';

export function HearCard({
  clip,
  quote,
  cookName,
  autoPlay = false,
  style,
}: {
  clip: AudioClip | null;
  quote: string | null | undefined;
  cookName: string;
  autoPlay?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const hear = useClipAudio(clip);
  const { play, available } = hear;

  useEffect(() => {
    if (autoPlay && available) play();
  }, [autoPlay, available, play]);

  // Listening: the sentence roughly being said. Nothing to hear: every word of it.
  const line = available ? subtitleAt(quote, hear.progress) : quote?.trim() || null;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.top}>
        <View style={styles.listening} accessibilityLiveRegion="polite">
          {available ? <PulseDot active={hear.playing} /> : null}
          <Txt variant="label" size={15} weight={600} color={colors.peachInk} numberOfLines={1} style={styles.flex}>
            {!available
              ? `${cookName}’s words`
              : hear.playing
                ? `Listening to ${cookName}…`
                : `${cookName}’s voice`}
          </Txt>
        </View>
        {available ? (
          <IconButton
            tone="ink"
            size={56}
            haptic
            accessibilityLabel={hear.playing ? 'Pause' : `Hear ${cookName}`}
            onPress={hear.phase === 'ended' ? hear.replay : hear.toggle}
            icon={(c) =>
              hear.phase === 'loading' ? (
                <ActivityIndicator color={c} />
              ) : hear.playing ? (
                <PauseIcon size={22} color={c} />
              ) : (
                <PlayIcon size={22} color={c} />
              )
            }
          />
        ) : null}
      </View>
      {line ? (
        <Txt variant="quoteLg" color={colors.ink} selectable={!available}>
          {`“${line}”`}
        </Txt>
      ) : null}
      {available && hear.duration > 0 ? (
        <ProgressRow
          elapsed={hear.elapsed}
          duration={hear.duration}
          progress={hear.progress}
          onSeek={hear.seek}
          disabled={!hear.isCurrent || hear.phase === 'loading' || hear.phase === 'error'}
          tone="peach"
          style={styles.seek}
        />
      ) : null}
      {hear.phase === 'error' ? (
        <Txt variant="caption" color={colors.danger}>
          Couldn’t load the recording. Try again.
        </Txt>
      ) : null}
    </View>
  );
}

function PulseDot({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(o);
      o.set(active ? 1 : 0.35);
      return;
    }
    const ease = Easing.inOut(Easing.sin);
    o.set(withRepeat(withSequence(withTiming(1, { duration: 900, easing: ease }), withTiming(0.35, { duration: 900, easing: ease })), -1));
    return () => cancelAnimation(o);
  }, [active, reduce, o]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, s]} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.peach, borderRadius: radii.panel, padding: 20, gap: 16, minHeight: 200 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  flex: { flexShrink: 1 },
  // The skip buttons' glyphs line up with the card's text (48 pt buttons, 26 pt glyphs).
  seek: { marginHorizontal: -11 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green },
});
