// homie big and glowing at the centre of the cook's screens: a sun ring and a soft glow around the pot
// (the mockups' 0 0 0 18px sun at 28% + a 70 px glow, scaled to the size).
//   <GlowHomie size={200} state level label />   HomiePot: its steam follows her voice while it listens;
//                                                "AI voice" under it while it speaks (homie asks, walkie).
//                                                The glow breathes slowly while homie waits for her.
//   <WavingHomie size={200} />                   the done screen: PotMark's waving pose, the arm waving
//                                                a few times, the lid lifting twice and happy steam.
// Reduce Motion: no loops and no waving: still pictures (the glow stays full).
// The shared HomiePot draws its own cream disc with no glow; if it gains one (components/homie), these
// screens can use that instead.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { HomiePot } from '@/components/homie';
import { Txt } from '@/components/ui';
import type { HomieState } from '@/lib/homie/store';
import { colors } from '@/theme/tokens';

/** One breath of the glow, in and out. */
export const BREATH_MS = 3200;
/** The glow's faintest point in a breath. */
const BREATH_LOW = 0.55;
const WAVES = 3;

function glow(size: number) {
  const ring = Math.round(size * 0.1);
  return { width: size, height: size, borderRadius: size / 2, boxShadow: `0 0 0 ${ring}px rgba(254,190,41,0.28), 0 0 ${Math.round(size * 0.4)}px rgba(254,190,41,0.55)` };
}

/** The sun ring and glow behind the disc; `breathe` lets it fade softly in and out. */
function Glow({ size, butter = false, breathe }: { size: number; butter?: boolean; breathe: boolean }) {
  const reduce = useReducedMotion();
  const breath = useSharedValue(1);
  const on = breathe && !reduce;
  useEffect(() => {
    if (!on) {
      cancelAnimation(breath);
      breath.set(1);
      return;
    }
    const half = { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) };
    breath.set(withRepeat(withSequence(withTiming(BREATH_LOW, half), withTiming(1, half)), -1, false));
    return () => cancelAnimation(breath);
  }, [on, breath]);
  const style = useAnimatedStyle(() => ({ opacity: breath.value }));
  return <Animated.View style={[StyleSheet.absoluteFill, styles.disc, butter && styles.butter, glow(size), style]} />;
}

export function GlowHomie({ size, state, level = 0, label = null, breathe = true }: { size: number; state: HomieState; level?: number; label?: string | null; breathe?: boolean }) {
  return (
    <View style={{ width: size, height: size }}>
      <Glow size={size} breathe={breathe} />
      <HomiePot state={state} level={level} size={size} shadow={false} />
      {label ? (
        <View style={styles.labelWrap} pointerEvents="none">
          <Txt variant="label" size={13} weight={700} color={colors.butterInk} style={styles.label}>
            {label}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const CURLS = [40, 50, 60];

export function WavingHomie({ size }: { size: number }) {
  const reduce = useReducedMotion();
  const lift = useSharedValue(0);
  const drift = useSharedValue(0);
  const wave = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    const ease = Easing.inOut(Easing.quad);
    const up = withSequence(withTiming(1, { duration: 220, easing: ease }), withTiming(0, { duration: 260, easing: ease }));
    lift.set(withDelay(300, withSequence(up, withDelay(160, up))));
    // The arm waves from the shoulder a few times, then rests in the pose.
    const swing = withSequence(withTiming(-18, { duration: 200, easing: ease }), withTiming(10, { duration: 220, easing: ease }));
    wave.set(withDelay(200, withSequence(withRepeat(swing, WAVES, false), withTiming(0, { duration: 200, easing: ease }))));
    drift.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => {
      cancelAnimation(drift);
      cancelAnimation(wave);
      cancelAnimation(lift);
    };
  }, [reduce, lift, drift, wave]);

  const potW = size * 0.62;
  const box = { left: size * 0.19, top: size * 0.29, width: potW, height: potW * 0.92 };
  const lidStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * size * 0.07 }, { rotate: `${-lift.value * 8}deg` }] }));
  const armStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wave.value}deg` }] }));
  const steamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -drift.value * size * 0.04 }] }));

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glow size={size} butter breathe={false} />
      <Animated.View style={[StyleSheet.absoluteFill, steamStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {CURLS.map((x, i) => (
            <Path key={x} d={`M${x} 47c-4-4 4-7 0-12.5s4-8.5 0-14.5`} transform={i === 1 ? 'translate(0 -3)' : undefined} stroke={colors.potLine} strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" fill="none" />
          ))}
        </Svg>
      </Animated.View>
      <View style={[styles.abs, box]}>
        {/* PotMark's waving pose (components/ui/icons), with the arm and the lid drawn on their own so they can move. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.armOrigin, armStyle]}>
          <Svg width={box.width} height={box.height} viewBox="0 0 100 92">
            <Path d="M78 52q9-1 11-13" fill="none" stroke={colors.potLine} strokeWidth={5} strokeLinecap="round" />
            <Circle cx={89.5} cy={35} r={5} fill={colors.potBody} stroke={colors.potLine} strokeWidth={3.5} />
          </Svg>
        </Animated.View>
        <Svg style={StyleSheet.absoluteFill} width={box.width} height={box.height} viewBox="0 0 100 92">
          <Path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill={colors.potBody} stroke={colors.potLine} strokeWidth={4} strokeLinejoin="round" />
          <Path d="M22 52h-8" stroke={colors.potLine} strokeWidth={5} strokeLinecap="round" />
          <Circle cx={40} cy={59} r={3.6} fill={colors.potFace} />
          <Circle cx={60} cy={59} r={3.6} fill={colors.potFace} />
          <Path d="M45 65q5 5 10 0" fill="none" stroke={colors.potFace} strokeWidth={3} strokeLinecap="round" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, styles.lidOrigin, lidStyle]}>
          <Svg width={box.width} height={box.height} viewBox="0 0 100 92">
            <Ellipse cx={50} cy={42} rx={31} ry={7} fill={colors.potLid} stroke={colors.potLine} strokeWidth={4} />
            <Circle cx={50} cy={33} r={4.5} fill={colors.potLine} />
          </Svg>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  disc: { backgroundColor: colors.card },
  butter: { backgroundColor: colors.butter },
  labelWrap: { position: 'absolute', bottom: -14, left: 0, right: 0, alignItems: 'center' },
  label: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.butter, overflow: 'hidden' },
  // The arm swings from its shoulder, where it meets the pot's right side (78, 52 of 100 × 92).
  armOrigin: { transformOrigin: '78% 56.5%' },
  // The lid tips up from its left rim (as HomiePot's).
  lidOrigin: { transformOrigin: '19% 46%' },
});
