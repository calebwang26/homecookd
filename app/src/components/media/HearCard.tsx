// Hear the cook: a green-tint card (the cook's words) that stands in for the video while listening. The
// egg's "listening" mood and "Listening to Dad…", a round ink play/pause, the sentence she is roughly saying (Fraunces italic,
// the quote as a subtitle), and a progress row across the clip's range (back / forward 10 s, drag).
// Without audio it is "Dad's words": the whole quote as text, never cut to one sentence.
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { EggMascot, IconButton, PauseIcon, PlayIcon, Txt } from '@/components/ui';
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
          {available ? <EggMascot mood="listening" size={40} /> : null}
          <Txt variant="label" size={15} weight={600} color={colors.ink} numberOfLines={1} style={styles.flex}>
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
          tone="tint"
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

const styles = StyleSheet.create({
  card: { backgroundColor: colors.greenTint, borderRadius: radii.panel, padding: 20, gap: 16, minHeight: 200 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  flex: { flexShrink: 1 },
  // The skip buttons' glyphs line up with the card's text (48 pt buttons, 26 pt glyphs).
  seek: { marginHorizontal: -11 },
});
