// Parent Home (bible: Parent-Home), decluttered on Oct 24 like kid Home (#41). Today’s date with
// "Mom ▾" on its right (tap: "Who’s in the kitchen?", with Switch family and Sign out)
// + "Good morning, Mom", then only:
//  1. "Record a new recipe": the big green button, first on screen -> /record
//     Under it, only when it happened: "Your recording stopped early. Send what was filmed?" (the app
//     closed while she was filming, before "I'm done"; components/record/StoppedEarlyCard)
//  2. A recording still being made: the glasses video, its live row (the newest one only; all of them
//     are in Recipes) and the kids' live questions to answer by voice (LiveQuestions); gone when empty
//  3. "Leo made your Poha": the newest photo a kid sent of one of her dishes (MadeYourDishCard); gone
//     when there's none
//  4. "Invite family :)" (Caleb, Oct 24: back on Home, right under the photo card), once a kid has joined
// Phase 5 (docs/design/phase5-cold-parents): "Record a new recipe" is always first, the one big button (Caleb, Oct 29:
// keep it simple). Under it a kid's open ask ("Caleb wants your braised pork"), and before she has shared her
// craving link a quiet card, "Your loved ones miss your cooking." / "Ask what they're craving →" (no photo, no button), and after it "Sent! We'll tell you when they pick a dish." until an
// ask comes. One CravingSheet serves both cards.
// Cut on Oct 24 (Caleb): the family faces row ("This week at the table"), the updates card and the
// month's recap card. Their components stay for the screens that still use them. Dev aids (web screenshots): `?preview=made` shows the photo card,
// `?preview=stopped` the stopped-early card.
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { CravingAskCard } from '@/components/craving/CravingAskCard';
import { CravingSentCard } from '@/components/craving/CravingSentCard';
import { CravingSheet } from '@/components/craving/CravingSheet';
import { askForPushSoon } from '@/components/push/PushAskSheet';
import { useCravingSent } from '@/components/craving/useCravingSent';
import { InviteButton } from '@/components/invite/InviteButton';
import { LiveQuestions } from '@/components/parent/LiveQuestions';
import { MadeYourDishCard } from '@/components/parent/MadeYourDishCard';
import { PendingList, usePendingRecipes } from '@/components/parent/PendingRecipes';
import { GlassesVideoCard } from '@/components/record/GlassesVideoCard';
import { StoppedEarlyCard } from '@/components/record/StoppedEarlyCard';
import { AskCard } from '@/components/request/AskCard';
import { ActingAsBar, MoveRequestPrompt, ProfileButton } from '@/components/profiles';
import { ActionButton, EggMascot, LargeHeader, listEnter, RecordDotIcon, ScreenWash, ScrollHold, StickyHeader, useScrollHold, useScrollY } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { useCravingAsks } from '@/lib/cravings';
import { dayPart } from '@/lib/format';
import { useMadeMyDish, type MadeMyDish } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import type { Unsent } from '@/lib/unsentLogic';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, space, tabBar } from '@/theme/tokens';

/**
 * Dev aid (web screenshots only): `?preview=made` fills the photo card. Read once at startup, like the
 * session's `?as=`: the first load goes through "/", which drops the query.
 */
const PREVIEW_MADE: MadeMyDish | null =
  __DEV__ && Platform.OS === 'web' && /[?&]preview=made\b/.test(globalThis.location?.search ?? '')
    ? { messageId: 'preview-made', fromName: 'Leo', recipeTitle: 'Poha', libraryId: 'biryani', photoUrl: `${WEB_URL}/media/stock/dish-dal.jpg`, text: 'Tasted like home.', at: Date.now() - 86_400_000 }
    : null;

/** Dev aid (web screenshots only): `?preview=stopped`, a 12-minute Poha the app died in while she filmed. */
const PREVIEW_STOPPED: Unsent | null =
  __DEV__ && Platform.OS === 'web' && /[?&]preview=stopped\b/.test(globalThis.location?.search ?? '')
    ? {
        recordingId: 'preview-stopped',
        familyId: null,
        cookId: 'preview',
        clips: [0, 1, 2].map((i) => ({ path: `recordings/preview/part-0${i + 1}.mp4`, durationMs: i < 2 ? 300_000 : 120_000, width: 1080, height: 1920, startedAt: i })),
        dish: 'Poha',
        language: 'hi',
        forKids: null,
        everyone: true,
        requestFrom: null,
        savedAt: new Date().toISOString(),
        jobId: null,
        resends: 0,
        state: 'filming',
      }
    : null;

