// Kid Community tab ("Near you", Caleb's mockup): lavender wash, the title, the filter chips (only
// Nearby works for now), one dark dinner card for the next dinner (one I host, one I'm in, else the
// soonest open one nearby), "Host a dinner", then a card per family that shared a recipe (photo,
// dish, "<family> · <distance>", one line of its story) and the AI footnote. Everything is live:
// a new dinner, a request or a yes shows up on both phones without a refresh.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { rememberCovers, useNow, useWaited } from '@/components/community/data';
import { DinnerCard } from '@/components/community/DinnerCard';
import { FamilyCard } from '@/components/community/FamilyCard';
import { pickNextDinner } from '@/components/community/labels';
import { NearbyFilters } from '@/components/community/NearbyFilters';
import { ActingAsBar } from '@/components/profiles';
import { ActionButton, EmptyState, LargeHeader, listEnter, PlusIcon, ScreenWash, SkeletonRow, StickyHeader, Txt, useScrollY } from '@/components/ui';
import { useCommunityFeed, useMyDinners } from '@/lib/live/community';
import { colors, space, tabBar } from '@/theme/tokens';

const TITLE = 'Near you';
/** The feed starts empty; give it this long before "No one nearby yet" (it's usually back sooner). */
const SETTLE_MS = 1500;

export default function KidCommunity() {
  const feed = useCommunityFeed();
  const mine = useMyDinners();
  const now = useNow();
  const waited = useWaited(SETTLE_MS);
  const { scrollY, onScroll } = useScrollY();
  // The recipe and dinner pages show the same stock photo (coverFor) without asking again.
  useEffect(() => rememberCovers(feed.recipes), [feed.recipes]);

  const next = pickNextDinner(mine, feed.dinners, now);
  const nextId = next ? ('mine' in next ? next.mine.dinnerId : next.feed.dinnerId) : null;
  const loading = !waited && !feed.recipes.length && !feed.dinners.length && !mine.length;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <ScreenWash tone="kid" height={300} />
        <LargeHeader title={TITLE} scrollY={scrollY} fadeEnd={40} />
        <ActingAsBar />
        <View style={styles.filters}>
          <NearbyFilters />
        </View>
        <View style={styles.body}>
          {next && nextId ? (
            <Animated.View entering={listEnter(0)}>
              <DinnerCard pick={next} now={now} onOpen={() => router.push({ pathname: '/dinner/[id]', params: { id: nextId } })} />
            </Animated.View>
          ) : null}
          <ActionButton
            label="Host a dinner"
            variant="outline"
            size="sm"
            icon={<PlusIcon size={20} color={colors.ink} strokeWidth={2.2} />}
            onPress={() => router.push('/dinner/new')}
          />
          {loading ? (
            <View>
              {[0, 1, 2].map((i) => (
                <SkeletonRow key={i} thumb={84} />
              ))}
            </View>
          ) : feed.recipes.length ? (
            <View style={styles.cards}>
              {feed.recipes.map((r, i) => (
                <Animated.View key={r.recipeId} entering={listEnter(i + 1)}>
                  <FamilyCard recipe={r} onOpen={() => router.push({ pathname: '/community/[id]', params: { id: r.recipeId } })} />
                </Animated.View>
              ))}
              <Txt variant="caption" align="center" style={styles.footnote}>
                Stories are written with AI from each family’s recipe.
              </Txt>
            </View>
          ) : (
            <EmptyState tone="lavender" title="No one nearby yet" body="When a family near you shares a recipe, it shows up here." />
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
  filters: { marginTop: space.xxl },
  body: { marginTop: space.xxl, paddingHorizontal: space.gutter, gap: space.lg },
  cards: { gap: space.lg },
  footnote: { marginTop: space.sm },
});
