// A dish with no photo yet: its name in Fraunces where the photo would be (just the first letter on a tile
// under 100 pt), never the egg and never a stock photo. The web's DishHero does the same (brand kit, Oct 30).
// The container gives the ground (white or the sunken cream); this is only the words, a picture to VoiceOver.
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Txt } from './Txt';

export function NoPhoto({ title, size, initial = false }: { title: string; /** The tile's height. */ size: number; /** The first letter whatever the size (a monogram when the name shows elsewhere). */ initial?: boolean }) {
  const small = initial || size < 100;
  const words = small ? (Array.from(title.trim())[0] ?? '').toUpperCase() : title.trim();
  const font = small ? Math.round(size * 0.46) : Math.max(18, Math.min(40, Math.round(size * 0.15)));
  return (
    <View style={[StyleSheet.absoluteFill, styles.center]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Txt variant="display" size={font} leading={1.1} color={colors.ink} align="center" numberOfLines={small ? 1 : 3} style={small ? null : styles.wide}>
        {words}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  wide: { paddingHorizontal: 24 },
});
