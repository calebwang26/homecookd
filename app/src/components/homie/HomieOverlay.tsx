// homie on every screen: mounted once in app/_layout, above the navigator. The pot rests top-right
// (just left of the profile face or Share where a screen has one; a screen can dock it elsewhere with
// useHomieScreen), not on sign-in, the launch gateway or link screens, and not before someone is in.
// Native Modals (sheets, the full-screen step player) cover it on their own. When homie needs you
// (store.moment), HomieMoment takes the pot to the centre.
// A tap on the resting pot says this screen's help line and shows it as a moment with one "OK",
// unless the screen gave the pot its own onPress.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { useHomieRoute } from '@/lib/homie/hooks';
import { HOMIE_REST_SIZE, potState, sayPhase, speakingLabel, timerProgress } from '@/lib/homie/logic';
import { closeMoment, doneSpeaking, getHomie, showMoment, useHomie, type Homie } from '@/lib/homie/store';
import { speak } from '@/lib/live/speak';
import { useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { colors, motion } from '@/theme/tokens';

import { HomieMoment } from './HomieMoment';
import { HomiePot } from './HomiePot';

const HELP_SHOWN_MS = 6000;
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

  // A say that stops playing (ended, stopped, failed) ends homie's speaking beat.
  const sayOn = say !== 'none';
  const wasOn = useRef(false);
  useEffect(() => {
    if (wasOn.current && !sayOn && getHomie().state === 'speaking') doneSpeaking();
    wasOn.current = sayOn;
  }, [sayOn]);

  const onPress = () => {
    if (h.onPress) return h.onPress();
    const line = route.help;
    const id = `help:${Date.now()}`;
    const moment = { id, question: line, options: [{ id: 'ok', label: 'OK', kind: 'primary' as const }], onChoose: () => {} };
    showMoment(moment);
    void speak(line, { translate: true, profileId: me?.id }).then((spoken) => {
      // Said in the person's language: show that, with the English under it.
      if (spoken.text && spoken.text !== line && getHomie().moment?.id === id) showMoment({ ...moment, question: spoken.text, questionEn: line });
    });
    setTimeout(() => closeMoment(id), HELP_SHOWN_MS);
  };

  const resting = !!me && !route.hidden && !h.hidden && !inMoment;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {me ? <RestingPot frame={frame} shown={resting} h={h} state={state} label={label} progress={progress} onPress={onPress} /> : null}
      <HomieMoment from={frame} state={state} level={h.level} label={label} onActive={setInMoment} />
    </View>
  );
}

function RestingPot({
  frame,
  shown,
  h,
  state,
  label,
  progress,
  onPress,
}: {
  frame: { x: number; y: number; size: number };
  shown: boolean;
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

  // A new screen's corner: a short glide (a fade under Reduce Motion).
  useEffect(() => {
    const move = { duration: MOVE_MS, easing: Easing.out(Easing.cubic) };
    x.set(reduce ? frame.x : withTiming(frame.x, move));
    y.set(reduce ? frame.y : withTiming(frame.y, move));
  }, [frame.x, frame.y, reduce, x, y]);

  // Back from a moment it lands exactly here, so it shows at once; anything else fades.
  useEffect(() => {
    opacity.set(withTiming(shown ? 1 : 0, { duration: motion.reducedFadeMs }));
  }, [shown, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: frame.size / HOMIE_REST_SIZE }],
  }));

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
  labelWrap: { position: 'absolute', top: HOMIE_REST_SIZE - 6, alignItems: 'center', width: 120 },
  label: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.lavender, overflow: 'hidden' },
});
