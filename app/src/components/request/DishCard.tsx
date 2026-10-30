// A kid's ask, as a picture: his own photo of the dish when he added one; otherwise a designed card, white
// with the dish name in big Fraunces (the egg brand's no-photo card, the same as the web's DishHero; never
// the egg). Never a stock photo in his dish's place, or in hers (docs/design/phase5-cold-parents, "Fixes
// from the Merge Agent").
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { alpha, colors, radii } from '@/theme/tokens';

export function DishCard({
  dish,
  label,
  photoUrl,
  height = 150,
  radius = radii.panel,
  photoChip = false,
  style,
}: {
  dish: string;
  /** The words on the designed card ("Mom’s braised pork"); the dish by default. */
  label?: string;
  photoUrl?: string | null;
  height?: number;
  radius?: number;
  /** Also show `label` over his photo, in a white chip (when nothing under the card names the dish). */
  photoChip?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const words = (label ?? dish).trim();
  if (photoUrl) {
    return (
      <View style={[styles.box, { height, borderRadius: radius }, style]}>
        <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={dish} />
        {photoChip ? (
          <View style={styles.chip}>
            <Txt variant="name" size={18} weight={500} color={colors.ink} numberOfLines={1}>
              {words}
            </Txt>
          </View>
        ) : null}
      </View>
    );
  }
  const big = height >= 130;
  return (
    <View style={[styles.box, styles.designed, { height, borderRadius: radius }, style]} accessible accessibilityLabel={words}>
      <Txt
        variant="display"
        size={big ? 32 : 24}
        leading={1.1}
        color={colors.ink}
        align="center"
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={styles.words}>
        {words}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.well },
  designed: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  words: { alignSelf: 'stretch' },
  chip: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: alpha.glassChip,
  },
});
