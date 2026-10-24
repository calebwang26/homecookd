// Loading placeholders: #EFEFE6 blocks that breathe (opacity 0.55 <-> 1, 900 ms). Static under
// Reduce Motion.
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

export function Skeleton({
  width = '100%',
  height = 16,
  radius = 8,
  circle,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(o);
  }, [o, reduce]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        styles.base,
        { width: circle ? height : width, height, borderRadius: circle ? height / 2 : radius },
        a,
        style,
      ]}
    />
  );
}

/** A list-row skeleton: 64 px thumb + two lines (Browse / Your recipes rows). */
export function SkeletonRow({ thumb = 64, round = false }: { thumb?: number; round?: boolean }) {
  return (
    <View style={styles.row}>
      <Skeleton width={thumb} height={thumb} radius={round ? thumb / 2 : 18} />
      <View style={styles.lines}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="45%" height={13} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.well },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  lines: { flex: 1, gap: 8 },
});
