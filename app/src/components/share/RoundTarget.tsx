// One round target in the share sheets' rows, as in Spotify's share sheet: a circle (a face or an
// app button) with a one-line label underneath. The faces row (FamilyRow) and the app row
// (ExternalRow) share one grid (useRowMetrics), so a face sits above a button: five targets fit the
// sheet's width with no scrolling (QA B09), so the app row never hides a button past the edge. On a
// 390 pt phone that is 68 pt targets with 56 pt circles; from about 430 pt up, 76 pt targets with
// 64 pt circles. A faces row with more than five people scrolls, the sixth peeking in at the edge.
//
//   busy  a green arc spins round the circle
//   done  a green check fades in at the bottom right and the label becomes `doneLabel` ("Sent")
//
// No scale pops on the icons (the fuzzy-heart bug): the check fades in, the press is
// PressableScale's.
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { CheckIcon, PressableScale, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

/** The largest circle and target (from about 430 pt wide). */
export const CIRCLE = 64;
export const TARGET_W = 76;
/** Side padding of a row: the sheet's 24 pt gutter. */
const PAD = 24;
/** Targets that fit across the sheet without scrolling. */
const FIT = 5;
const MAX_GAP = 20;
/**
 * A label stops this far short of each side of its target: on phones the targets touch (no gap),
 * so two long names side by side ("Auntie Te…", "Grandpa J…") would otherwise run together.
 */
const LABEL_INSET = 3;

export type RowMetrics = {
  /** A target's width (its tap area and label width). */
  width: number;
  /** Between targets (0 on phones: the targets' own width spaces them). */
  gap: number;
  circle: number;
  /** The label's font size: 13 where a target is narrower than 72 pt, so "Instagram" fits. */
  label: number;
};

/** The shared grid: FIT slots across the sheet (its full window width) between the 24 pt gutters. */
export function useRowMetrics(): RowMetrics {
  const { width: win } = useWindowDimensions();
  // Whole points, so five never add up to a hair over the width (which would make the row scroll).
  const slot = Math.floor(Math.min((win - 2 * PAD) / FIT, TARGET_W + MAX_GAP));
  const width = Math.min(slot, TARGET_W);
  return { width, gap: slot - width, circle: Math.min(CIRCLE, Math.floor(width - 12)), label: width < 72 ? 13 : 14 };
}

/**
 * A sideways row of targets running the full width of the sheet (the caller bleeds it). `reveal`
 * scrolls that target fully into view (a new object each time, e.g. after a tap on a face that
 * was half past the edge).
 */
export function TargetRow({
  children,
  accessibilityLabel,
  reveal,
}: {
  children: ReactNode;
  accessibilityLabel?: string;
  reveal?: { index: number } | null;
}) {
  const m = useRowMetrics();
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const viewW = useRef(0);
  useEffect(() => {
    if (!reveal || !viewW.current) return;
    const left = PAD + reveal.index * (m.width + m.gap);
    const right = left + m.width;
    let to = offset.current;
    if (left - PAD < offset.current) to = left - PAD;
    else if (right + PAD > offset.current + viewW.current) to = right + PAD - viewW.current;
    if (to !== offset.current) ref.current?.scrollTo({ x: Math.max(0, to), animated: true });
  }, [reveal, m.width, m.gap]);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => {
        viewW.current = e.nativeEvent.layout.width;
      }}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
      contentContainerStyle={[styles.scroll, { gap: m.gap }]}
      accessibilityRole="list"
      accessibilityLabel={accessibilityLabel}>
      {children}
    </ScrollView>
  );
}

export type RoundTargetProps = {
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  /** The circle's fill (faces leave it clear; the avatar is the circle). */
  fill?: string;
  busy?: boolean;
  done?: boolean;
  doneLabel?: string;
  /** Taps do nothing (another target is busy). */
  disabled?: boolean;
  children: ReactNode;
};

export function RoundTarget({
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  fill,
  busy = false,
  done = false,
  doneLabel = 'Sent',
  disabled = false,
  children,
}: RoundTargetProps) {
  const idle = !busy && !done && !disabled;
  const m = useRowMetrics();
  const c = m.circle;
  const labelBox = { maxWidth: m.width - 2 * LABEL_INSET };
  return (
    <PressableScale
      onPress={idle ? onPress : undefined}
      haptic={idle}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy, disabled: !idle }}
      style={[styles.item, { width: m.width }]}>
      <View style={[styles.circle, { width: c, height: c, borderRadius: c / 2 }, fill ? { backgroundColor: fill } : null]}>
        {children}
        {busy ? <SpinnerRing circle={c} /> : null}
        {done ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.check}>
            <CheckIcon size={14} strokeWidth={3.5} color={colors.card} />
          </Animated.View>
        ) : null}
      </View>
      {done ? (
        <Animated.View key="done" entering={FadeIn.duration(180)}>
          <Txt variant="label" size={m.label} weight={700} color={colors.greenDeep} numberOfLines={1} align="center" style={labelBox}>
            {doneLabel}
          </Txt>
        </Animated.View>
      ) : (
        <Txt
          variant="label"
          size={m.label}
          weight={600}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          align="center"
          style={[labelBox, busy ? styles.dim : null]}>
          {label}
        </Txt>
      )}
    </PressableScale>
  );
}

/** A green arc spinning round the circle while something is on its way. */
function SpinnerRing({ circle }: { circle: number }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withRepeat(withTiming(1, { duration: reduce ? 1600 : 900, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [turn, reduce]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const S = circle + 10;
  const r = S / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <Animated.View entering={FadeIn.duration(160)} pointerEvents="none" style={styles.spinnerWrap}>
      <View style={[styles.veil, { width: circle, height: circle, borderRadius: circle / 2 }]} />
      <Animated.View style={[{ width: S, height: S }, spin]}>
        <Svg width={S} height={S}>
          <Circle cx={S / 2} cy={S / 2} r={r} stroke={colors.green} strokeWidth={3} strokeLinecap="round" fill="none" strokeDasharray={`${c * 0.28} ${c}`} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Vertical room so the spinner ring (5 pt outside the circle) isn't clipped by the scroller.
  scroll: { paddingHorizontal: PAD, paddingVertical: 6 },
  item: { alignItems: 'center', gap: 8 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  spinnerWrap: { position: 'absolute', left: -5, top: -5, right: -5, bottom: -5, alignItems: 'center', justifyContent: 'center' },
  veil: { position: 'absolute', left: 5, top: 5, backgroundColor: 'rgba(255,253,247,0.35)' },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 0 3px ${colors.card}`,
  },
  dim: { opacity: 0.6 },
});
