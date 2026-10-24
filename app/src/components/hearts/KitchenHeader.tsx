// "Grandma's kitchen, 4 of 7" (RETENTION-HANDOFF 3.6): the line above a cook's dishes on the kid's
// Recipes tab when that cook's chip is selected (components/recipes/RecipeList.tsx, learners only).
//
//   (G)  You can cook 4 of Grandma’s 7
//        ● ● ● ● ○ ○ ○
//
// One dot per dish (filled = cooked), only while they fit (12); past that the words say it alone.
// Every dish cooked: "Keeper of Grandma’s kitchen" with the cooked stamp. Before the first one, just
// "Grandma’s 7 dishes" (nothing to count yet, and no nudge in it). Counts come from kitchenCounts.ts:
// only a family cook's real dishes, never samples or YouTube. Presentational; nothing here is
// tappable, and nothing moves.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar, Txt, type AvatarProfile } from '@/components/ui';
import { KITCHEN_DOTS_MAX, kitchenLine } from '@/lib/heartsCopy';
import type { KitchenCount } from '@/lib/kitchenCounts';
import { alpha, colors } from '@/theme/tokens';

import { CookStamp } from './CookStamp';

export type KitchenHeaderProps = {
  /** kitchenFor(kitchenCounts(…), activeChip): null hides the header. */
  count: Pick<KitchenCount, 'cookName' | 'total' | 'cooked' | 'complete' | 'recipeIds' | 'cookedIds'> | null | undefined;
  /** The cook's profile, for her face (falls back to her initial). */
  cook?: AvatarProfile | null;
  style?: StyleProp<ViewStyle>;
};

const DOT = 10;

export function KitchenHeader({ count, cook, style }: KitchenHeaderProps) {
  const line = kitchenLine(count);
  if (!count || !line) return null;
  const complete = count.complete || count.cooked >= count.total;
  const cooked = new Set(count.cookedIds);
  // In the dishes' own order, so a dot can be read as "that one".
  const dots = count.total <= KITCHEN_DOTS_MAX ? count.recipeIds.map((id) => cooked.has(id)) : null;
  const label = complete ? `${line}. All ${count.total} cooked.` : count.cooked > 0 ? `${line} dishes` : line;

  return (
    <View style={[styles.wrap, style]} accessible accessibilityRole="header" accessibilityLabel={label}>
      <Avatar profile={cook ?? { name: count.cookName, avatar_key: null }} size={32} />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Txt variant="kitchen" size={19} leading={1.25} style={styles.shrink}>
            {line}
          </Txt>
          {complete ? <CookStamp size={22} style={styles.stamp} /> : null}
        </View>
        {dots ? (
          <View style={styles.dots}>
            {dots.map((on, i) => (
              <View key={i} style={[styles.dot, on ? styles.on : styles.off]} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 8, paddingTop: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  stamp: { marginTop: -2 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  on: { backgroundColor: colors.green },
  // An empty dish is an outline, not a grey fill: quiet, never a "missing" mark.
  off: { borderWidth: 1.5, borderColor: alpha.checkRing },
});
