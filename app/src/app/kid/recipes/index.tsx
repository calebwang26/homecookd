// Kid Recipes tab: "Our family table", the search field right under it, then the filter chips
// (Everyone, Favorites, each cook) over one card per dish (cook · my activity, heart), 24 pt between
// each of those sections. Typing swaps the chips and list for the matching dishes; clearing brings
// them back. A dish opens inside this tab (/kid/recipes/<id>), so Back comes back here. The chosen
// chip is remembered per profile; a new profile starts on Everyone. A cook's chip opens with "You
// can cook 4 of Grandma’s 7" (learners; counts from my own /me/recipe-stats over that cook's real
// dishes: RETENTION-HANDOFF 3.6).
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { SearchBar } from '@/components/browse/SearchBar';
import { SearchResults } from '@/components/kid-home/SearchResults';
import { EVERYONE, RecipeList, type RecipeFilter } from '@/components/recipes/RecipeList';
import { useRecipeStats } from '@/components/recipes/stats';
import { ActingAsBar } from '@/components/profiles';
import { LargeHeader, ScreenWash, StickyHeader, useScrollY } from '@/components/ui';
import { useFavorites } from '@/lib/favorites';
import { kitchenCounts } from '@/lib/kitchenCounts';
import { openRecipe } from '@/lib/navigation';
import { refreshLibrary, useLibrary, useRecipes, type LibraryEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { searchDishes, searchWords } from '@/lib/search';
import { kvGet, kvSet } from '@/lib/storage';
import { colors, space, tabBar } from '@/theme/tokens';

const TITLE = 'Our family table';

export default function KidRecipes() {
  const { me, cooks, profiles, isLearner } = useSession();
  const { entries } = useLibrary();
  const fav = useFavorites();
  const stats = useRecipeStats();
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const recipes = useRecipes(ids);
  // "4 of 7" per family cook, for learners only (a cook's own Recipes tab has the mirror instead).
  // Not before the server has answered my stats: no "Grandma’s 7 dishes" that turns into "4 of 7"
  // a moment later (or stays wrong offline).
  const counts = useMemo(
    () => (isLearner && stats.loaded ? kitchenCounts(entries, profiles, stats.byId, me?.id) : undefined),
    [isLearner, stats.loaded, entries, profiles, stats.byId, me?.id],
  );
  const { scrollY, onScroll } = useScrollY();

  // The chip survives leaving the tab (and the app), per profile.
  const filterKey = me ? `recipes.filter.${me.id}` : null;
  const [filter, setFilter] = useState<RecipeFilter>(EVERYONE);
  useEffect(() => {
    if (!filterKey) return;
    let alive = true;
    kvGet(filterKey).then((v) => {
      if (alive && v) setFilter(v);
    });
    return () => {
      alive = false;
    };
  }, [filterKey]);
  const onFilter = useCallback(
    (f: RecipeFilter) => {
      setFilter(f);
      if (filterKey) void kvSet(filterKey, f);
    },
    [filterKey],
  );

  const [query, setQuery] = useState('');
  const searching = searchWords(query).length > 0;
  const results = useMemo(() => searchDishes(entries, query), [entries, query]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshLibrary(), fav.refresh(), stats.refresh()]).catch(() => {});
    setRefreshing(false);
  }, [fav, stats]);

  const onOpenId = useCallback((id: string) => {
    Keyboard.dismiss();
    openRecipe(router, id);
  }, []);
  const onOpen = useCallback((e: LibraryEntry) => onOpenId(e.id), [onOpenId]);

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // On web a scroll would blur the field mid-typing.
        keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        contentContainerStyle={styles.content}>
        <ScreenWash tone="kid" height={300} />
        <LargeHeader title={TITLE} size={34} scrollY={scrollY} fadeEnd={40} />
        <ActingAsBar />
        {entries.length ? (
          <View style={styles.search}>
            <SearchBar value={query} onChangeText={setQuery} />
          </View>
        ) : null}
        <View style={styles.body}>
          {searching ? (
            <SearchResults query={query} results={results} stats={stats.byId} recipes={recipes} onOpen={onOpenId} />
          ) : (
            <RecipeList
              entries={entries}
              cooks={cooks}
              favorites={fav.ids}
              favoritesReady={fav.ready}
              stats={stats.byId}
              recipes={recipes}
              filter={filter}
              onFilter={onFilter}
              onOpen={onOpen}
              kitchens={counts}
              profiles={profiles}
              meId={me?.id}
            />
          )}
        </View>
      </Animated.ScrollView>
      <StickyHeader title={TITLE} scrollY={scrollY} start={40} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: tabBar.clearance + space.sm },
  search: { marginTop: space.xxl },
  body: { marginTop: space.xxl },
});
