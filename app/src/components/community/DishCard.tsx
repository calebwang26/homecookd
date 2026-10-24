// The card under the map for the dish you tapped (Caleb's Community mockup): its photo, the dish,
// "Mama Ngozi · Nigerian", how far, the cook's own words in italics (tagged "Translated" when she said
// them in another language), and ONE button, "Connect with Mama Ngozi", which opens the chooser. Your
// own family's dish says so instead of a distance, and its one button is "Host a dinner".
import { StyleSheet, View } from 'react-native';

import { ActionButton, PlusIcon, Txt } from '@/components/ui';
import type { FeedRecipe } from '@/lib/live/community';
import { colors, radii, shadows } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { awayLabel, cookLine } from './labels';

const PHOTO = 80;

export function DishCard({ recipe, onConnect, onHost }: { recipe: FeedRecipe; onConnect: () => void; onHost: () => void }) {
  const who = cookLine(recipe.cookName, recipe.culture);
  const where = recipe.ours ? 'Your family’s dish' : awayLabel(recipe.distanceLabel);
  const cook = recipe.cookName.trim() || 'the cook';
  return (
    <View style={styles.card}>
      <View style={styles.top} accessible accessibilityLabel={[recipe.dish, who, where].filter(Boolean).join(', ')}>
        <DishPhoto uri={recipe.coverUrl} label="" pot={40} style={styles.photo} />
        <View style={styles.text}>
          <Txt variant="display" size={24} numberOfLines={2}>
            {recipe.dish}
          </Txt>
          {who ? (
            <Txt variant="body" size={15} numberOfLines={1}>
              {who}
            </Txt>
          ) : null}
          <Txt variant="meta" numberOfLines={1}>
            {where}
          </Txt>
        </View>
      </View>
      {recipe.quote ? (
        <View style={styles.quote} accessible accessibilityLabel={`${cook} says${recipe.quoteTranslated ? ', translated' : ''}: ${recipe.quote}`}>
          <Txt variant="quote" color={colors.peachInk} leading={1.35}>
            “{recipe.quote}”
          </Txt>
          {recipe.quoteTranslated ? <Txt variant="caption">Translated</Txt> : null}
        </View>
      ) : null}
      {recipe.ours ? (
        <ActionButton
          label="Host a dinner"
          size="sm"
          icon={<PlusIcon size={20} color={colors.card} strokeWidth={2.2} />}
          accessibilityHint="Pick a time and place for this dish"
          onPress={onHost}
        />
      ) : (
        <ActionButton label={`Connect with ${cook}`} size="sm" accessibilityHint="Join a dinner, swap recipes or host one" onPress={onConnect} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.cardRaised },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radii.thumb, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 4 },
  quote: { gap: 2 },
});
