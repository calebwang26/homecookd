// Home after she sent the craving link (docs/design/phase5-cold-parents, screen 3): an ink card like the ask card it
// replaces, "Sent!" / "We'll tell you when they pick a dish." in cream, and a yolk "Send to someone else". The
// whole card opens the sheet again (Caleb, Oct 31), like the ask card.
// Mounting it with CravingAskCard: see that file.
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { CheckIcon, listEnter, PressableScale, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

export function CravingSentCard({ onSendAgain, enterIndex = 0 }: { onSendAgain: () => void; enterIndex?: number }) {
  const { t } = useWords();
  return (
    <Animated.View entering={listEnter(enterIndex)}>
      <PressableScale
        onPress={onSendAgain}
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${t('craving.sent.title')} ${t('craving.sent.line')} ${t('craving.sent.again')}`}
        style={styles.card}
      >
        <View style={styles.row}>
          <View style={styles.check}>
            <CheckIcon size={24} strokeWidth={2.4} color={colors.ink} />
          </View>
          <View style={styles.words}>
            <Txt size={20} weight={700} color={colors.page}>
              {t('craving.sent.title')}
            </Txt>
            <Txt size={18} leading={1.35} color={colors.page}>
              {t('craving.sent.line')}
            </Txt>
          </View>
        </View>
        <Txt size={18} weight={700} color={colors.yolk} style={styles.again}>
          {t('craving.sent.again')}
        </Txt>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.ink, borderRadius: radii.panel, padding: 22, gap: 14, boxShadow: shadows.cardRaised },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // The bible's waiting ring: a white disc in a yolk ring.
  check: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, boxShadow: shadows.ringYolk, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 2 },
  again: { alignSelf: 'flex-start', paddingVertical: 4 },
});
