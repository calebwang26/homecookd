// AskedCard (bible Parent-Recipe): lavender "Leo asked you" + the question + a mic "Answer",
// docked at the bottom of the cook's recipe page.
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ActionButton, Avatar, MicIcon, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import { colors, radii } from '@/theme/tokens';

export function AskedCard({
  who,
  question,
  onAnswer,
  voice,
  style,
}: {
  who: Pick<Profile, 'name' | 'avatar_key'>;
  question: string;
  onAnswer: () => void;
  /** Shown in place of the quote, e.g. a play button for a spoken question. */
  voice?: ReactNode;
  /** Kept for callers; the card is always the docked lavender one now. */
  docked?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useWords();
  return (
    <View style={[styles.docked, style]} accessibilityLabel={t('parent.ask.askedYou', { name: who.name })}>
      <View style={styles.dockedRow}>
        <Avatar profile={who} size={40} />
        <View style={styles.flex}>
          <Txt variant="label" size={14} weight={700} color={colors.lavenderInk}>
            {t('parent.ask.askedYou', { name: who.name })}
          </Txt>
          {voice ?? (
            <Txt variant="quote" size={19} leading={1.3} numberOfLines={2}>
              {`“${question.trim()}”`}
            </Txt>
          )}
        </View>
      </View>
      <ActionButton
        label={t('parent.ask.answer')}
        size="md"
        flat
        icon={<MicIcon size={22} color={colors.card} />}
        onPress={onAnswer}
        accessibilityHint={t('parent.ask.chatHint', { name: who.name })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  docked: {
    borderRadius: radii.panel,
    backgroundColor: colors.lavender,
    padding: 20,
    gap: 14,
  },
  dockedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
