// The postcard's rating in little yolks (they were pots; retention PR 3, RETENTION-HANDOFF 3.4):
//   - the kid's "How close to Dad’s?": five 48 pt yolk buttons; tap one to rate, the same one again to
//     take it back (it is optional); a selection haptic each tap, the yolks fill up to the one tapped;
//   - on the cook's postcard and in the chat: small yolks after the question's words ("How close to
//     yours", "How close to Dad’s"), as the kid rated it.
// TODO(caleb): the rating's shape (was "pots vs dumplings", handoff 8.3).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { YolkIcon, PressableScale, Txt } from '@/components/ui';
import { nextRating, RATING_MAX, ratingWords } from '@/lib/postcardLogic';
import { colors } from '@/theme/tokens';

const ALL = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

/** Five egg buttons (48 pt each) for the kid's optional rating. `disabled`: while the postcard sends. */
export function RatingInput({
  value,
  onChange,
  disabled,
  style,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.input, style]} accessibilityRole="radiogroup">
      {ALL.map((n) => (
        <PressableScale
          key={n}
          onPress={() => onChange(nextRating(value, n))}
          disabled={disabled}
          haptic
          scaleTo={0.88}
          accessibilityRole="radio"
          accessibilityLabel={ratingWords(n)}
          accessibilityState={{ checked: value === n }}
          aria-checked={value === n}
          accessibilityHint={value === n ? 'Takes the rating back' : undefined}
          style={styles.button}>
          <YolkIcon size={32} filled={value !== null && n <= value} />
        </PressableScale>
      ))}
    </View>
  );
}

/** The rating as it was given: small eggs, filled up to it. Nothing when there is none. */
export function RatingShown({ value, size = 18, style }: { value: number | null | undefined; size?: number; style?: StyleProp<ViewStyle> }) {
  if (!value) return null;
  return (
    <View style={[styles.shown, style]} accessible accessibilityLabel={ratingWords(value)}>
      {ALL.map((n) => (
        <YolkIcon key={n} size={size} filled={n <= value} />
      ))}
    </View>
  );
}

/** "How close to yours  ● ● ● ● ○": the words the kid answered, then the eggs. Nothing without a rating. */
export function RatingLine({ words, value, size = 18, textSize = 15, style }: { words: string; value: number | null | undefined; size?: number; textSize?: number; style?: StyleProp<ViewStyle> }) {
  if (!value) return null;
  return (
    <View style={[styles.line, style]} accessible accessibilityLabel={`${words}: ${ratingWords(value)}`}>
      <Txt variant="meta" size={textSize} color={colors.muted}>
        {words}
      </Txt>
      <RatingShown value={value} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 },
  input: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  shown: { flexDirection: 'row', alignItems: 'center', gap: 1 },
});
