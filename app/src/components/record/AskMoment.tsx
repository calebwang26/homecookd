// homie asks the cook something while she records (Caleb's v4, canvas frame 2): no buttons. Over the
// blurred, dimmed recording screen, one centred column: homie big and glowing (its steam follows her
// voice, its glow breathes; "AI voice" while it says the question), the question under it in her
// language (32 pt) with the English small, then five green listening bars that move with her voice
// and "बोला, मी ऐकतोय" / "Just answer out loud". She answers out loud: the service hears it, and fades
// the question when she says "not now" or after ~10 s of quiet (on the stories opt-in, quiet is a no).
// A tap anywhere closes it too ("not now"): the only way out without a mic stream (Expo Go, the web,
// where it says so), and an escape if the service never fades it. VoiceOver's escape gesture is the same.
// Motion (Caleb, Oct 24: "smooth, no jumps"; all on the UI thread): homie leaves its corner. 0-280 ms
// it glides from the resting pot's exact spot and size to the centre while the dim and a light blur come
// up (over 480 ms, so the background blurs in under the move); 280-560 ms it grows to full size and its
// disc warms from the resting cream to butter with the sun ring (a spring that settles without
// overshoot); from 560 ms the words rise under it. Closing plays it backwards and lands homie back on
// its corner, where the resting pot takes over under it before this one goes (no blink). The blur is
// lighter than the canvas's frames 2 and 4 (Caleb). Reduce Motion: everything fades in place (150 ms),
// nothing moves or loops.
// The shared HomieMoment (components/homie) has big buttons and a green listening pill; this screen
// needs neither, so it draws its own.
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

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
export const ASK_BLUR = 24;
export const ASK_TINT = 'rgba(30,36,16,0.5)';
const WHITE_SOFT = 'rgba(255,253,247,0.8)';
const GLIDE_MS = 280;
const DIM_MS = 480;
const GROW_AT = 280;
const RISE_AT = 560;
const RISE_MS = 320;
const CLOSE_MS = 440;
/** After landing back in the corner, this long with both pots there, so the resting one fades in under nothing. */
const HANDOFF_MS = 200;
const GROW = { damping: 26, stiffness: 170, mass: 1, overshootClamping: true };
const out = Easing.out(Easing.cubic);
const inOut = Easing.inOut(Easing.cubic);

type Spot = { x: number; y: number };

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

  // Where the big pot sits in the column (measured), so the glide ends exactly there.
  const [to, setTo] = useState<Spot | null>(null);

  const dim = useSharedValue(0);
  const glide = useSharedValue(0);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  const id = ask?.promptId ?? null;
  const measured = !!to;
  useEffect(() => {
    if (!id || !measured) return;
    haptic('light');
    if (reduce) {
      glide.set(1);
      grow.set(1);
      dim.set(withTiming(1, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(1, { duration: motion.reducedFadeMs }));
      return;
    }
    dim.set(withTiming(1, { duration: DIM_MS, easing: out }));
    glide.set(withTiming(1, { duration: GLIDE_MS, easing: out }));
    grow.set(withDelay(GROW_AT, withSpring(1, GROW)));
    rise.set(0);
    rise.set(withDelay(RISE_AT, withTiming(1, { duration: RISE_MS, easing: out })));
  }, [id, measured, reduce, dim, glide, grow, rise]);

  useEffect(() => {
    if (!closing) return;
    if (reduce) {
      dim.set(withTiming(0, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(0, { duration: motion.reducedFadeMs }));
    } else {
      rise.set(withTiming(0, { duration: 140 }));
      grow.set(withDelay(80, withTiming(0, { duration: 200, easing: inOut })));
      glide.set(withDelay(220, withTiming(0, { duration: 200, easing: inOut })));
      dim.set(withDelay(160, withTiming(0, { duration: 280, easing: inOut })));
    }
    const settle = reduce ? motion.reducedFadeMs + 20 : CLOSE_MS;
    const land = setTimeout(() => setLanded(true), settle);
    const gone = setTimeout(() => setShown(null), settle + (reduce ? 0 : HANDOFF_MS));
    return () => {
      clearTimeout(land);
      clearTimeout(gone);
    };
  }, [closing, reduce, dim, glide, grow, rise]);

  const question = ask?.text;
  useEffect(() => {
    if (question) AccessibilityInfo.announceForAccessibility(question);
  }, [question]);

  const blurProps = useAnimatedProps(() => ({ intensity: ASK_BLUR * dim.value }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const potStyle = useAnimatedStyle(() => {
    if (!to) return { opacity: 0 };
    if (reduce) return { opacity: dim.value, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const start = from.size / ASK_HOMIE_SIZE;
    const dx = from.x + from.size / 2 - (to.x + ASK_HOMIE_SIZE / 2);
    const dy = from.y + from.size / 2 - (to.y + ASK_HOMIE_SIZE / 2);
    return {
      opacity: 1,
      transform: [{ translateX: dx * (1 - glide.value) }, { translateY: dy * (1 - glide.value) }, { scale: start + (1 - start) * grow.value }],
    };
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
          <GlowHomie
            size={ASK_HOMIE_SIZE}
            state={talking ? pot : micOn ? 'listening' : 'off'}
            level={h.level}
            label={talking ? speakingLabel(h, now.key) : null}
            breathe={!closing}
            lit={grow}
          />
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
  tint: { backgroundColor: ASK_TINT },
  column: { flex: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  // Below the sun ring (18 pt round the disc), as far as the label is below the words.
  words: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 8 },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 10 },
});
