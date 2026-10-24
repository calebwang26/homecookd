// "Near you" filter chips: Nearby (on) · On campus · This week · Like my food. Only Nearby works in
// the MVP; the others answer a tap with a soft "Coming soon" and change nothing (no made-up results).
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, ClockIcon, useToast } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

const LATER = ['On campus', 'This week', 'Like my food'];

export function NearbyFilters() {
  const toast = useToast();
  const soon = () => toast.show('Coming soon', { tone: 'info', icon: <ClockIcon size={14} strokeWidth={2.6} color={colors.card} /> });
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Show">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.chips}>
        <Chip label="Nearby" selected />
        {LATER.map((label) => (
          <Chip key={label} label={label} onPress={soon} accessibilityLabel={`${label}, coming soon`} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // As on the Recipes tab: the vertical padding keeps the chips' shadow from being clipped.
  scroll: { marginVertical: -10, flexGrow: 0 },
  chips: { paddingHorizontal: space.gutter, paddingVertical: 10, gap: space.sm },
});
