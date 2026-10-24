// Motion spec 5 success moment (Luma's "You're In", in homecookd colours):
//   0 ms     green #5B6F00 badge grows 0 -> 1 on a spring
//   120 ms   cream check stroke draws on (220 ms)
//   250 ms   sun #FEBE29 ring scales 1 -> 1.8 while fading; 10 confetti dots (green, sun, peach,
//            lavender) fly 28-44 px outward and fade
//   500 ms   title (Fraunces 26) + subtitle fade up 8 px
//   then holds `holdMs` (1.4 s) and calls onDone.
// Reduce Motion: everything fades in over 150 ms, same hold.
// Retention PR 7 touches (RETENTION-HANDOFF 4), polish only:
//   steam     three steam curls draw on above the badge at 300 ms, then rise and fade (cook mode's
//             last step, "I made it"). Reduce Motion: they fade in with the badge and stay.
//   glyph     'plane': a paper plane in the badge instead of the check, lifting off up and to the
//             right as the ring goes (Send, "On its way to Leo"). Reduce Motion: it just fades in.
//   subtitleIcon  a small picture before the subtitle (Send: a pot with its lid on, "You can close the app").
import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import Svg, { Path } from 'react-native-svg';

import { colors, motion } from '@/theme/tokens';

import { haptic } from './haptics';
import { Txt } from './Txt';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 20;
const STEAM_LEN = 40;
/** A paper plane with its centre fold (24 box): SendIcon's outline alone reads as a map arrow at badge size. */
const PLANE = 'M21 3l-6.5 18-4-7.5L3 9.5zM21 3l-10.5 10.5';
const DOT_COLORS = [colors.green, colors.sun, colors.peach, colors.lavender];

