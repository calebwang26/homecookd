// The two doors (docs/design/phase5-cold-parents, screen 1): once, after the language screen, for a cook whose
// family has nothing yet (who sees it: lib/doorsGate.ts; the gate: parent/_layout + useDoorsGate).
//   1. A big photo and "Your kids miss your cooking."
//   2. The main door, a yolk card: "Ask your kids what they're craving" opens the craving sheet. Closing the sheet
//      goes to Home, where "Sent!" or "Ask what they're craving" waits (components/craving).
//   3. "Start recording now" opens Record, which asks for AI consent itself.
//   4. A quiet "Not now" goes to Home.
// Any tap marks the doors seen for her on this phone. Nothing here talks (homie's voice is off for launch).
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { CravingSheet } from '@/components/craving/CravingSheet';
import { ActionButton, listEnter, PressableScale, RecordDotIcon, ScreenWash, Txt } from '@/components/ui';
import { afterClose } from '@/lib/sheets/coordinator';
import { useHomieScreen } from '@/lib/homie/hooks';
import { useWords } from '@/lib/words/useWords';
import { colors, motion, radii, shadows, space } from '@/theme/tokens';

// A mother and her grown daughter (an ~800 px crop of web/public/media/stock/hero-alt-mother-daughter-poster.jpg).
// Licensed Pexels photo by cottonbro studio, credited in web/public/media/stock/credits.json.
const HERO = require('@/assets/images/doors-hero.jpg');

export type TwoDoorsProps = {
  /** She tapped a door: don't show them again (they stay up under the sheet). */
  onSeen: () => void;
  /** Leave the doors for Home (also marks them seen). */
  onDone: () => void;
  /** She sent the craving link from the sheet (CravingSheet onSent). */
  onSent?: () => void;
};

export function TwoDoors({ onSeen, onDone, onSent }: TwoDoorsProps) {
  const insets = useSafeAreaInsets();
  const { t } = useWords();
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The photo fills the top: no corner egg over it (homie's voice is off here anyway).
  useHomieScreen({ hidden: true });

  // Home comes once the sheet has slid away (never pull a Modal out mid-animation).
  useEffect(() => {
    if (!leaving) return;
    return afterClose(onDone, motion.sheetCloseMs + 40);
  }, [leaving, onDone]);

  const ask = () => {
    onSeen();
    setAsking(true);
  };
  const record = () => {
    router.push('/record');
    onDone();
  };

  return (
    <View style={styles.root}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(space.top, insets.top + 8), paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        <Animated.View entering={listEnter(0)} style={styles.photoWrap}>
          <Image source={HERO} style={styles.photo} contentFit="cover" contentPosition="center" accessible={false} />
        </Animated.View>
        <Animated.View entering={listEnter(1)}>
          <Txt variant="display" size={38} leading={1.08} accessibilityRole="header">
            {t('craving.missYourCooking')}
          </Txt>
        </Animated.View>
        <Animated.View entering={listEnter(2)}>
          <PressableScale
            onPress={ask}
            haptic
            scaleTo={motion.pressScaleCard}
            accessibilityRole="button"
            accessibilityLabel={t('craving.doors.ask')}
            style={styles.door}>
            <View style={styles.doorIcon}>
              <AskIcon />
            </View>
            <Txt size={24} weight={700} leading={1.2} color={colors.ink} style={styles.doorWords}>
              {t('craving.doors.ask')}
            </Txt>
          </PressableScale>
        </Animated.View>
        <Animated.View entering={listEnter(3)}>
          <ActionButton
            label={t('craving.doors.record')}
            variant="outline"
            size="xl"
            labelWeight={700}
            icon={
              <View style={styles.recordDot}>
                <RecordDotIcon size={20} color={colors.danger} />
              </View>
            }
            onPress={record}
          />
        </Animated.View>
        <Animated.View entering={listEnter(4)} style={styles.notNowRow}>
          <PressableScale onPress={onDone} accessibilityRole="button" style={styles.notNow}>
            <Txt size={18} weight={600} color={colors.muted}>
              {t('craving.doors.notNow')}
            </Txt>
          </PressableScale>
        </Animated.View>
      </ScrollView>
      <CravingSheet
        visible={asking}
        onClose={() => {
          setAsking(false);
          setLeaving(true);
        }}
        onSent={onSent}
      />
    </View>
  );
}

/** A chat bubble with a heart in it (the bible's chat path). */
function AskIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
      <Path d="M12 15.5s-3.2-1.9-3.2-4a1.7 1.7 0 0 1 3.2-.8 1.7 1.7 0 0 1 3.2.8c0 2.1-3.2 4-3.2 4z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.gutter, gap: space.xl },
  photoWrap: { borderRadius: radii.panel, boxShadow: shadows.cardRaised },
  photo: { width: '100%', height: 320, borderRadius: radii.panel },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginTop: space.xs,
    padding: 22,
    borderRadius: radii.panel,
    backgroundColor: colors.yolk,
    boxShadow: shadows.cta,
  },
  doorIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  doorWords: { flex: 1 },
  // Record's red dot on a yolk-tint disc, like Home's "Record a new recipe".
  recordDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.yolkTint, alignItems: 'center', justifyContent: 'center' },
  notNowRow: { alignItems: 'center' },
  notNow: { paddingVertical: 10, paddingHorizontal: space.lg },
});
