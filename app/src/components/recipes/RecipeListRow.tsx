// One dish in the kid's Recipes list, as its own card (the shared recipe list style): cream card,
// 16 px padding, 72 px rounded thumb, title (2 lines max), one muted meta line, a heart on the right.
// The meta line is "<cook> · <activity>" ("Dad · You cooked it"), or just one of the two; a family
// cook's real dish I cooked adds a small hand-drawn stamp after it (RETENTION-HANDOFF 3.6).
// The heart sits beside the card's pressable (not inside it), so each is its own tap and its own
// screen reader stop. So the press answers with a dim only, no scale: a shrinking card would leave
// the heart (which never takes a transform) visibly outside it.
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { CookStamp } from '@/components/hearts';
import { NoPhoto, PressableScale, Txt } from '@/components/ui';
import type { LibraryEntry } from '@/lib/recipes';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

import type { Activity } from './activity';
import { HeartButton } from './HeartButton';

const THUMB = 72;
const PAD = 16;
const HEART = 44;
const HEART_RIGHT = 10;

type Props = {
  entry: LibraryEntry;
  activity: Activity | null;
  /** Show who cooked it (Everyone, Favorites, search). */
  showCook: boolean;
  /** The "cooked it" stamp (kitchenCounts earnsStamp: a family cook's real dish I cooked). */
  stamp?: boolean;
  onOpen: () => void;
};

export function RecipeListRow({ entry, activity, showCook, stamp = false, onOpen }: Props) {
  const { t } = useWords();
  const cook = showCook ? entry.cook_name : null;
  const meta = [cook, activity?.text].filter(Boolean).join(' · ');
  return (
    <View>
      <PressableScale
        onPress={onOpen}
        scaleTo={1}
        pressedOpacity={0.85}
        accessibilityRole="link"
        accessibilityLabel={[entry.title, t('parent.list.by', { name: entry.cook_name }), activity?.text].filter(Boolean).join(', ')}
        style={styles.card}>
        <View style={styles.thumb}>
          {entry.poster_url ? (
            <Image source={{ uri: entry.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={entry.id} />
          ) : (
            <NoPhoto title={entry.title} size={THUMB} />
          )}
        </View>
        <View style={styles.text}>
          <Txt variant="title" size={17} numberOfLines={2}>
            {entry.title}
          </Txt>
          {meta ? (
            <View style={styles.meta}>
              <Txt variant="body" size={15} color={colors.muted} numberOfLines={1} style={styles.shrink}>
                {cook && activity ? `${cook} · ` : cook}
                {activity ? (
                  activity.tone === 'plain' ? (
                    activity.text
                  ) : (
                    <Txt variant="label" size={15} color={colors.yolkDeep}>
                      {activity.text}
                    </Txt>
                  )
                ) : null}
              </Txt>
              {stamp ? <CookStamp /> : null}
            </View>
          ) : null}
        </View>
      </PressableScale>
      <View style={styles.heartSlot} pointerEvents="box-none">
        <HeartButton recipeId={entry.id} title={entry.title} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PAD,
    padding: PAD,
    // Room for the heart, which floats over the card's right edge.
    paddingRight: HEART + HEART_RIGHT + 8,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.thumb,
    overflow: 'hidden',
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: { flex: 1, minWidth: 0, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  heartSlot: { position: 'absolute', top: 0, bottom: 0, right: HEART_RIGHT, justifyContent: 'center' },
});
