// The card under the map for the dish you tapped (Caleb's Community canvas): its photo, the dish,
// "Mama Ngozi · Nigerian" (the culture is Muse's guess, so it carries a small "AI" tag), how far, the
// cook's own words in italics (tagged "Translated" when she said them in another language), and ONE
// button, "Connect with Mama Ngozi", which opens the chooser. Your own family's dish says so instead of
// a distance, and its one button is "Host a dinner".
import { StyleSheet, View } from 'react-native';

import { ActionButton, Pill, PlusIcon, Txt } from '@/components/ui';
import type { FeedRecipe } from '@/lib/live/community';
import { colors, radii, shadows } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { awayLabel, cookLine } from './labels';

const PHOTO = 80;

export function DishCard({ recipe, onConnect, onHost }: { recipe: FeedRecipe; onConnect: () => void; onHost: () => void }) {
  const who = cookLine(recipe.cookName, recipe.culture);
  const culture = recipe.culture?.trim() || null;
  const where = recipe.ours ? 'Your family’s dish' : awayLabel(recipe.distanceLabel);
  const cook = recipe.cookName.trim() || 'the cook';
  const heard = [recipe.dish, recipe.cookName.trim(), culture ? `${culture}, a guess by AI` : null, where];
  return (
    <View style={styles.card}>
      <View style={styles.top} accessible accessibilityLabel={heard.filter(Boolean).join(', ')}>
        <DishPhoto uri={recipe.coverUrl} label="" title={recipe.dish} size={PHOTO} style={styles.photo} />
        <View style={styles.text}>
          <Txt variant="display" size={24} numberOfLines={2}>
            {recipe.dish}
          </Txt>
          {who ? (
            <View style={styles.who}>
              <Txt variant="body" size={15} numberOfLines={1} style={styles.shrink}>
                {who}
              </Txt>
              {culture ? <Pill tone="yolkTint" size="xs" label="AI" /> : null}
            </View>
          ) : null}
          <Txt variant="meta" numberOfLines={1}>
            {where}
          </Txt>
        </View>
      </View>
      {recipe.quote ? (
        <View style={styles.quote} accessible accessibilityLabel={`${cook} says${recipe.quoteTranslated ? ', translated' : ''}: ${recipe.quote}`}>
          <Txt variant="quote" color={colors.ink} leading={1.35}>
            “{recipe.quote}”
          </Txt>
          {recipe.quoteTranslated ? <Txt variant="caption">Translated</Txt> : null}
        </View>
      ) : null}
      {recipe.ours ? (
        <ActionButton
          label="Host a dinner"
          size="sm"
          icon={<PlusIcon size={20} color={colors.ink} strokeWidth={2.2} />}
          accessibilityHint="Pick a time and place for this dish"
          onPress={onHost}
        />
      ) : (
        <ActionButton label={`Connect with ${cook}`} size="sm" accessibilityHint="Join a dinner, swap recipes or cook it together" onPress={onConnect} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.cardRaised },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radii.thumb, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  quote: { gap: 2 },
});
