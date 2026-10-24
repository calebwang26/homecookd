// What the Recipes search finds, right under the search bar: the same dish cards as the list
// (RecipeCards, with the cook's name). Nothing found: say so plainly and offer to ask the family.
// The result count is read out to the screen reader once typing pauses.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { RecipeCards } from '@/components/recipes/RecipeList';
import { EmptyState } from '@/components/ui';
import type { RecipeStat } from '@/lib/api';
import { plural } from '@/lib/format';
import { clip, type LibraryEntry, type Recipe } from '@/lib/recipes';
import { motion, space } from '@/theme/tokens';

type Props = {
  query: string;
  results: LibraryEntry[];
  stats: Record<string, RecipeStat>;
  recipes: Record<string, Recipe>;
  onOpen: (id: string) => void;
};

export function SearchResults({ query, results, stats, recipes, onOpen }: Props) {
  const count = results.length;
  useEffect(() => {
    const t = setTimeout(() => AccessibilityInfo.announceForAccessibility(count ? `${plural(count, 'dish', 'dishes')} found` : 'No dishes found'), 700);
    return () => clearTimeout(t);
  }, [count, query]);

  if (!count) {
    return (
      <Animated.View entering={FadeIn.duration(motion.crossfadeMs)} style={styles.col}>
        <EmptyState
          compact
          title={`No “${clip(query.trim(), 28)}” yet`}
          actionLabel="Ask the family"
          onAction={() => router.navigate('/kid/ask')}
        />
      </Animated.View>
    );
  }
  return (
    <View style={styles.col}>
      <RecipeCards entries={results} stats={stats} recipes={recipes} showCook fadeIn onOpen={(e) => onOpen(e.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  col: { paddingHorizontal: space.gutter },
});
