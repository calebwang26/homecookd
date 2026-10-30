// Cards from the bible.
//  default: white #FFFFFF, radius 28, 0 8px 24px rgba(31,36,48,0.06) (list cards, panels)
//  raised:  same with 0 10px 30px rgba(31,36,48,0.08) ("Leo asked you", "Waiting for your answer")
//  tinted:  yolkTint (asks: request card, give-back card) / greenTint (the cook's answers) fills, no shadow
// `ListCard` + `ListRow` are the bible's rows-with-hairlines pattern (Browse, Messages, Your recipes).
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, shadows } from '@/theme/tokens';

import { PressableScale } from './PressableScale';

export type CardTone = 'card' | 'yolkTint' | 'greenTint';
const toneBg: Record<CardTone, string> = {
  card: colors.card,
  yolkTint: colors.yolkTint,
  greenTint: colors.greenTint,
};

export type CardProps = {
  children?: ReactNode;
  tone?: CardTone;
  /** Shadow: 'card' (default for cream), 'raised', or 'none' (default for tints). */
  elevation?: 'none' | 'card' | 'raised';
  radius?: number;
  padding?: number;
  /** Gap between children (the bible's flex column gaps: 14, 16, 18). */
  gap?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, tone = 'card', elevation, radius = radii.panel, padding = 20, gap, onPress, accessibilityLabel, style }: CardProps) {
  const elev = elevation ?? (tone === 'card' ? 'card' : 'none');
  const s = [
    {
      backgroundColor: toneBg[tone],
      borderRadius: radius,
      padding,
      gap,
      boxShadow: elev === 'none' ? undefined : elev === 'raised' ? shadows.cardRaised : shadows.card,
    },
    style,
  ];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} scaleTo={0.97} accessibilityLabel={accessibilityLabel} style={s}>
        {children}
      </PressableScale>
    );
  }
  return <View style={s}>{children}</View>;
}

/** A cream list card with 6 px top/bottom and 16 px side padding (12 on Browse). */
export function ListCard({ children, padH = 16, padV = 6, style }: { children?: ReactNode; padH?: number; padV?: number; style?: StyleProp<ViewStyle> }) {
  return <Card padding={0} style={[{ paddingHorizontal: padH, paddingVertical: padV }, style]}>{children}</Card>;
}

/** One row in a ListCard: horizontal, gap 14, a #E6DDCF hairline below unless `last`. */
export function ListRow({
  children,
  last,
  padV = 12,
  onPress,
  accessibilityLabel,
  align = 'center',
  style,
}: {
  children?: ReactNode;
  last?: boolean;
  padV?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  align?: 'center' | 'flex-start';
  style?: StyleProp<ViewStyle>;
}) {
  const s = [
    styles.row,
    { paddingVertical: padV, alignItems: align },
    last ? null : styles.hairline,
    style,
  ];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} scaleTo={0.98} pressedOpacity={0.85} accessibilityLabel={accessibilityLabel} style={s}>
        {children}
      </PressableScale>
    );
  }
  return <View style={s}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  hairline: { borderBottomWidth: 1, borderBottomColor: colors.well },
});
