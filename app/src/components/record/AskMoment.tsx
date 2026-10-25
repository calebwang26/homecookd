// homie asks the cook something while she records (Caleb's v4, canvas frame 2): no buttons. Over the
// blurred, dimmed recording screen, one centred column: homie big and glowing (its steam follows her
// voice, its glow breathes; "AI voice" while it says the question), the question under it in her
// language (32 pt) with the English small, then five green listening bars that move with her voice
// and "बोला, मी ऐकतोय" / "Just answer out loud". She answers out loud: the service hears it, and fades
// the question when she says "not now" or after ~10 s of quiet (on the stories opt-in, quiet is a no).
// A tap anywhere closes it too ("not now"): the only way out without a mic stream (Expo Go, the web,
// where it says so), and an escape if the service never fades it. VoiceOver's escape gesture is the same.
// Motion (Caleb, Oct 24: smooth, and less blur than the canvas's frames 2 and 4), all on the UI thread:
// homie leaves its corner from the resting pot's exact spot and size, and the glide, the growth and the
// light blur run together as one move (420 ms, easing out, no overshoot), like cook mode's HomieMoment;
// from 300 ms the words rise under it. Closing plays it backwards in one move and lands homie back on its
// corner, where the resting pot fades in under it before this one goes (no blink). Reduce Motion:
// everything fades in place (150 ms), nothing moves or loops.
// The shared HomieMoment (components/homie) has big buttons and a green listening pill; this screen
// needs neither, so it draws its own.
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { haptic, Txt } from '@/components/ui';
import { useHomieSlot } from '@/lib/homie/hooks';
import { potState, sayPhase, speakingLabel } from '@/lib/homie/logic';
import { useHomie } from '@/lib/homie/store';
import { useNowPlaying } from '@/lib/media';
import { colors, motion } from '@/theme/tokens';

import { GlowHomie } from './GlowHomie';
import { ListeningBars } from './ListeningBars';
import { askLine, type Ask } from './recordingLogic';
import { COLUMN } from './RecordWash';
import type { RecordWords } from './words';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export const ASK_HOMIE_SIZE = 176;
/** expo-blur intensity: light, so the kitchen still reads behind homie (was 70). */
const BLUR = 30;
const TINT = 'rgba(30,36,16,0.5)';
const WHITE_SOFT = 'rgba(255,253,247,0.8)';
const OPEN_MS = 420;
const RISE_AT = 300;
const CLOSE_AT = 80;
const CLOSE_MOVE_MS = 300;
const CLOSE_MS = CLOSE_AT + CLOSE_MOVE_MS + 20;
/** Landed back on the corner: both pots there this long, so the resting one fades in under this one. */
const HANDOFF_MS = 200;
const out = Easing.out(Easing.cubic);
const inOut = Easing.inOut(Easing.cubic);
/** One curve for the move, the size and the blur (the same as HomieMoment's). */
const move = Easing.bezier(0.2, 0.8, 0.2, 1);

