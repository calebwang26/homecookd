// The flip-camera button on the recording screen (Caleb, Oct 24: "make the camera flip logo VERY clear"):
// a 68 pt round button with the iPhone's own flip-camera icon (SF Symbol arrow.triangle.2.circlepath.camera;
// the same drawing in SVG on Android and the web), her word for it under it ("कॅमेरा बदला" / "Flip camera").
// It sits beside the camera card (recording.tsx, cameraLogic flipBeside), and beside the shutter in the
// plate photo's big view (`onDark`). The icon spins once when the camera changes; while the other camera
// gets ready the button is dimmed and waits. Reduce Motion: no spin.
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { PressableScale, Txt } from '@/components/ui';
import { alpha, colors, shadows } from '@/theme/tokens';

import type { Facing } from './cameraLogic';
import type { Line } from './words';

export const FLIP_SIZE = 68;
const ICON = 38;
const TURN_MS = 420;

/** The SF Symbol's drawing: a camera with two arrows going round (24 x 24, 2 pt strokes like icons.tsx). */
function FlipCameraIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4.5 7.5h2.8l1.4-2h6.6l1.4 2h2.8A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5z" />
      <Path d="M8.75 12.93A3.3 3.3 0 0 1 14.86 11.85M15.16 10.18 14.86 11.85 13.26 11.27" strokeWidth={1.7} />
      <Path d="M15.25 14.07A3.3 3.3 0 0 1 9.14 15.15M8.84 16.82 9.14 15.15 10.74 15.73" strokeWidth={1.7} />
    </Svg>
  );
}

export function FlipCameraButton({
  label,
  facing,
  onPress,
  disabled = false,
  onDark = false,
  width = FLIP_SIZE,
}: {
  /** Her word for it (words.line('flipCamera')): the text shows, the English is VoiceOver's label. */
  label: Line;
  facing: Facing;
  onPress: () => void;
  /** A flip is running, or the camera isn't ready yet. */
  disabled?: boolean;
  /** Over the plate photo's dark dim: a glass circle, a cream label. */
  onDark?: boolean;
  /** The label's width (the button stays FLIP_SIZE). */
  width?: number;
}) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    // One turn each time the camera changes (not when the screen first shows); it lands upright.
    if (first.current) return void (first.current = false);
    if (!reduce) turn.set(withTiming(turn.get() + 360, { duration: TURN_MS, easing: Easing.inOut(Easing.cubic) }));
  }, [facing, reduce, turn]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const other = facing === 'back' ? 'front' : 'back';
  const glyph = Platform.OS === 'ios' ? (
    <SymbolView
      name="arrow.triangle.2.circlepath.camera"
      size={ICON}
      weight="semibold"
      tintColor={colors.ink}
      fallback={<FlipCameraIcon size={ICON} color={colors.ink} />}
    />
  ) : (
    <FlipCameraIcon size={ICON} color={colors.ink} />
  );
  return (
    <View style={[styles.wrap, { width }]}>
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        haptic="medium"
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel={label.en ?? label.text}
        accessibilityHint={`Films with the ${other} camera`}
        accessibilityState={{ disabled }}
        hitSlop={8}
        style={[styles.button, onDark ? styles.onDark : styles.onPage, disabled && styles.waiting]}>
        <Animated.View style={iconStyle}>{glyph}</Animated.View>
      </PressableScale>
      <Txt
        variant="label"
        size={15}
        weight={700}
        leading={1.2}
        color={onDark ? colors.card : colors.ink}
        align="center"
        numberOfLines={2}
        adjustsFontSizeToFit
        importantForAccessibility="no"
        accessibilityElementsHidden>
        {label.text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  button: { width: FLIP_SIZE, height: FLIP_SIZE, borderRadius: FLIP_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  onPage: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: 'rgba(30,36,16,0.12)', boxShadow: shadows.button },
  onDark: { backgroundColor: alpha.glassButton },
  waiting: { opacity: 0.5 },
});
