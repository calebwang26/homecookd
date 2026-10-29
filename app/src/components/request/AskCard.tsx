// Parent Home's top card when a kid asked for a dish (Phase 5 screen 5, mockup HomeRequest): his dish on top
// (DishCard: his photo, else the designed card), "Caleb wants your" / "braised pork", and a green
// "Answer Caleb" that opens the request screen. Mounted by parent/home.tsx.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionButton, Avatar, Txt } from '@/components/ui';
import type { CravingAsk } from '@/lib/cravings';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

import { DishCard } from './DishCard';

export function openAsk(id: string) {
  router.push({ pathname: '/request/[id]', params: { id } });
}

export function AskCard({ ask }: { ask: CravingAsk }) {
  const { t } = useWords();
  const kid = ask.kidName.trim() || t('dish.yourKid');
  const open = () => openAsk(ask.id);
  return (
    // One button: the green "Answer Caleb" (a pressable card around it would nest a button in a button on the web).
    <View style={styles.card}>
      <DishCard dish={ask.dish} photoUrl={ask.photoUrl} height={150} radius={0} />
      <View style={styles.body}>
        <View style={styles.row}>
          <Avatar name={kid} avatarKey={null} size={44} />
          <View style={styles.flex}>
            <Txt variant="label" size={16} weight={600} color={colors.greenDeep} numberOfLines={1}>
              {t('request.wantsYour', { kid })}
            </Txt>
            <Txt variant="display" size={28} weight={500} leading={1.1} numberOfLines={2}>
              {ask.dish}
            </Txt>
          </View>
        </View>
        <ActionButton
          label={t('request.answer', { kid })}
          onPress={open}
          size="lg"
          labelSize={19}
          accessibilityHint={t('request.wants', { kid, dish: ask.dish })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.panel, overflow: 'hidden', boxShadow: shadows.cardRaised },
  body: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 22, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
