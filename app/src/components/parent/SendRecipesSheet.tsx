// "Which recipe?": the first and only question of "Send a recipe" on Your recipes, when there is
// more than one dish to send. Every dish is a big row (thumb + title, "by <cook>" for the family's
// dishes); one tap picks it, this sheet closes, and the Spotify-style share sheet opens for that
// dish (lib/share.tsx: the family's faces to send inside homecookd, then Copy link, Messages,
// Instagram, ...). BottomSheet holds the share sheet back until this one's Modal is gone (iOS).
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { dishName } from '@/components/messages/helpers';
import { ArrowRightIcon, BottomSheet, NoPhoto, PressableScale, Txt } from '@/components/ui';
import type { LibraryEntry } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import { colors, radii } from '@/theme/tokens';

export function SendRecipesSheet({
  visible,
  onClose,
  dishes,
  mine,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  dishes: LibraryEntry[];
  /** False: these are the family's dishes (I have none yet), so each says whose it is. */
  mine: boolean;
  /** The tapped dish. The caller closes this sheet and opens the share sheet for it. */
  onPick: (dish: LibraryEntry) => void;
}) {
  const { height: winH } = useWindowDimensions();
  const { t } = useWords();
  // Room for the list: the sheet's 92% minus grabber, header and the bottom inset.
  const listMax = Math.max(240, winH * 0.92 - 160);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('parent.sendRecipe.which')} accessibilityLabel={t('parent.sendRecipe.button')}>
      <ScrollView style={{ maxHeight: listMax }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {dishes.map((d) => {
          const title = mine ? d.title : dishName(d);
          return (
            <PressableScale
              key={d.id}
              haptic
              scaleTo={0.98}
              onPress={() => onPick(d)}
              accessibilityRole="button"
              accessibilityLabel={mine ? t('parent.sendRecipe.send', { dish: title }) : t('parent.sendRecipe.sendBy', { dish: title, cook: d.cook_name })}
              style={styles.row}>
              <View style={styles.thumb}>
                {d.poster_url ? (
                  <Image source={{ uri: d.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={d.id} />
                ) : (
                  <NoPhoto title={title} size={56} />
                )}
              </View>
              <View style={styles.rowText}>
                <Txt variant="rowTitle" size={17} numberOfLines={2}>
                  {title}
                </Txt>
                {mine ? null : (
                  <Txt variant="meta" numberOfLines={1}>
                    {t('parent.sendRecipe.by', { cook: d.cook_name })}
                  </Txt>
                )}
              </View>
              <ArrowRightIcon size={20} color={colors.ink} />
            </PressableScale>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.tile,
    overflow: 'hidden',
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
