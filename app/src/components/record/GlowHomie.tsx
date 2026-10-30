// homie big at the centre of the cook's screens, and the done screen's egg.
//   <GlowHomie size={200} state level label />   HomiePot, the only glow: it lights up, rings and pulses
//                                                by state like everywhere else (off is a plain white
//                                                circle, so she can tell when homie can't hear her);
//                                                "AI voice" under it while it speaks (homie asks, walkie).
//   <WavingHomie size={200} />                   the done screen: the egg's "made-it" mood (success; it
//                                                was the waving pot), popping in once. No glow or tilt
//                                                on it (the brand kit). Reduce Motion: a still picture.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { HomiePot } from '@/components/homie';
import { EggMascot, Txt } from '@/components/ui';
import type { HomieState } from '@/lib/homie/store';
import { colors } from '@/theme/tokens';

type Props = {
  size: number;
  state: HomieState;
  level?: number;
  label?: string | null;
};

export function GlowHomie({ size, state, level = 0, label = null }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <HomiePot state={state} level={level} size={size} shadow={false} />
      {label ? (
        <View style={styles.labelWrap} pointerEvents="none">
          <Txt variant="label" size={13} weight={700} color={colors.ink} style={styles.label}>
            {label}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

export function WavingHomie({ size }: { size: number }) {
  const reduce = useReducedMotion();
  const pop = useSharedValue(reduce ? 1 : 0.85);
  useEffect(() => {
    if (reduce) return;
    const ease = Easing.inOut(Easing.quad);
    pop.set(withDelay(200, withSequence(withTiming(1.06, { duration: 240, easing: ease }), withTiming(1, { duration: 220, easing: ease }))));
  }, [reduce, pop]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <EggMascot mood="made-it" size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  labelWrap: { position: 'absolute', bottom: -14, left: 0, right: 0, alignItems: 'center' },
  label: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.yolkTint, overflow: 'hidden' },
});
