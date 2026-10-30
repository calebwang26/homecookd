// One recipe in "Your recipes", in the shared recipe list style: its own cream card (radius 24, soft
// card shadow, 16 padding), a 72 px rounded thumb, the title (2 lines at most), one line of real
// activity ("✓ Leo cooked it", "Leo opened it 3 times", "Sent to Leo · Monday", else the recipe's
// own facts), then the family's hearts & cooks on one line ("♥ 4 · cooked 3 times" + faces;
// RETENTION-HANDOFF 3.5, zero parts hidden, the line gone at zero) and a chevron. When that line says
// how often it was cooked AND its faces on screen show everyone who cooked it, the activity line skips
// "✓ Leo cooked it" and says the next true thing instead, so a card never says it twice; when the
// faces don't fit (a narrow phone, a busy dish), it keeps naming who cooked it. Nobody who cooked it is
// ever shown as only having opened it (lib/heartsCopy.ts cardActivityLine). `rowStyles` is shared with
// the greyed ProcessingRow; RecipeRowSkeleton holds the card's place while the library loads.
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DishStatsLine } from '@/components/hearts';
import { CheckIcon, ChevronRightIcon, NoPhoto, PressableScale, Skeleton, Txt } from '@/components/ui';
import { relativeDay, totalTimeLabel } from '@/lib/format';
import { cardActivityLine, dishStatsLabel, type MadeVerb } from '@/lib/heartsCopy';
import type { DishStat } from '@/lib/kitchenCounts';
import { useRecipeActivity } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import type { LibraryEntry, Recipe } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { colors, radii, shadows } from '@/theme/tokens';

import { madeVerb, type KitchenItem } from './kitchen';

export const THUMB = 72;

export function RecipeRow({
  entry,
  recipe,
  lastSent,
  stat,
  onPress,
}: {
  entry: LibraryEntry;
  recipe?: Recipe | null;
  /** My latest recipe card for this dish (from the kitchen). */
  lastSent?: KitchenItem | null;
  /** GET /dish-stats for this dish (PR 4): the family's hearts & cooks. */
  stat?: DishStat | null;
  onPress: () => void;
}) {
  const { me, profiles } = useSession();
  const { t } = useWords();
  const { activity, error } = useRecipeActivity(entry.id);
  // The faces the stat line actually drew (none until measured, none when they don't fit).
  const [faceIds, setFaceIds] = useState<string[]>([]);
  const verb = madeVerb(entry.tags, entry.title);
  // TODO(caleb): the alternative always keeps "✓ Leo cooked it" above "♥ 4 · cooked 3 times" (who in
  // words, then how often). Default: skip it only while the faces drawn show everyone who cooked it
  // (RETENTION-WIRING A3).
  const line = activityLine(recipe ?? null, activity, lastSent ?? null, {
    meId: me?.id ?? null,
    verb,
    statCooked: stat?.cooked?.count ?? 0,
    faceIds,
  }, t);
  const statLabel = dishStatsLabel(stat, profiles, verb);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      pressedOpacity={0.85}
      accessibilityRole="link"
      accessibilityLabel={[entry.title, line?.text, statLabel].filter(Boolean).join('. ')}
      style={rowStyles.card}>
      <View style={rowStyles.thumb}>
        {entry.poster_url ? (
          <Image source={{ uri: entry.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={entry.id} />
        ) : (
          <NoPhoto title={entry.title} size={THUMB} />
        )}
      </View>
      <View style={rowStyles.text}>
        <Txt variant="title" size={17} numberOfLines={2}>
          {entry.title}
        </Txt>
        {line ? (
          line.done ? (
            <View style={styles.done}>
              <CheckIcon size={15} strokeWidth={3} color={colors.green} />
              <Txt variant="label" size={15} weight={700} color={colors.green} numberOfLines={1} style={styles.shrink}>
                {line.text}
              </Txt>
            </View>
          ) : (
            <Txt variant="meta" size={15} numberOfLines={1}>
              {line.text}
            </Txt>
          )
        ) : !activity && !error ? (
          <Skeleton width="55%" height={13} style={styles.skeleton} />
        ) : null}
        <DishStatsLine stat={stat} profiles={profiles} verb={verb} onFacesShown={setFaceIds} style={styles.stat} />
      </View>
      <ChevronRightIcon size={22} strokeWidth={2.2} color={colors.muted} />
    </PressableScale>
  );
}

/** A placeholder card at the row's size (72 thumb + 16 padding) while the library loads. */
export function RecipeRowSkeleton() {
  return (
    <View style={rowStyles.card}>
      <Skeleton width={THUMB} height={THUMB} radius={radii.thumb} />
      <View style={rowStyles.text}>
        <Skeleton width="70%" height={17} />
        <Skeleton width="45%" height={13} style={styles.skeleton} />
      </View>
    </View>
  );
}

type Activity = ReturnType<typeof useRecipeActivity>['activity'];

function activityLine(
  recipe: Recipe | null,
  a: Activity,
  sent: KitchenItem | null,
  /** Who's looking, and what the stat line beside it already says & shows (cardActivityLine). */
  opts: { meId: string | null; verb: MadeVerb; statCooked: number; faceIds: readonly string[] },
  t: T,
): { text: string; done?: boolean } | null {
  const family = a ? cardActivityLine(a, opts) : null;
  if (family) return family;
  if (sent) return { text: t('parent.row.sentTo', { name: sent.other.name, day: relativeDay(sent.message.created_at, {}, t) }) };
  if (!a && !recipe) return null;
  const facts = [
    recipe ? totalTimeLabel(recipe.total_time) : null,
    recipe && recipe.steps.length ? t('parent.row.steps', { n: recipe.steps.length }) : null,
  ].filter(Boolean);
  if (facts.length) return { text: facts.join(' · ') };
  return a ? { text: t('parent.row.notSent') } : null;
}

/** The shared recipe list card: Your recipes rows and the greyed processing rows. */
export const rowStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
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
});

const styles = StyleSheet.create({
  done: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  skeleton: { marginTop: 4 },
  stat: { marginTop: 2 },
});
