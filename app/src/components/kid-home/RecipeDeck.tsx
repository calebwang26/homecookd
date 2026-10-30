// Kid Home's look through the family's recipes (round-2 note 1, iPhone feedback Oct 22): a swipeable
// row of dish cards, every recipe in the Recipes tab's Everyone order. One card sits in the middle;
// the ones before and after peek in at the sides, smaller and dimmed, so it still reads as a stack.
// Each card is the dish photo with a cream rim, so cards never blend into each other; the middle one
// names its dish on a dark fade at the bottom. Swipes snap one card at a time.
//   tap the middle card   opens that dish (in the Recipes tab, so Back returns to the list)
//   tap a peeking card    brings it to the middle
// Under the row, a quiet position: "3/10 recipes" (iPhone feedback Oct 22: no dots); one dish is
// "1 recipe". The row takes the height its parent gives it (flex: 1); each card's size comes from that
// height and the screen width, never from how many dishes there are. Missing photos show the dish's first letter in
// Fraunces on the sunken cream (ui/NoPhoto; never the egg), as on the Recipes list.
// Reduce Motion: the side cards are only dimmed (no shrinking as you swipe), and a tap jumps.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { NoPhoto, PressableScale, Txt } from '@/components/ui';
import type { LibraryEntry } from '@/lib/types';
import { alpha, colors, radii, shadows, space } from '@/theme/tokens';

/** Card width : height. */
const ASPECT = 0.78;
/** The middle card's widest, as a share of the row's width (the rest is the peeking neighbours). */
const MAX_WIDTH = 0.66;
/** Space between two cards. */
const GAP = 14;
/** Room above and below the cards for their shadow. */
const PAD_Y = 14;
/** Room under the row for the position line (its gap and one line). */
const POSITION_ROOM = 30;
/** Peeking cards against the middle one: size, and how much darker. */
const SIDE_SCALE = 0.86;
const SIDE_DIM = 0.32;
const RIM = 3;

type Props = {
  /** The dishes in the Recipes tab's Everyone order; the first is in the middle to start. */
  entries: LibraryEntry[];
  onOpen: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

export function RecipeDeck({ entries, onOpen, style }: Props) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useAnimatedRef<Animated.FlatList<LibraryEntry>>();
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const count = entries.length;
  const card = stage ? cardSize(stage.w, stage.h - POSITION_ROOM) : null;
  const step = card ? card.w + GAP : 1;
  const current = Math.min(index, Math.max(0, count - 1));

  useAnimatedReaction(
    () => Math.round(scrollX.value / step),
    (now, before) => {
      if (now !== before) scheduleOnRN(setIndex, Math.max(0, now));
    },
    [step],
  );

  // The order settles once the family's cooks load (and can change on refresh): start again from the
  // first dish. (On web, CSS snapping would otherwise follow the old first card to its new place.)
  const order = entries.map((e) => e.id).join(' ');
  useEffect(() => {
    // The scroll event moves the position back too.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [order, listRef]);

  const center = useCallback(
    (i: number) => listRef.current?.scrollToOffset({ offset: i * step, animated: !reduce }),
    [listRef, step, reduce],
  );

  const renderItem = useCallback(
    ({ item, index: i }: { item: LibraryEntry; index: number }) =>
      card ? (
        <DeckCard
          entry={item}
          index={i}
          count={count}
          width={card.w}
          height={card.h}
          step={step}
          scrollX={scrollX}
          shrink={!reduce}
          onPress={() => (i === current ? onOpen(item.id) : center(i))}
          centered={i === current}
        />
      ) : null,
    [card, count, step, scrollX, reduce, current, onOpen, center],
  );

  return (
    <View style={[styles.wrap, style]} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {card && stage ? (
        <>
          <Animated.FlatList
            ref={listRef}
            data={entries}
            keyExtractor={(e) => e.id}
            renderItem={renderItem}
            extraData={current}
            horizontal
            scrollEnabled={count > 1}
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            snapToInterval={step}
            decelerationRate="fast"
            disableIntervalMomentum
            getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
            style={[{ width: stage.w, height: card.h + PAD_Y * 2, flexGrow: 0 }, webSnap]}
            contentContainerStyle={{ paddingHorizontal: (stage.w - card.w) / 2, paddingVertical: PAD_Y, gap: GAP }}
          />
          <Position index={current} count={count} />
        </>
      ) : null}
    </View>
  );
}

/** The middle card's size: as tall as fits, never wider than MAX_WIDTH of the row. */
function cardSize(w: number, h: number): { w: number; h: number } {
  const width = Math.max(0, Math.min(w * MAX_WIDTH, (h - PAD_Y * 2) * ASPECT));
  return { w: Math.round(width), h: Math.round(width / ASPECT) };
}

function DeckCard({
  entry,
  index,
  count,
  width,
  height,
  step,
  scrollX,
  shrink,
  centered,
  onPress,
}: {
  entry: LibraryEntry;
  index: number;
  count: number;
  width: number;
  height: number;
  step: number;
  scrollX: SharedValue<number>;
  shrink: boolean;
  centered: boolean;
  onPress: () => void;
}) {
  const range = [(index - 1) * step, index * step, (index + 1) * step];
  const sizeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shrink ? interpolate(scrollX.value, range, [SIDE_SCALE, 1, SIDE_SCALE], Extrapolation.CLAMP) : 1 }],
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [SIDE_DIM, 0, SIDE_DIM], Extrapolation.CLAMP),
  }));
  // Only the middle card names its dish; cut-off titles on the peeking cards are just noise.
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[{ width, height }, webSnapItem, sizeStyle]}>
      <PressableScale
        onPress={onPress}
        haptic={centered}
        scaleTo={0.98}
        pressedOpacity={1}
        accessibilityRole={centered ? 'link' : 'button'}
        accessibilityLabel={`${entry.title}, ${index + 1} of ${count}`}
        accessibilityHint={centered ? 'Opens the recipe' : 'Shows this dish'}
        style={[styles.card, { boxShadow: shadows.card }]}>
        <View style={styles.photo}>
          {entry.poster_url ? (
            <Image source={{ uri: entry.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={entry.id} />
          ) : (
            <NoPhoto title={entry.title} size={Math.round(width * 0.5)} initial />
          )}
          <LinearGradient pointerEvents="none" colors={[alpha.photoShadeTop, alpha.photoShadeCard]} style={styles.shade} />
          <Animated.View pointerEvents="none" style={[styles.title, titleStyle]}>
            <Txt variant="display" size={22} color={colors.card} numberOfLines={2}>
              {entry.title}
            </Txt>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/** Where you are in the row: "3/10 recipes", or "1 recipe" (each card already says it aloud). */
function Position({ index, count }: { index: number; count: number }) {
  return (
    <View style={styles.position} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Txt variant="label" color={colors.muted}>
        {positionLabel(index, count)}
      </Txt>
    </View>
  );
}

const positionLabel = (index: number, count: number) => (count === 1 ? '1 recipe' : `${index + 1}/${count} recipes`);

// Web has no snapToInterval; CSS scroll snapping does the same there.
const webSnap = (Platform.OS === 'web' ? { scrollSnapType: 'x mandatory' } : null) as ViewStyle | null;
const webSnapItem = (Platform.OS === 'web' ? { scrollSnapAlign: 'center' } : null) as ViewStyle | null;

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { flex: 1, borderRadius: radii.card, backgroundColor: colors.card, padding: RIM },
  photo: {
    flex: 1,
    borderRadius: radii.card - RIM,
    overflow: 'hidden',
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  title: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg },
  dim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.ink },
  position: { height: POSITION_ROOM - 8, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
});
