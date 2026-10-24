// The one card under the map for the dish you tapped: its photo, the dish, "Mama Ngozi · Nigerian",
// how far ("About 1 mi away"), the cook's own words in italics, and one button. When the dish has an
// open dinner, a butter line says when, and the button opens the dinner ("Ask to join" there);
// otherwise "See the recipe".
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionButton, Txt } from '@/components/ui';
import type { FeedRecipe } from '@/lib/live/community';
import { colors, radii, shadows } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { awayLabel, cookLine, dinnerLine } from './labels';

const PHOTO = 64;

/** `asked`: I already asked to join (or I'm in), so the button just opens the dinner. */
export function DishCard({ recipe, now, asked }: { recipe: FeedRecipe; now: number; asked: boolean }) {
  const dinner = recipe.dinner && recipe.dinner.startsAt > now ? recipe.dinner : null;
  const who = cookLine(recipe.cookName, recipe.culture);
  const away = awayLabel(recipe.distanceLabel);
  const open = () =>
    dinner
      ? router.push({ pathname: '/dinner/[id]', params: { id: dinner.dinnerId } })
      : router.push({ pathname: '/community/[id]', params: { id: recipe.recipeId } });
  return (
    <View style={styles.card}>
      <View style={styles.top} accessible accessibilityLabel={[recipe.dish, who, away].filter(Boolean).join(', ')}>
        <DishPhoto uri={recipe.coverUrl} label="" pot={36} style={styles.photo} />
        <View style={styles.text}>
          <Txt variant="section" numberOfLines={2}>
            {recipe.dish}
          </Txt>
          {who ? (
            <Txt variant="label" weight={600} numberOfLines={1}>
              {who}
            </Txt>
          ) : null}
          <Txt variant="meta" numberOfLines={1}>
            {away}
          </Txt>
        </View>
      </View>
      {recipe.quote ? (
        <Txt variant="quote" size={16} accessibilityLabel={`${recipe.cookName.trim() || 'The cook'} says: ${recipe.quote}`}>
          “{recipe.quote}”
        </Txt>
      ) : null}
      {dinner ? (
        <View style={styles.dinner}>
          <Txt variant="label" weight={700} color={colors.butterInk}>
            {dinnerLine(dinner.startsAt, dinner.seatsLeft, now)}
          </Txt>
        </View>
      ) : null}
      <ActionButton
        label={dinner ? (asked ? 'See the dinner' : 'Ask to join') : 'See the recipe'}
        accessibilityHint={dinner ? (asked ? undefined : 'Opens the dinner, where you ask the host') : 'Opens the recipe’s steps'}
        size="sm"
        onPress={open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 14, borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.card },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radii.thumb, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  dinner: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.tile, backgroundColor: colors.butter },
});
