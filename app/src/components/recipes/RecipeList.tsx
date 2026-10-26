// The kid's Recipes list: filter chips (Everyone, Favorites, each cook; Everyone first, since a new
// kid has no favorites yet: kid QA Oct 21, Neil), then one card per dish with 16 px between cards
// (RecipeCards, also used by search). Everyone keeps the family's cooks in profile order (then other
// relatives, then YouTube creators; kid Home's deck uses the same order); Favorites is newest heart
// first.
// For a kid (pass `kitchens`), a cook's chip opens with how many of that cook's dishes they can make
// ("You can cook 4 of Grandma’s 7" + a dot per dish; "Keeper of Grandma’s kitchen" once all are
// cooked; RETENTION-HANDOFF 3.6) and each of those dishes they cooked carries a small stamp. Only a
// family cook's real dishes count (never samples or YouTube), so the header hides for the rest.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { KitchenHeader } from '@/components/hearts';
import { Chip, EmptyState, HeartIcon } from '@/components/ui';
import type { Profile, RecipeStat } from '@/lib/api';
import { earnsStamp, kitchenFor, type KitchenCount } from '@/lib/kitchenCounts';
import type { LibraryEntry, Recipe } from '@/lib/recipes';
import { cookProfile, kitchens } from '@/lib/recipes';
import { useWords } from '@/lib/words/useWords';
import { colors, motion, space } from '@/theme/tokens';

import { activityFor } from './activity';
import { RecipeListRow } from './RecipeListRow';

/** 'everyone', 'favorites', or a cook's name. */
export type RecipeFilter = string;
export const EVERYONE = 'everyone';
export const FAVORITES = 'favorites';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** The family's cooks first (profile order), then other relatives, then YouTube creators. */
export function cookOrder(entries: LibraryEntry[], cooks: Profile[]): { cook: string; entries: LibraryEntry[] }[] {
  const rank = (name: string, relation: string) => {
    const i = cooks.findIndex((p) => norm(p.name) === norm(name));
    if (i >= 0) return i;
    return /youtube/i.test(relation) ? 2000 : 1000;
  };
  return kitchens(entries)
    .map((g, i) => ({ cook: g.cook, entries: g.entries, order: rank(g.cook, g.relation) + i / 100 }))
    .sort((a, b) => a.order - b.order);
}

/** A column of dish cards, 16 px apart. `fadeIn`: each card fades in as it appears (search matches). */
export function RecipeCards({
  entries,
  stats,
  recipes,
  showCook,
  fadeIn,
  stampFor,
  onOpen,
}: {
  entries: LibraryEntry[];
  stats: Record<string, RecipeStat>;
  recipes: Record<string, Recipe>;
  showCook: boolean;
  fadeIn?: boolean;
  /** True for a dish that earns the "cooked it" stamp (a kid's family dish they cooked). */
  stampFor?: (e: LibraryEntry) => boolean;
  onOpen: (e: LibraryEntry) => void;
}) {
  return (
    <View style={styles.cards}>
      {entries.map((e) => (
        <Animated.View key={e.id} entering={fadeIn ? FadeIn.duration(motion.crossfadeMs) : undefined}>
          <RecipeListRow
            entry={e}
            activity={activityFor(e, stats[e.id], recipes[e.id])}
            showCook={showCook}
            stamp={!!stampFor?.(e)}
            onOpen={() => onOpen(e)}
          />
        </Animated.View>
      ))}
    </View>
  );
}

type Props = {
  entries: LibraryEntry[];
  cooks: Profile[];
  favorites: string[];
  favoritesReady: boolean;
  stats: Record<string, RecipeStat>;
  recipes: Record<string, Recipe>;
  filter: RecipeFilter;
  onFilter: (f: RecipeFilter) => void;
  onOpen: (e: LibraryEntry) => void;
  /** Kid side only (kitchenCounts): the "4 of 7" header on a cook's chip and the cooked stamps. */
  kitchens?: KitchenCount[];
  /** The family (session profiles), for the cook's face and whose dish counts. */
  profiles?: Profile[];
  meId?: string | null;
};

export function RecipeList({ entries, cooks, favorites, favoritesReady, stats, recipes, filter, onFilter, onOpen, kitchens: counts, profiles, meId }: Props) {
  const { t } = useWords();
  const groups = useMemo(() => cookOrder(entries, cooks), [entries, cooks]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  // A cook chip whose dishes are gone (library refresh) falls back to Everyone.
  const active = filter === FAVORITES || groups.some((g) => g.cook === filter) ? filter : EVERYONE;
  const rows = useMemo(() => {
    if (active === FAVORITES) return favorites.flatMap((id) => byId.get(id) ?? []);
    if (active === EVERYONE) return groups.flatMap((g) => g.entries);
    return groups.find((g) => g.cook === active)?.entries ?? [];
  }, [active, favorites, byId, groups]);
  const cookChip = active !== EVERYONE && active !== FAVORITES;
  const kitchen = counts && cookChip ? kitchenFor(counts, active) : null;
  const stampFor = useMemo(
    () => (counts ? (e: LibraryEntry) => earnsStamp(e, profiles ?? [], stats, meId) : undefined),
    [counts, profiles, stats, meId],
  );

  if (!entries.length) {
    return (
      <EmptyState
        title={t('parent.list.empty')}
        body={t('parent.list.emptyBody')}
        actionLabel={t('parent.list.emptyAction')}
        onAction={() => router.navigate('/kid/ask')}
        style={styles.col}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('parent.list.show')}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}>
          <Chip label={t('parent.list.everyone')} selected={active === EVERYONE} onPress={() => onFilter(EVERYONE)} />
          <Chip
            label={t('parent.list.favorites')}
            // Wrapped: on web a bare <svg> would sit under the chip's positioned fill.
            leading={
              <View>
                <HeartIcon size={16} filled color={colors.danger} />
              </View>
            }
            selected={active === FAVORITES}
            onPress={() => onFilter(active === FAVORITES ? EVERYONE : FAVORITES)}
          />
          {groups.length > 1
            ? groups.map((g) => <Chip key={g.cook} label={g.cook} selected={active === g.cook} onPress={() => onFilter(active === g.cook ? EVERYONE : g.cook)} />)
            : null}
        </ScrollView>
      </View>

      {/* Keyed by filter: each list fades in on its own instead of rows jumping around. */}
      <Animated.View key={active} entering={FadeIn.duration(motion.crossfadeMs)} style={styles.col}>
        {kitchen && rows.length ? <KitchenHeader count={kitchen} cook={cookProfile({ cook_name: active }, profiles ?? [])} style={styles.kitchen} /> : null}
        {rows.length ? (
          <RecipeCards entries={rows} stats={stats} recipes={recipes} showCook={!cookChip} stampFor={stampFor} onOpen={onOpen} />
        ) : active === FAVORITES && favoritesReady ? (
          <EmptyState icon={<HeartIcon size={28} color={colors.danger} />} title={t('parent.list.noFavorites')} />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xxl },
  // Vertical padding keeps the chips' soft shadow from being clipped by the scroll view.
  chipScroll: { marginVertical: -10, flexGrow: 0 },
  chips: { paddingHorizontal: space.gutter, paddingVertical: 10, gap: space.sm },
  col: { paddingHorizontal: space.gutter },
  cards: { gap: space.lg },
  kitchen: { marginBottom: space.lg },
});
