// Send's "You can close the app" (retention PR 7, RETENTION-HANDOFF 4): a small pot whose lid settles
// on, the way you'd leave a pot to simmer. Drawn like PotIcon (filled, the mascot's colours). The lid
// drops 5 pt onto the pot as the burst's subtitle shows (`delay`), no bounce. Reduce Motion: it fades
// in, already on. A picture only (hidden from screen readers; the words say it).
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { colors, motion } from '@/theme/tokens';

export function LidPot({ size = 22, delay = 560 }: { size?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const on = useSharedValue(0);
  useEffect(() => {
    on.value = withDelay(reduce ? 0 : delay, withTiming(1, { duration: reduce ? motion.reducedFadeMs : 280, easing: Easing.out(Easing.cubic) }));
  }, [delay, reduce, on]);
  const lid = useAnimatedStyle(() => ({
    opacity: Math.min(1, on.value * 2),
    transform: [{ translateY: reduce ? 0 : -5 * (1 - on.value) }],
  }));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.potLine} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5 11h14v4a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill={colors.potBody} />
        <Path d="M5 13H3M19 13h2" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, lid]}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.potLine} strokeWidth={1.8}>
          <Ellipse cx={12} cy={10.4} rx={7.6} ry={1.9} fill={colors.potLid} />
          <Circle cx={12} cy={7} r={1.1} fill={colors.potLine} />
        </Svg>
      </Animated.View>
    </View>
  );
}
