// Three colour circles under the card. Selected = a cream gap and an ink ring, like Spotify's
// white ring; light swatches get a hairline so they read on the cream sheet.
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui';
import { alpha, colors } from '@/theme/tokens';

import { SWATCHES, type SwatchId } from './swatches';

const SIZE = 36;

export function SwatchRow({ value, onChange }: { value: SwatchId; onChange: (id: SwatchId) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Card colour">
      {SWATCHES.map((s) => {
        const on = s.id === value;
        return (
          <PressableScale
            key={s.id}
            haptic
            onPress={() => onChange(s.id)}
            accessibilityRole="radio"
            accessibilityLabel={`${s.label} card`}
            accessibilityState={{ selected: on, checked: on }}
            hitSlop={6}
            style={[
              styles.dot,
              { backgroundColor: s.stage },
              on
                ? { boxShadow: `0 0 0 3px ${colors.card}, 0 0 0 5px ${colors.ink}` }
                : s.dark
                  ? null
                  : { borderWidth: 1, borderColor: alpha.border },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 6 },
  dot: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
});
