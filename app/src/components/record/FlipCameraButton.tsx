// The flip-camera button on the recording screen (Caleb, Oct 24: "make the camera flip logo VERY clear"):
// a 68 pt round button with the iPhone's own flip-camera icon, filled (SF Symbol
// arrow.triangle.2.circlepath.camera.fill; the same drawing in SVG on Android and the web), her word for it
// under it in 17 pt ("कॅमेरा बदला" / "Flip camera"). It sits beside the camera card (recording.tsx,
// cameraLogic flipBeside), and beside the shutter in the plate photo's big view (`onDark`). The icon spins
// once when the camera changes; while the other camera gets ready the button is dimmed and waits. Reduce
// Motion: no spin.
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
const ICON = 42;
const TURN_MS = 420;

/** The SF Symbol's drawing: a filled camera with two arrows going round cut out of it (24 x 24). */
function FlipCameraIcon({ size, color, cutout }: { size: number; color: string; cutout: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4.5 7h2.6l1.5-2.2h6.8L16.9 7h2.6A2 2 0 0 1 21.5 9v9.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill={color} />
      <Path d="M8.55 13.39A3.5 3.5 0 0 1 15.03 12.25M15.33 10.58 15.03 12.25 13.43 11.67" stroke={cutout} strokeWidth={1.8} />
      <Path d="M15.45 14.61A3.5 3.5 0 0 1 8.97 15.75M8.67 17.42 8.97 15.75 10.57 16.33" stroke={cutout} strokeWidth={1.8} />
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
  /** A flip is running, the camera isn't ready yet, or the plate photo is being taken. */
  disabled?: boolean;
  /** Over the plate photo's dark dim: a glass circle, a cream label. */
  onDark?: boolean;
  /** The label's width (the button stays FLIP_SIZE). */
  width?: number;
}) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  const shown = useRef(facing);
  useEffect(() => {
    // One turn each time the camera changes (not on the first show, nor when Reduce Motion changes); it lands upright.
    if (shown.current === facing) return;
    shown.current = facing;
    if (!reduce) turn.set(withTiming(turn.get() + 360, { duration: TURN_MS, easing: Easing.inOut(Easing.cubic) }));
  }, [facing, reduce, turn]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const other = facing === 'back' ? 'front' : 'back';
  const drawn = <FlipCameraIcon size={ICON} color={colors.ink} cutout={colors.card} />;
  const glyph =
    Platform.OS === 'ios' ? <SymbolView name="arrow.triangle.2.circlepath.camera.fill" size={ICON} weight="semibold" tintColor={colors.ink} fallback={drawn} /> : drawn;
  return (
    <View style={[styles.wrap, { width }]}>
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        haptic="medium"
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel={label.en ?? label.text}
        accessibilityHint={`Switches to the ${other} camera`}
        accessibilityState={{ disabled }}
        hitSlop={8}
        style={[styles.button, onDark ? styles.onDark : styles.onPage, disabled && styles.waiting]}>
        <Animated.View style={iconStyle}>{glyph}</Animated.View>
      </PressableScale>
      <Txt
        variant="label"
        size={17}
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
