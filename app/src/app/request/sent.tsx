// Sent to Caleb (/request/sent?ask=<askId>, Phase 5 screen 9, mockup Sent): the check, "Sent to Caleb" and
// "Caleb can cook it tonight, in your words.", her dish ("Mom's braised pork": his photo, else the designed
// card; never a stock photo), then the peach nudge to film it next time with "Remind me" (the reminder
// sheet; hidden once a reminder is set). Done goes to parent Home.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { DishCard } from '@/components/request/DishCard';
import { ReminderSheet } from '@/components/request/ReminderSheet';
import { ActionButton, CheckIcon, listEnter, PressableScale, ScreenWash, Txt, VideoIcon } from '@/components/ui';
import { useAskReminder } from '@/lib/askReminders';
import { useCravingAsk } from '@/lib/cravings';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows, space } from '@/theme/tokens';

/** The bell on "Remind me" (the mockup's), in the icon kit's stroke style; only used here. */
function BellIcon({ size = 20, color = colors.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <Path d="M10 20a2 2 0 0 0 4 0" />
    </Svg>
  );
}

function goHome() {
  if (router.canGoBack()) router.dismissTo('/parent/home');
  else router.replace('/parent/home');
}

export default function SentScreen() {
  const { ask: askId } = useLocalSearchParams<{ ask: string }>();
  const ask = useCravingAsk(askId);
  const reminder = useAskReminder(askId);
  const { me } = useSession();
  const { t } = useWords();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const kid = ask?.kidName.trim() || t('dish.yourKid');
  const cook = me?.name?.trim();
  const herDish = ask ? (cook ? t('request.sent.herDish', { name: cook, dish: ask.dish }) : ask.dish) : '';

  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.col, { paddingTop: Math.max(96, insets.top + 40), paddingBottom: Math.max(space.xxxl, insets.bottom + 16) }]}>
        <Animated.View entering={listEnter(0)} style={styles.top} accessible accessibilityLabel={`${t('request.sent.title', { kid })}. ${t('request.sent.line', { kid })}`}>
          <View style={styles.check}>
            <CheckIcon size={34} color={colors.card} strokeWidth={2.8} />
          </View>
          <Txt variant="display" size={40} leading={1.05} align="center" accessibilityRole="header">
            {t('request.sent.title', { kid })}
          </Txt>
          <Txt variant="lead" size={18} leading={1.4} color={colors.text} align="center">
            {t('request.sent.line', { kid })}
          </Txt>
        </Animated.View>

        {ask ? (
          <Animated.View entering={listEnter(1)}>
            <DishCard dish={ask.dish} label={herDish} photoUrl={ask.photoUrl} height={140} photoChip style={styles.dish} />
          </Animated.View>
        ) : null}

        {ask && !reminder ? (
          <Animated.View entering={listEnter(2)} style={styles.upgrade}>
            <View style={styles.row}>
              <View style={styles.disc}>
                <VideoIcon size={26} color={colors.peachInk} />
              </View>
              <Txt variant="title" size={19} leading={1.3} color={colors.peachInk} style={styles.flex}>
                {t('request.sent.upgrade', { kid })}
              </Txt>
            </View>
            <PressableScale onPress={() => setSheet(true)} accessibilityLabel={t('request.sent.remind')} style={styles.remind}>
              <BellIcon />
              <Txt variant="label" size={18} weight={700}>
                {t('request.sent.remind')}
              </Txt>
            </PressableScale>
          </Animated.View>
        ) : null}

        <ActionButton label={t('request.sent.done')} onPress={goHome} size="xl" labelSize={20} style={styles.done} />
      </ScrollView>
      {ask ? <ReminderSheet ask={ask} visible={sheet} onClose={() => setSheet(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { flexGrow: 1, paddingHorizontal: space.gutter, gap: 20 },
  flex: { flex: 1 },
  top: { alignItems: 'center', gap: 14 },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.cta },
  dish: { boxShadow: shadows.card },
  upgrade: { backgroundColor: colors.peach, borderRadius: radii.panel, paddingVertical: 20, paddingHorizontal: 22, gap: 14, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  disc: { width: 56, height: 56, borderRadius: radii.tile, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  remind: { height: 56, borderRadius: radii.pill, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  done: { marginTop: 'auto' },
});
