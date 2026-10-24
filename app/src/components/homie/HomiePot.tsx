// homie: the launch screen's pot (ui/icons PotMark, same face) in a round button. Only the steam and
// the lid move; the face never animates.
//   off        lid on, no steam
//   listening  steam rises with the mic level (0..1)
//   thinking   slow curls
//   lit        a warm butter glow and a sun halo: the beat before homie speaks
//   speaking   the glow, and the lid lifts gently, again and again
//   timer      a ring around the pot empties like a clock (`timerProgress` 1 -> 0, in any state)
// Reduce Motion: no loops. Each state is a still picture (speaking: the lid sits a little open) and a
// change cross-fades in 150 ms. A picture only: whoever renders it gives it a label.
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import type { HomieState } from '@/lib/homie/store';
import { alpha, colors, motion, shadows } from '@/theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const STEAM_LEN = 34;
const CURLS = [40, 50, 60];
/** Steam in each still state; listening adds the mic level, thinking loops. */
const STEAM: Record<HomieState, number> = { off: 0, listening: 0.3, thinking: 0.7, lit: 0.6, speaking: 1, timer: 0.35 };
const fade = { duration: motion.reducedFadeMs };
const inOut = Easing.inOut(Easing.cubic);

export type HomiePotProps = {
  state: HomieState;
  level?: number;
  size?: number;
  timerProgress?: number | null;
  /** The cream disc's soft shadow (off on a dark backdrop). */
  shadow?: boolean;
  /** false: no base disc, for a caller that draws its own behind the pot (components/record/GlowHomie). */
  disc?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function HomiePot({ state, level = 0, size = 56, timerProgress = null, shadow = true, disc: withDisc = true, style }: HomiePotProps) {
  const reduce = useReducedMotion();
  const warm = state === 'lit' || state === 'speaking';
  const steam = useSharedValue(STEAM[state]);
  const drift = useSharedValue(0);
  const lift = useSharedValue(0);
  const lidOpacity = useSharedValue(1);
  const glow = useSharedValue(warm ? 1 : 0);
  const ring = useSharedValue(timerProgress ?? 0);
  const ringOn = useSharedValue(timerProgress == null ? 0 : 1);

  const listening = state === 'listening';
  useEffect(() => {
    if (state === 'thinking' && !reduce) {
      steam.set(withRepeat(withSequence(withTiming(1, { duration: 1400, easing: inOut }), withTiming(0.25, { duration: 1400, easing: inOut })), -1, false));
    } else if (!listening) {
      steam.set(withTiming(STEAM[state], reduce ? fade : { duration: 260, easing: Easing.out(Easing.cubic) }));
    }
  }, [state, listening, reduce, steam]);

  useEffect(() => {
    if (listening) steam.set(withTiming(STEAM.listening + 0.7 * level, reduce ? fade : { duration: 120 }));
  }, [listening, level, reduce, steam]);

  // Steam drifts up and back while there is any.
  const steamy = state !== 'off';
  useEffect(() => {
    if (steamy && !reduce) drift.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
    else {
      cancelAnimation(drift);
      drift.set(withTiming(0, fade));
    }
  }, [steamy, reduce, drift]);

  const speaking = state === 'speaking';
  useEffect(() => {
    if (reduce) {
      // A still lid: it fades in where it now sits.
      const at = speaking ? 0.6 : 0;
      if (lift.get() === at) return;
      cancelAnimation(lift);
      lift.set(at);
      lidOpacity.set(0);
      lidOpacity.set(withTiming(1, fade));
      return;
    }
    lidOpacity.set(1);
    const talk = withSequence(withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(0.2, { duration: 260, easing: Easing.inOut(Easing.quad) }));
    lift.set(speaking ? withRepeat(talk, -1, false) : withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }));
  }, [speaking, reduce, lift, lidOpacity]);

  useEffect(() => {
    glow.set(withTiming(warm ? 1 : 0, reduce ? fade : { duration: 200 }));
  }, [warm, reduce, glow]);

  const timed = timerProgress != null;
  useEffect(() => {
    ringOn.set(withTiming(timed ? 1 : 0, fade));
    if (timed) ring.set(reduce ? timerProgress : withTiming(timerProgress, { duration: 900, easing: Easing.linear }));
  }, [timed, timerProgress, reduce, ring, ringOn]);

  const steamProps = useAnimatedProps(() => ({
    strokeDashoffset: reduce ? 0 : STEAM_LEN * (1 - steam.value),
    strokeOpacity: 0.6 * Math.min(1, steam.value * 1.5),
  }));
  const steamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -drift.value * size * 0.04 }] }));
  const lidStyle = useAnimatedStyle(() => ({
    opacity: lidOpacity.value,
    transform: [{ translateY: -lift.value * size * 0.06 }, { rotate: `${-lift.value * 7}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const ringR = size / 2 + 1;
  const ringBox = size + 8;
  const ringC = 2 * Math.PI * ringR;
  // From 12 o'clock, clockwise (two half arcs), so the remaining time ends at the top like a clock.
  const ringPath = `M${ringBox / 2} ${ringBox / 2 - ringR}a${ringR} ${ringR} 0 1 1 0 ${2 * ringR}a${ringR} ${ringR} 0 1 1 0 ${-2 * ringR}`;
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ringC * (1 - ring.value) }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOn.value }));

  const potW = size * 0.62;
  const potBox = { left: size * 0.19, top: size * 0.29, width: potW, height: potW * 0.92 };
  const disc = { borderRadius: size / 2 };
  const halo = size * 1.7;

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.abs, { left: (size - halo) / 2, top: (size - halo) / 2, width: halo, height: halo }, glowStyle]}>
        <Svg width={halo} height={halo} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="homieHalo" cx="50%" cy="50%" r="50%">
              <Stop offset="0.45" stopColor={colors.sun} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colors.sun} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={50} cy={50} r={50} fill="url(#homieHalo)" />
        </Svg>
      </Animated.View>
      {withDisc ? <View style={[StyleSheet.absoluteFill, disc, styles.disc, shadow && styles.shadow]} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, disc, styles.butter, glowStyle]} />

      <Animated.View style={[StyleSheet.absoluteFill, steamStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {CURLS.map((x, i) => (
            <AnimatedPath
              key={x}
              d={`M${x} 47c-4-4 4-7 0-12.5s4-8.5 0-14.5`}
              transform={i === 1 ? 'translate(0 -3)' : undefined}
              stroke={colors.potLine}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${STEAM_LEN} ${STEAM_LEN}`}
              animatedProps={steamProps}
            />
          ))}
        </Svg>
      </Animated.View>

      {/* PotMark's body, handles and face: never animated. */}
      <Svg style={[styles.abs, potBox]} width={potBox.width} height={potBox.height} viewBox="0 0 100 92">
        <Path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill={colors.potBody} stroke={colors.potLine} strokeWidth={4} strokeLinejoin="round" />
        <Path d="M22 52h-8M78 52h8" stroke={colors.potLine} strokeWidth={5} strokeLinecap="round" />
        <Circle cx={40} cy={59} r={3.6} fill={colors.potFace} />
        <Circle cx={60} cy={59} r={3.6} fill={colors.potFace} />
        <Path d="M45 65q5 5 10 0" fill="none" stroke={colors.potFace} strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <Animated.View style={[styles.abs, potBox, styles.lidOrigin, lidStyle]}>
        <Svg width={potBox.width} height={potBox.height} viewBox="0 0 100 92">
          <Ellipse cx={50} cy={42} rx={31} ry={7} fill={colors.potLid} stroke={colors.potLine} strokeWidth={4} />
          <Circle cx={50} cy={33} r={4.5} fill={colors.potLine} />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.abs, { left: -4, top: -4 }, ringStyle]}>
        <Svg width={ringBox} height={ringBox}>
          <Circle cx={ringBox / 2} cy={ringBox / 2} r={ringR} stroke={alpha.checkRing} strokeWidth={3} fill="none" />
          <AnimatedPath d={ringPath} stroke={colors.green} strokeWidth={3.5} strokeLinecap="round" fill="none" strokeDasharray={`${ringC} ${ringC}`} animatedProps={ringProps} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  disc: { backgroundColor: colors.card },
  shadow: { boxShadow: shadows.button },
  butter: { backgroundColor: colors.butter },
  // The lid tips up from its left rim.
  lidOrigin: { transformOrigin: '19% 46%' },
});
