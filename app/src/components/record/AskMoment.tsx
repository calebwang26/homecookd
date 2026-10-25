// homie asks the cook something while she records (Caleb's v4, canvas frame 2): no buttons. Over the
// blurred, dimmed recording screen, one column: homie big, in its Siri-like states (the ring while it
// listens; "AI voice" while it says the question), the question under it in her language (32 pt) with
// the English small, then five green listening bars that move with her voice and "बोला, मी ऐकतोय" /
// "Just answer out loud". She answers out loud: the service hears it, and fades the question when she
// says "not now" or after ~10 s of quiet (on the stories opt-in, quiet is a no). A tap anywhere closes
// it too ("not now"): the only way out without a mic stream (Expo Go, the web, where it says so), and
// an escape if the service never fades it. VoiceOver's escape gesture is the same.
// Held (Oct 25, Caleb: "homie should STAY in center expanded view until all questions are finished"):
// the wrap-up's voice service holds homie here across its run of questions ({type:"hold"}; what shows
// is recordingLogic momentView). homie never shrinks or moves between two questions: only the words
// under it change, crossfading in place (the old ones fade out, the next fade in; the bars and "Just
// answer out loud" go with the question). Between questions homie stays big, thinking, talking or
// listening, with the line it is saying (the count line, a let-off) or nothing under it, and a tap does
// nothing. It goes back to the corner once the hold is off and no question is up. homie sits at a fixed
// height (TOP), so a longer question only reaches further down.
// Motion (Caleb, Oct 24: smooth, and less blur than the canvas's frames 2 and 4), all on the UI thread:
// homie leaves its corner from the resting pot's exact spot and size, and the glide, the growth and the
// light blur run together as one move (420 ms, easing out, no overshoot), like cook mode's HomieMoment;
// from 300 ms the words rise under it. Closing plays it backwards in one move and lands homie back on its
// corner, where the resting pot fades in under it before this one goes (no blink); a hold that comes back
// meanwhile turns it round from where it is. Reduce Motion: everything fades in place (150 ms), the
// words too, and nothing moves or loops.
// The shared HomieMoment (components/homie) has big buttons and a green listening pill; this screen
// needs neither, so it draws its own.
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptic, Txt } from '@/components/ui';
import { useHomieSlot } from '@/lib/homie/hooks';
import { potState, sayPhase, speakingLabel } from '@/lib/homie/logic';
import { useHomie } from '@/lib/homie/store';
import { useNowPlaying } from '@/lib/media';
import { colors, motion } from '@/theme/tokens';

import { GlowHomie } from './GlowHomie';
import { ListeningBars } from './ListeningBars';
import type { MomentView } from './recordingLogic';
import { COLUMN } from './RecordWash';
import type { Line, RecordWords } from './words';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export const ASK_HOMIE_SIZE = 176;
/** homie's place: the bottom of the top 42% of the screen (about where a two-line question centred it). */
const TOP = 0.42;
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
/** The words changing while homie stays: the old ones fade out, the new ones fade in from WORDS_IN_AT. */
const WORDS_OUT_MS = 220;
const WORDS_IN_AT = 160;
const WORDS_IN_MS = 320;
const out = Easing.out(Easing.cubic);
const inOut = Easing.inOut(Easing.cubic);
/** One curve for the move, the size and the blur (the same as HomieMoment's). */
const move = Easing.bezier(0.2, 0.8, 0.2, 1);

/** What one of the two word layers shows: the question (with the bars and the hint) or homie's line. */
type Slot = { key: string; line: Line; asking: boolean } | null;
const slotOf = (view: MomentView): Slot => (view.words ? { ...view.words, asking: view.asking } : null);

