// A kid's ask, as a picture: his own photo of the dish when he added one; otherwise a designed card, the
// dish name in Fraunces on a Hearth color (peach or sage, picked by the name) with the pot. Never a stock
// photo in his dish's place, or in hers (docs/design/phase5-cold-parents, "Fixes from the Merge Agent").
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PotMark, Txt } from '@/components/ui';
import { alpha, colors, radii } from '@/theme/tokens';

const TONES = {
  peach: { bg: colors.peach, fg: colors.peachInk },
  sage: { bg: colors.sage, fg: colors.sageInk },
} as const;

/** The same dish always gets the same color. */
function toneFor(dish: string): keyof typeof TONES {
  let h = 0;
  for (const ch of dish.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 2 ? 'sage' : 'peach';
}

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
  /** Also show `label` over his photo, in a cream chip (when nothing under the card names the dish). */
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
  const tone = TONES[toneFor(dish)];
  const big = height >= 130;
  return (
    <View style={[styles.box, styles.designed, { height, borderRadius: radius, backgroundColor: tone.bg }, style]} accessible accessibilityLabel={words}>
      <PotMark size={big ? 44 : 34} />
      <Txt
        variant="display"
        size={big ? 30 : 24}
        leading={1.1}
        color={tone.fg}
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
  designed: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
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
