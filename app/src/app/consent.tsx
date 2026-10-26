// /consent, "Before we start": once per phone, after signing in and before anyone's home (App Store
// guideline 5.1.2(i)). It names each AI company and what it gets, then asks. The root layout sends a
// signed-in phone here until it says yes (lib/aiConsent), holding any link it opened for after.
//   I agree         saved on this phone, then their home (or "Who's in the kitchen?", which opens a held link)
//   Privacy policy  homecookd.app/privacy in the app's browser sheet
//   Not now         a sheet: homecookd can't work without this, with Sign out (to the first screen) or Go back
// Read in the phone's language like the sign-in screens it follows (or a cook's own, once she's picked
// it: lib/words/useWords).
// Launch: under the bloom it waits hidden, then the page rises in (like "Who's in the kitchen?").
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ComponentType } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLaunchPhase } from '@/components/LaunchSplash';
import { Headline, leaveTo, SmallLink } from '@/components/signin';
import {
  ActionButton,
  BookIcon,
  BottomSheet,
  Brand,
  listEnter,
  ScreenWash,
  SearchIcon,
  SpoonIcon,
  Txt,
  usePotMood,
  VideoIcon,
  VoiceIcon,
  type IconProps,
} from '@/components/ui';
import { agreeToAi } from '@/lib/aiConsent';
import { openPage, PRIVACY_URL } from '@/lib/links';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, motion, radii, shadows, space } from '@/theme/tokens';

/** Who gets what (`job`: its words' key). A change here means a new AI_CONSENT_KEY version, so everyone is asked again. */
const COMPANIES: { name: string; job: WordKey; Icon: ComponentType<IconProps> }[] = [
  { name: 'Google Gemini', job: 'signin.consent.gemini', Icon: VideoIcon },
  { name: 'Meta Muse Spark', job: 'signin.consent.muse', Icon: BookIcon },
  { name: 'Anthropic Claude', job: 'signin.consent.claude', Icon: SpoonIcon },
  { name: 'Cartesia', job: 'signin.consent.cartesia', Icon: VoiceIcon },
  { name: 'Moss', job: 'signin.consent.moss', Icon: SearchIcon },
];
/** The page colour, clear: the list fades out above the button. */
const FADE = 'rgba(247,247,242,0)';

export default function ConsentScreen() {
  const insets = useSafeAreaInsets();
  const potMood = usePotMood();
  const covered = useLaunchPhase() === 'playing';
  const { me, homeFor, leaveFamily } = useSession();
  const { t } = useWords();
  const [notNow, setNotNow] = useState(false);

  const agree = async () => {
    await agreeToAi();
    setTimeout(() => leaveTo(me ? homeFor(me) : '/'), motion.loadingMinMs);
  };

  // The sheet goes first: signing out sends the app to /join, never under a closing Modal.
  const signOut = () => {
    setNotNow(false);
    setTimeout(() => void leaveFamily(), motion.sheetCloseMs + 40);
  };

  return (
    <View style={styles.root}>
      <ScreenWash tone="parent" height={420} />
      {covered ? null : (
        <>
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.content, { paddingTop: Math.max(64, insets.top + 16) }]}
            showsVerticalScrollIndicator={false}>
            <Animated.View entering={listEnter(0)} style={styles.top}>
              <Brand mood={potMood} style={styles.brand} />
              <Headline title={t('signin.consent.title')} line={t('signin.consent.line')} />
            </Animated.View>
            <Animated.View entering={listEnter(1)} style={styles.card}>
              {COMPANIES.map(({ name, job, Icon }) => (
                <View key={name} style={styles.row} accessible accessibilityLabel={t('signin.consent.row', { name, job: t(job) })}>
                  <View style={styles.icon}>
                    <Icon size={22} color={colors.sageInk} />
                  </View>
                  <View style={styles.words}>
                    <Txt variant="title">{name}</Txt>
                    <Txt variant="body">{t(job)}</Txt>
                  </View>
                </View>
              ))}
            </Animated.View>
          </ScrollView>
          {/* What they're agreeing to sits with the button, always on screen; the list scrolls under a fade. */}
          <Animated.View entering={listEnter(2)} style={[styles.foot, { paddingBottom: Math.max(16, insets.bottom + 4) }]}>
            <LinearGradient pointerEvents="none" colors={[FADE, colors.page]} style={styles.fade} />
            <Txt variant="bodyInk" size={15} align="center" style={styles.promise}>
              {t('signin.consent.promise')}
            </Txt>
            <ActionButton label={t('signin.consent.agree')} size="xl" onPress={agree} accessibilityHint={t('signin.consent.agreeHint')} />
            <View style={styles.links}>
              <SmallLink label={t('signin.shared.privacy')} hint={t('signin.shared.opensSite')} onPress={() => void openPage(PRIVACY_URL)} />
              <SmallLink label={t('signin.shared.notNow')} color={colors.muted} onPress={() => setNotNow(true)} />
            </View>
          </Animated.View>
        </>
      )}

      <BottomSheet
        visible={notNow}
        onClose={() => setNotNow(false)}
        accessibilityLabel={t('signin.consent.sheetLabel')}
        footer={
          <View style={styles.choices}>
            <ActionButton
              label={t('signin.consent.signOut')}
              variant="outline"
              size="lg"
              fg={colors.danger}
              borderColor={colors.danger}
              labelWeight={700}
              haptics
              onPress={signOut}
              accessibilityHint={t('signin.consent.signOutHint')}
              style={styles.choice}
            />
            <ActionButton label={t('signin.consent.goBack')} size="lg" onPress={() => setNotNow(false)} style={styles.choice} />
          </View>
        }>
        <View style={styles.sheet}>
          <Txt variant="display" size={26} leading={1.2} align="center" accessibilityRole="header">
            {t('signin.consent.sheetTitle')}
          </Txt>
          <Txt variant="body" align="center">
            {t('signin.consent.sheetLine')}
          </Txt>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  fill: { flex: 1 },
  content: { paddingHorizontal: space.gutter, paddingBottom: 24, gap: 24 },
  top: { gap: 28 },
  brand: { height: 32 },
  card: { padding: 18, gap: 14, borderRadius: radii.panel, backgroundColor: colors.card, boxShadow: shadows.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 1 },
  foot: { paddingHorizontal: space.gutter, paddingTop: 4, gap: 4, backgroundColor: colors.page },
  fade: { position: 'absolute', left: 0, right: 0, top: -24, height: 24 },
  promise: { paddingHorizontal: 8, paddingBottom: 10 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  sheet: { alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  choices: { flexDirection: 'row', gap: 12 },
  choice: { flex: 1 },
});
