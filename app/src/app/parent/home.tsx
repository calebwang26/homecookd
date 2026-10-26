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
//  4. "Invite family :)" (Caleb, Oct 24: back on Home, right under the photo card)
// Cut on Oct 24 (Caleb): the family faces row ("This week at the table"), the updates card and the
// month's recap card. Their components stay for the screens that still use them. Dev aids (web screenshots): `?preview=made` shows the photo card,
// `?preview=stopped` the stopped-early card.
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { InviteButton } from '@/components/invite/InviteButton';
import { LiveQuestions } from '@/components/parent/LiveQuestions';
import { MadeYourDishCard } from '@/components/parent/MadeYourDishCard';
import { PendingList, usePendingRecipes } from '@/components/parent/PendingRecipes';
import { GlassesVideoCard } from '@/components/record/GlassesVideoCard';
import { StoppedEarlyCard } from '@/components/record/StoppedEarlyCard';
import { ActingAsBar, MoveRequestPrompt, ProfileButton } from '@/components/profiles';
import { ActionButton, LargeHeader, listEnter, RecordDotIcon, ScreenWash, ScrollHold, StickyHeader, useScrollHold, useScrollY } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { dayPart, longDate } from '@/lib/format';
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
        language: 'mr',
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
  const { me } = useSession();
  const { t } = useWords();
  const { scrollY, onScroll } = useScrollY();
  // A postcard's "Hold to talk" holds the page still while a finger is on it (ui/ScrollHold).
  const hold = useScrollHold();

  const name = me?.name ?? '';
  const part = dayPart();
  const hello = GREETING[part === 'night' ? 'evening' : part];
  const greeting = name ? t(hello.name, { name }) : t(hello.alone);

  // "Mom ▾" on the date line (tap: "Who’s in the kitchen?" with Back) keeps the greeting's full
  // width, like the bible. It also keeps homie's corner free, so the date never runs under the pot.
  const avatar = <ProfileButton homieRoom />;
  const pending = usePendingRecipes();
  const live = useMadeMyDish();
  const made = PREVIEW_MADE ?? live;

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
          <LargeHeader eyebrow={longDate(undefined, t)} eyebrowTone="parent" title={greeting} size={34} eyebrowRight={avatar} scrollY={scrollY} fadeEnd={40} />
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

            <StoppedEarlyCard preview={PREVIEW_STOPPED} enterIndex={1} />
            <GlassesVideoCard />
            <PendingList pending={pending} jobs={pending.jobs.slice(0, 1)} startIndex={1} />
            <LiveQuestions enterIndex={1} />
            <MadeYourDishCard made={made} cookName={me?.name} enterIndex={2} />

            <Animated.View entering={listEnter(3)}>
              <InviteButton />
            </Animated.View>
          </View>
        </Animated.ScrollView>
      </ScrollHold>
      <StickyHeader title={t('parent.tab.home')} scrollY={scrollY} start={40} />
      <MoveRequestPrompt />
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
