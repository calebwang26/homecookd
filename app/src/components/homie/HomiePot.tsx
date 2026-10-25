// homie: the launch screen's pot (ui/icons PotMark, same face) in a round button that lights up like
// Siri. The face, body and lid never change; what's around the circle says what homie is doing, the
// same on every screen:
//   off        a plain white circle: no glow, no steam, no ring (homie isn't listening)
//   lit        it lights up: the circle warms and a sun halo glows around it (the beat before it speaks)
//   listening  the mic is on: the halo, and a yellow ring on the circle's edge with a bright arc that
//              orbits it while the ring pulses; both grow a little with the mic level (`level` 0..1)
//   thinking   the same ring in a quicker rhythm: three short arcs spinning fast while the answer comes
//   speaking   the halo pulses with the words and the lid lifts, again and again
//   timer      a green clock ring around the circle empties (`timerProgress` 1 -> 0); it shows with any
//              state, and steps out to sit just outside the yellow ring while that one shows
// Steam rises in every state but off (with the mic level while listening, in slow curls while thinking).
// It draws a little past its `size` box: the rings by about a fifth of it, the halo by about a third.
// Reduce Motion: no loops. Each state is a still picture (the arcs rest, speaking's lid sits a little
// open) and a change cross-fades in 150 ms. A picture only: whoever renders it gives it a label.
import { useEffect, useId } from 'react';
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
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import type { HomieState } from '@/lib/homie/store';
import { alpha, colors, motion, shadows } from '@/theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const STEAM_LEN = 34;
const CURLS = [40, 50, 60];
/** Steam in each still state; listening adds the mic level, thinking loops. */
const STEAM: Record<HomieState, number> = { off: 0, listening: 0.3, thinking: 0.7, lit: 0.6, speaking: 1, timer: 0.35 };
/** How bright the halo is in each state (the ring's states keep it softer, so the ring stands out). */
const HALO: Record<HomieState, number> = { off: 0, lit: 1, listening: 0.7, thinking: 0.7, speaking: 1, timer: 0 };
/** One lap of the listening arc, and of the thinking arcs. */
const ORBIT_MS = 2400;
const SPIN_MS = 1000;
/** Half a pulse of the ring: slow while it listens, quick while it thinks. */
const LISTEN_BEAT_MS = 1300;
const THINK_BEAT_MS = 420;
/** The bright arc (a comet: faint tail, bright head) and the thinking arcs, in degrees from 12 o'clock. */
const COMET = { tail: -120, head: 40 };
const SEGMENTS = [0, 120, 240];
const SEGMENT_DEG = 46;
/** How far the ring can grow (pulse + mic level), so the clock ring sits clear of it. */
const RING_GROW = 0.07;
/** The halo's biggest scale: fully lit, plus speaking's pulse or the mic level (0.92 + 3 × 0.08). */
const HALO_MAX = 1.16;
const fade = { duration: motion.reducedFadeMs };
const inOut = Easing.inOut(Easing.cubic);

