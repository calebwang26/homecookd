// The bible's big pill button ("Start cooking", "Answer with your voice", "Send to Leo") with the
// motion spec 5 states: idle -> pressed (scale 0.96, dims) -> loading (spinner replaces the label,
// width locked, 180 ms crossfade, at least 450 ms) -> success | error.
//
// Give it an async `onPress` and it runs the whole cycle itself; or drive it with `state`.
// `loadingLabel` (retention PR 7) puts a word beside the spinner while it works (Send: "Wrapping…").
// The screen reader hears it too: it becomes the button's label while loading, and VoiceOver is told
// once (the live region beside the spinner only speaks on Android and the web).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { alpha, colors, motion, shadows } from '@/theme/tokens';

import { haptic } from './haptics';
import { CheckIcon } from './icons';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type ActionState = 'idle' | 'loading' | 'success' | 'error';

export type ActionVariant =
  | 'primary' // green #5B6F00, cream label, cta shadow
  | 'ink' // dark #1E2410 ("Ask about a dish")
  | 'outline' // cream with 1.5px hairline border (Watch / Hear)
  | 'cream' // solid cream on photos / dark cards
  | 'glass' // translucent cream on the dark hero ("Hear Mom · 0:24")
  | 'sun'; // sun yellow #FEBE29, ink label: a warm second action next to a green one ("Invite family")

/** Heights and label sizes from the bible: lg 60/18 (default), xl 64/19, md 56/17, sm 52/16, xs 44/15. */
export type ActionSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizes: Record<ActionSize, { h: number; font: number; icon: number }> = {
  xs: { h: 44, font: 15, icon: 18 },
  sm: { h: 52, font: 15, icon: 18 },
  md: { h: 56, font: 17, icon: 22 },
  lg: { h: 60, font: 18, icon: 22 },
  xl: { h: 64, font: 19, icon: 22 },
};

const look: Record<ActionVariant, { bg: string; fg: string; border?: string; shadow?: string; weight: 600 | 700 }> = {
  primary: { bg: colors.green, fg: colors.card, shadow: shadows.cta, weight: 700 },
  ink: { bg: colors.ink, fg: colors.card, weight: 700 },
  outline: { bg: colors.card, fg: colors.ink, border: alpha.border, weight: 600 },
  cream: { bg: colors.card, fg: colors.ink, weight: 700 },
  glass: { bg: alpha.glassOnDark, fg: colors.card, weight: 600 },
  sun: { bg: colors.sun, fg: colors.ink, shadow: shadows.cta, weight: 700 },
};

