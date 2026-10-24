// One shared recipe in "Near you": the dish photo (84 pt), the dish in Fraunces, "<family> ·
// <distance>", and one line of its story card (written with AI: the screen's footnote says so).
import { StyleSheet, View } from 'react-native';

import { PressableScale, Txt } from '@/components/ui';
import type { FeedRecipe } from '@/lib/live/community';
import { colors, radii, shadows } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';

const PHOTO = 84;

export function FamilyCard({ recipe, onOpen }: { recipe: FeedRecipe; onOpen: () => void }) {
  const meta = `${recipe.familyName} · ${recipe.distanceLabel}`;
  return (
    <PressableScale
      onPress={onOpen}
      scaleTo={0.97}
      accessibilityRole="link"
      accessibilityLabel={`${recipe.dish}, ${meta}`}
      accessibilityHint="Opens the story and the recipe"
      style={styles.card}>
      <DishPhoto uri={recipe.coverUrl} label={recipe.dish} pot={44} style={styles.photo} />
      <View style={styles.text}>
        <Txt variant="section" numberOfLines={2}>
          {recipe.dish}
        </Txt>
        <Txt variant="body" size={15} numberOfLines={1}>
          {meta}
        </Txt>
        {recipe.story ? (
          <Txt variant="body" size={15} color={colors.text} numberOfLines={1}>
            {recipe.story}
          </Txt>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radii.thumb, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 4 },
});
