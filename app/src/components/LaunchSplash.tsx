// Motion spec 1: launch bloom, then reveal. An overlay above the navigator; mount it once per cold
// start and unmount it in `onDone`.
//   0-280 ms     pot mark scale 0.2 -> 1.15, opacity 0 -> 1, sun glow (35% -> 0) blooms behind it
//   280-700 ms   settle 1.15 -> 1.0 on a spring (damping 14, stiffness 160); steam curls draw on
//   700-900 ms   shrink to 0.85
//   900-1150 ms  the mark scales to ~14x and fades while the page shows through a lavender wash
//                that clears; taps pass through from 900 ms; onDone at ~1200 ms
// Reduce Motion: the mark appears, holds briefly, and the overlay fades out (150 ms).
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors, motion } from '@/theme/tokens';

import { PotMark, SparkleIcon } from './ui/icons';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const STEAM_LEN = 40;

/**
 * Where the launch bloom is, so the first screen can time its own reveal (fade in from opacity 0,
 * scale 1.03 -> 1 while the overlay clears):
 *   'none'      no bloom this launch (or not mounted yet)
 *   'playing'   the overlay covers the screen
 *   'revealing' the overlay is clearing (900 ms in; 450 ms under Reduce Motion)
 *   'done'      gone
 */
export type LaunchPhase = 'none' | 'playing' | 'revealing' | 'done';
let launchPhase: LaunchPhase = 'none';
const phaseListeners = new Set<() => void>();
function setLaunchPhase(p: LaunchPhase) {
  if (launchPhase === p) return;
  launchPhase = p;
  for (const l of phaseListeners) l();
}
function subscribePhase(l: () => void) {
  phaseListeners.add(l);
  return () => {
    phaseListeners.delete(l);
  };
}
export function getLaunchPhase(): LaunchPhase {
  return launchPhase;
}
export function useLaunchPhase(): LaunchPhase {
  return useSyncExternalStore(subscribePhase, getLaunchPhase, getLaunchPhase);
}
const MARK = 112;

export function LaunchSplash({ onDone }: { onDone?: () => void }) {
  const reduce = useReducedMotion();
  const [passThrough, setPassThrough] = useState(false);

  const mark = useSharedValue(reduce ? 1 : 0.2);
  const markOpacity = useSharedValue(reduce ? 1 : 0);
  const glow = useSharedValue(0);
  const steam = useSharedValue(reduce ? 1 : 0);
  const page = useSharedValue(1); // cream page opacity
  const wash = useSharedValue(0); // lavender tint

  // Before paint, so the first screen can hide itself under the overlay.
  useLayoutEffect(() => {
    setLaunchPhase('playing');
    return () => setLaunchPhase('done');
  }, []);

  useEffect(() => {
    if (reduce) {
      page.value = withDelay(450, withTiming(0, { duration: motion.reducedFadeMs }));
      markOpacity.value = withDelay(450, withTiming(0, { duration: motion.reducedFadeMs }));
      const t1 = setTimeout(() => {
        setPassThrough(true);
        setLaunchPhase('revealing');
      }, 450);
      const t2 = setTimeout(() => {
        setLaunchPhase('done');
        onDone?.();
      }, 450 + motion.reducedFadeMs + 20);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    const out = Easing.out(Easing.cubic);
    mark.value = withSequence(
      withTiming(1.15, { duration: 280, easing: out }),
      withSpring(1, motion.settle),
    );
    // The spring settles in a variable time; pin the shrink + zoom to the spec's clock instead.
    const tShrink = setTimeout(() => {
      mark.value = withSequence(
        withTiming(0.85, { duration: 200, easing: Easing.inOut(Easing.cubic) }),
        withTiming(14, { duration: 250, easing: Easing.in(Easing.cubic) }),
      );
    }, 700);
    markOpacity.value = withSequence(
      withTiming(1, { duration: 280, easing: out }),
      withDelay(620, withTiming(0, { duration: 250, easing: Easing.in(Easing.quad) })),
    );
    glow.value = withSequence(withTiming(1, { duration: 280, easing: out }), withTiming(0, { duration: 520 }));
    steam.value = withDelay(280, withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }));
    page.value = withDelay(900, withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) }));
    wash.value = withDelay(900, withSequence(withTiming(0.75, { duration: 90 }), withTiming(0, { duration: 210 })));
    const t1 = setTimeout(() => {
      setPassThrough(true);
      setLaunchPhase('revealing');
    }, 900);
    const t2 = setTimeout(() => {
      setLaunchPhase('done');
      onDone?.();
    }, 1220);
    return () => {
      clearTimeout(tShrink);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageStyle = useAnimatedStyle(() => ({ opacity: page.value }));
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
  const markStyle = useAnimatedStyle(() => ({ opacity: markOpacity.value, transform: [{ scale: mark.value }] }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.4 + glow.value * 1.2 }],
  }));
  const steamProps = useAnimatedProps(() => ({ strokeDashoffset: STEAM_LEN * (1 - steam.value) }));
  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: steam.value,
    transform: [{ scale: 0.4 + 0.6 * steam.value }, { rotate: `${steam.value * 45}deg` }],
  }));

  return (
    <View style={styles.overlay} pointerEvents={passThrough ? 'none' : 'auto'} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, styles.page, pageStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.wash, washStyle]} />
      <View style={styles.center} pointerEvents="none">
        <Animated.View style={[styles.glow, glowStyle]}>
          <Svg width={280} height={280}>
            <Defs>
              <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={colors.sun} stopOpacity={0.35} />
                <Stop offset="1" stopColor={colors.sun} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={140} cy={140} r={140} fill="url(#glow)" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.mark, markStyle]}>
          <Svg width={MARK} height={44} viewBox="0 0 112 44" style={styles.steam}>
            {[34, 56, 78].map((x, i) => (
              <AnimatedPath
                key={x}
                d={`M${x} 42c-6-6 6-10 0-18s6-12 0-20`}
                stroke={colors.potLine}
                strokeOpacity={0.55}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${STEAM_LEN} ${STEAM_LEN}`}
                animatedProps={steamProps}
                transform={i === 1 ? 'translate(0 -4)' : undefined}
              />
            ))}
          </Svg>
          <PotMark size={MARK} />
          <Animated.View style={[styles.sparkle, sparkleStyle]}>
            <SparkleIcon size={26} gradient />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9999, elevation: 9999 },
  page: { backgroundColor: colors.page },
  wash: { backgroundColor: colors.lavender },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 280, height: 280 },
  mark: { alignItems: 'center' },
  steam: { marginBottom: -Math.round(MARK * 0.3) },
  sparkle: { position: 'absolute', right: -6, top: 18 },
});
