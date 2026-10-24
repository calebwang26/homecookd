// homie on every screen: mounted once in app/_layout, above the navigator. The pot rests top-right
// (just left of the profile face or Share where a screen has one; a screen can dock it elsewhere with
// useHomieScreen), not on sign-in, the launch gateway or link screens, and not before someone is in.
// Native Modals (sheets, the full-screen step player) cover it on their own. When homie needs you
// (store.moment), HomieMoment takes the pot to the centre, and VoiceOver keeps to the moment (the
// overlay is modal then: the screen behind it is out of reach).
// A tap on the resting pot always says something (lib/homie/tap): what's new for this person, once
// (lib/homie/news keeps it ready), else this screen's "Explore X by doing X" line, never the same line
// twice in a row, with "Hi, I’m homie." before the very first one (lib/homie/intro); unless the screen
// gave the pot its own onPress. It's an answer to the tap, so it pauses a playing video. Talking only
// (Caleb): no words on screen, the pot lights, its lid lifts and "AI voice" shows under it. While the
// cook's own voice plays (store `shrunk`) the resting pot shrinks a little about its centre.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { useHomieRoute } from '@/lib/homie/hooks';
import { takeTapLine } from '@/lib/homie/intro';
import { useHomieNews } from '@/lib/homie/news';
import { HOMIE_REST_SIZE, potState, sayPhase, SHRUNK_SCALE, speakingLabel, timerProgress } from '@/lib/homie/logic';
import { doneSpeaking, getHomie, useHomie, type Homie } from '@/lib/homie/store';
import { speak } from '@/lib/live/speak';
import { useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { colors, motion } from '@/theme/tokens';

import { HomieMoment } from './HomieMoment';
import { HomiePot } from './HomiePot';

const MOVE_MS = 240;

export function HomieOverlay() {
  const h = useHomie();
  const { me } = useSession();
  const { route, frame: rest } = useHomieRoute();
  const now = useNowPlaying();
  const say = sayPhase(now.key, now.phase);
  const state = potState(h, say);
  const label = state === 'speaking' ? speakingLabel(h, now.key) : null;
  const frame = h.dock ?? rest;
  const progress = useTimerProgress(h.timer);
  const [inMoment, setInMoment] = useState(false);
  const news = useHomieNews();

  // A say that stops playing (ended, stopped, failed) ends homie's speaking beat.
  const sayOn = say !== 'none';
  const wasOn = useRef(false);
  useEffect(() => {
    if (wasOn.current && !sayOn && getHomie().state === 'speaking') doneSpeaking();
    wasOn.current = sayOn;
  }, [sayOn]);

  const onPress = () => {
    if (h.onPress) return h.onPress();
    void takeTapLine(route, me?.id, news).then((line) => speak(line, { translate: true, profileId: me?.id, answer: true }));
  };

  const resting = !!me && !route.hidden && !h.hidden && !inMoment;
  // While a moment is up the overlay is modal: VoiceOver ignores its siblings, the app's screens
  // (iOS reads accessibilityViewIsModal; the web build reads aria-modal).
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal={inMoment} aria-modal={inMoment}>
      {me ? <RestingPot frame={frame} shown={resting} inMoment={inMoment} h={h} state={state} label={label} progress={progress} onPress={onPress} /> : null}
      <HomieMoment from={frame} state={state} level={h.level} label={label} onActive={setInMoment} />
    </View>
  );
}

function RestingPot({
  frame,
  shown,
  inMoment,
  h,
  state,
  label,
  progress,
  onPress,
}: {
  frame: { x: number; y: number; size: number };
  shown: boolean;
  /** A moment has the pot (it lands back here when the moment closes). */
  inMoment: boolean;
  h: Homie;
  state: Homie['state'];
  label: string | null;
  progress: number | null;
  onPress: () => void;
}) {
  const reduce = useReducedMotion();
  const x = useSharedValue(frame.x);
  const y = useSharedValue(frame.y);
  const opacity = useSharedValue(shown ? 1 : 0);
  // The cook's own voice is playing: homie steps back (smaller; under Reduce Motion, fainter).
  const small = useSharedValue(h.shrunk ? 1 : 0);
  const shrunk = !!h.shrunk;
  useEffect(() => {
    small.set(withTiming(shrunk ? 1 : 0, reduce ? { duration: motion.reducedFadeMs } : { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [shrunk, reduce, small]);

  // A new screen's corner: a short glide (a fade under Reduce Motion).
  useEffect(() => {
    const move = { duration: MOVE_MS, easing: Easing.out(Easing.cubic) };
    x.set(reduce ? frame.x : withTiming(frame.x, move));
    y.set(reduce ? frame.y : withTiming(frame.y, move));
  }, [frame.x, frame.y, reduce, x, y]);

  // Back from a moment it lands exactly here, so it shows at once (no blink); a screen that hides or
  // shows the pot fades it.
  const wasInMoment = useRef(inMoment);
  useEffect(() => {
    if (shown && wasInMoment.current) opacity.set(1);
    else opacity.set(withTiming(shown ? 1 : 0, { duration: motion.reducedFadeMs }));
    wasInMoment.current = inMoment;
  }, [shown, inMoment, opacity]);

  const style = useAnimatedStyle(() => {
    // Scaled about its centre (the box scales from its top left).
    const s = reduce ? 1 : 1 - (1 - SHRUNK_SCALE) * small.value;
    const inset = ((1 - s) * frame.size) / 2;
    return {
      opacity: opacity.value * (reduce ? 1 - 0.35 * small.value : 1),
      transform: [{ translateX: x.value + inset }, { translateY: y.value + inset }, { scale: (frame.size / HOMIE_REST_SIZE) * s }],
    };
  });

  const a11y = state === 'speaking' ? 'homie, speaking' : state === 'listening' ? 'homie, listening' : 'homie';
  return (
    <Animated.View style={[styles.rest, style]} pointerEvents={shown ? 'box-none' : 'none'}>
      <PressableScale
        onPress={onPress}
        haptic
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={h.onPress ? undefined : 'Says what you can do here'}
        style={styles.press}>
        <HomiePot state={state} level={h.level} size={HOMIE_REST_SIZE} timerProgress={progress} />
      </PressableScale>
      {label ? (
        <View style={styles.labelWrap} pointerEvents="none">
          <Txt variant="caption" size={11} weight={700} color={colors.lavenderInk} numberOfLines={1} style={styles.label}>
            {label}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  );
}

/** 1 -> 0 while a timer runs, ticking each second; null without one. */
function useTimerProgress(timer: Homie['timer']): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [timer]);
  return timer ? timerProgress(timer, now) : null;
}

const styles = StyleSheet.create({
  rest: { position: 'absolute', left: 0, top: 0, width: HOMIE_REST_SIZE, height: HOMIE_REST_SIZE, alignItems: 'center', transformOrigin: 'top left' },
  press: { width: HOMIE_REST_SIZE, height: HOMIE_REST_SIZE, borderRadius: HOMIE_REST_SIZE / 2 },
  // Its right edge a little past the pot's, so "Translated from Grandma" grows left and stays on screen.
  labelWrap: { position: 'absolute', top: HOMIE_REST_SIZE - 6, right: -8, alignItems: 'flex-end', width: 220 },
  label: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.lavender, overflow: 'hidden' },
});