export type SuccessBurstProps = {
  title?: string;
  subtitle?: string;
  /** 'lg' = 64 px badge for sheets/screens; 'sm' = 40 px inline. */
  size?: 'lg' | 'sm';
  /** Start playing (default true on mount). Flip false -> true to replay. */
  play?: boolean;
  holdMs?: number;
  onDone?: () => void;
  /** Haptic success on the badge (default true). */
  haptics?: boolean;
  /** Steam curls rise over the badge (cook mode's "I made it"). */
  steam?: boolean;
  /** What the badge holds: the check (default) or a paper plane (a send). */
  glyph?: 'check' | 'plane';
  /** A small picture before the subtitle, on its line. */
  subtitleIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SuccessBurst({
  title,
  subtitle,
  size = 'lg',
  play = true,
  holdMs = motion.successHoldMs,
  onDone,
  haptics = true,
  steam = false,
  glyph = 'check',
  subtitleIcon,
  style,
}: SuccessBurstProps) {
  const reduce = useReducedMotion();
  const badge = size === 'lg' ? 64 : 40;
  const stroke = size === 'lg' ? 3 : 3.2;

  const scale = useSharedValue(0);
  const draw = useSharedValue(0);
  const ring = useSharedValue(0);
  const burst = useSharedValue(0);
  const text = useSharedValue(0);
  const fade = useSharedValue(0); // reduce-motion path
  const puff = useSharedValue(0); // steam: 0 -> 1 draws on, 1 -> 2 rises and fades
  const lift = useSharedValue(0); // the paper plane's lift-off

  const dots = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2 + (i % 2 ? 0.22 : -0.1);
        const dist = 28 + ((i * 7) % 17); // 28..44
        return { angle, dist, color: DOT_COLORS[i % DOT_COLORS.length], size: i % 3 === 0 ? 7 : 5 };
      }),
    [],
  );

  useEffect(() => {
    if (!play) {
      scale.value = 0;
      draw.value = 0;
      ring.value = 0;
      burst.value = 0;
      text.value = 0;
      fade.value = 0;
      puff.value = 0;
      lift.value = 0;
      return;
    }
    const finish = () => onDone?.();
    if (haptics) haptic('success');
    if (reduce) {
      fade.value = withTiming(1, { duration: motion.reducedFadeMs });
      const t = setTimeout(finish, motion.reducedFadeMs + holdMs);
      return () => clearTimeout(t);
    }
    // mass 1 like every spring (theme/tokens motion); damping 16 keeps the old 0.8-mass settle.
    scale.value = withSpring(1, { damping: 16, stiffness: 220, mass: 1 });
    draw.value = withDelay(120, withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }));
    ring.value = withDelay(250, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    burst.value = withDelay(250, withTiming(1, { duration: 480, easing: Easing.out(Easing.quad) }));
    text.value = withDelay(500, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    if (steam) {
      puff.value = withDelay(
        300,
        withSequence(
          withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }),
          withDelay(250, withTiming(2, { duration: 900, easing: Easing.out(Easing.quad) })),
        ),
      );
    }
    if (glyph === 'plane') lift.value = withDelay(250, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    const t = setTimeout(finish, 500 + 260 + holdMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, reduce]);

  const badgeStyle = useAnimatedStyle(() =>
    reduce ? { opacity: fade.value, transform: [{ scale: 1 }] } : { opacity: 1, transform: [{ scale: scale.value }] },
  );
  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: reduce ? 0 : CHECK_LEN * (1 - draw.value),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduce ? 0 : ring.value === 0 ? 0 : 0.9 * (1 - ring.value),
    transform: [{ scale: 1 + 0.8 * ring.value }],
  }));
  const textStyle = useAnimatedStyle(() =>
    reduce ? { opacity: fade.value } : { opacity: text.value, transform: [{ translateY: 8 * (1 - text.value) }] },
  );
  const steamProps = useAnimatedProps(() => ({
    strokeDashoffset: reduce ? 0 : STEAM_LEN * (1 - Math.min(1, puff.value)),
  }));
  const steamStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: fade.value }
      : { opacity: puff.value <= 1 ? 1 : 2 - puff.value, transform: [{ translateY: -10 * Math.max(0, puff.value - 1) }] },
  );
  const planeStyle = useAnimatedStyle(() =>
    reduce ? { transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }] } : { transform: [{ translateX: 3 * lift.value }, { translateY: -3 * lift.value }, { rotate: `${-6 * lift.value}deg` }] },
  );
  const steamW = badge * 1.1;
  const steamH = badge * 0.62;

  return (
    <View style={[styles.wrap, style]} accessibilityRole="alert" accessibilityLabel={[title, subtitle].filter(Boolean).join('. ')}>
      <View style={{ width: badge, height: badge, alignItems: 'center', justifyContent: 'center' }}>
        {steam ? (
          // Above the badge, not in the layout: the title stays where it always is.
          <Animated.View pointerEvents="none" style={[styles.steam, { width: steamW, height: steamH, top: -steamH - 2 }, steamStyle]}>
            <Svg width={steamW} height={steamH} viewBox="0 0 44 26">
              {[12, 22, 32].map((x, i) => (
                <AnimatedPath
                  key={x}
                  d={`M${x} ${i === 1 ? 24 : 25}c-4-4 4-6.5 0-11.5s4-7.5 0-12`}
                  stroke={colors.green}
                  strokeOpacity={0.5}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${STEAM_LEN} ${STEAM_LEN}`}
                  animatedProps={steamProps}
                />
              ))}
            </Svg>
          </Animated.View>
        ) : null}
        <Animated.View
          style={[
            styles.ring,
            { width: badge, height: badge, borderRadius: badge / 2, borderWidth: size === 'lg' ? 4 : 3 },
            ringStyle,
          ]}
        />
        {dots.map((d, i) => (
          <Dot key={i} {...d} radius={badge / 2} burst={burst} hidden={reduce} />
        ))}
        <Animated.View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2 }, badgeStyle]}>
          {glyph === 'plane' ? (
            <Animated.View style={planeStyle}>
              <Svg width={badge * 0.46} height={badge * 0.46} viewBox="0 0 24 24" fill="none">
                <Path d={PLANE} stroke={colors.card} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Animated.View>
          ) : (
            <Svg width={badge * 0.5} height={badge * 0.5} viewBox="0 0 24 24" fill="none">
              <AnimatedPath
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke={colors.card}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`}
                animatedProps={checkProps}
              />
            </Svg>
          )}
        </Animated.View>
      </View>
      {title || subtitle ? (
        <Animated.View style={[styles.text, textStyle]}>
          {title ? (
            <Txt variant="display" size={size === 'lg' ? 26 : 20} align="center">
              {title}
            </Txt>
          ) : null}
          {subtitle && subtitleIcon ? (
            <View style={styles.subRow}>
              {subtitleIcon}
              <Txt variant="body" align="center" leading={1.4} style={styles.subText}>
                {subtitle}
              </Txt>
            </View>
          ) : subtitle ? (
            <Txt variant="body" align="center" leading={1.4}>
              {subtitle}
            </Txt>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

function Dot({
  angle,
  dist,
  color,
  size,
  radius,
  burst,
  hidden,
}: {
  angle: number;
  dist: number;
  color: string;
  size: number;
  radius: number;
  burst: { value: number };
  hidden: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const r = radius * 0.7 + (radius * 0.3 + dist) * burst.value;
    return {
      opacity: hidden || burst.value === 0 ? 0 : burst.value < 0.5 ? 1 : 1 - (burst.value - 0.5) * 2,
      transform: [{ translateX: Math.cos(angle) * r }, { translateY: Math.sin(angle) * r }, { scale: 1 - 0.4 * burst.value }],
    };
  });
  return <Animated.View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, marginLeft: -size / 2, marginTop: -size / 2 }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 16 },
  badge: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderColor: colors.sun },
  dot: { position: 'absolute', left: '50%', top: '50%' },
  text: { alignItems: 'center', gap: 6, maxWidth: 300 },
  steam: { position: 'absolute', alignSelf: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  subText: { flexShrink: 1 },
});
