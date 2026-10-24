// A reaction in the chat (RETENTION-HANDOFF 3.1 & 3.4): a small centred stamp, never a bubble and
// never the raw body ("heart"):
//                ♥ Mom
// "Just like mine" without its dish card to sit under reads "♥ “Just like mine.” · Mom" (PR 3 groups
// those under the cooked message they answer). For ChatLog: give a reaction its own centred group,
// like a system note, and render this instead of the note's text (RETENTION-WIRING.md, PR 2 A5).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { HeartIcon, Txt } from '@/components/ui';
import { reactionStampText } from '@/lib/cookingLogic';
import { colors } from '@/theme/tokens';

export type ReactionStampProps = {
  /** The message body: 'heart' or 'just_like_mine'. */
  body: string | null | undefined;
  /** Who sent it, as the family calls them. */
  name: string | null | undefined;
  /** I sent it ("You"). */
  mine?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ReactionStamp({ body, name, mine = false, style }: ReactionStampProps) {
  const text = reactionStampText(body, name, mine);
  const label = body === 'just_like_mine' ? text : `Heart from ${mine ? 'you' : text}`;
  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={label}>
      <HeartIcon size={13} filled color={colors.danger} strokeWidth={1.5} />
      <Txt variant="caption" weight={600} numberOfLines={1} style={styles.shrink}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2, maxWidth: '80%' },
  shrink: { flexShrink: 1 },
});
