// Home before she asks (docs/design/phase5-cold-parents, screen 3b): a young man cooking alone at night, "Your kids
// miss your cooking." and a green "Ask what they're craving". It stays at the top of Home until she sends the link
// once (useCravingSent), then CravingSentCard takes its place.
// The sheet belongs to Home, one CravingSheet for both cards, so it stays open while this card turns into "Sent!":
//   const sent = useCravingSent(me?.id);
//   {sent === false ? <CravingAskCard onAsk={openSheet} /> : sent ? <CravingSentCard onSendAgain={openSheet} /> : null}
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ActionButton, listEnter, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

// A young man cooking alone at night (an ~800 px crop of web/public/media/stock/photo-young-adult-cooking-night.jpg).
// Licensed Pexels photo by Riccardo Vespa, credited in web/public/media/stock/credits.json.
const PHOTO = require('@/assets/images/craving-kid.jpg');

export function CravingAskCard({ onAsk, enterIndex = 0 }: { onAsk: () => void; enterIndex?: number }) {
  const { t } = useWords();
  return (
    <Animated.View entering={listEnter(enterIndex)} style={styles.card}>
      <Image source={PHOTO} style={styles.photo} contentFit="cover" contentPosition="center" accessible={false} />
      <View style={styles.body}>
        <Txt variant="display" size={28} weight={500} leading={1.1}>
          {t('craving.missYourCooking')}
        </Txt>
        <ActionButton label={t('craving.ask')} size="lg" labelSize={19} onPress={onAsk} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.panel, overflow: 'hidden', boxShadow: shadows.cardRaised },
  photo: { width: '100%', height: 170 },
  body: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 22, gap: 16 },
});
