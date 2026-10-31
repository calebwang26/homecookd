// Round icon buttons and the "< Back" pill.
//  cream: white #FFFFFF + 0 4px 14px shadow (back / close on the page, Kid-Ingredients, Kid-Step)
//  glass: rgba(255,255,255,0.92), no shadow (back / heart / share over a photo)
//  ink: #18221D with a white glyph (play in a voice row, composer mic)
//  yolkTint: #FCEBD0 with an ink glyph ("Add a hello" mic, the cook's voice play)
//  well: #E3EBE6 (quiet secondary buttons: a sheet's close, a hello's play)
//  glassDark: rgba(255,255,255,0.3) with a white glyph (heart on a photo card)
//  clear: transparent (heart in a list row)
//  field: white + 0 4px 14px 0.06 (voice search next to the search field)
import { useContext, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { TContext } from '@/lib/words/context';
import { alpha, colors, shadows } from '@/theme/tokens';

import { BackIcon } from './icons';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type IconButtonTone = 'cream' | 'glass' | 'ink' | 'yolkTint' | 'yolk' | 'well' | 'glassDark' | 'clear' | 'field' | 'green';

const tones: Record<IconButtonTone, { bg: string; fg: string; shadow?: string }> = {
  cream: { bg: colors.card, fg: colors.ink, shadow: shadows.button },
  glass: { bg: alpha.glassButton, fg: colors.ink },
  ink: { bg: colors.ink, fg: colors.card },
  yolkTint: { bg: colors.yolkTint, fg: colors.ink },
  yolk: { bg: colors.yolk, fg: colors.ink },
  well: { bg: colors.well, fg: colors.ink },
  glassDark: { bg: alpha.glassHeart, fg: colors.card },
  clear: { bg: 'transparent', fg: colors.muted },
  field: { bg: colors.card, fg: colors.ink, shadow: shadows.field },
  green: { bg: colors.green, fg: colors.card },
};

export type IconButtonProps = {
  /** The glyph. Either a node or a render function receiving the tone's colour. */
  icon: ReactNode | ((color: string) => ReactNode);
  accessibilityLabel: string;
  onPress?: () => void;
  tone?: IconButtonTone;
  /** Diameter: 40, 44, 48 (default), 52, 56, 60, 68, 92. */
  size?: number;
  haptic?: boolean;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({ icon, accessibilityLabel, onPress, tone = 'cream', size = 48, haptic, selected, disabled, style }: IconButtonProps) {
  const t = tones[tone];
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, boxShadow: t.shadow },
        style,
      ]}>
      {typeof icon === 'function' ? icon(t.fg) : icon}
    </PressableScale>
  );
}

/** "< Back" pill: 48 tall, padding 0 18 0 12, 16/700. `overPhoto` uses the 0.94 glass fill. */
export function BackPill({ onPress, label: own, overPhoto = false, style }: { onPress?: () => void; label?: string; overPhoto?: boolean; style?: StyleProp<ViewStyle> }) {
  const words = useContext(TContext);
  const label = own ?? words('common.back');
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        styles.backPill,
        overPhoto ? { backgroundColor: alpha.glassPill } : { backgroundColor: colors.card, boxShadow: shadows.button },
        style,
      ]}>
      <BackIcon size={20} color={colors.ink} />
      <Txt variant="label" size={16} weight={700}>
        {label}
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  backPill: {
    height: 48,
    paddingLeft: 12,
    paddingRight: 18,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
});
