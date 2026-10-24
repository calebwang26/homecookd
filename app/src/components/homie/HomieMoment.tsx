// homie needs something from you (store.showMoment): the pot leaves its corner for the centre and
// grows, lit; the screen behind dims and really blurs; the question (big, white) and big buttons rise
// under it. Motion: 0-280 ms the pot glides to the centre while the dim starts; 280-560 ms it grows and
// glows (a spring that settles without overshoot); from 560 ms the words and buttons rise. Answering
// or "Not now" plays it backwards, and the pot lands back on its corner. Reduce Motion: the dim, pot
// and words fade in place (150 ms).
// The option with id 'not_now' (else 'ok') is also VoiceOver's escape gesture.
// When homie asks out loud (a moment with bars, a prompt or tapToClose; lib/homie isCentredMoment):
// no buttons, one centred column like Grandma's screens. The glowing pot (176, its glow breathing),
// 56 pt, the question (Fraunces 32), the five listening bars and "Say “yes” or “no”", then the small
// "Tap anywhere to close". A tap anywhere is "not now" (dismissMoment). At most one button, for a
// phone that can't hear the answer.
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic, MicIcon, PressableScale, Txt } from '@/components/ui';
import { ASK_SIDE, askFrame, isCentredMoment, momentFrame } from '@/lib/homie/logic';
import { chooseMoment, dismissMoment, useHomie, type HomieFrame, type HomieMoment as Moment, type HomieOption, type HomieState } from '@/lib/homie/store';
import { stopSpeaking } from '@/lib/live/speak';
import { alpha, colors, motion } from '@/theme/tokens';

import { HomiePot } from './HomiePot';
import { ListeningBars } from './ListeningBars';

// The blur's strength animates, not its opacity: iOS draws a fading blur view broken until it is opaque.
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const GLIDE_MS = 280;
const GROW_AT = 280;
const RISE_AT = 560;
const RISE_MS = 320;
const CLOSE_MS = 440;
/** Critically damped: settles on its size, never past it. */
const GROW = { damping: 26, stiffness: 170, mass: 1, overshootClamping: true };
const BLUR = 70;
const TINT = 'rgba(30,36,16,0.5)';
const WHITE = colors.card;
const WHITE_SOFT = 'rgba(255,253,247,0.78)';
const out = Easing.out(Easing.cubic);
const inOut = Easing.inOut(Easing.cubic);
/** The centred column's words before they are measured (a two-line question, the bars, the prompt). */
const WORDS_GUESS = 240;
const BREATH_MS = 1400;

type Props = {
  /** The resting pot's frame: where the glide starts and ends. */
  from: HomieFrame;
  state: HomieState;
  level: number;
  /** "AI voice" while homie says the question. */
  label: string | null;
  /** True from the first frame of opening to the last of closing (the resting pot hides meanwhile). */
  onActive: (on: boolean) => void;
};

