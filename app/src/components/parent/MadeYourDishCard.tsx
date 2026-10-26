// "Leo made your Poha" (bible: Parent-Home's photo card): the newest photo a kid sent after cooking one
// of my dishes (the postcard, Convex messages.madeMyDish), full bleed, darker on the left for the words:
// the day, "<kid> made your <dish>", their note. Tap = my recipe. Gone when there's none (or Convex
// isn't reachable).
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { dishName } from '@/components/parent/kitchen';
import { ArrowRightIcon, listEnter, PressableScale, Txt } from '@/components/ui';
import { relativeDay } from '@/lib/format';
import type { MadeMyDish } from '@/lib/live/convex';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, radii, shadows } from '@/theme/tokens';

export function MadeYourDishCard({ made, cookName, enterIndex = 0 }: { made: MadeMyDish | null; cookName?: string; enterIndex?: number }) {
  const { t } = useWords();
  if (!made) return null;
  const title = t('parent.home.madeYour', { name: made.fromName, dish: dishName(made.recipeTitle, cookName, t) });
  const note = made.text?.trim();
  const libraryId = made.libraryId;
  return (
    <Animated.View entering={listEnter(enterIndex)}>
      <PressableScale
        onPress={libraryId ? () => router.push({ pathname: '/my-recipe/[id]', params: { id: libraryId } }) : undefined}
        scaleTo={0.98}
        accessibilityRole={libraryId ? 'button' : 'image'}
        accessibilityLabel={note ? `${title}. “${note}”` : title}
        accessibilityHint={libraryId ? t('parent.home.opensRecipe') : undefined}
        style={styles.card}>
        <Image source={{ uri: made.photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={made.messageId} />
        <LinearGradient pointerEvents="none" colors={[alpha.photoShadeLeft, alpha.photoShadeTop]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <View style={styles.words}>
          <Txt variant="label" size={15} weight={600} color={colors.card}>
            {relativeDay(made.at, {}, t)}
          </Txt>
          <Txt variant="display" size={26} leading={1.15} color={colors.card} numberOfLines={2}>
            {title}
          </Txt>
          {note ? (
            <Txt variant="quote" color={colors.card} numberOfLines={2}>
              “{note}”
            </Txt>
          ) : null}
        </View>
        {libraryId ? (
          <View style={styles.go}>
            <ArrowRightIcon size={22} color={colors.ink} />
          </View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 150,
    borderRadius: radii.panel,
    overflow: 'hidden',
    backgroundColor: colors.olive,
    boxShadow: shadows.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 20,
    gap: 12,
  },
  words: { flex: 1, minWidth: 0, gap: 4 },
  go: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
