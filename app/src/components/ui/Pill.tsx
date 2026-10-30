// Small rounded labels from the bible, in the egg palette: "2 of 6" (greenTint), "Waiting for your answer" (yolkTint),
// "New voice note · 0:38" (yolkTint, with a leading play disc), "Just in from Mom" (glass, with avatar),
// "About Pork & Chive Dumplings" (cream: white + chip shadow), "New" (yolk), "Sent" (green).
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, colors, shadows } from '@/theme/tokens';

import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type PillTone = 'greenTint' | 'yolkTint' | 'yolk' | 'cream' | 'glass' | 'ink' | 'green';

const tones: Record<PillTone, { bg: string; fg: string; shadow?: string }> = {
  greenTint: { bg: colors.greenTint, fg: colors.green },
  yolkTint: { bg: colors.yolkTint, fg: colors.ink },
  yolk: { bg: colors.yolk, fg: colors.ink },
  cream: { bg: colors.card, fg: colors.ink, shadow: shadows.chip },
  glass: { bg: alpha.glassChip, fg: colors.ink },
  ink: { bg: colors.ink, fg: colors.card },
  green: { bg: colors.green, fg: colors.card },
};

/**
 * Sizes (height / font / weight): xs 22/12/700 ("Waiting", "New"), sm 30/14/700 (status pill),
 * md 32/14/700 ("2 of 6"), lg 34/14/700 (voice note pill), xl 40/14-15/600 (pills with an avatar).
 */
export type PillSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const sizes: Record<PillSize, { h: number; px: number; font: number; weight: 600 | 700 }> = {
  xs: { h: 22, px: 8, font: 12, weight: 700 },
  sm: { h: 30, px: 12, font: 14, weight: 700 },
  md: { h: 32, px: 12, font: 14, weight: 700 },
  lg: { h: 34, px: 14, font: 14, weight: 700 },
  xl: { h: 40, px: 14, font: 14, weight: 600 },
};

export type PillProps = {
  children?: ReactNode;
  label?: string;
  tone?: PillTone;
  size?: PillSize;
  /** Leading element (avatar / icon disc). The pill tucks its left padding to 4-6 px around it. */
  leading?: ReactNode;
  /** Override the text colour / size. */
  color?: string;
  fontSize?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Pill({ children, label, tone = 'greenTint', size = 'md', leading, color, fontSize, onPress, accessibilityLabel, style }: PillProps) {
  const t = tones[tone];
  const s = sizes[size];
  const leadPad = size === 'lg' ? 6 : 4;
  const body = (
    <>
      {leading}
      {label != null || typeof children === 'string' ? (
        <Txt variant="label" size={fontSize ?? s.font} weight={s.weight} color={color ?? t.fg} numberOfLines={1}>
          {label ?? children}
        </Txt>
      ) : (
        children
      )}
    </>
  );
  const boxStyle = [
    styles.base,
    {
      height: s.h,
      paddingLeft: leading ? leadPad : s.px,
      paddingRight: s.px,
      backgroundColor: t.bg,
      boxShadow: t.shadow,
      gap: 8,
    },
    style,
  ];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityLabel={accessibilityLabel ?? label} style={boxStyle}>
        {body}
      </PressableScale>
    );
  }
  return (
    <View style={boxStyle} accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 999 },
});
