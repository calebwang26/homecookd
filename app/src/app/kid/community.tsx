// Kid Community tab, "Dishes near you" (Caleb's final Community canvas, Oct 24): the title (homie rests
// at the top right) with one line under it, "Tap a photo to learn about a dish and cook together.", one
// square map with a round photo for each dish nearby (they pop in) and "You" in the middle, and under it
// ONE button, "Share your recipe". Everything else waits for a tap, one step at a time: a dish opens its
// card ("Connect with Mama Ngozi"), then the chooser (join her dinner, swap recipes, cook together);
// "Share your recipe" opens its own chooser (put a family dish on the map, host a dinner); the
// floormates' shared circle opens a row of their dishes; "You" opens your dinners, swaps and dishes
// you're cooking together. Tap the map or the same circle to close it. Live: a new dish, dinner,
// request, swap or yes shows up on both phones without a refresh.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedRef, useReducedMotion } from 'react-native-reanimated';

import { newSwaps } from '@/components/community/choices';
import { rememberCovers, useNow, useWaited } from '@/components/community/data';
import { DishMap } from '@/components/community/DishMap';
import { DishSteps, type DishStep } from '@/components/community/DishSteps';
import { newRequests, pickNextDinner, youLabel } from '@/components/community/labels';
import { layoutSpots, placeAreas } from '@/components/community/mapLayout';
import { fadeOut, riseIn } from '@/components/community/motion';
import { ShareSteps, type ShareStep } from '@/components/community/ShareSteps';
import { YouCard } from '@/components/community/YouCard';
import { ActingAsBar } from '@/components/profiles';
import { ActionButton, LargeHeader, ScreenWash, StickyHeader, Txt, useScrollY } from '@/components/ui';
import { useCommunityFeed, useFamilyDishes, useMyDinners, useMySwaps } from '@/lib/live/community';
import { colors, space, tabBar } from '@/theme/tokens';

const TITLE = 'Dishes near you';
const HOW = 'Tap a photo to learn about a dish and cook together.';
/** The cards' side gutter; the map sits a little further in (330 pt on a 390 pt phone). */
const GUTTER = 16;
const MAP_GUTTER = 30;
const MAX_MAP = 420;
/** Room homie takes at the top right (its resting pot, 56 pt). */
const HOMIE_ROOM = 56;
/** The feed starts empty; give it this long before "nothing nearby" (it's usually back sooner). */
const SETTLE_MS = 1500;

type Panel =
  | { kind: 'dish'; key: string; member: number; step: DishStep }
  | { kind: 'share'; step: ShareStep }
  | { kind: 'you' }
  | null;

export default function KidCommunity() {
  const feed = useCommunityFeed();
  const mine = useMyDinners();
  const swaps = useMySwaps();
  const now = useNow();
  const waited = useWaited(SETTLE_MS);
  const { scrollY, onScroll } = useScrollY();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 2 * MAP_GUTTER, MAX_MAP);
  const cardWidth = Math.min(width - 2 * GUTTER, MAX_MAP + 2 * (MAP_GUTTER - GUTTER));
  const [panel, setPanel] = useState<Panel>(null);
  // Our own dishes: for "Share your recipe" and for what a swap can offer.
  const dishes = useFamilyDishes(panel?.kind === 'share' || panel?.kind === 'dish');
  // The recipe and dinner pages show the same stock photo (coverFor) without asking again.
  useEffect(() => rememberCovers(feed.recipes), [feed.recipes]);

  // A card that opens below the fold (a small phone, a tall card) scrolls up just above the tab bar.
  const reduce = useReducedMotion();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const frame = useRef({ bottom: 0, view: 0 });
  const reveal = useCallback(() => {
    const { bottom, view } = frame.current;
    const y = bottom - (view - tabBar.clearance);
    if (panel && view && y > scrollY.get() + 1) scroller.current?.scrollTo({ y, animated: !reduce });
  }, [panel, reduce, scrollY, scroller]);
  useEffect(reveal, [reveal]);
  const onBodyLayout = (e: LayoutChangeEvent) => {
    frame.current.bottom = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
    reveal();
  };

  const spots = useMemo(() => layoutSpots(feed.recipes, feed.here, size), [feed.recipes, feed.here, size]);
  const areas = useMemo(() => placeAreas(feed.here, size, spots), [feed.here, size, spots]);
  const spot = panel?.kind === 'dish' ? (spots.find((s) => s.key === panel.key) ?? null) : null;
  const requests = newRequests(mine, now) + newSwaps(swaps);

  // Only an empty map gets a line under it (once the feed had time to answer).
  const empty = !feed.recipes.length && waited;

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
        <LargeHeader title={TITLE} subtitle={HOW} scrollY={scrollY} fadeEnd={40} style={styles.header} right={<View style={styles.homie} />} />
        <ActingAsBar />
        <View style={styles.body} onLayout={onBodyLayout}>
          <DishMap
            size={size}
            spots={spots}
            areas={areas}
            pickedKey={spot?.key ?? null}
            onPick={(key) => setPanel(key ? { kind: 'dish', key, member: 0, step: 'info' } : null)}
            you={{
              picked: panel?.kind === 'you',
              news: requests > 0,
              label: youLabel(requests),
              onPress: () => setPanel((p) => (p?.kind === 'you' ? null : { kind: 'you' })),
            }}
          />
          <View style={{ width: cardWidth }}>
            {panel?.kind === 'you' ? (
              <Animated.View key="you" entering={riseIn(reduce)} exiting={fadeOut()}>
                <YouCard next={pickNextDinner(mine, [], now)} swaps={swaps} now={now} />
              </Animated.View>
            ) : panel?.kind === 'share' ? (
              <ShareSteps step={panel.step} onStep={(step) => setPanel({ kind: 'share', step })} onClose={() => setPanel(null)} dishes={dishes} now={now} />
            ) : panel?.kind === 'dish' && spot ? (
              <DishSteps
                key={spot.key}
                spot={spot}
                member={panel.member}
                step={panel.step}
                onMember={(member) => setPanel({ ...panel, member, step: 'info' })}
                onStep={(step) => setPanel({ ...panel, step })}
                mine={mine}
                swaps={swaps}
                dishes={dishes}
                now={now}
                width={cardWidth}
              />
            ) : feed.recipes.length || empty ? (
              <View style={styles.idle}>
                {empty ? (
                  <Txt variant="body" size={18} leading={1.4} align="center" style={styles.hint}>
                    When a family near you shares a dish, it shows up here.
                  </Txt>
                ) : null}
                <ActionButton
                  label="Share your recipe"
                  variant="outline"
                  size="md"
                  padH={28}
                  accessibilityHint="Put a family dish on the map, or host a dinner"
                  onPress={() => setPanel({ kind: 'share', step: 'menu' })}
                  style={styles.share}
                />
              </View>
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
  idle: { alignItems: 'center', gap: space.lg, paddingTop: 2 },
  hint: { paddingHorizontal: space.sm },
  share: { alignSelf: 'center' },
});