export type HomiePotProps = {
  state: HomieState;
  level?: number;
  size?: number;
  timerProgress?: number | null;
  /** The cream disc's soft shadow (off on a dark backdrop). */
  shadow?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Round and round from where it is now (angles in turns, 0..1). */
function spinFrom(turn: SharedValue<number>, ms: number) {
  const from = turn.get() % 1;
  turn.set(from);
  turn.set(withRepeat(withTiming(from + 1, { duration: ms, easing: Easing.linear }), -1, false));
}

export function HomiePot({ state, level = 0, size = 56, timerProgress = null, shadow = true, style }: HomiePotProps) {
  const reduce = useReducedMotion();
  const id = useId().replace(/[^\w-]/g, '');
  const listening = state === 'listening';
  const thinking = state === 'thinking';
  const speaking = state === 'speaking';
  const awake = state !== 'off' && state !== 'timer';

  const steam = useSharedValue(STEAM[state]);
  const drift = useSharedValue(0);
  const lift = useSharedValue(0);
  const lidOpacity = useSharedValue(1);
  const warm = useSharedValue(awake ? 1 : 0);
  const halo = useSharedValue(HALO[state]);
  const pulse = useSharedValue(0);
  const ringOn = useSharedValue(listening || thinking ? 1 : 0);
  const orbitOn = useSharedValue(listening ? 1 : 0);
  const spinOn = useSharedValue(thinking ? 1 : 0);
  const orbit = useSharedValue(0);
  const spin = useSharedValue(0);
  const beat = useSharedValue(0);
  const voice = useSharedValue(0);
  const clock = useSharedValue(timerProgress ?? 0);
  const clockOn = useSharedValue(timerProgress == null ? 0 : 1);

  // Steam: a still amount per state, the mic level while listening, slow curls while thinking.
  useEffect(() => {
    if (thinking && !reduce) {
      steam.set(withRepeat(withSequence(withTiming(1, { duration: 1400, easing: inOut }), withTiming(0.25, { duration: 1400, easing: inOut })), -1, false));
    } else if (!listening) {
      steam.set(withTiming(STEAM[state], reduce ? fade : { duration: 260, easing: Easing.out(Easing.cubic) }));
    }
  }, [state, listening, thinking, reduce, steam]);
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

  // Lighting up: the warm disc, the halo blooming open, the ring and its arcs fading in (or out).
  useEffect(() => {
    const change = reduce ? fade : { duration: 260, easing: Easing.out(Easing.cubic) };
    warm.set(withTiming(awake ? 1 : 0, change));
    halo.set(withTiming(HALO[state], change));
    ringOn.set(withTiming(listening || thinking ? 1 : 0, change));
    orbitOn.set(withTiming(listening ? 1 : 0, change));
    spinOn.set(withTiming(thinking ? 1 : 0, change));
  }, [state, awake, listening, thinking, reduce, warm, halo, ringOn, orbitOn, spinOn]);

  // The arcs go round only while they show; under Reduce Motion they rest where they were drawn.
  useEffect(() => {
    if (listening && !reduce) spinFrom(orbit, ORBIT_MS);
    else cancelAnimation(orbit);
    if (reduce) orbit.set(0);
  }, [listening, reduce, orbit]);
  useEffect(() => {
    if (thinking && !reduce) spinFrom(spin, SPIN_MS);
    else cancelAnimation(spin);
    if (reduce) spin.set(0);
  }, [thinking, reduce, spin]);

  // The ring's pulse: slow while listening, quick while thinking.
  useEffect(() => {
    if (reduce || !(listening || thinking)) {
      cancelAnimation(beat);
      beat.set(withTiming(0, fade));
      return;
    }
    const half = { duration: thinking ? THINK_BEAT_MS : LISTEN_BEAT_MS, easing: inOut };
    beat.set(withSequence(withTiming(0, { duration: 160 }), withRepeat(withTiming(1, half), -1, true)));
  }, [listening, thinking, reduce, beat]);
  useEffect(() => {
    voice.set(withTiming(listening && !reduce ? level : 0, { duration: 120 }));
  }, [listening, level, reduce, voice]);

  // Speaking: the halo pulses with the words.
  const talking = speaking && !reduce;
  useEffect(() => {
    if (talking) pulse.set(withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(0.3, { duration: 340, easing: inOut })), -1, false));
    else {
      cancelAnimation(pulse);
      pulse.set(withTiming(0, fade));
    }
  }, [talking, pulse]);

  const timed = timerProgress != null;
  useEffect(() => {
    clockOn.set(withTiming(timed ? 1 : 0, fade));
    if (timed) clock.set(reduce ? timerProgress : withTiming(timerProgress, { duration: 900, easing: Easing.linear }));
  }, [timed, timerProgress, reduce, clock, clockOn]);

  // Sizes: the ring hugs the circle's edge; the clock is drawn just outside the ring's glow at its biggest,
  // and scaled in to hug the edge while there is no ring (under Reduce Motion it stays out: no movement).
  // The ring and the halo are drawn at their biggest and only ever scaled down, so the ring stays crisp.
  const ringW = Math.max(3, size * 0.04);
  const ringOut = size / 2 + 1.5 * ringW; // how far the arcs' glow (twice the ring's width) reaches at rest
  const big = 1 + RING_GROW;
  const ringR = (size / 2 + ringW / 2) * big;
  const lineW = ringW * big;
  const glowW = lineW * 2;
  const ringBox = Math.ceil(2 * ringOut * big + 2);
  const c = ringBox / 2;
  const gap = Math.max(1, size * 0.01);
  const clockW = Math.max(3, size * 0.03);
  const clockR = ringOut * big + gap + clockW / 2;
  const clockBox = Math.ceil(2 * clockR + clockW + 2);
  const clockC = 2 * Math.PI * clockR;
  const clockIn = (size / 2 + gap + clockW / 2) / clockR;
  const haloBox = size * 1.5 * HALO_MAX;

  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + ringR * Math.sin(a), y: c - ringR * Math.cos(a) };
  };
  const arc = (from: number, to: number) => {
    const p = at(from);
    const q = at(to);
    return `M${p.x} ${p.y}A${ringR} ${ringR} 0 0 1 ${q.x} ${q.y}`;
  };
  const tail = at(COMET.tail);
  const head = at(COMET.head);
  const comet = arc(COMET.tail, COMET.head);
  // From 12 o'clock, clockwise (two half arcs), so the remaining time ends at the top like a clock.
  const clockPath = `M${clockBox / 2} ${clockBox / 2 - clockR}a${clockR} ${clockR} 0 1 1 0 ${2 * clockR}a${clockR} ${clockR} 0 1 1 0 ${-2 * clockR}`;

  const steamProps = useAnimatedProps(() => ({
    strokeDashoffset: reduce ? 0 : STEAM_LEN * (1 - steam.value),
    strokeOpacity: 0.6 * Math.min(1, steam.value * 1.5),
  }));
  const steamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -drift.value * size * 0.04 }] }));
  const lidStyle = useAnimatedStyle(() => ({
    opacity: lidOpacity.value,
    transform: [{ translateY: -lift.value * size * 0.06 }, { rotate: `${-lift.value * 7}deg` }],
  }));
  const warmStyle = useAnimatedStyle(() => ({ opacity: warm.value }));
  // Lit, the glow takes over from the shadow (which would muddy the ring).
  const shadowStyle = useAnimatedStyle(() => ({ opacity: 1 - warm.value }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, halo.value * (0.8 + 0.2 * pulse.value) + 0.3 * voice.value),
    transform: [{ scale: (0.92 + 0.08 * halo.value + 0.08 * pulse.value + 0.08 * voice.value) / HALO_MAX }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOn.value,
    transform: [{ scale: (1 + 0.02 * beat.value + (RING_GROW - 0.02) * voice.value) / big }],
  }));
  const trackStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, 0.35 + 0.3 * beat.value + 0.35 * voice.value) }));
  const orbitStyle = useAnimatedStyle(() => ({ opacity: orbitOn.value * (0.8 + 0.2 * beat.value), transform: [{ rotate: `${orbit.value * 360}deg` }] }));
  const spinStyle = useAnimatedStyle(() => ({ opacity: spinOn.value * (0.6 + 0.4 * beat.value), transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const clockProps = useAnimatedProps(() => ({ strokeDashoffset: clockC * (1 - clock.value) }));
  const clockStyle = useAnimatedStyle(() => ({ opacity: clockOn.value, transform: [{ scale: reduce ? 1 : clockIn + (1 - clockIn) * ringOn.value }] }));

  const potW = size * 0.62;
  const potBox = { left: size * 0.19, top: size * 0.29, width: potW, height: potW * 0.92 };
  const disc = { borderRadius: size / 2 };
  const around = (box: number) => ({ left: (size - box) / 2, top: (size - box) / 2, width: box, height: box });

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.abs, around(haloBox), haloStyle]}>
        <Svg width={haloBox} height={haloBox} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%">
              <Stop offset="0.6" stopColor={colors.sun} stopOpacity={0.7} />
              <Stop offset="0.8" stopColor={colors.sun} stopOpacity={0.25} />
              <Stop offset="1" stopColor={colors.sun} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={50} cy={50} r={50} fill={`url(#${id}halo)`} />
        </Svg>
      </Animated.View>
      {shadow ? <Animated.View style={[StyleSheet.absoluteFill, disc, styles.disc, styles.shadow, shadowStyle]} /> : null}
      <View style={[StyleSheet.absoluteFill, disc, styles.disc]} />
      <Animated.View style={[StyleSheet.absoluteFill, disc, styles.butter, warmStyle]} />

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

      {/* The activity ring: a pulsing yellow track, the orbiting comet (listening), the spinning arcs (thinking). */}
      <Animated.View style={[styles.abs, around(ringBox), ringStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, trackStyle]}>
          <Svg width={ringBox} height={ringBox}>
            <Circle cx={c} cy={c} r={ringR} stroke={colors.sun} strokeWidth={lineW * 0.6} fill="none" />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, orbitStyle]}>
          <Svg width={ringBox} height={ringBox}>
            <Defs>
              <LinearGradient id={`${id}comet`} gradientUnits="userSpaceOnUse" x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}>
                <Stop offset="0" stopColor={colors.sun} stopOpacity={0} />
                <Stop offset="0.45" stopColor={colors.sun} stopOpacity={0.6} />
                <Stop offset="1" stopColor={colors.sun} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Path d={comet} stroke={`url(#${id}comet)`} strokeOpacity={0.35} strokeWidth={glowW} strokeLinecap="round" fill="none" />
            <Path d={comet} stroke={`url(#${id}comet)`} strokeWidth={lineW} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
          <Svg width={ringBox} height={ringBox}>
            {SEGMENTS.map((mid) => (
              <Path key={`glow${mid}`} d={arc(mid - SEGMENT_DEG / 2, mid + SEGMENT_DEG / 2)} stroke={colors.sun} strokeOpacity={0.3} strokeWidth={glowW} strokeLinecap="round" fill="none" />
            ))}
            {SEGMENTS.map((mid) => (
              <Path key={mid} d={arc(mid - SEGMENT_DEG / 2, mid + SEGMENT_DEG / 2)} stroke={colors.sun} strokeWidth={lineW} strokeLinecap="round" fill="none" />
            ))}
          </Svg>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.abs, around(clockBox), clockStyle]}>
        <Svg width={clockBox} height={clockBox}>
          <Circle cx={clockBox / 2} cy={clockBox / 2} r={clockR} stroke={alpha.checkRing} strokeWidth={clockW * 0.85} fill="none" />
          <AnimatedPath d={clockPath} stroke={colors.green} strokeWidth={clockW} strokeLinecap="round" fill="none" strokeDasharray={`${clockC} ${clockC}`} animatedProps={clockProps} />
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
