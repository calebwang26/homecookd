// A fade in on mount for what shows inside a sheet, without Reanimated's layout animations (`entering` /
// `exiting`). Those run in the native mounting layer: on iOS, inside a sheet's native Modal, a view removed
// while its `entering` still ran (Copy link's spinner shows after 120 ms and goes as the link lands, then
// "Copied" fades in) left the screen frozen while the app kept running: taps still opened a chat and Home
// underneath, but nothing redrew (1.1, Nov 8). An animated opacity is plain style, safe to stop at any frame.
//
//   <Appear style={styles.check}>…</Appear>            fades in over 180 ms (Reduce Motion: shows at once)
//   <Appear key={n} duration={160}>…</Appear>          a new key fades the new one in
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

export function Appear({
  duration = 180,
  style,
  children,
  ...rest
}: Omit<ViewProps, 'style'> & { duration?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) opacity.set(withTiming(1, { duration }));
  }, [opacity, reduce, duration]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View {...rest} style={[style, fade]}>
      {children}
    </Animated.View>
  );
}
