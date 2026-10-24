// Recipes (parent Recipes tab, FEEDBACK-OCT16c-debloat 3 + 14, QA B03). Top to bottom:
//  1. "Your recipes": who in the family can cook how many of my real dishes ("Leo can cook 4 of your
//     7. Maya, 2."; hidden at 0, RETENTION-HANDOFF 3.6), a search field that filters my dishes by
//     title as you type, a big "Send a
//     recipe" button (pick one or more dishes, then who), recordings still being made as greyed
//     rows with a spinner, a progress bar and the usual wait, then my recipes, one card each. A
//     finished recording's row goes and its recipe card takes its place. Each card adds "♥ 4 ·
//     cooked 3 times" and the faces of who cooked or hearted it (3.5; zero parts hidden; GET
//     /dish-stats answers only the dish's cook). Nothing of mine yet (no
//     recipes, nothing on its way): one compact "Record your first recipe" row.
//  2. "Family recipes": the kid side's list (components/recipes/RecipeList: Favorites, Everyone,
//     each cook) without my own dishes. A dish opens /recipe/<id>. Gone when there are none.
// Before the library first loads, placeholder cards hold the list's place.
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { SearchBar } from '@/components/browse/SearchBar';
import { CookMirrorLine, useDishStats } from '@/components/hearts';
import { useKitchen } from '@/components/parent/kitchen';
import { PendingList, usePendingRecipes } from '@/components/parent/PendingRecipes';
import { RecipeRow, RecipeRowSkeleton, rowStyles } from '@/components/parent/RecipeRow';
import { SendRecipeButton, useSendable } from '@/components/parent/SendRecipe';
import { ActingAsBar } from '@/components/profiles';
import { EVERYONE, RecipeList, type RecipeFilter } from '@/components/recipes/RecipeList';
import { useRecipeStats } from '@/components/recipes/stats';
import { ChevronRightIcon, LargeHeader, listEnter, PressableScale, RecordDotIcon, ScreenWash, StickyHeader, Txt, useScrollY } from '@/components/ui';
import { useFavorites } from '@/lib/favorites';
import { refreshThreads } from '@/lib/messaging';
import { openRecipe } from '@/lib/navigation';
import { recipesByCook, refreshLibrary, useLibrary, useRecipes, type LibraryEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { colors, space, tabBar } from '@/theme/tokens';

const TITLE = 'Recipes';

/** Every word of the query appears in the title. */
function matches(title: string, words: string[]): boolean {
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w));
}

