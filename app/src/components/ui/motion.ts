// Entering-animation presets from the motion spec. Reanimated layout animations follow the
// system Reduce Motion setting by default (they are skipped), so these are safe everywhere.
//
//   <Animated.View entering={listEnter(index)}>...</Animated.View>          (motion 2: cards)
//   <Animated.View entering={heroEnter}>hero image</Animated.View>           (motion 3: detail hero)
//   <Animated.View entering={detailContentEnter}>the rest</Animated.View>   (motion 3: 80 ms later)
import { Platform } from 'react-native';
import { Easing, FadeIn, FadeInDown, FadeOut, ZoomIn, withSpring, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

// Reanimated on web only runs predefined animations with duration/delay/easing modifiers, so web
// gets the closest predefined equivalent of each custom preset.
const web = Platform.OS === 'web';

/** Cards fade + rise 12 px on first mount, 40 ms stagger. */
export const listEnter = (index = 0) => {
  const a = FadeInDown.duration(motion.listEnterMs)
    .delay(Math.min(index, 12) * motion.listStaggerMs)
    .easing(Easing.out(Easing.cubic));
  return web ? a : a.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
};

/** Detail hero: scale 0.92 / translateY 24 / opacity 0.6 -> 1 on a spring (damping 18, stiffness 180, mass 1). */
function heroEnterNative() {
  'worklet';
  const cfg = { damping: 18, stiffness: 180, mass: 1 };
  return {
    initialValues: { opacity: 0.6, transform: [{ scale: 0.92 }, { translateY: 24 }] },
    animations: {
      opacity: withTiming(1, { duration: 220 }),
      transform: [{ scale: withSpring(1, cfg) }, { translateY: withSpring(0, cfg) }],
    },
  };
}

export const heroEnter = web ? FadeIn.duration(260) : heroEnterNative;

/** Detail content: fades up 80 ms after the hero. */
const detailBase = FadeInDown.duration(320).delay(80).easing(Easing.out(Easing.cubic));
export const detailContentEnter = web ? detailBase : detailBase.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });

/** A sent message bubble pops in (scale 0.9 -> 1). */
function bubblePopNative() {
  'worklet';
  const cfg = { damping: 16, stiffness: 260, mass: 1 };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: { opacity: withTiming(1, { duration: 140 }), transform: [{ scale: withSpring(1, cfg) }] },
  };
}

export const bubblePop = web ? ZoomIn.duration(200) : bubblePopNative;

export const fadeOutFast = FadeOut.duration(150);
