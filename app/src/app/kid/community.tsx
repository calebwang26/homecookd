// Kid Community tab, "Dishes near you" (Caleb's simplified map, Oct 24): the title (homie rests at the
// top right), one square map with a round photo for each dish nearby and "You" in the middle, and one
// line under it. Everything else waits for a tap: a dish opens its card (whose it is, how far, the
// cook's words, "See the recipe" or its dinner); the floormates' shared circle opens a row of their
// dishes; "You" opens your dinners and "Host a dinner". Tap the map or the same circle to close it.
// Live: a new dish, dinner, request or yes shows up on both phones without a refresh.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedRef, useReducedMotion } from 'react-native-reanimated';

import { ClusterRow } from '@/components/community/ClusterRow';
import { rememberCovers, useNow, useWaited } from '@/components/community/data';
import { DishCard } from '@/components/community/DishCard';
import { DishMap } from '@/components/community/DishMap';
import { newRequests, pickNextDinner, youLabel } from '@/components/community/labels';
import { layoutSpots, placeAreas } from '@/components/community/mapLayout';
import { YouCard } from '@/components/community/YouCard';
import { ActingAsBar } from '@/components/profiles';
import { LargeHeader, listEnter, ScreenWash, StickyHeader, Txt, useScrollY } from '@/components/ui';
import { useCommunityFeed, useMyDinners } from '@/lib/live/community';
import { colors, space, tabBar } from '@/theme/tokens';

const TITLE = 'Dishes near you';
/** This screen's side gutter: the map is 358 pt on a 390 pt phone. */
const GUTTER = 16;
const MAX_MAP = 420;
/** Room homie takes at the top right (its resting pot, 56 pt). */
const HOMIE_ROOM = 56;
/** The feed starts empty; give it this long before "nothing nearby" (it's usually back sooner). */
const SETTLE_MS = 1500;

type Picked = { key: string; member: number } | 'you' | null;

export default function KidCommunity() {
  const feed = useCommunityFeed();
  const mine = useMyDinners();
  const now = useNow();
  const waited = useWaited(SETTLE_MS);
  const { scrollY, onScroll } = useScrollY();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 2 * GUTTER, MAX_MAP);
  const [picked, setPicked] = useState<Picked>(null);
  // The recipe and dinner pages show the same stock photo (coverFor) without asking again.
  useEffect(() => rememberCovers(feed.recipes), [feed.recipes]);

  // A card that opens below the fold (a small phone, a tall card) scrolls up just above the tab bar.
  const reduce = useReducedMotion();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const frame = useRef({ bottom: 0, view: 0 });
  const reveal = useCallback(() => {
    const { bottom, view } = frame.current;
    const y = bottom - (view - tabBar.clearance);
    if (picked && view && y > scrollY.get() + 1) scroller.current?.scrollTo({ y, animated: !reduce });
  }, [picked, reduce, scrollY, scroller]);
  useEffect(reveal, [reveal]);
  const onBodyLayout = (e: LayoutChangeEvent) => {
    frame.current.bottom = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
    reveal();
  };

  const spots = useMemo(() => layoutSpots(feed.recipes, feed.here, size), [feed.recipes, feed.here, size]);
  const areas = useMemo(() => placeAreas(feed.here, size, spots), [feed.here, size, spots]);
  const spot = picked && picked !== 'you' ? (spots.find((s) => s.key === picked.key) ?? null) : null;
  const dish = spot && picked && picked !== 'you' ? (spot.members[picked.member] ?? spot.members[0]) : null;
  const asked = !!dish?.dinner && mine.some((d) => d.dinnerId === dish.dinner?.dinnerId && !!d.myRequest);
  const requests = newRequests(mine, now);

  const hint = feed.recipes.length
    ? 'Tap a dish to see whose it is.'
    : waited
      ? 'When a family near you shares a dish, it shows up here.'
      : '';

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        onLayout={(e) => {
          frame.current.view = e.nativeEvent.layout.height;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}>
        <ScreenWash tone="kid" height={300} />
        <LargeHeader title={TITLE} scrollY={scrollY} fadeEnd={40} style={styles.header} right={<View style={styles.homie} />} />
        <ActingAsBar />
        <View style={styles.body} onLayout={onBodyLayout}>
          <DishMap
            size={size}
            spots={spots}
            areas={areas}
            pickedKey={spot?.key ?? null}
            onPick={(key) => setPicked(key ? { key, member: 0 } : null)}
            you={{ picked: picked === 'you', news: requests > 0, label: youLabel(requests), onPress: () => setPicked((p) => (p === 'you' ? null : 'you')) }}
          />
          <View style={[styles.under, { width: size }]}>
            {picked === 'you' ? (
              <Animated.View key="you" entering={listEnter(0)}>
                <YouCard next={pickNextDinner(mine, [], now)} now={now} />
              </Animated.View>
            ) : spot && dish ? (
              <Animated.View key={spot.key} entering={listEnter(0)} style={styles.picked}>
                {spot.members.length > 1 ? (
                  <ClusterRow members={spot.members} picked={spot.members.indexOf(dish)} onPick={(member) => setPicked({ key: spot.key, member })} width={size} />
                ) : null}
                <DishCard key={dish.recipeId} recipe={dish} now={now} asked={asked} />
              </Animated.View>
            ) : hint ? (
              <Txt variant="body" align="center" style={styles.hint}>
                {hint}
              </Txt>
            ) : null}
          </View>
        </View>
      </Animated.ScrollView>
      <StickyHeader title={TITLE} scrollY={scrollY} start={40} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: tabBar.clearance + space.sm },
  header: { paddingHorizontal: GUTTER },
  homie: { width: HOMIE_ROOM, height: 48 },
  body: { marginTop: space.md, alignItems: 'center', gap: space.lg },
  under: { gap: space.md },
  picked: { gap: space.lg },
  hint: { paddingHorizontal: space.sm },
});
