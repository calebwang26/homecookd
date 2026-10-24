// homie asks the cook something while she records (Caleb's v4): no buttons. Over the blurred, dimmed
// recording screen, one centred column (the COLUMN rhythm): the question in her language (32 pt) with
// the English under it, homie big and glowing (its steam follows her voice; "AI voice" while it says
// the question), then five listening bars and "बोला, मी ऐकतोय" / "Just answer out loud". She answers out
// loud: the service hears it, and fades the question when she says "not now" or after ~10 s of quiet
// (on the stories opt-in, quiet is a no). Without a mic stream (Expo Go, the web) a tap anywhere closes
// it instead. VoiceOver's escape gesture is "not now".
// Motion: the dim and blur come up while homie grows in (0-400 ms), then the words rise; closing plays
// it backwards. Reduce Motion: everything fades in place (150 ms).
// The shared HomieMoment (components/homie) has big buttons and a green listening pill; this screen
// needs neither, so it draws its own.
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { haptic, Txt } from '@/components/ui';
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
const BLUR = 70;
const TINT = 'rgba(30,36,16,0.5)';
const WHITE_SOFT = 'rgba(255,253,247,0.8)';
const OPEN_MS = 280;
const RISE_AT = 400;
const CLOSE_MS = 440;
const GROW = { damping: 26, stiffness: 170, mass: 1, overshootClamping: true };
const out = Easing.out(Easing.cubic);

export function AskMoment({ ask, words, micOn, onNotNow, onActive }: { ask: Ask | null; words: RecordWords; micOn: boolean; onNotNow: () => void; onActive: (on: boolean) => void }) {
  const reduce = useReducedMotion();
  const h = useHomie();
  const now = useNowPlaying();

  // The question on screen: the hook's, or the last one while it fades.
  const [shown, setShown] = useState<Ask | null>(ask);
  const closing = !ask && !!shown;
  if (ask && ask !== shown) setShown(ask);

  const active = useRef(onActive);
  useEffect(() => {
    active.current = onActive;
  });
  const on = !!shown;
  useEffect(() => active.current(on), [on]);

  const dim = useSharedValue(0);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  const id = ask?.promptId ?? null;
  useEffect(() => {
    if (!id) return;
    haptic('light');
    if (reduce) {
      grow.set(1);
      dim.set(withTiming(1, { duration: motion.reducedFadeMs }));
      rise.set(withTiming(1, { duration: motion.reducedFadeMs }));
      return;
    }
    dim.set(withTiming(1, { duration: OPEN_MS, easing: out }));
    grow.set(withSpring(1, GROW));
    rise.set(0);
    rise.set(withDelay(RISE_AT, withTiming(1, { duration: 320, easing: out })));
  }, [id, reduce, dim, grow, rise]);

  useEffect(() => {
    if (!closing) return;
    const fast = { duration: reduce ? motion.reducedFadeMs : 200 };
    rise.set(withTiming(0, { duration: reduce ? motion.reducedFadeMs : 140 }));
    grow.set(reduce ? 1 : withDelay(80, withTiming(0, fast)));
    dim.set(reduce ? withTiming(0, fast) : withDelay(220, withTiming(0, fast)));
    const t = setTimeout(() => setShown(null), reduce ? motion.reducedFadeMs + 20 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, reduce, dim, grow, rise]);

  const question = ask?.text;
  useEffect(() => {
    if (question) AccessibilityInfo.announceForAccessibility(question);
  }, [question]);

  const blurProps = useAnimatedProps(() => ({ intensity: BLUR * dim.value }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const potStyle = useAnimatedStyle(() => ({ opacity: reduce ? dim.value : Math.min(1, grow.value * 1.5), transform: [{ scale: reduce ? 1 : 0.35 + 0.65 * grow.value }] }));
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
      <Pressable style={styles.column} onPress={micOn ? undefined : onNotNow} accessible={false}>
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
        <Animated.View style={[styles.hero, potStyle]}>
          <GlowHomie size={ASK_HOMIE_SIZE} state={talking ? pot : micOn ? 'listening' : 'off'} level={h.level} label={talking ? speakingLabel(h, now.key) : null} />
        </Animated.View>
        <Animated.View style={[styles.label, riseStyle]} accessible accessibilityLabel={hint.en ? `${hint.text}. ${hint.en}` : hint.text}>
          {micOn ? <ListeningBars level={talking ? 0 : h.level} color={colors.card} /> : null}
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
  words: { alignItems: 'center', gap: 8 },
  hero: { marginTop: COLUMN.toHero },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 8 },
});
