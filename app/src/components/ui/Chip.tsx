// Selectable chips. Filter chips (Kid-Browse cook row): 40 tall, cream, selected = sun #FEBE29.
// Person chips (Parent-Send "Who is it for?"): 52 tall with a 40 px avatar, selected = ink.
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming, interpolateColor } from 'react-native-reanimated';

import { colors, shadows } from '@/theme/tokens';

import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** 'sun' (filters, default) or 'ink' (people picker). */
  selectedTone?: 'sun' | 'ink';
  /** 'md' 40 px filter chip (15/600), 'lg' 52 px person chip (16/700). */
  size?: 'md' | 'lg';
  /** Leading avatar or icon (person chips). */
  leading?: ReactNode;
  accessibilityLabel?: string;
};

export function Chip({ label, selected = false, onPress, selectedTone = 'sun', size = 'md', leading, accessibilityLabel }: ChipProps) {
  const on = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: 180 }), [selected]);
  const selBg = selectedTone === 'sun' ? colors.sun : colors.ink;
  const selFg = selectedTone === 'sun' ? colors.ink : colors.card;
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [colors.card, selBg]),
  }));
  const lg = size === 'lg';
  return (
    <PressableScale
      onPress={onPress}
      haptic
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.base,
        lg
          ? { height: 52, paddingLeft: leading ? 6 : 20, paddingRight: leading ? 18 : 20, boxShadow: shadows.person }
          : { height: 40, paddingHorizontal: 16, boxShadow: shadows.chip },
      ]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, bgStyle]} />
      {leading}
      <Txt variant="label" size={lg ? 16 : 15} weight={lg ? 700 : 600} color={selected ? selFg : colors.ink} numberOfLines={1}>
        {label}
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, flexShrink: 0 },
  fill: { borderRadius: 999 },
});
