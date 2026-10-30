// Home after she sent the craving link (docs/design/phase5-cold-parents, screen 3): a yolk-tint card, "Sent!" /
// "We'll tell you when they pick a dish.", and a green "Send to someone else" that opens the sheet again.
// Mounting it with CravingAskCard: see that file.
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { CheckIcon, listEnter, PressableScale, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

export function CravingSentCard({ onSendAgain, enterIndex = 0 }: { onSendAgain: () => void; enterIndex?: number }) {
  const { t } = useWords();
  return (
    <Animated.View entering={listEnter(enterIndex)} style={styles.card}>
      <View style={styles.row} accessible accessibilityLabel={`${t('craving.sent.title')} ${t('craving.sent.line')}`}>
        <View style={styles.check}>
          <CheckIcon size={24} strokeWidth={2.4} color={colors.ink} />
        </View>
        <View style={styles.words}>
          <Txt size={20} weight={700} color={colors.ink}>
            {t('craving.sent.title')}
          </Txt>
          <Txt size={18} leading={1.35} color={colors.ink}>
            {t('craving.sent.line')}
          </Txt>
        </View>
      </View>
      <PressableScale onPress={onSendAgain} accessibilityRole="button" style={styles.again}>
        <Txt size={18} weight={700} color={colors.yolkDeep}>
          {t('craving.sent.again')}
        </Txt>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.yolkTint, borderRadius: radii.panel, padding: 22, gap: 14, boxShadow: shadows.cardRaised },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // The bible's waiting ring: a white disc in a yolk ring.
  check: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, boxShadow: shadows.ringYolk, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 2 },
  again: { alignSelf: 'flex-start', paddingVertical: 4 },
});
