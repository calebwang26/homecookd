// A small row of overlapping faces (RETENTION-HANDOFF 3.5, the cofounder's "faces row"): who cooked or
// hearted a dish, or who can cook a cook's dishes. Each face has a cream ring so the overlap reads
// cleanly; "+2" when there are more. Purely decorative for the screen reader: the line beside it says
// the same thing in words, so the row is hidden from it unless a `label` is given.
//
//   <FacesRow people={faces.shown} more={faces.more} />
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar, Txt, type AvatarProfile } from '@/components/ui';
import { colors } from '@/theme/tokens';

export type FacesRowProps = {
  people: (AvatarProfile & { id?: string })[];
  /** How many more people aren't drawn ("+2"). */
  more?: number;
  /** Face diameter (default 24). */
  size?: number;
  /** Read aloud instead of being skipped (when nothing next to it says who). */
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function FacesRow({ people, more = 0, size = 24, label, style }: FacesRowProps) {
  if (!people.length) return null;
  const overlap = Math.round(size * 0.3);
  return (
    <View
      style={[styles.row, style]}
      accessible={!!label}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!label}>
      {people.map((p, i) => (
        <Avatar key={p.id ?? `${p.name}-${i}`} profile={p} size={size} ring style={i ? { marginLeft: -overlap } : null} />
      ))}
      {more > 0 ? (
        <Txt variant="caption" size={13} weight={600} color={colors.muted} style={styles.more}>
          +{more}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  more: { marginLeft: 6, fontVariant: ['tabular-nums'] },
});
