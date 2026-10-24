// A line in the cook's language with its English small under it (lib/homie/strings). An English
// line is just the line.
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import type { Line } from '@/lib/homie/strings';
import { colors, type SansWeight } from '@/theme/tokens';

export function BiLine({
  line,
  size = 18,
  weight = 600,
  color = colors.ink,
  enSize = 14,
  enColor = colors.muted,
  align = 'center',
  leading = 1.35,
  style,
  textStyle,
}: {
  line: Line;
  size?: number;
  weight?: SansWeight;
  color?: string;
  enSize?: number;
  enColor?: string;
  align?: TextStyle['textAlign'];
  leading?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.col, align === 'center' && styles.center, style]} accessible accessibilityLabel={line.en ? `${line.text}. ${line.en}` : line.text}>
      <Txt variant="label" size={size} weight={weight} color={color} align={align} leading={leading} style={textStyle}>
        {line.text}
      </Txt>
      {line.en ? (
        <Txt variant="meta" size={enSize} color={enColor} align={align}>
          {line.en}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 2 },
  center: { alignItems: 'center' },
});
