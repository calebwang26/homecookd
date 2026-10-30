// The background of the cook's centred screens (recording, the walkie-talkie, done; Caleb's v3b): the
// yolk-tint wash over the whole height (#FCEBD0 at the top, #FDF1DE, then the cream page #FBF5EA), and a
// soft warm glow (WarmGlow: the yolk at 16%, fading out over ~230 pt) centred behind the big button (never
// behind the egg: the kit has no glows on it). All of them, and homie's questions while she records, use one centred column with the same
// rhythm (COLUMN): 32 pt at the sides, 56 pt from the words to homie or the button, 48 pt from there
// to the line under it.
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const WASH = [colors.yolkTint, '#FDF1DE', colors.page] as const;
export const GLOW_RADIUS = 230;
export const COLUMN = { side: 32, toHero: 56, toLabel: 48 } as const;

export function RecordWash() {
  return <LinearGradient pointerEvents="none" colors={WASH} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />;
}

/** Put it first inside a `box`-wide square (the button, homie): it centres itself on that square. */
export function WarmGlow({ box, radius = GLOW_RADIUS }: { box: number; radius?: number }) {
  const d = radius * 2;
  return (
    <View pointerEvents="none" style={[styles.glow, { left: (box - d) / 2, top: (box - d) / 2, width: d, height: d }]}>
      <Svg width={d} height={d} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="cookWarmGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.yolk} stopOpacity={0.16} />
            <Stop offset="1" stopColor={colors.yolk} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill="url(#cookWarmGlow)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
});
