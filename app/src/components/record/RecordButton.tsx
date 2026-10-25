// The recording screen's one button (Caleb's v3): a big red circle (232 pt, #9A4F47) with a 6 pt
// cream border and a white rounded stop square inside, like a phone's voice recorder, on a warm glow.
// While filming (`live`) two faint red rings pulse outward from it on a loop (one every 0.8 s, each
// growing and fading over 1.6 s, out to the mockup's outer ring); Reduce Motion keeps them still.
// Before filming starts and after it ends it rests, dimmed and without rings. `resume`: filming in the
// app stopped while she was away: the button is bright again, with a cream dot (record) in place of the
// stop square, and a tap films again.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

import { PressableScale } from '@/components/ui';
import { colors } from '@/theme/tokens';

import { WarmGlow } from './RecordWash';

export const RECORD_SIZE = 232;
const BORDER = 6;
const SQUARE = 76;
export const PULSE_MS = 1600;
/** How far a ring grows: 46 pt past the button's edge on each side (the mockup's outer ring). */
const RING_GROWTH = (2 * 46) / RECORD_SIZE;
const RING = 'rgba(154,79,71,0.22)';

export function RecordButton({ live, resume = false, disabled, onPress, accessibilityLabel }: { live: boolean; resume?: boolean; disabled?: boolean; onPress: () => void; accessibilityLabel: string }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(0);
  const breathing = live && !reduce;
  useEffect(() => {
    if (breathing) pulse.set(withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.linear }), -1, false));
    else {
      cancelAnimation(pulse);
      pulse.set(0);
    }
  }, [breathing, pulse]);

  return (
    <View style={styles.box}>
      <WarmGlow box={RECORD_SIZE} />
      {live ? (
        <>
          <Ring pulse={pulse} offset={0} still={reduce} />
          <Ring pulse={pulse} offset={0.5} still={reduce} />
        </>
      ) : null}
      {/* The press animates opacity, so the resting dim sits on a wrapper. */}
      <View style={!live && !resume && styles.resting}>
        <PressableScale
          onPress={onPress}
          disabled={disabled}
          haptic="medium"
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={[styles.button, !live && !resume && styles.flat]}>
          <View style={resume ? styles.dot : styles.square} />
        </PressableScale>
      </View>
    </View>
  );
}

/** A faint ring that grows out of the button and fades; `offset` puts the second one half a breath later. */
function Ring({ pulse, offset, still }: { pulse: SharedValue<number>; offset: number; still: boolean }) {
  const style = useAnimatedStyle(() => {
    // The mockup's two rings, 22 and 46 pt out, at 12% and 6%.
    if (still) return { opacity: offset ? 0.27 : 0.55, transform: [{ scale: offset ? 1 + RING_GROWTH : 1 + RING_GROWTH * (22 / 46) }] };
    const t = (pulse.value + offset) % 1;
    return { opacity: 1 - t, transform: [{ scale: 1 + RING_GROWTH * t }] };
  });
  return <Animated.View pointerEvents="none" style={[styles.ring, style]} />;
}

const styles = StyleSheet.create({
  box: { width: RECORD_SIZE, height: RECORD_SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: RECORD_SIZE, height: RECORD_SIZE, borderRadius: RECORD_SIZE / 2, backgroundColor: RING },
  button: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    backgroundColor: colors.danger,
    borderWidth: BORDER,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 16px 40px rgba(154,79,71,0.28)',
  },
  resting: { opacity: 0.55 },
  flat: { boxShadow: 'none' },
  square: { width: SQUARE, height: SQUARE, borderRadius: 18, backgroundColor: colors.card },
  dot: { width: SQUARE, height: SQUARE, borderRadius: SQUARE / 2, backgroundColor: colors.card },
});
