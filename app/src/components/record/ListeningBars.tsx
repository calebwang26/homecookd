// "I'm listening": five soft green bars that move with the mic level (0..1), the middle ones most
// (limeWash on homie's dark moment, green on the walkie-talkie's peach). Reduce Motion: they stand
// still and only brighten while she talks.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

const WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];
const MIN_H = 8;
const MAX_H = 40;
const TALKING = 0.3;

export function ListeningBars({ level, color }: { level: number; color: string }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withTiming(Math.max(0, Math.min(1, level)), { duration: reduce ? 0 : 120 }));
  }, [level, reduce, v]);
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {WEIGHTS.map((w, i) => (
        <Bar key={i} weight={w} level={v} still={reduce} color={color} />
      ))}
    </View>
  );
}

function Bar({ weight, level, still, color }: { weight: number; level: SharedValue<number>; still: boolean; color: string }) {
  const style = useAnimatedStyle(() => {
    if (still) return { height: MIN_H + (MAX_H - MIN_H) * weight * 0.5, opacity: level.value > TALKING ? 1 : 0.55 };
    return { height: MIN_H + (MAX_H - MIN_H) * weight * Math.min(1, 0.15 + level.value * 1.1), opacity: 0.6 + 0.4 * level.value };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { height: MAX_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { width: 8, borderRadius: 4 },
});
