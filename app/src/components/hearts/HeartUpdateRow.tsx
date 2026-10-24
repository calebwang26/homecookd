// "Leo hearted your Sunday Chili" (RETENTION-HANDOFF 3.5): one row in the cook's updates card
// (components/parent/UpdatesCard.tsx), built like its "made your" row: face, words, the dish's photo
// and a clear button. A small red heart on the face says what kind of news it is. No push for hearts
// (handoff 2.5): this row is the only place they arrive. Rows come from heartUpdates() in
// lib/heartsCopy.ts over GET /hearts/recent (newest 3, merged by time with the card's other rows).
//
//   <HeartUpdateRow who={u.who} dish={dishName(entry.title, entry.cook_name)} posterUrl={entry.poster_url}
//     onPress={() => router.push({ pathname: '/my-recipe/[id]', params: { id: u.recipeId } })}
//     onClear={() => dismiss(u.key)} />
//
// The row and its clear button are siblings, never one button inside another (web forbids it).
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Avatar, CloseIcon, haptic, HeartIcon, PressableScale, Txt, type AvatarProfile } from '@/components/ui';
import { heartUpdateTitle } from '@/lib/heartsCopy';
import { colors, shadows, space } from '@/theme/tokens';

export type HeartUpdateRowProps = {
  who: AvatarProfile;
  /** The short dish name ("Sunday Chili"): components/parent/kitchen.ts dishName(title, cook_name). */
  dish: string;
  posterUrl?: string | null;
  onPress: () => void;
  onClear: () => void;
};

export function HeartUpdateRow({ who, dish, posterUrl, onPress, onClear }: HeartUpdateRowProps) {
  const title = heartUpdateTitle(who.name, dish);
  return (
    <View style={styles.row}>
      <PressableScale onPress={onPress} scaleTo={0.98} accessibilityLabel={title} accessibilityHint="Opens your recipe" style={styles.main}>
        <View>
          <Avatar profile={who} size={40} />
          <View style={styles.badge}>
            <HeartIcon size={11} filled color={colors.danger} strokeWidth={1.5} />
          </View>
        </View>
        <Txt variant="rowTitle" leading={1.3} numberOfLines={2} style={styles.flex}>
          {title}
        </Txt>
        {posterUrl ? <Image source={{ uri: posterUrl }} style={styles.thumb} contentFit="cover" transition={150} /> : null}
      </PressableScale>
      <PressableScale
        onPress={() => {
          haptic('selection');
          onClear();
        }}
        hitSlop={8}
        accessibilityLabel={`Clear: ${title}`}
        style={styles.clear}>
        <CloseIcon size={16} strokeWidth={2.4} color={colors.muted} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  // The updates card's row metrics (UpdatesCard.tsx styles.row + madeRow).
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.chip,
  },
  thumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.well },
  clear: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
});