export function AskMoment({ ask, words, micOn, onNotNow, onActive }: { ask: Ask | null; words: RecordWords; micOn: boolean; onNotNow: () => void; onActive: (on: boolean) => void }) {
  const reduce = useReducedMotion();
  const h = useHomie();
  const now = useNowPlaying();
  const from = useHomieSlot();

  // The question on screen: the hook's, or the last one while it fades.
  const [shown, setShown] = useState<Ask | null>(ask);
  const closing = !ask && !!shown;
  if (ask && ask !== shown) setShown(ask);
  // The corner pot stays hidden from the first frame until this one has landed back on it.
  const [landed, setLanded] = useState(true);
  if (ask && landed) setLanded(false);

  const active = useRef(onActive);
  useEffect(() => {
    active.current = onActive;
  });
  const on = !landed;
  useEffect(() => active.current(on), [on]);

  // Where the big pot sits in the column (measured), so the move ends exactly there.
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const measured = !!to;

  const dim = useSharedValue(0);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  const id = ask?.promptId ?? null;
  useEffect(() => {
    if (!id || !measured) return;
    haptic('light');
    if (reduce) {
      grow.set(1);
      dim.set(withTiming(1, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(1, { duration: motion.reducedFadeMs }));
      return;
    }
    const together = { duration: OPEN_MS, easing: move };
    dim.set(withTiming(1, together));
    grow.set(withTiming(1, together));
    rise.set(0);
    rise.set(withDelay(RISE_AT, withTiming(1, { duration: 300, easing: out })));
  }, [id, measured, reduce, dim, grow, rise]);

  useEffect(() => {
    if (!closing) return;
    if (reduce) {
      dim.set(withTiming(0, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(0, { duration: motion.reducedFadeMs }));
    } else {
      rise.set(withTiming(0, { duration: 120 }));
      const back = { duration: CLOSE_MOVE_MS, easing: inOut };
      grow.set(withDelay(CLOSE_AT, withTiming(0, back)));
      dim.set(withDelay(CLOSE_AT, withTiming(0, back)));
    }
    const settle = reduce ? motion.reducedFadeMs + 20 : CLOSE_MS;
    const land = setTimeout(() => setLanded(true), settle);
    const gone = setTimeout(() => setShown(null), settle + (reduce ? 0 : HANDOFF_MS));
    return () => {
      clearTimeout(land);
      clearTimeout(gone);
    };
  }, [closing, reduce, dim, grow, rise]);

  const question = ask?.text;
  useEffect(() => {
    if (question) AccessibilityInfo.announceForAccessibility(question);
  }, [question]);

  const blurProps = useAnimatedProps(() => ({ intensity: BLUR * dim.value }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  // One value moves it: from the corner pot's centre and size to its place in the column.
  const potStyle = useAnimatedStyle(() => {
    if (!to) return { opacity: 0 };
    if (reduce) return { opacity: dim.value };
    const start = from.size / ASK_HOMIE_SIZE;
    const dx = from.x + from.size / 2 - (to.x + ASK_HOMIE_SIZE / 2);
    const dy = from.y + from.size / 2 - (to.y + ASK_HOMIE_SIZE / 2);
    const t = grow.value;
    return { opacity: 1, transform: [{ translateX: dx * (1 - t) }, { translateY: dy * (1 - t) }, { scale: start + (1 - start) * t }] };
  });
  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: reduce ? 0 : 16 * (1 - rise.value) }] }));

  if (!shown) return null;

  const say = sayPhase(now.key, now.phase);
  const pot = potState(h, say);
  const talking = pot === 'speaking' || pot === 'lit';
  const q = askLine(shown);
  const hint = micOn ? words.line('listening') : words.line('tapToClose');

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={closing ? 'none' : 'auto'}
      accessibilityViewIsModal
      onAccessibilityEscape={onNotNow}>
      <AnimatedBlurView tint="dark" style={StyleSheet.absoluteFill} animatedProps={blurProps} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.tint, dimStyle]} />
      <Pressable style={styles.column} onPress={onNotNow} accessible={false}>
        <Animated.View
          style={potStyle}
          onLayout={(e) => {
            const { x, y } = e.nativeEvent.layout;
            if (!to || Math.abs(to.x - x) > 0.5 || Math.abs(to.y - y) > 0.5) setTo({ x, y });
          }}>
          <GlowHomie size={ASK_HOMIE_SIZE} state={talking ? pot : micOn ? 'listening' : 'off'} level={h.level} label={talking ? speakingLabel(h, now.key) : null} breathe={!closing} />
        </Animated.View>
        <Animated.View style={[styles.words, riseStyle]}>
          <Txt variant="label" size={32} weight={700} leading={1.3} color={colors.card} align="center" accessibilityRole="header">
            {q.text}
          </Txt>
          {q.en ? (
            <Txt variant="body" size={16} leading={1.35} color={WHITE_SOFT} align="center">
              “{q.en}”
            </Txt>
          ) : null}
        </Animated.View>
        <Animated.View style={[styles.label, riseStyle]} accessible accessibilityLabel={hint.en ? `${hint.text}. ${hint.en}` : hint.text}>
          {micOn ? <ListeningBars level={talking ? 0 : h.level} color={colors.limeWash} /> : null}
          <Txt variant="label" size={24} weight={700} color={colors.card} align="center">
            {hint.text}
          </Txt>
          {hint.en ? (
            <Txt variant="meta" size={15} color={WHITE_SOFT} align="center">
              {hint.en}
            </Txt>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tint: { backgroundColor: TINT },
  column: { flex: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  // Below the sun ring (18 pt round the disc), as far as the label is below the words.
  words: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 8 },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 10 },
});
