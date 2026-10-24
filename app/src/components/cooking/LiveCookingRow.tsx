// The live row on top of the cook's updates card while a kid cooks one of their dishes
// (RETENTION-HANDOFF 3.1):
//   (Leo)  Leo is making your Sunday Chili        ( ♥ )
//          • Step 3 of 8                 [Sent]
// One action: the 48 pt heart. A tap gives a light haptic at once; once the heart is sent, a success
// haptic, the heart fills, a few tiny particles pop just around it and a small "Sent" fades in at the
// end of the step line, right beside the heart, then fades; the filled heart can send another. A
// failure shows "Try again" there instead. Everything stays inside the row (nothing over the card's
// header or past its edge, nothing clipped), the button never changes size and the step line keeps
// its height, so nothing reflows. VoiceOver hears "Heart sent" / "Didn't send". The step line follows
// the kid live (the Home polls every 15 s: lib/useLiveCooking.ts); the row goes when the session ends.
// Presentational: the parent passes the kid, the dish (as the app says it: kitchen.ts dishName),
// the step and `onHeart` (e.g. () => cookingApi.sendHeart(kid.id, recipeId)).
// Reduce Motion: no pulse on the live dot, no particles; "Sent" fades in place.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Avatar, haptic, HeartIcon, PressableScale, Txt, type AvatarProfile } from '@/components/ui';
import { liveTitle, stepLine } from '@/lib/cookingLogic';
import { colors, space } from '@/theme/tokens';

import { HeartPop } from './HeartBurst';

export type LiveCookingRowProps = {
  /** The kid cooking ({name, avatar_key}). */
  kid: AvatarProfile;
  /** The dish, as the app says it ("Sunday Chili"). */
  dish: string;
  step: number;
  total: number;
  /** Sends the heart; resolve = sent, reject = "Try again". */
  onHeart: () => Promise<unknown>;
  /** Optional: tapping the words (e.g. opens the chat with the kid). The heart stays its own button. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

type HeartState = 'idle' | 'sending' | 'sent' | 'error';
const LABEL_MS = 2400;
/** Heart button radius 24, the ring at 18 and particles at most 18 pt past it: the burst stays inside the row. */
const POP_RADIUS = 18;
const POP_REACH = 18;

export function LiveCookingRow({ kid, dish, step, total, onHeart, onPress, style }: LiveCookingRowProps) {
  const reduce = useReducedMotion();
  const title = liveTitle(kid.name, dish);
  const steps = stepLine(step, total);
  const [state, setState] = useState<HeartState>('idle');
  const [hearted, setHearted] = useState(false);
  const [pop, setPop] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const send = async () => {
    if (state === 'sending') return;
    if (timer.current) clearTimeout(timer.current);
    setState('sending');
    let next: HeartState = 'sent';
    try {
      await onHeart();
      haptic('success');
      setHearted(true);
      setPop((n) => n + 1);
    } catch {
      haptic('error');
      next = 'error';
    }
    AccessibilityInfo.announceForAccessibility?.(next === 'sent' ? 'Heart sent' : 'Didn’t send. Try again.');
    setState(next);
    timer.current = setTimeout(() => setState('idle'), LABEL_MS);
  };

  const label = state === 'sent' ? 'Sent' : state === 'error' ? 'Try again' : null;
  const words = (
    <>
      <Avatar profile={kid} size={40} />
      <View style={styles.text}>
        <Txt variant="rowTitle" leading={1.3} numberOfLines={2}>
          {title}
        </Txt>
        <View style={styles.live}>
          <LiveDot />
          <Animated.View key={`${step}/${total}`} entering={reduce ? undefined : FadeIn.duration(220)} style={styles.stepWrap}>
            <Txt variant="meta" size={15} weight={600} color={colors.greenDeep} numberOfLines={1} style={styles.tnum}>
              {steps}
            </Txt>
          </Animated.View>
          {label ? (
            // At the end of the step line, right beside the heart; inside the row, never in the layout's way.
            <Animated.View
              key={`${label}-${pop}`}
              pointerEvents="none"
              entering={reduce ? FadeIn.duration(150) : FadeInLeft.duration(220)}
              exiting={FadeOut.duration(180)}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={[styles.tag, state === 'error' ? styles.tagError : null]}>
              <Txt variant="label" size={13} weight={700} color={colors.card} numberOfLines={1}>
                {label}
              </Txt>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </>
  );

  return (
    <View style={[styles.row, style]}>
      {onPress ? (
        <PressableScale onPress={onPress} scaleTo={0.98} accessibilityLabel={`${title}. ${steps}`} style={styles.main}>
          {words}
        </PressableScale>
      ) : (
        <View style={styles.main} accessible accessibilityLabel={`${title}. ${steps}`}>
          {words}
        </View>
      )}
      <PressableScale
        onPress={send}
        haptic="light"
        disabled={state === 'sending'}
        accessibilityLabel={state === 'sent' ? `Heart sent to ${kid.name}` : `Send ${kid.name} a heart`}
        accessibilityHint={state === 'error' ? 'It didn’t send. Tap to try again.' : undefined}
        accessibilityState={{ busy: state === 'sending' }}
        style={[styles.heart, state === 'error' ? styles.heartError : null]}>
        <View style={state === 'sending' ? styles.dim : null}>
          <HeartIcon size={22} filled={hearted} color={colors.danger} strokeWidth={2.2} />
        </View>
        <HeartPop trigger={pop} radius={POP_RADIUS} reach={POP_REACH} />
      </PressableScale>
    </View>
  );
}

/** A small green dot that breathes while the session is live (steady under Reduce Motion). */
function LiveDot() {
  const reduce = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      glow.value = 1;
      return;
    }
    glow.value = withRepeat(withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
  }, [reduce, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, minWidth: 0, gap: 3 },
  // As tall as the tag, so "Sent" appearing never moves the row.
  live: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  stepWrap: { flexShrink: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  tnum: { fontVariant: ['tabular-nums'] },
  heart: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
  heartError: { backgroundColor: colors.butter },
  dim: { opacity: 0.5 },
  // Pushed to the end of the step line (right next to the heart); it never wraps.
  tag: { marginLeft: 'auto', flexShrink: 0, height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.ink, justifyContent: 'center' },
  tagError: { backgroundColor: colors.danger },
});
