// Kid Home (round-2 note 1): a portal and nothing else. Top to bottom: yolk-tint wash -> "Hi, Leo" +
// Leo's face ▾ (tap = "Who’s in the kitchen?", to switch people; no second "Leo") -> a swipeable row of every dish
// (RecipeDeck, in the Recipes tab's Everyone order; tap a dish = open it in the Recipes tab) -> green "Start cooking"
// (the Recipes tab) -> outline "Have a question about a dish?" (the Ask sheet: dish -> person -> that
// chat). The row takes whatever height is left above the buttons, so everything clears the tab bar
// on any phone. No recipes: the warm empty state, with one way to ask the family (and invite them)
// on the Ask tab. ActingAsBar (a lent phone) and MoveRequestPrompt stay: they are system states.
// Over it all, only when the App Store has a newer homecookd than this phone's build: "Update homecookd", a popup in the
// middle of the screen over blurred glass (components/update/AppUpdatePopup); Home's own layout doesn't move.
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { RecipeDeck } from '@/components/kid-home/RecipeDeck';
import { AskSheet } from '@/components/messages';
import { ActingAsBar, MoveRequestPrompt, ProfileButton } from '@/components/profiles';
import { cookOrder } from '@/components/recipes/RecipeList';
import { AppUpdatePopup } from '@/components/update/AppUpdatePopup';
import { ActionButton, EmptyState, LargeHeader, listEnter, ScreenWash, Skeleton, StickyHeader, useScrollY } from '@/components/ui';
import { openRecipe } from '@/lib/navigation';
import { refreshLibrary, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { colors, space, tabBar } from '@/theme/tokens';

/** Under the scroll content: room for the floating tab bar. */
const CONTENT_BOTTOM = tabBar.clearance + 8;
/** The row never gets shorter than this; a short phone scrolls a little instead. */
const DECK_MIN = 260;

export default function KidHome() {
  const { status, me, cooks } = useSession();
  const { entries, familyChecked } = useLibrary();
  const dishes = useMemo(() => cookOrder(entries, cooks).flatMap((g) => g.entries), [entries, cooks]);
  const { scrollY, onScroll } = useScrollY();
  const [asking, setAsking] = useState(false);

  // No one picked (e.g. a stale deep link): back to "Who's in the kitchen?".
  useEffect(() => {
    if (status === 'ready' && !me) router.replace('/');
  }, [status, me]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshLibrary().catch(() => {});
    setRefreshing(false);
  }, []);

  const startCooking = useCallback(() => router.navigate('/kid/recipes'), []);
  const openDish = useCallback((id: string) => openRecipe(router, id), []);
  const name = me?.name ?? '';

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        contentContainerStyle={styles.content}>
        <ScreenWash tone="kid" height={360} />
        <LargeHeader title={name ? `Hi, ${name}` : 'Hi there'} right={<ProfileButton faceOnly homieRoom />} scrollY={scrollY} fadeEnd={56} />
        <ActingAsBar />

        {dishes.length ? (
          <>
            <RecipeDeck entries={dishes} onOpen={openDish} style={styles.deck} />
            <Animated.View entering={listEnter(1)} style={styles.actions}>
              <ActionButton label="Start cooking" onPress={startCooking} accessibilityHint="Opens the Recipes tab" />
              <ActionButton
                label="Have a question about a dish?"
                variant="outline"
                onPress={() => setAsking(true)}
                accessibilityHint="Pick a dish, then who to ask"
              />
            </Animated.View>
          </>
        ) : !familyChecked ? (
          // The family's own dishes haven't answered yet: never "No recipes yet" before they could (lib/libraryLoad).
          <View accessible accessibilityLabel="Loading recipes" style={[styles.gutter, styles.deck]}>
            <Skeleton height={DECK_MIN} radius={28} />
          </View>
        ) : (
          <EmptyState
            title="No recipes yet"
            body="Ask someone what they made last Sunday."
            actionLabel="Ask the family"
            onAction={() => router.navigate('/kid/ask')}
            style={styles.gutter}
          />
        )}
      </Animated.ScrollView>

      <StickyHeader title={name ? `Hi, ${name}` : 'Home'} scrollY={scrollY} start={56} />
      <MoveRequestPrompt />
      <AskSheet visible={asking} onClose={() => setAsking(false)} />
      <AppUpdatePopup />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { flexGrow: 1, paddingBottom: CONTENT_BOTTOM },
  gutter: { marginHorizontal: space.gutter },
  deck: { minHeight: DECK_MIN, marginTop: space.lg },
  actions: { marginTop: space.xxl, paddingHorizontal: space.gutter, gap: space.md },
});
