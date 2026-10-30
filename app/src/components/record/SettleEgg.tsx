// Send's "You can close the app" (retention PR 7, RETENTION-HANDOFF 4): the little egg mark settling in
// beside the words (it was a pot whose lid settled on). It drops 5 pt into place as the burst's subtitle
// shows (`delay`), no bounce, no tilt (the kit). Reduce Motion: it fades in, already in place. A picture
// only (hidden from screen readers; the words say it).
import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EggMark } from '@/components/ui';
import { motion } from '@/theme/tokens';

export function SettleEgg({ size = 22, delay = 560 }: { size?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const on = useSharedValue(0);
  useEffect(() => {
    on.value = withDelay(reduce ? 0 : delay, withTiming(1, { duration: reduce ? motion.reducedFadeMs : 280, easing: Easing.out(Easing.cubic) }));
  }, [delay, reduce, on]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, on.value * 2),
    transform: [{ translateY: reduce ? 0 : -5 * (1 - on.value) }],
  }));
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <EggMark size={size} />
    </Animated.View>
  );
}
