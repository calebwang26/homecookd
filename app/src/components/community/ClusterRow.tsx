// A shared circle's dishes (the floormates "in your building"): "3 dishes in your building" and a
// short row of small cards, the photo and the dish. The one you tap opens its card below; the first
// is open to start.
import { ScrollView, StyleSheet, View } from 'react-native';

import { PressableScale, Txt } from '@/components/ui';
import type { FeedRecipe } from '@/lib/live/community';
import { colors, radii } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { clusterTitle, spotLabel } from './labels';

const GAP = 8;
/** Three fit across; more scroll sideways. */
const ACROSS = 3;

export function ClusterRow({ members, picked, onPick, width }: { members: FeedRecipe[]; picked: number; onPick: (i: number) => void; width: number }) {
  const across = Math.min(members.length, ACROSS);
  const cardW = (width - GAP * (across - 1)) / across;
  return (
    <View style={styles.wrap}>
      <Txt variant="label" color={colors.muted} accessibilityRole="header">
        {clusterTitle(members.length, members[0]?.distanceLabel ?? '')}
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        {members.map((r, i) => {
          const on = i === picked;
          return (
            <PressableScale
              key={r.recipeId}
              onPress={() => onPick(i)}
              haptic
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityLabel={spotLabel([r])}
              accessibilityState={{ selected: on }}
              style={[styles.small, { width: cardW }, on ? styles.on : null]}>
              <DishPhoto uri={r.coverUrl} label="" title={r.dish} size={64} style={styles.photo} />
              <Txt variant="rowTitle" size={14} numberOfLines={2}>
                {r.dish}
              </Txt>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  // The vertical padding keeps the picked card's ring from being clipped.
  scroll: { marginVertical: -4, flexGrow: 0 },
  row: { gap: GAP, paddingVertical: 4 },
  small: { gap: 6, padding: 6, borderRadius: radii.thumb, borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.card },
  on: { borderColor: colors.yolk },
  photo: { height: 64, borderRadius: radii.tile - 4 },
});