export type ActionButtonProps = {
  label: string;
  /** Return a promise to get loading -> success/error automatically. Throw/reject = error. */
  onPress?: () => void | Promise<unknown>;
  variant?: ActionVariant;
  size?: ActionSize;
  /** Left icon (receives nothing; color it with the variant's fg, e.g. colors.card). */
  icon?: ReactNode;
  /** Right icon (e.g. <ArrowRightIcon color={colors.card} />). */
  iconRight?: ReactNode;
  /** Controlled state. When set, the button does not manage its own state. */
  state?: ActionState;
  /** Label shown in the success state (default: a check alone). */
  successLabel?: string;
  /** Words beside the spinner while loading (default: the spinner alone). */
  loadingLabel?: string;
  /** Label shown in the error state (default "Try again"). */
  errorLabel?: string;
  /** How long success / error show before returning to idle (ms). 0 = stay. Default 1800. */
  resetAfter?: number;
  disabled?: boolean;
  /** Drop the cta shadow (the bible's in-card buttons: "Answer with your voice", "Remind me Sunday"). */
  flat?: boolean;
  /** Label size override (e.g. 16 for the hero's "Hear Mom · 0:24"). */
  labelSize?: number;
  /** Primary actions get a selection haptic on press (default true for primary/ink). */
  haptics?: boolean;
  /** Label / icon colour override (e.g. green-deep #4C5A10 on the outline "Send to Maya"). */
  fg?: string;
  /** Border colour override for the outline variant (e.g. rgba(30,36,16,0.14)). */
  borderColor?: string;
  /** Horizontal padding override (default 20; the bible's small outline pills use 16). */
  padH?: number;
  /** Label weight override (the outline variant defaults to 600; "Send to Maya" is 700). */
  labelWeight?: 600 | 700;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  iconRight,
  state: controlled,
  successLabel,
  loadingLabel,
  errorLabel = 'Try again',
  resetAfter = 1800,
  disabled,
  flat,
  labelSize,
  haptics,
  fg,
  borderColor,
  padH,
  labelWeight,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ActionButtonProps) {
  const [own, setOwn] = useState<ActionState>('idle');
  const state = controlled ?? own;
  const reduce = useReducedMotion();
  const base = look[variant];
  const v = { ...base, fg: fg ?? base.fg, border: base.border ? borderColor ?? base.border : undefined, weight: labelWeight ?? base.weight };
  const sz = labelSize ? { ...sizes[size], font: labelSize } : sizes[size];
  const [lockedWidth, setLockedWidth] = useState<number | undefined>();
  const widthRef = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  // Crossfade between the label and the state content.
  const labelOn = useSharedValue(1);
  const shake = useSharedValue(0);
  useEffect(() => {
    labelOn.value = withTiming(state === 'idle' ? 1 : 0, { duration: motion.crossfadeMs });
    if (state === 'loading') setLockedWidth(widthRef.current || undefined);
    if (state === 'idle') setLockedWidth(undefined);
    if (state === 'success') haptic('success');
    if (state === 'error') {
      haptic('error');
      if (!reduce) {
        shake.value = withSequence(
          withTiming(-6, { duration: 50 }),
          withTiming(6, { duration: 70 }),
          withTiming(-4, { duration: 60 }),
          withTiming(0, { duration: 60 }),
        );
      }
    }
  }, [state, labelOn, shake, reduce]);

  const speakLoading = state === 'loading' && Platform.OS === 'ios' ? loadingLabel : undefined;
  useEffect(() => {
    if (speakLoading) AccessibilityInfo.announceForAccessibility(speakLoading);
  }, [speakLoading]);

  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOn.value }));
  const stateStyle = useAnimatedStyle(() => ({ opacity: 1 - labelOn.value }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  async function handlePress() {
    if (!onPress || state !== 'idle') return;
    const result = onPress();
    if (controlled || !result || typeof (result as Promise<unknown>).then !== 'function') return;
    setOwn('loading');
    const started = Date.now();
    let ok = true;
    try {
      await result;
    } catch {
      ok = false;
    }
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!mounted.current) return;
    setOwn(ok ? 'success' : 'error');
    if (resetAfter > 0) {
      setTimeout(() => mounted.current && setOwn('idle'), resetAfter);
    }
  }

  const busy = state !== 'idle';
  const errorBg = state === 'error' && (variant === 'primary' || variant === 'ink') ? colors.danger : v.bg;

  return (
    // Disabled dimming lives on the wrapper: PressableScale animates its own opacity, which would
    // override an opacity set on its style.
    <Animated.View style={[shakeStyle, disabled ? styles.disabled : null, style]}>
      <PressableScale
        onPress={handlePress}
        disabled={disabled || busy}
        haptic={haptics ?? (variant === 'primary' || variant === 'ink')}
        accessibilityLabel={state === 'loading' && loadingLabel ? loadingLabel : accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled, busy: state === 'loading' }}
        onLayout={(e) => {
          if (!busy) widthRef.current = e.nativeEvent.layout.width;
        }}
        style={[
          styles.base,
          {
            height: sz.h,
            backgroundColor: errorBg,
            boxShadow: flat ? undefined : v.shadow,
            borderWidth: v.border ? 1.5 : 0,
            borderColor: v.border,
            width: lockedWidth,
          },
          padH != null ? { paddingHorizontal: padH } : null,
        ]}>
        <Animated.View style={[styles.row, labelStyle]}>
          {icon}
          <Txt variant="button" size={sz.font} weight={v.weight} color={v.fg} numberOfLines={1}>
            {label}
          </Txt>
          {iconRight}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.center, stateStyle]} pointerEvents="none">
          {state === 'loading' ? (
            loadingLabel ? (
              <View style={styles.row} accessibilityLiveRegion="polite">
                <ActivityIndicator color={v.fg} />
                <Txt variant="button" size={sz.font} weight={v.weight} color={v.fg} numberOfLines={1}>
                  {loadingLabel}
                </Txt>
              </View>
            ) : (
              <ActivityIndicator color={v.fg} />
            )
          ) : null}
          {state === 'success' ? (
            <View style={styles.row}>
              <CheckIcon size={sz.icon} color={v.fg} />
              {successLabel ? (
                <Txt variant="button" size={sz.font} weight={v.weight} color={v.fg} numberOfLines={1}>
                  {successLabel}
                </Txt>
              ) : null}
            </View>
          ) : null}
          {state === 'error' ? (
            <Txt variant="button" size={sz.font} weight={v.weight} color={variant === 'primary' || variant === 'ink' ? colors.card : colors.danger}>
              {errorLabel}
            </Txt>
          ) : null}
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
