// Every tappable thing in the app: press-in scale 0.96 + opacity 0.9 on a spring (damping 15,
// stiffness 300), release back to 1 (motion spec 5). Optional haptic on press. Reduce Motion: no
// scale, a plain <=150 ms opacity fade.
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

import { haptic, type HapticKind } from './haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Plain styles or Reanimated animated styles. */
  style?: StyleProp<ViewStyle> | ComponentProps<typeof AnimatedPressable>['style'];
  children?: ReactNode;
  /** Scale while pressed. 0.96 for controls (default), 0.97 for cards. */
  scaleTo?: number;
  /** Opacity while pressed (default 0.9). */
  pressedOpacity?: number;
  /** Fire a haptic on press: true = selection. */
  haptic?: boolean | HapticKind;
};

export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { style, children, scaleTo = motion.pressScale, pressedOpacity = motion.pressOpacity, haptic: hap, onPressIn, onPressOut, onPress, disabled, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * (1 - pressedOpacity),
    transform: reduce ? [] : [{ scale: 1 - pressed.value * (1 - scaleTo) }],
  }));

  const to = (v: number) =>
    reduce ? withTiming(v, { duration: motion.reducedFadeMs }) : withSpring(v, motion.press);

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      disabled={disabled}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      onPressIn={(e: GestureResponderEvent) => {
        pressed.value = to(1);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.value = to(0);
        onPressOut?.(e);
      }}
      onPress={(e: GestureResponderEvent) => {
        if (hap) haptic(hap === true ? 'selection' : hap);
        onPress?.(e);
      }}
      style={[style, animStyle]}>
      {children}
    </AnimatedPressable>
  );
});
