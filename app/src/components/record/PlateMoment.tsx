// homie's last ask when she filmed in the app: "Hold the plate up to the camera" (the voice service's
// {type:"ask", kind:"plate"}). The screen dims, the camera card grows into the middle (CameraCard `big`),
// homie's words sit above it and one big round shutter below: a tap takes the photo, which shows in the
// card ("Got it!") and becomes the recipe's cover (live.setCover). "Not now" skips it, and so does
// saying it (the service hears that). Two layers so the card sits between them: <PlateDim> under the
// card, <PlateControls> over it. Reduce Motion: fades only.
import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, PressableScale, Txt } from '@/components/ui';
import { colors, motion } from '@/theme/tokens';

import { plateFrame } from './CameraCard';
import { askLine, type Ask } from './recordingLogic';
import { COLUMN } from './RecordWash';
import type { RecordWords } from './words';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
// The same dim and blur as homie's questions (AskMoment).
const BLUR = 70;
const TINT = 'rgba(30,36,16,0.5)';
const SHUTTER = 84;
const WHITE_SOFT = 'rgba(255,253,247,0.8)';

function useShown(on: boolean) {
  const reduce = useReducedMotion();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, { duration: reduce ? motion.reducedFadeMs : 280 }));
  }, [on, reduce, v]);
  return v;
}

export function PlateDim({ on }: { on: boolean }) {
  const v = useShown(on);
  const blurProps = useAnimatedProps(() => ({ intensity: BLUR * v.value }));
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <AnimatedBlurView tint="dark" style={StyleSheet.absoluteFill} animatedProps={blurProps} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.tint, style]} />
    </View>
  );
}

export function PlateControls({ ask, words, taken, busy, onShoot, onSkip }: { ask: Ask | null; words: RecordWords; taken: boolean; busy: boolean; onShoot: () => void; onSkip: () => void }) {
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const v = useShown(!!ask);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  if (!ask) return null;
  const card = plateFrame(screen, COLUMN.side);
  const q = askLine(ask);
  const got = words.line('plateGot');
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="box-none" accessibilityViewIsModal onAccessibilityEscape={onSkip}>
      <View style={[styles.words, { top: Math.max(insets.top + 16, 40), height: Math.max(0, card.y - Math.max(insets.top + 16, 40) - 16) }]}>
        <Txt variant="label" size={24} weight={700} leading={1.3} color={colors.card} align="center" accessibilityRole="header" numberOfLines={4} adjustsFontSizeToFit>
          {taken ? got.text : q.text}
        </Txt>
        {(taken ? got.en : q.en) ? (
          <Txt variant="body" size={15} leading={1.35} color={WHITE_SOFT} align="center" numberOfLines={2}>
            {taken ? got.en : `“${q.en}”`}
          </Txt>
        ) : null}
      </View>
      {!taken ? (
        <View style={[styles.below, { top: card.y + card.height + 24 }]}>
          <PressableScale onPress={onShoot} disabled={busy} haptic="medium" scaleTo={0.94} accessibilityRole="button" accessibilityLabel={words.line('takePhoto').en ?? words.line('takePhoto').text} style={styles.shutter}>
            <View style={styles.shutterInner} />
          </PressableScale>
          <Txt variant="label" size={18} weight={700} color={colors.card} align="center">
            {words.line('takePhoto').text}
          </Txt>
          <ActionButton label={words.line('notNow').text} variant="glass" size="xs" onPress={onSkip} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tint: { backgroundColor: TINT },
  words: { position: 'absolute', left: COLUMN.side, right: COLUMN.side, justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  below: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 10 },
  shutter: { width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, borderWidth: 5, borderColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: SHUTTER - 18, height: SHUTTER - 18, borderRadius: (SHUTTER - 18) / 2, backgroundColor: colors.card },
});
