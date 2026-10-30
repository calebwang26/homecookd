// Cook mode's step progress under "Step 3 of 8" (retention PR 7, RETENTION-HANDOFF 4): one little yolk
// per step (they were pots), yolk up to and including the step on screen (where you are now; the furthest step
// reached shows in "All steps" instead). A jump ahead fills the new dots one after another (45 ms
// apart); going back empties them at once. Each dot fades between empty (the track colour) and full (yolk),
// the same 240 ms fade the bars had, so Reduce Motion keeps a plain fade (no stagger).
// The dots are as big as the header allows (lib/touches potDotLayout, 10-16 pt); a recipe with so many
// steps that they'd shrink below that keeps the old bars. A picture only: the "Step 3 of 8" button
// around it says it.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { POT_MAX, potDotLayout } from '@/lib/touches';
import { colors, radii } from '@/theme/tokens';

const FILL_MS = 240;
const STAGGER_MS = 45;
/** The row is always as tall as the biggest dot, so nothing under the header moves once it's measured. */
const ROW_H = Math.round(POT_MAX * 0.8);

/** `reached`: the 1-based step on screen. */
export function PotDots({ total, reached }: { total: number; reached: number }) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  // Where the fill was before this change, so a jump fills the new dots in turn.
  const [seen, setSeen] = useState(reached);
  const [from, setFrom] = useState(reached);
  if (seen !== reached) {
    setFrom(seen);
    setSeen(reached);
  }
  const layout = potDotLayout(width, total);

  return (
    <View
      style={[styles.row, { gap: layout?.gap ?? 6 }]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {!width
        ? null
        : layout
          ? Array.from({ length: total }, (_, i) => (
              <StepDot key={i} size={layout.size} on={i < reached} delay={!reduce && i >= from && i < reached ? (i - from) * STAGGER_MS : 0} />
            ))
          : Array.from({ length: Math.max(total, 1) }, (_, i) => <Segment key={i} on={!!total && i < reached} />)}
    </View>
  );
}

/** A little yolk: a round dot as tall as the row. */
function Yolk({ size, color }: { size: number; color: string }) {
  const h = Math.round(size * 0.8);
  return (
    <Svg width={size} height={h}>
      <Circle cx={size / 2} cy={h / 2} r={h / 2} fill={color} />
    </Svg>
  );
}

function StepDot({ size, on, delay }: { size: number; on: boolean; delay: number }) {
  const p = useDerivedValue(() => (on ? withDelay(delay, withTiming(1, { duration: FILL_MS })) : withTiming(0, { duration: FILL_MS })), [on, delay]);
  const fill = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <View>
      <Yolk size={size} color={colors.track} />
      <Animated.View style={[StyleSheet.absoluteFill, fill]}>
        <Yolk size={size} color={colors.yolk} />
      </Animated.View>
    </View>
  );
}

/** The old progress segment (6 tall, radius 3, yolk when reached), for recipes with very many steps. */
function Segment({ on }: { on: boolean }) {
  const p = useDerivedValue(() => withTiming(on ? 1 : 0, { duration: FILL_MS }), [on]);
  const fill = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.segmentOn, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_H },
  segment: { flex: 1, height: 6, borderRadius: radii.step, backgroundColor: colors.track, overflow: 'hidden' },
  segmentOn: { backgroundColor: colors.yolk, borderRadius: radii.step },
});
