// Voice-note bars from Kid-Chat: 16 bars, 3 px wide, 8 px apart, rounded, centred in a 28 px row,
// ink. Pass `progress` (0..1) while playing: played bars stay full ink, the rest dim.
// Pass `seed` (e.g. the message id) to get a stable, different shape per note.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

/** The bible's exact bar heights. */
export const BIBLE_BARS = [6, 14, 22, 10, 18, 8, 24, 12, 6, 16, 10, 20, 8, 14, 6, 10];

function barsFor(seed: string | undefined, count: number, height: number) {
  if (!seed) {
    return Array.from({ length: count }, (_, i) => (BIBLE_BARS[i % BIBLE_BARS.length] / 28) * height);
  }
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761);
    const r = ((h >>> 0) % 1000) / 1000;
    return Math.max(6, Math.round((0.2 + r * 0.8) * height));
  });
}

export function Waveform({
  seed,
  bars = 16,
  height = 28,
  color = colors.ink,
  progress,
  style,
}: {
  seed?: string;
  bars?: number;
  height?: number;
  color?: string;
  /** 0..1 while playing; undefined = all bars full colour. */
  progress?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const hs = barsFor(seed, bars, height);
  const playedUpTo = progress == null ? bars : Math.round(progress * bars);
  return (
    <View style={[styles.row, { height }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {hs.map((h, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { height: h, backgroundColor: color, opacity: progress == null || i < playedUpTo ? 1 : 0.35 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bar: { width: 3, borderRadius: 1.5 },
});
