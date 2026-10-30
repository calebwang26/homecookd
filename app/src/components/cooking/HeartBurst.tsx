// Hearts mid-cook (RETENTION-HANDOFF 3.1).
//
//   <HeartBurst trigger={heartKey} fromName="Mom" />   kid side, over cook mode: each time `trigger`
//       goes up, a heart pops in the middle of the screen with a few tiny particles, then fades, and a
//       toast says "Mom sent you a heart". It never blocks a tap (pointerEvents none). No push.
//   <HeartPop trigger={n} reach={18} />                the small particle ring alone, e.g. around the
//       cook's heart button on the live row (LiveCookingRow), where `reach` keeps it inside the card,
//       and any heart that goes on (HeartButton, retention PR 7: `size` 0.7 for tinier particles).
//
// Motion: the heart grows 0 -> 1.15 -> 1 on a soft spring, holds ~0.9 s, fades out; 8 particles (the
// heart's red, yolk, yolk-deep) fly out past the ring (26-44 pt by default, `reach` scales it) and fade.
// Reduce Motion: the heart fades in and out in place, no particles, no scale.
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptic, HeartIcon, useToast } from '@/components/ui';
import { heartToast } from '@/lib/cookingLogic';
import { colors, motion } from '@/theme/tokens';

const PARTICLE_COLORS = [colors.danger, colors.yolk, colors.yolkDeep, colors.yolk];

export type HeartPopProps = {
  /** Plays each time this goes up (0 = never played). */
  trigger: number;
  /** The ring's radius at rest, around the centre of the parent (default 20: a 48 pt button). */
  radius?: number;
  /**
   * How far past `radius` the farthest particle ends (default 44). They fade out on the way, so the
   * visible burst stops a little short of `radius + reach`.
   */
  reach?: number;
  /** Particle size, as a share of the default (5-7 pt dots, 10-12 pt hearts). */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_REACH = 44;

/** A few tiny particles flying out from the centre of the parent, then gone. Nothing under Reduce Motion. */
export function HeartPop({ trigger, radius = 20, reach = DEFAULT_REACH, size: scale = 1, style }: HeartPopProps) {
  const reduce = useReducedMotion();
  const burst = useSharedValue(0);
  const parts = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2 + (i % 2 ? 0.25 : -0.15),
        dist: ((26 + ((i * 7) % 19)) * reach) / DEFAULT_REACH, // 26..44 at the default reach
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        size: Math.max(3, Math.round((i % 3 === 0 ? 7 : 5) * scale)),
        heart: i % 2 === 0,
      })),
    [reach, scale],
  );
  useEffect(() => {
    if (!trigger || reduce) return;
    burst.value = 0;
    burst.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
  }, [trigger, reduce, burst]);
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, style]}>
      {parts.map((p, i) => (
        <Particle key={i} {...p} radius={radius} burst={burst} />
      ))}
    </View>
  );
}

function Particle({
  angle,
  dist,
  color,
  size,
  heart,
  radius,
  burst,
}: {
  angle: number;
  dist: number;
  color: string;
  size: number;
  heart: boolean;
  radius: number;
  burst: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const r = radius * 0.6 + (radius * 0.4 + dist) * burst.value;
    return {
      opacity: burst.value === 0 || burst.value === 1 ? 0 : burst.value < 0.55 ? 1 : 1 - (burst.value - 0.55) / 0.45,
      transform: [{ translateX: Math.cos(angle) * r }, { translateY: Math.sin(angle) * r }, { scale: 1 - 0.35 * burst.value }],
    };
  });
  return (
    <Animated.View style={[styles.particle, style]}>
      {heart ? (
        <HeartIcon size={size + 5} filled color={color} strokeWidth={1} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
      )}
    </Animated.View>
  );
}

export type HeartBurstProps = {
  /** Each time this goes up, one burst and one toast (0 = none yet). */
  trigger: number;
  /** Who sent it, as the family calls them ("Mom"). */
  fromName?: string | null;
  /** Show the toast "Mom sent you a heart" (default true). */
  toast?: boolean;
  /** Where the heart sits, from the top of the screen (default 38%). */
  top?: ViewStyle['top'];
  onDone?: () => void;
};

const HOLD_MS = 900;

/** The kid's mid-cook heart: a pop in the middle of the screen and a toast. Never blocks a tap. */
export function HeartBurst({ trigger, fromName, toast = true, top = '38%', onDone }: HeartBurstProps) {
  const reduce = useReducedMotion();
  const toasts = useToast();
  const scale = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (!trigger) return;
    haptic('success');
    if (toast) toasts.show(heartToast(fromName), { icon: <HeartIcon size={15} filled color={colors.card} strokeWidth={1.5} /> });
    if (reduce) {
      scale.value = 1;
      fade.value = withSequence(
        withTiming(1, { duration: motion.reducedFadeMs }),
        withDelay(HOLD_MS, withTiming(0, { duration: motion.reducedFadeMs })),
      );
    } else {
      scale.value = 0;
      fade.value = 1;
      scale.value = withSequence(
        withSpring(1.15, { damping: 12, stiffness: 260, mass: 1 }),
        withSpring(1, { damping: 16, stiffness: 220, mass: 1 }),
      );
      fade.value = withDelay(HOLD_MS + 250, withTiming(0, { duration: 260 }));
    }
    const t = setTimeout(() => onDone?.(), HOLD_MS + 600);
    return () => clearTimeout(t);
    // One burst per new trigger; the name, toast & callback are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const heartStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: scale.value }] }));

  if (!trigger) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.spot, { top }]}>
        <HeartPop trigger={trigger} radius={36} />
        <Animated.View style={[styles.disc, heartStyle]}>
          <HeartIcon size={40} filled color={colors.danger} strokeWidth={1.5} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  particle: { position: 'absolute' },
  spot: { position: 'absolute', left: 0, right: 0, height: 96, marginTop: -48, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 30px rgba(31,36,48,0.14)',
  },
});
