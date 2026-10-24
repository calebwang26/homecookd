// A side-scrolling row of choice chips for the host form (days, times). It opens scrolled so the
// chosen chip sits in the middle: 7 pm is the default, past the edge of the screen.
import { useRef } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Chip } from '@/components/ui';
import { space } from '@/theme/tokens';

export type ChipItem<K> = { key: K; label: string };

export function ChipRow<K extends string | number>({
  items,
  selected,
  onSelect,
  accessibilityLabel,
}: {
  items: ChipItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  accessibilityLabel: string;
}) {
  const ref = useRef<ScrollView>(null);
  const placed = useRef(false);
  const { width } = useWindowDimensions();
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={styles.scroll}
      contentContainerStyle={styles.row}>
      {items.map((it) => (
        <View
          key={String(it.key)}
          onLayout={(e) => {
            if (placed.current || it.key !== selected) return;
            placed.current = true;
            const { x, width: w } = e.nativeEvent.layout;
            ref.current?.scrollTo({ x: Math.max(0, x + w / 2 - width / 2), animated: false });
          }}>
          <Chip label={it.label} selectedTone="ink" selected={it.key === selected} onPress={() => onSelect(it.key)} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Out to the screen's edges (the form has a 24 pt gutter), so the row scrolls under it; the
  // vertical padding keeps the chips' shadow from being clipped.
  scroll: { marginHorizontal: -space.gutter, marginVertical: -10, flexGrow: 0 },
  row: { paddingHorizontal: space.gutter, paddingVertical: 10, gap: space.sm },
});
