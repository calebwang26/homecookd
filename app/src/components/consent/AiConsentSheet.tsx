// The small sheet that asks before something goes to the AI companies for the first time (App Store
// guideline 5.1.2(i); lib/aiConsent asks for it):
//   homecookd uses AI for this
//   Your videos, photos and voice go to AI services ... Never for ads.
//   See who ˅            opens the companies and what each gets, in place (1.1 on AWS: Claude and Cartesia only)
//   Privacy policy       homecookd.app/privacy in the app's browser sheet
//   [ OK, continue ]     the yes, saved on this phone; the action goes on
//   Not now              nothing is sent; the action doesn't start (closing the sheet is the same)
// Mounted once in app/_layout (AiConsentHost), above every screen. On a small phone the words scroll
// under the two buttons, which always stay on screen.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ActionButton, BottomSheet, ChevronDownIcon, ChevronUpIcon, PressableScale, Txt } from '@/components/ui';
import { answerAiConsent, useAiConsentAsking } from '@/lib/aiConsent';
import { AWS_ON } from '@/lib/aws/config';
import { openPage, PRIVACY_URL } from '@/lib/links';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, radii } from '@/theme/tokens';

/**
 * Who gets what (`job`: its words' key). A company added here means a new AI_CONSENT_KEY version, so everyone is
 * asked again; one taken away doesn't. 1.1 on AWS sends nothing to Moss (Caleb, Nov 2) or Gemini (no glasses, and
 * every pipeline step is Claude's), so they aren't named there.
 */
export const AI_COMPANIES: { name: string; job: WordKey }[] = [
  { name: 'Anthropic Claude', job: 'common.ai.claude' },
  { name: 'Cartesia', job: 'common.ai.cartesia' },
  ...(AWS_ON
    ? []
    : ([
        { name: 'Moss', job: 'common.ai.moss' },
        { name: 'Google Gemini', job: 'common.ai.gemini' },
      ] as const)),
];

export function AiConsentHost() {
  const asking = useAiConsentAsking();
  return <AiConsentSheet visible={asking} onYes={() => void answerAiConsent(true)} onNotNow={() => void answerAiConsent(false)} />;
}

export function AiConsentSheet({ visible, onYes, onNotNow }: { visible: boolean; onYes: () => void; onNotNow: () => void }) {
  const { t } = useWords();
  const [open, setOpen] = useState(false);
  // Each ask starts with the list closed.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpen(false);
  }
  const Chevron = open ? ChevronUpIcon : ChevronDownIcon;
  return (
    <BottomSheet visible={visible} onClose={onNotNow} showClose={false} contentStyle={styles.shrink} accessibilityLabel={t('common.ai.title')}>
      <ScrollView style={styles.shrink} contentContainerStyle={styles.body} bounces={false} showsVerticalScrollIndicator={false}>
        <Txt variant="display" size={26} leading={1.2} accessibilityRole="header">
          {t('common.ai.title')}
        </Txt>
        <Txt variant="body" size={17}>
          {t('common.ai.line')}
        </Txt>
        <View style={styles.links}>
          <PressableScale
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={t('common.ai.seeWho')}
            accessibilityState={{ expanded: open }}
            style={styles.link}>
            <Txt variant="label" size={16} weight={700} color={colors.yolkDeep}>
              {t('common.ai.seeWho')}
            </Txt>
            <Chevron size={18} color={colors.yolkDeep} />
          </PressableScale>
          <PressableScale
            onPress={() => void openPage(PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel={t('signin.shared.privacy')}
            accessibilityHint={t('signin.shared.opensSite')}
            style={styles.link}>
            <Txt variant="label" size={16} weight={600} color={colors.yolkDeep}>
              {t('signin.shared.privacy')}
            </Txt>
          </PressableScale>
        </View>
        {open ? (
          <View style={styles.list}>
            {AI_COMPANIES.map(({ name, job }) => (
              <View key={name} accessible accessibilityLabel={t('common.ai.row', { name, job: t(job) })} style={styles.row}>
                <Txt variant="label" size={16} weight={700} color={colors.ink}>
                  {name}
                </Txt>
                <Txt variant="body" size={15}>
                  {t(job)}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.actions}>
        <ActionButton label={t('common.ai.ok')} size="xl" onPress={onYes} accessibilityHint={t('common.ai.okHint')} />
        <PressableScale onPress={onNotNow} haptic accessibilityRole="button" accessibilityLabel={t('signin.shared.notNow')} style={styles.later}>
          <Txt variant="label" size={17} weight={600} color={colors.muted}>
            {t('signin.shared.notNow')}
          </Txt>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  body: { gap: 10, paddingTop: 4, paddingHorizontal: 4, paddingBottom: 16 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, marginTop: -4 },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { gap: 10, padding: 14, borderRadius: radii.quote, backgroundColor: colors.page },
  row: { gap: 1 },
  actions: { gap: 6, paddingTop: 2, paddingBottom: 4 },
  later: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
