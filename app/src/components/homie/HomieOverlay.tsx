// homie on every screen: mounted once in app/_layout, above the navigator. The pot rests top-right
// (just left of the profile face or Share where a screen has one), or in the middle of an even header
// row (a dish: Back and the heart); a screen can dock it elsewhere with useHomieScreen. Not on sign-in,
// the launch gateway or link screens, and not before someone is in.
// Native Modals (sheets, the full-screen step player) cover it on their own. When homie needs you
// (store.moment), HomieMoment takes the pot to the centre, and VoiceOver keeps to the moment (the
// overlay is modal then: the screen behind it is out of reach).
// A tap on the resting pot always says something (lib/homie/tap): what's new for this person, once
// (lib/homie/news keeps it ready; never while she films), else this screen's one line about its big
// button, and "I’m right here." on a second tap in a row, with "Hi, I’m homie." before the very first one (lib/homie/intro); unless the screen
// gave the pot its own onPress (and onLongPress). It's an answer to the tap, so it pauses a playing
// video. A screen can dock the pot somewhere else (cook mode: the middle of the bottom bar); low on the
// screen its label sits above it. The pot shows the same Siri-like states everywhere (HomiePot).
// Talking only
// (Caleb): no words on screen, the pot lights, its lid lifts and "AI voice" shows under it. While the
// cook's own voice plays (store `shrunk`) the resting pot shrinks a little about its centre.
// The pot is drawn at its real size (lib/homie HOMIE_SIZE: 48 in a header, 60 in cook mode's bar) and
// only ever scaled down, so it stays sharp when held.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { useHomieRoute } from '@/lib/homie/hooks';
import { takeTapLine } from '@/lib/homie/intro';
import { useHomieNews } from '@/lib/homie/news';
import { labelAbove, potState, sayPhase, shownFrame, SHRUNK_SCALE, speakingLabel, timerProgress } from '@/lib/homie/logic';
import { doneSpeaking, getHomie, useHomie, type Homie } from '@/lib/homie/store';
import { speak, stopSpeaking } from '@/lib/live/speak';
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

  // The tap line homie is saying (from the tap until the pot is quiet again): a tap meanwhile stops it,
  // instead of starting another.
  const tapLine = useRef(false);
  const voiced = state === 'lit' || state === 'speaking';
  useEffect(() => {
    if (!voiced) tapLine.current = false;
  }, [voiced]);
  const onPress = () => {
    if (h.onPress) return h.onPress();
    if (tapLine.current) {
      tapLine.current = false;
      return stopSpeaking();
    }
    tapLine.current = true;
    void takeTapLine(route, me?.id, news)
      .then((line) => speak(line, { translate: true, profileId: me?.id, answer: true }))
      .then((said) => {
        // Nothing was said (a newer line, or the tap that stopped it): the next tap speaks again.
        if (said.via === 'none') tapLine.current = false;
      });
  };

  const resting = !!me && !route.hidden && !h.hidden && !inMoment;
  // While a moment is up the overlay is modal: VoiceOver ignores its siblings, the app's screens
  // (iOS reads accessibilityViewIsModal; the web build reads aria-modal).
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal={inMoment} aria-modal={inMoment}>
      {me ? <RestingPot frame={frame} shown={resting} inMoment={inMoment} h={h} state={state} label={label} progress={progress} onPress={onPress} /> : null}
      {/* From where the pot really is (shrunk while her voice plays), so the moment never jumps. */}
      <HomieMoment from={shownFrame(frame, !!h.shrunk)} state={state} level={h.level} label={label} onActive={setInMoment} />
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

  const moveStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * (reduce ? 1 - 0.35 * small.value : 1),
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
  // Smaller about its centre, never bigger than it's drawn.
  const potStyle = useAnimatedStyle(() => ({ transform: [{ scale: reduce ? 1 : 1 - (1 - SHRUNK_SCALE) * small.value }] }));

  const { width: windowW, height: windowH } = useWindowDimensions();
  const above = labelAbove(frame, windowH);
  const centred = Math.abs(frame.x + frame.size / 2 - windowW / 2) < 1;
  const box = { width: frame.size, height: frame.size };
  const a11y = state === 'speaking' ? 'homie, speaking' : state === 'listening' ? 'homie, listening' : 'homie';
  const hint = h.onLongPress ? 'Ask anything. Touch and hold to turn the mic off or on.' : h.onPress ? undefined : 'Says what you can do here';
  return (
    <Animated.View style={[styles.rest, box, moveStyle]} pointerEvents={shown ? 'box-none' : 'none'}>
      <Animated.View style={[box, potStyle]}>
        <PressableScale
          onPress={onPress}
          onLongPress={h.onLongPress}
          delayLongPress={450}
          haptic
          accessibilityRole="button"
          accessibilityLabel={a11y}
          accessibilityHint={hint}
          accessibilityActions={h.onLongPress ? [{ name: 'longpress', label: 'Turn the mic off or on' }] : undefined}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && h.onLongPress?.()}
          style={[box, { borderRadius: frame.size / 2 }]}>
          <HomiePot state={state} level={h.level} size={frame.size} timerProgress={progress} />
        </PressableScale>
      </Animated.View>
      {label ? (
        <View
          style={
            above
              ? [styles.labelMid, { bottom: frame.size + 6, left: frame.size / 2 - LABEL_W / 2 }]
              : centred
                ? [styles.labelMid, { top: frame.size - 6, left: frame.size / 2 - LABEL_W / 2 }]
                : [styles.labelWrap, { top: frame.size - 6 }]
          }
          pointerEvents="none">
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

const LABEL_W = 220;

const styles = StyleSheet.create({
  rest: { position: 'absolute', left: 0, top: 0 },
  // Its right edge a little past the pot's, so "Translated from Grandma" grows left and stays on screen.
  labelWrap: { position: 'absolute', right: -8, alignItems: 'flex-end', width: LABEL_W },
  // Docked low (the bottom bar): centred above the pot; in the middle of a header: centred under it.
  labelMid: { position: 'absolute', alignItems: 'center', width: LABEL_W },
  label: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.lavender, overflow: 'hidden' },
});
