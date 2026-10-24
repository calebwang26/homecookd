// Main's brand row: the pot mascot (34x32) + "homecookd" in Fraunces 600 22 ink, gap 10.
// `mood` (retention PR 7): the pot's mood by the clock (usePotMood); leave it out for a fixed pot
// (share images and recaps someone sends on).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

import { PotMark } from './icons';
import { BrandPot, type PotMood } from './PotMood';
import { Txt } from './Txt';

export function Brand({ size = 22, color = colors.ink, mood, style }: { size?: number; color?: string; mood?: PotMood; style?: StyleProp<ViewStyle> }) {
  const pot = Math.round((size * 34) / 22);
  return (
    <View style={[styles.row, { gap: Math.round((size * 10) / 22) }, style]} accessibilityLabel="homecookd">
      {mood === undefined ? <PotMark size={pot} /> : <BrandPot size={pot} mood={mood} />}
      <Txt variant="brand" size={size} color={color}>
        homecookd
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
