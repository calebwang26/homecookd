// Cook mode's step progress under "Step 3 of 8" (retention PR 7, RETENTION-HANDOFF 4): one small pot
// per step, green up to and including the step on screen (where you are now; the furthest step
// reached shows in "All steps" instead). A jump ahead fills the new pots one after another (45 ms
// apart); going back empties them at once. Each pot fades between empty (the track colour) and full (green),
// the same 240 ms fade the bars had, so Reduce Motion keeps a plain fade (no stagger).
// The pots are as big as the header allows (lib/touches potDotLayout, 10-16 pt); a recipe with so many
// steps that they'd shrink below that keeps the old bars. A picture only: the "Step 3 of 8" button
// around it says it.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { POT_MAX, potDotLayout } from '@/lib/touches';
import { colors, radii } from '@/theme/tokens';

const FILL_MS = 240;
const STAGGER_MS = 45;
/** The row is always as tall as the biggest pot, so nothing under the header moves once it's measured. */
const ROW_H = Math.round(POT_MAX * 0.8);

/** `reached`: the 1-based step on screen. */
export function PotDots({ total, reached }: { total: number; reached: number }) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  // Where the fill was before this change, so a jump fills the new pots in turn.
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
              <StepPot key={i} size={layout.size} on={i < reached} delay={!reduce && i >= from && i < reached ? (i - from) * STAGGER_MS : 0} />
            ))
          : Array.from({ length: Math.max(total, 1) }, (_, i) => <Segment key={i} on={!!total && i < reached} />)}
    </View>
  );
}

/** A pot silhouette (body, handles, lid, knob), cropped to its drawing so it sits on the row's baseline. */
function PotShape({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={Math.round(size * 0.8)} viewBox="2 5 20 16">
      <Path d="M5 11h14v4a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill={color} />
      <Path d="M5 13H3.2M19 13h1.8" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Ellipse cx={12} cy={10.2} rx={7.8} ry={1.7} fill={color} />
      <Circle cx={12} cy={7.4} r={1.4} fill={color} />
    </Svg>
  );
}

function StepPot({ size, on, delay }: { size: number; on: boolean; delay: number }) {
  const p = useDerivedValue(() => (on ? withDelay(delay, withTiming(1, { duration: FILL_MS })) : withTiming(0, { duration: FILL_MS })), [on, delay]);
  const fill = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <View>
      <PotShape size={size} color={colors.track} />
      <Animated.View style={[StyleSheet.absoluteFill, fill]}>
        <PotShape size={size} color={colors.green} />
      </Animated.View>
    </View>
  );
}

/** The old progress segment (6 tall, radius 3, green when reached), for recipes with very many steps. */
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
  segmentOn: { backgroundColor: colors.green, borderRadius: radii.step },
});
