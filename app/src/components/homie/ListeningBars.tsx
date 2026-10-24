// Five soft green bars that move with the mic level while homie listens (a moment's `bars`, and any
// screen that waits for an answer out loud). Reduce Motion: the bars stay still and only brighten.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { BAR_MAX, barHeights } from '@/lib/homie/logic';
import { colors } from '@/theme/tokens';

const LOW = barHeights(0);
const HIGH = barHeights(1);

/** `level`: the mic level 0..1 (store `level`). `color`: the bars (default lime, for a dark backdrop). */
export function ListeningBars({ level, color = colors.limeWash }: { level: number; color?: string }) {
  const reduce = useReducedMotion();
  const lv = useSharedValue(level);
  useEffect(() => {
    lv.set(reduce ? level : withTiming(level, { duration: 120 }));
  }, [level, reduce, lv]);
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="homie is listening">
      {LOW.map((h, i) => (
        <Bar key={i} lv={lv} low={h} high={HIGH[i]} reduce={reduce} color={color} />
      ))}
    </View>
  );
}

function Bar({ lv, low, high, reduce, color }: { lv: SharedValue<number>; low: number; high: number; reduce: boolean; color: string }) {
  const style = useAnimatedStyle(() =>
    reduce ? { height: low + (high - low) * 0.4, opacity: 0.55 + 0.45 * lv.value } : { height: low + (high - low) * lv.value, opacity: 0.75 + 0.25 * lv.value },
  );
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { height: BAR_MAX, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bar: { width: 8, borderRadius: 4 },
});
