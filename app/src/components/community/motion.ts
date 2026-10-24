// The Community screens' motion (Caleb's final canvas, "A"): the dish circles pop in one after another,
// the dish card rises in, one chooser step crossfades into the next, the dinner's "X going" rolls up.
// With Reduce Motion each one is a plain fade. Reanimated skips layout animations entirely under Reduce
// Motion, so the fades say ReduceMotion.Never.
import { Platform } from 'react-native';
import { Easing, FadeIn, FadeInDown, FadeOut, ReduceMotion, ZoomIn } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

// Reanimated on the web runs only its predefined animations with duration and delay.
const web = Platform.OS === 'web';
const STAGGER_MS = 45;
const MAX_STAGGER = 12;
/** A picked circle springs up with a little overshoot. */
export const SPRING_UP = { damping: 11, stiffness: 220, mass: 0.9 };

export const fadeIn = (ms = 200, delay = 0) => FadeIn.duration(ms).delay(delay).reduceMotion(ReduceMotion.Never);
export const fadeOut = (ms = 140) => FadeOut.duration(ms).reduceMotion(ReduceMotion.Never);

/** A dish circle on the map: pops in, `index` places after the first. */
export function popIn(index: number, reduce: boolean) {
  const delay = Math.min(index, MAX_STAGGER) * STAGGER_MS;
  if (reduce) return fadeIn(220, delay);
  return web ? ZoomIn.duration(300).delay(delay) : ZoomIn.springify().damping(12).stiffness(200).delay(delay);
}

/** The card under the map: rises 12 pt as it fades in. */
export function riseIn(reduce: boolean) {
  if (reduce) return fadeIn(180);
  const rise = FadeInDown.duration(motion.listEnterMs).easing(Easing.out(Easing.cubic));
  return web ? rise : rise.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
}

/** One chooser step to the next: the new one fades in where the old one fades out (fadeOut). */
export const crossIn = () => fadeIn(motion.crossfadeMs + 40);