export function HomieMoment({ from, state, level, label, onActive }: Props) {
  const { moment } = useHomie();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // The moment on screen: the store's, or the last one while it closes.
  const [shown, setShown] = useState<Moment | null>(moment);
  const closing = !moment && !!shown;
  if (moment && moment !== shown) setShown(moment);

  const centred = !!shown && isCentredMoment(shown);
  const [wordsH, setWordsH] = useState(0);
  const ask = askFrame({ width, height, insetsTop: insets.top, insetsBottom: insets.bottom }, wordsH || WORDS_GUESS);
  const to = centred ? ask.pot : momentFrame({ width, height, insetsTop: insets.top });

  const glide = useSharedValue(0);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  const dim = useSharedValue(0);
  const breath = useSharedValue(1);

  const active = !!shown;
  const activeRef = useRef(onActive);
  useEffect(() => {
    activeRef.current = onActive;
  });
  useEffect(() => {
    activeRef.current(active);
  }, [active]);

  const id = moment?.id ?? null;
  useEffect(() => {
    if (!id) return;
    haptic('light');
    if (reduce) {
      glide.set(1);
      grow.set(1);
      dim.set(withTiming(1, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(1, { duration: motion.reducedFadeMs }));
      return;
    }
    dim.set(withTiming(1, { duration: GLIDE_MS, easing: out }));
    glide.set(withTiming(1, { duration: GLIDE_MS, easing: out }));
    grow.set(withDelay(GROW_AT, withSpring(1, GROW)));
    rise.set(0);
    rise.set(withDelay(RISE_AT, withTiming(1, { duration: RISE_MS, easing: out })));
  }, [id, reduce, glide, grow, rise, dim]);

  useEffect(() => {
    if (!closing) return;
    if (reduce) {
      dim.set(withTiming(0, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(0, { duration: motion.reducedFadeMs }));
    } else {
      rise.set(withTiming(0, { duration: 140 }));
      grow.set(withDelay(80, withTiming(0, { duration: 200, easing: inOut })));
      glide.set(withDelay(220, withTiming(0, { duration: 200, easing: inOut })));
      dim.set(withDelay(220, withTiming(0, { duration: 200 })));
    }
    const t = setTimeout(() => setShown(null), reduce ? motion.reducedFadeMs + 20 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, reduce, glide, grow, rise, dim]);

  // The centred pot's glow breathes while it waits for an answer (still under Reduce Motion).
  const breathing = centred && !closing && !reduce;
  useEffect(() => {
    if (!breathing) {
      cancelAnimation(breath);
      breath.set(1);
      return;
    }
    breath.set(withRepeat(withSequence(withTiming(0.5, { duration: BREATH_MS, easing: inOut }), withTiming(1, { duration: BREATH_MS, easing: inOut })), -1, false));
  }, [breathing, breath]);

  // Screen readers hear the question once it is up.
  const question = moment?.question;
  const questionEn = moment?.questionEn;
  useEffect(() => {
    if (question) AccessibilityInfo.announceForAccessibility(questionEn ? `${question}. ${questionEn}` : question);
  }, [question, questionEn]);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const blurProps = useAnimatedProps(() => ({ intensity: BLUR * dim.value }));
  const potStyle = useAnimatedStyle(() => {
    const start = from.size / to.size;
    const scale = start + (1 - start) * grow.value;
    const dx = from.x + from.size / 2 - (to.x + to.size / 2);
    const dy = from.y + from.size / 2 - (to.y + to.size / 2);
    return {
      opacity: reduce ? dim.value : 1,
      transform: [{ translateX: dx * (1 - glide.value) }, { translateY: dy * (1 - glide.value) }, { scale }],
    };
  });
  const riseStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: reduce ? 0 : 16 * (1 - rise.value) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: grow.value * breath.value }));

  if (!shown) return null;

  const choose = (o: HomieOption) => {
    if (closing) return;
    if (!o.keepOpen) stopSpeaking();
    chooseMoment(o.id);
  };
  const dismiss = () => {
    if (closing) return;
    stopSpeaking();
    dismissMoment(shown.id);
  };
  const escape = shown.options.find((o) => o.id === 'not_now') ?? shown.options.find((o) => o.id === 'ok');
  const speaking = state === 'speaking';

  if (centred) {
    const listens = !!(shown.bars || shown.prompt);
    // The whole screen is the close button (its children stay separate for VoiceOver).
    return (
      <Pressable
        style={StyleSheet.absoluteFill}
        pointerEvents={closing ? 'none' : 'auto'}
        accessible={false}
        accessibilityViewIsModal
        disabled={!shown.tapToClose}
        onPress={dismiss}
        onAccessibilityEscape={escape ? () => choose(escape) : shown.tapToClose ? dismiss : undefined}>
        <AnimatedBlurView tint="dark" style={StyleSheet.absoluteFill} animatedProps={blurProps} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.tint, dimStyle]} />

        <Animated.View style={[styles.pot, { left: to.x, top: to.y, width: to.size, height: to.size }, potStyle]}>
          <Animated.View style={[styles.glow, { width: to.size, height: to.size, borderRadius: to.size / 2 }, glowStyle]} />
          <HomiePot state={speaking ? 'speaking' : 'lit'} level={level} size={to.size} shadow={false} />
          {speaking && label ? (
            <View style={styles.labelWrap}>
              <Txt variant="label" size={13} weight={700} color={colors.butterInk} style={styles.label}>
                {label}
              </Txt>
            </View>
          ) : null}
        </Animated.View>

        <Animated.View style={[styles.content, { top: ask.wordsTop, bottom: Math.max(16, insets.bottom + 8) }, riseStyle]}>
          <ScrollView contentContainerStyle={styles.askScroll} bounces={false} showsVerticalScrollIndicator={false} onContentSizeChange={(_, h) => setWordsH(Math.round(h))}>
            <Txt variant="display" size={32} leading={1.2} color={WHITE} align="center" accessibilityRole="header">
              {shown.question}
            </Txt>
            {shown.questionEn ? (
              <Txt variant="body" size={17} leading={1.35} color={WHITE_SOFT} align="center" style={styles.askEn}>
                {shown.questionEn}
              </Txt>
            ) : null}
            {listens ? (
              <View style={styles.askListen}>
                {shown.bars ? <ListeningBars level={level} /> : null}
                {shown.prompt ? (
                  <View style={styles.askPrompt}>
                    <Txt variant="label" size={22} weight={700} leading={1.25} color={WHITE} align="center">
                      {shown.prompt.label}
                    </Txt>
                    {shown.prompt.sublabel ? (
                      <Txt variant="meta" size={15} color={WHITE_SOFT} align="center">
                        {shown.prompt.sublabel}
                      </Txt>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            {shown.options.length ? (
              <View style={[styles.askOptions, { marginTop: listens ? 28 : 48 }]}>
                {shown.options.map((o) => (
                  <MomentButton key={o.id} option={o} onPress={() => choose(o)} />
                ))}
              </View>
            ) : null}
            {shown.tapToClose ? (
              <Txt variant="meta" size={15} color={WHITE_SOFT} align="center" style={styles.askClose} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close">
                {shown.tapToClose}
              </Txt>
            ) : null}
          </ScrollView>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={closing ? 'none' : 'auto'}
      accessibilityViewIsModal
      onAccessibilityEscape={escape ? () => choose(escape) : undefined}>
      <AnimatedBlurView tint="dark" style={StyleSheet.absoluteFill} animatedProps={blurProps} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.tint, dimStyle]} />

      <Animated.View style={[styles.pot, { left: to.x, top: to.y, width: to.size, height: to.size }, potStyle]}>
        <HomiePot state={speaking ? 'speaking' : 'lit'} level={level} size={to.size} shadow={false} />
        {speaking && label ? (
          <View style={styles.labelWrap}>
            <Txt variant="label" size={13} weight={700} color={colors.butterInk} style={styles.label}>
              {label}
            </Txt>
          </View>
        ) : null}
      </Animated.View>

      <Animated.View style={[styles.content, { top: to.y + to.size + 28, bottom: Math.max(16, insets.bottom + 8) }, riseStyle]}>
        <ScrollView contentContainerStyle={styles.scroll} bounces={false} showsVerticalScrollIndicator={false}>
          <Txt variant="display" size={30} leading={1.2} color={WHITE} align="center" accessibilityRole="header">
            {shown.question}
          </Txt>
          {shown.questionEn ? (
            <Txt variant="body" size={17} leading={1.35} color={WHITE_SOFT} align="center">
              {shown.questionEn}
            </Txt>
          ) : null}
          {shown.listening ? <ListeningBar {...shown.listening} /> : null}
          <View style={styles.options}>
            {shown.options.map((o) => (
              <MomentButton key={o.id} option={o} onPress={() => choose(o)} />
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function ListeningBar({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <View style={styles.listening} accessibilityRole="text" accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}>
      <MicIcon size={24} color={WHITE} strokeWidth={2.2} />
      <View style={styles.flex}>
        <Txt variant="title" size={18} color={WHITE}>
          {label}
        </Txt>
        {sublabel ? (
          <Txt variant="meta" size={14} color={WHITE_SOFT}>
            {sublabel}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

function MomentButton({ option, onPress }: { option: HomieOption; onPress: () => void }) {
  const primary = option.kind === 'primary';
  return (
    <PressableScale
      onPress={onPress}
      haptic={primary}
      accessibilityRole="button"
      accessibilityLabel={option.sublabel ? `${option.label}. ${option.sublabel}` : option.label}
      style={[styles.button, primary ? styles.primary : styles.secondary]}>
      <Txt variant="button" size={19} color={WHITE} align="center">
        {option.label}
      </Txt>
      {option.sublabel ? (
        <Txt variant="meta" size={14} color={WHITE_SOFT} align="center">
          {option.sublabel}
        </Txt>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tint: { backgroundColor: TINT },
  pot: { position: 'absolute', alignItems: 'center' },
  labelWrap: { position: 'absolute', bottom: -14, alignSelf: 'center' },
  label: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.butter, overflow: 'hidden' },
  content: { position: 'absolute', left: 0, right: 0 },
  scroll: { paddingHorizontal: 24, gap: 12, flexGrow: 1 },
  options: { gap: 12, marginTop: 12 },
  listening: {
    marginTop: 12,
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 30,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flex: { flex: 1 },
  button: { minHeight: 64, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2 },
  primary: { backgroundColor: colors.green },
  secondary: { backgroundColor: alpha.glassOnDark },
  // The centred column (the mockup's ring and glow around the pot: sun 28 %, then 55 % blurred).
  glow: { position: 'absolute', left: 0, top: 0, backgroundColor: colors.butter, boxShadow: '0 0 0 18px rgba(254,190,41,0.28), 0 0 70px rgba(254,190,41,0.55)' },
  askScroll: { paddingHorizontal: ASK_SIDE },
  askEn: { marginTop: 8 },
  askListen: { marginTop: 48, alignItems: 'center', gap: 16 },
  askPrompt: { alignItems: 'center', gap: 4 },
  askOptions: { gap: 12, width: '100%', maxWidth: 340, alignSelf: 'center' },
  askClose: { marginTop: 20, alignSelf: 'center', paddingVertical: 4 },
});
