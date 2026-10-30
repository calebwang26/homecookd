// Parent Home's quiet craving card (Caleb, Oct 29: Home had too many big buttons, and the photo was too much): under
// "Record a new recipe", a soft yolk-tint card with "Your loved ones miss your cooking." and a yolk-deep line "Ask what
// they're craving →". The whole card is the tap target; it isn't another button. It stays until she sends the link
// once (useCravingSent), then CravingSentCard takes its place. Home owns the one CravingSheet both cards open.
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { listEnter, PressableScale, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors, radii } from '@/theme/tokens';

export function CravingAskCard({ onAsk, enterIndex = 0 }: { onAsk: () => void; enterIndex?: number }) {
  const { t } = useWords();
  return (
    <Animated.View entering={listEnter(enterIndex)}>
      <PressableScale onPress={onAsk} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`${t('craving.missYourCooking')} ${t('craving.ask')}`} style={styles.card}>
        <Txt variant="display" size={24} leading={1.15} color={colors.ink}>
          {t('craving.missYourCooking')}
        </Txt>
        <View style={styles.link}>
          <Txt variant="label" size={18} weight={700} color={colors.yolkDeep}>
            {t('craving.ask')}
          </Txt>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.yolkDeep} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.yolkTint, borderRadius: radii.panel, paddingVertical: 20, paddingHorizontal: 22, gap: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
