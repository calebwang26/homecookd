// Motion spec 1: launch bloom, then reveal. An overlay above the navigator; mount it once per cold
// start and unmount it in `onDone`.
//   0-280 ms     the egg mark (the kit's mark.svg) scales 0.2 -> 1.15, opacity 0 -> 1 (no glow: the kit)
//   280-700 ms   settle 1.15 -> 1.0 on a spring (damping 14, stiffness 160); the sparkle pops in
//   700-900 ms   shrink to 0.85
//   900-1150 ms  the mark scales to ~14x and fades while the page shows through a yolk-tint wash
//                that clears; taps pass through from 900 ms; onDone at ~1200 ms
// Reduce Motion: the mark appears, holds briefly, and the overlay fades out (150 ms).
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, motion } from '@/theme/tokens';

import { EggMark } from './ui/Egg';
import { SparkleIcon } from './ui/icons';

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
  const sparkle = useSharedValue(reduce ? 1 : 0);
  const page = useSharedValue(1); // cream page opacity
  const wash = useSharedValue(0); // yolk tint

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
    sparkle.value = withDelay(280, withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }));
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
  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: sparkle.value,
    transform: [{ scale: 0.4 + 0.6 * sparkle.value }, { rotate: `${sparkle.value * 45}deg` }],
  }));

  return (
    <View style={styles.overlay} pointerEvents={passThrough ? 'none' : 'auto'} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, styles.page, pageStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.wash, washStyle]} />
      <View style={styles.center} pointerEvents="none">
        <Animated.View style={[styles.mark, markStyle]}>
          <EggMark size={MARK} />
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
  wash: { backgroundColor: colors.yolkTint },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  mark: { alignItems: 'center' },
  // Clear of the egg (the kit's 25% clear space would be 28 pt; the sparkle sits just inside it).
  sparkle: { position: 'absolute', right: -18, top: -10 },
});