export function AskMoment({ view, words, micOn, onNotNow, onActive }: { view: MomentView; words: RecordWords; micOn: boolean; onNotNow: () => void; onActive: (on: boolean) => void }) {
  const reduce = useReducedMotion();
  const h = useHomie();
  const now = useNowPlaying();
  const from = useHomieSlot();
  const open = view.open;

  // Drawn from the first frame it opens until it has gone back to the corner.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const closing = !open && mounted;
  // The corner pot stays hidden from the first frame until this one has landed back on it.
  const [landed, setLanded] = useState(!open);
  if (open && landed) setLanded(false);

  const active = useRef(onActive);
  useEffect(() => {
    active.current = onActive;
  });
  const on = !landed;
  useEffect(() => active.current(on), [on]);

  // The words: two layers in the same place, so a change crossfades. New words go into the layer that
  // has faded out. While it closes they stay as they were, and leave with homie.
  const [slots, setSlots] = useState<[Slot, Slot]>([null, null]);
  const [cur, setCur] = useState<0 | 1>(0);
  const [turn, setTurn] = useState(0);
  const nextKey = view.words?.key ?? null;
  if (open && nextKey !== (slots[cur]?.key ?? null)) {
    const n = cur === 0 ? 1 : 0;
    const next: [Slot, Slot] = [slots[0], slots[1]];
    next[n] = slotOf(view);
    setSlots(next);
    setCur(n);
    setTurn((t) => t + 1);
  }
  const v0 = useSharedValue(0);
  const v1 = useSharedValue(0);
  useEffect(() => {
    if (!turn) return;
    const [inV, outV] = cur === 0 ? [v0, v1] : [v1, v0];
    outV.set(withTiming(0, { duration: reduce ? motion.reducedFadeMs : WORDS_OUT_MS, easing: inOut }));
    inV.set(reduce ? withTiming(1, { duration: motion.reducedFadeMs }) : withDelay(WORDS_IN_AT, withTiming(1, { duration: WORDS_IN_MS, easing: out })));
  }, [turn, cur, reduce, v0, v1]);

  // Where the big pot sits (measured), so the move ends exactly there.
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const measured = !!to;

  const dim = useSharedValue(0);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  useEffect(() => {
    if (!open || !measured) return;
    if (reduce) {
      grow.set(1);
      dim.set(withTiming(1, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(1, { duration: motion.reducedFadeMs }));
      return;
    }
    // From where it is: 0 when it opens, part way when a hold comes back while homie heads for the corner.
    const fresh = grow.get() < 0.01;
    const together = { duration: OPEN_MS, easing: move };
    dim.set(withTiming(1, together));
    grow.set(withTiming(1, together));
    rise.set(withDelay(fresh ? RISE_AT : 0, withTiming(1, { duration: 300, easing: out })));
  }, [open, measured, reduce, dim, grow, rise]);

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
    const gone = setTimeout(
      () => {
        setMounted(false);
        // Next time it opens on fresh words, never on these.
        setSlots([null, null]);
        v0.set(0);
        v1.set(0);
      },
      settle + (reduce ? 0 : HANDOFF_MS),
    );
    return () => {
      clearTimeout(land);
      clearTimeout(gone);
    };
  }, [closing, reduce, dim, grow, rise, v0, v1]);

  // A light tap and VoiceOver's reading for each new question.
  const askKey = open && view.asking ? nextKey : null;
  const question = open && view.asking ? view.words?.line.text : undefined;
  useEffect(() => {
    if (askKey) haptic('light');
  }, [askKey]);
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

  if (!mounted) return null;

  const say = sayPhase(now.key, now.phase);
  const pot = potState(h, say);
  const talking = pot === 'speaking' || pot === 'lit';
  const hint = micOn ? words.line('listening') : words.line('tapToClose');
  // Only a question can be closed: while homie is merely held, a tap does nothing.
  const notNow = open && view.asking ? onNotNow : undefined;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={closing ? 'none' : 'auto'} accessibilityViewIsModal onAccessibilityEscape={notNow}>
      <AnimatedBlurView tint="dark" style={StyleSheet.absoluteFill} animatedProps={blurProps} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.tint, dimStyle]} />
      <Pressable style={styles.column} onPress={notNow} accessible={false}>
        <View style={styles.top}>
          <Animated.View
            style={potStyle}
            onLayout={(e) => {
              const { x, y } = e.nativeEvent.layout;
              if (!to || Math.abs(to.x - x) > 0.5 || Math.abs(to.y - y) > 0.5) setTo({ x, y });
            }}>
            <GlowHomie
              size={ASK_HOMIE_SIZE}
              state={talking ? pot : pot === 'thinking' ? 'thinking' : micOn ? 'listening' : 'off'}
              level={h.level}
              label={talking ? speakingLabel(h, now.key) : null}
            />
          </Animated.View>
        </View>
        <Animated.View style={[styles.below, riseStyle]}>
          {slots.map((slot, i) => (
            <WordsLayer key={i} slot={slot} v={i === 0 ? v0 : v1} current={i === cur} hint={hint} micOn={micOn} level={talking ? 0 : h.level} />
          ))}
        </Animated.View>
      </Pressable>
    </View>
  );
}

function WordsLayer({ slot, v, current, hint, micOn, level }: { slot: Slot; v: SharedValue<number>; current: boolean; hint: Line; micOn: boolean; level: number }) {
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  if (!slot) return null;
  const { line, asking } = slot;
  return (
    <Animated.View style={[styles.layer, style]} pointerEvents="none" accessibilityElementsHidden={!current} importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}>
      <View style={styles.words}>
        {/* A question is the big line; homie's own line between questions is a little quieter. */}
        <Txt variant="label" size={asking ? 32 : 26} weight={asking ? 700 : 600} leading={1.3} color={colors.card} align="center" accessibilityRole={asking ? 'header' : undefined}>
          {line.text}
        </Txt>
        {line.en ? (
          <Txt variant="body" size={16} leading={1.35} color={WHITE_SOFT} align="center">
            “{line.en}”
          </Txt>
        ) : null}
      </View>
      {asking ? (
        <View style={styles.label} accessible accessibilityLabel={hint.en ? `${hint.text}. ${hint.en}` : hint.text}>
          {micOn ? <ListeningBars level={level} color={colors.limeWash} /> : null}
          <Txt variant="label" size={24} weight={700} color={colors.card} align="center">
            {hint.text}
          </Txt>
          {hint.en ? (
            <Txt variant="meta" size={15} color={WHITE_SOFT} align="center">
              {hint.en}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tint: { backgroundColor: TINT },
  column: { flex: 1 },
  // homie at the bottom of the top part, whatever the words under it: it never moves while held.
  top: { flex: TOP, alignItems: 'center', justifyContent: 'flex-end' },
  below: { flex: 1 - TOP },
  // Below the sun ring (18 pt round the disc), as far as the label is below the words.
  layer: { position: 'absolute', top: COLUMN.toLabel, left: COLUMN.side, right: COLUMN.side, alignItems: 'center' },
  words: { alignItems: 'center', gap: 8 },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 10 },
});