export default function ParentRecipes() {
  const { me, cooks, profiles } = useSession();
  const { entries, loaded } = useLibrary();
  const fav = useFavorites();
  const stats = useRecipeStats();
  const [filter, setFilter] = useState<RecipeFilter>(EVERYONE);
  const k = useKitchen();
  const pending = usePendingRecipes();
  const { scrollY, onScroll } = useScrollY();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const sendable = useSendable();
  const mine = useMemo(() => recipesByCook(entries, me?.name), [entries, me?.name]);
  const ids = useMemo(() => mine.map((e) => e.id), [mine]);
  // Hearts & cooks on my dishes from the family (PR 4): the mirror line and each card's line.
  const { stats: dishStats, refresh: refreshDishStats } = useDishStats(ids);
  // Everyone else's dishes, for Family recipes.
  const family = useMemo(() => {
    const own = new Set(ids);
    return entries.filter((e) => !own.has(e.id));
  }, [entries, ids]);
  const allIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const recipes = useRecipes(allIds);

  // A finished recording whose card is already listed shows once, as the card (unless it needs a warning).
  const onTheirWay = useMemo(() => {
    const listed = new Set(ids);
    return pending.jobs.filter((j) => {
      const view = pending.views[j.job_id];
      return !(view?.recipeId && listed.has(view.recipeId) && !view.problem);
    });
  }, [ids, pending.jobs, pending.views]);
  const hasAny = mine.length > 0 || onTheirWay.length > 0;

  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const shown = words.length ? mine.filter((e) => matches(e.title, words)) : mine;
  const jobs = words.length ? onTheirWay.filter((j) => matches(j.title, words)) : onTheirWay;

  const { poll } = pending;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshLibrary(), refreshThreads(), poll(), fav.refresh(), stats.refresh(), refreshDishStats()]).catch(() => {});
    setRefreshing(false);
  }, [poll, fav, stats, refreshDishStats]);
  const onOpenFamily = useCallback((e: LibraryEntry) => openRecipe(router, e.id), []);

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        contentContainerStyle={styles.content}>
        <ScreenWash tone="parent" height={300} />
        <LargeHeader title={TITLE} size={34} scrollY={scrollY} fadeEnd={40} />
        <ActingAsBar />

        <Txt variant="section" accessibilityRole="header" style={styles.heading}>
          Your recipes
        </Txt>
        <CookMirrorLine entries={mine} stats={dishStats} profiles={profiles} meId={me?.id} style={styles.mirror} />
        {hasAny ? (
          <>
            {mine.length ? (
              <Animated.View entering={listEnter(0)} style={styles.search}>
                <SearchBar value={query} onChangeText={setQuery} placeholder="Search your recipes" />
              </Animated.View>
            ) : null}
            <View style={styles.col}>
              {sendable.dishes.length ? (
                <Animated.View entering={listEnter(0)}>
                  <SendRecipeButton dishes={sendable.dishes} mine={sendable.mine} />
                </Animated.View>
              ) : null}

              {jobs.length || shown.length ? (
                <View style={styles.list}>
                  <PendingList pending={pending} jobs={jobs} startIndex={1} />
                  {shown.map((e, i) => (
                    <Animated.View key={e.id} entering={listEnter(1 + jobs.length + i)}>
                      <RecipeRow
                        entry={e}
                        recipe={recipes[e.id] ?? null}
                        lastSent={k.sent.find((s) => s.message.recipe_id === e.id) ?? null}
                        stat={dishStats?.[e.id] ?? null}
                        onPress={() => router.push({ pathname: '/my-recipe/[id]', params: { id: e.id } })}
                      />
                    </Animated.View>
                  ))}
                </View>
              ) : (
                <Txt variant="body" align="center" style={styles.noMatch}>
                  No match for “{query.trim()}”
                </Txt>
              )}
            </View>
          </>
        ) : loaded ? (
          <Animated.View entering={listEnter(0)} style={styles.col}>
            <RecordFirstRow />
            {sendable.dishes.length ? <SendRecipeButton dishes={sendable.dishes} mine={sendable.mine} /> : null}
          </Animated.View>
        ) : (
          <View accessible accessibilityLabel="Loading your recipes" style={[styles.col, styles.list]}>
            <RecipeRowSkeleton />
            <RecipeRowSkeleton />
            <RecipeRowSkeleton />
          </View>
        )}

        {family.length ? (
          <Animated.View entering={listEnter(2)} style={styles.family}>
            <Txt variant="section" accessibilityRole="header" style={styles.familyHeading}>
              Family recipes
            </Txt>
            <RecipeList
              entries={family}
              cooks={cooks}
              favorites={fav.ids}
              favoritesReady={fav.ready}
              stats={stats.byId}
              recipes={recipes}
              filter={filter}
              onFilter={setFilter}
              onOpen={onOpenFamily}
            />
          </Animated.View>
        ) : null}
      </Animated.ScrollView>
      <StickyHeader title={TITLE} scrollY={scrollY} start={40} />
    </View>
  );
}

/** Nothing of mine yet: one row, not a whole empty screen, so the family's dishes show below. */
function RecordFirstRow() {
  return (
    <PressableScale
      onPress={() => router.push('/record')}
      scaleTo={0.98}
      pressedOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Record your first recipe"
      accessibilityHint="Film yourself cooking, then send it to the family"
      style={rowStyles.card}>
      <View style={styles.recordDisc}>
        <RecordDotIcon size={16} color={colors.danger} />
      </View>
      <Txt variant="title" size={17} numberOfLines={2} style={rowStyles.text}>
        Record your first recipe
      </Txt>
      <ChevronRightIcon size={22} strokeWidth={2.2} color={colors.muted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: tabBar.clearance + 8 },
  heading: { paddingHorizontal: space.gutter, marginTop: space.xxl },
  mirror: { paddingHorizontal: space.gutter, marginTop: space.md },
  search: { marginTop: space.lg },
  col: { paddingHorizontal: space.gutter, paddingTop: space.xxl, gap: space.xxxl },
  list: { gap: space.lg },
  noMatch: { paddingTop: space.sm },
  family: { marginTop: space.xxxl + space.lg, gap: space.lg },
  familyHeading: { paddingHorizontal: space.gutter },
  // The Record screen's red dot on a peach disc (56 pt, a little smaller than a recipe row's 72 pt thumb).
  recordDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
