// One circle on the Community map: the dish's photo (our stock photo, or the pot) in a cream rim, and a
// count when several families share the ~1 km cell. It pops in after the circles before it (`index`).
// Picked, it springs bigger (54 -> 70 pt, the canvas) with a warm sun ring; with Reduce Motion it only
// gets the ring, and the pop is a fade.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { PHOTO } from './mapLayout';
import { popIn, SPRING_UP } from './motion';

const PICKED = 70;
const GROW = PICKED / PHOTO;
const RIM = 3;
// From the Community canvas: a circle lifts off the map, and the picked one wears a sun ring.
const LIFT = '0 4px 12px rgba(30,36,16,0.22)';
const RING = '0 0 0 5px rgba(254,190,41,0.55), 0 6px 18px rgba(30,36,16,0.25)';

export type MapSpotProps = {
  x: number;
  y: number;
  /** Its place in the map's pop-in order. */
  index: number;
  photo: string | null;
  count: number;
  picked: boolean;
  /** "Jollof Rice by Mama Ngozi, under a mile away" (labels.spotLabel). */
  label: string;
  onPress: () => void;
};

export function MapSpot({ x, y, index, photo, count, picked, label, onPress }: MapSpotProps) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = reduce ? 1 : withSpring(picked ? GROW : 1, SPRING_UP);
  }, [picked, reduce, scale]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View entering={popIn(index, reduce)} style={[styles.place, { left: x - PHOTO / 2, top: y - PHOTO / 2, zIndex: picked ? 2 : 1 }]}>
      <Animated.View style={grow}>
        <PressableScale
          onPress={onPress}
          haptic
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={picked ? 'Closes the card' : 'Shows whose it is'}
          accessibilityState={{ selected: picked }}
          style={[styles.circle, { boxShadow: picked ? RING : LIFT }]}>
          <DishPhoto uri={photo} label="" pot={26} style={styles.photo} />
          {count > 1 ? (
            <View style={styles.badge}>
              <Txt variant="label" size={13} weight={700} color={colors.card}>
                {count}
              </Txt>
            </View>
          ) : null}
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', width: PHOTO, height: PHOTO },
  circle: { width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, borderWidth: RIM, borderColor: colors.card, backgroundColor: colors.card },
  photo: { flex: 1, borderRadius: PHOTO / 2 - RIM },
  badge: {
    position: 'absolute',
    top: -RIM - 6,
    right: -RIM - 6,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
