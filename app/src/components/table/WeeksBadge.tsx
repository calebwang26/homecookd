// The 1:1 chat header's "6 weeks" (RETENTION-HANDOFF 3.2): a small flame and how many weeks in a row
// that kid & cook have both shown up. Shown only to those two people (the screen passes their pair's
// count) and only when there is a count: nothing for 0, nothing during an ember (weeks is null), so a
// quiet week never reads as a loss.
//
//   <WeeksBadge weeks={weeksOf(pairWith(table, me.id, other.id))} />
//
// Presentational: renders nothing without a count.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { FlameIcon } from '@/components/ui/FlameIcon';
import { weeksLabel } from '@/lib/sundayTable';
import { colors } from '@/theme/tokens';

export function WeeksBadge({ weeks, color = colors.text, style }: { weeks: number | null | undefined; color?: string; style?: StyleProp<ViewStyle> }) {
  const label = weeksLabel(weeks);
  if (!label) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} style={style}>
      <View style={styles.row} accessible accessibilityLabel={`${label} at the table`}>
        <FlameIcon size={16} />
        <Txt variant="label" size={14} weight={600} color={color} numberOfLines={1}>
          {label}
        </Txt>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
});