/** "Good morning" and the rest (the night says "Good evening", like lib/format goodGreeting). */
const GREETING: Record<'morning' | 'afternoon' | 'evening', { alone: WordKey; name: WordKey }> = {
  morning: { alone: 'parent.home.goodMorning', name: 'parent.home.goodMorningName' },
  afternoon: { alone: 'parent.home.goodAfternoon', name: 'parent.home.goodAfternoonName' },
  evening: { alone: 'parent.home.goodEvening', name: 'parent.home.goodEveningName' },
};

export default function ParentHome() {
  const { me, learners } = useSession();
  const { t } = useWords();
  const { scrollY, onScroll } = useScrollY();
  // A postcard's "Hold to talk" holds the page still while a finger is on it (ui/ScrollHold).
  const hold = useScrollHold();

  const name = me?.name ?? '';
  const part = dayPart();
  const hello = GREETING[part === 'night' ? 'evening' : part];
  const greeting = name ? t(hello.name, { name }) : t(hello.alone);

  // "Mom ▾" on its own line above the greeting (tap: "Who’s in the kitchen?" with Back) keeps the
  // greeting's full width, like the bible, and homie's corner free. No date there (Caleb, Nov 7).
  const avatar = <ProfileButton homieRoom />;
  const pending = usePendingRecipes();
  const live = useMadeMyDish();
  const made = PREVIEW_MADE ?? live;
  const asks = useCravingAsks();
  const open = asks.filter((a) => !a.answered);
  const sent = useCravingSent(me?.id);
  const [craving, setCraving] = useState(false);
  const askCraving = () => setCraving(true);

  return (
    <View style={styles.screen}>
      <ScrollHold value={hold.set}>
        <Animated.ScrollView
          scrollEnabled={!hold.held}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: tabBar.clearance }}>
          <ScreenWash tone="parent" height={380} />
          <LargeHeader title={greeting} size={34} eyebrowRight={avatar} titleRight={<EggMascot mood="hello" size={56} />} scrollY={scrollY} fadeEnd={40} />
          <ActingAsBar />

          <View style={styles.col}>
            <Animated.View entering={listEnter(0)}>
              <ActionButton
                label={t('parent.home.record')}
                size="xl"
                icon={
                  <View style={styles.recordDot}>
                    <RecordDotIcon size={14} color={colors.danger} />
                  </View>
                }
                onPress={() => router.push('/record')}
                accessibilityHint={t('parent.home.recordHint')}
              />
            </Animated.View>
            {open.map((a, i) => (
              <Animated.View key={a.id} entering={listEnter(i + 1)}>
                <AskCard ask={a} />
              </Animated.View>
            ))}
            {sent === false && !asks.length ? <CravingAskCard onAsk={askCraving} enterIndex={1} /> : null}

            {sent && !asks.length ? <CravingSentCard onSendAgain={askCraving} enterIndex={1} /> : null}
            <StoppedEarlyCard preview={PREVIEW_STOPPED} enterIndex={1} />
            <GlassesVideoCard />
            <PendingList pending={pending} jobs={pending.jobs.slice(0, 1)} startIndex={1} />
            <LiveQuestions enterIndex={1} />
            <MadeYourDishCard made={made} cookName={me?.name} enterIndex={2} />

            {learners.length ? (
              <Animated.View entering={listEnter(3)}>
                <InviteButton />
              </Animated.View>
            ) : null}
          </View>
        </Animated.ScrollView>
      </ScrollHold>
      <StickyHeader title={t('parent.tab.home')} scrollY={scrollY} start={40} />
      <MoveRequestPrompt />
      <CravingSheet
        visible={craving}
        onClose={() => setCraving(false)}
        onSent={() => me && askForPushSoon({ kind: 'cook-craving-sent', profileId: me.id, name: '' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  col: { paddingHorizontal: space.gutter, paddingTop: space.xxl, gap: space.xxxl },
  // The Record screen's cream disc with the red dot, small enough for the pill.
  recordDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
