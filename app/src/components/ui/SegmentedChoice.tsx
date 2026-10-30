// Kid-Recipe "Cooking for" control: track #F3EAD9, padding 6, radius 22, gap 6; options 60 tall,
// radius 16, title 16/700 ink + subtitle 13 muted; the selected one is cream with
// 0 2px 8px rgba(31,36,48,0.08). The cream thumb slides between options on a spring.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { colors, motion, radii, shadows } from '@/theme/tokens';

import { haptic } from './haptics';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type SegmentOption<K extends string> = { key: K; title: string; subtitle?: string };

export function SegmentedChoice<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  height = 60,
  style,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const n = Math.max(options.length, 1);
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const segW = w > 0 ? (w - 12 - 6 * (n - 1)) / n : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (segW <= 0) return;
    const target = idx * (segW + 6);
    if (!placed.current) {
      placed.current = true;
      x.value = target; // first layout: no slide
    } else {
      x.value = reduce ? withTiming(target, { duration: motion.reducedFadeMs }) : withSpring(target, motion.tab);
    }
  }, [idx, segW, reduce, x]);

  const thumb = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: x.value }] }), [segW]);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={[styles.track, style]}>
      {segW > 0 ? <Animated.View style={[styles.thumb, { height }, thumb]} /> : null}
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressableScale
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.subtitle ? `${o.title}, ${o.subtitle}` : o.title}
            onPress={() => {
              if (!on) haptic('selection');
              onChange(o.key);
            }}
            style={[styles.option, { height }, segW > 0 ? null : on ? styles.staticOn : null]}>
            <Txt variant="rowTitle">{o.title}</Txt>
            {o.subtitle ? <Txt variant="caption">{o.subtitle}</Txt> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 6, gap: 6, borderRadius: radii.segment, backgroundColor: colors.well },
  thumb: {
    position: 'absolute',
    left: 6,
    top: 6,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
    boxShadow: shadows.segment,
  },
  option: { flex: 1, borderRadius: radii.tile, alignItems: 'center', justifyContent: 'center', gap: 2 },
  staticOn: { backgroundColor: colors.card, boxShadow: shadows.segment },
});
