// One circle on the Community map: the dish's photo (our stock photo, or the pot) in a white rim, and
// a count when several families share the ~1 km cell. Picked, it grows a little and gets a warm sun
// ring; with Reduce Motion it only gets the ring.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { colors, motion } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { PHOTO } from './mapLayout';

const GROW = 1.2;
const RIM = 3;
// From the Community mockup: a circle lifts off the map, and the picked one glows sun yellow.
const LIFT = '0 2px 8px rgba(30,36,16,0.25)';
const GLOW = '0 0 0 5px rgba(254,190,41,0.4)';

export type MapSpotProps = {
  x: number;
  y: number;
  photo: string | null;
  count: number;
  picked: boolean;
  /** "Jollof Rice by Mama Ngozi, under a mile away" (labels.spotLabel). */
  label: string;
  onPress: () => void;
};

export function MapSpot({ x, y, photo, count, picked, label, onPress }: MapSpotProps) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = reduce ? 1 : withSpring(picked ? GROW : 1, motion.settle);
  }, [picked, reduce, scale]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.place, { left: x - PHOTO / 2, top: y - PHOTO / 2, zIndex: picked ? 2 : 1 }, grow]}>
      <PressableScale
        onPress={onPress}
        haptic
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={picked ? 'Closes the card' : 'Shows whose it is'}
        accessibilityState={{ selected: picked }}
        style={[styles.circle, picked ? styles.on : styles.off]}>
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
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', width: PHOTO, height: PHOTO },
  circle: { width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, borderWidth: RIM, backgroundColor: colors.card },
  off: { borderColor: colors.card, boxShadow: LIFT },
  on: { borderColor: colors.sun, boxShadow: GLOW },
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
