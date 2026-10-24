// Parent Home (bible: Parent-Home). Today’s date with "Mom ▾" on its right (tap: "Who’s in the
// kitchen?", with Switch family and Sign out) + "Good morning, Mom", then "This week at the table"
// (RETENTION-HANDOFF 3.2: the family's faces in big type, a small flame on whoever did their part this
// week, nothing on the others; tap a face = their chat; no memorial faces; hidden until the table
// loads and when nobody else is in the family), then three things only:
//  1. "Record a new recipe": the big green button, first on screen -> /record
//  2. A recording still being made (hackathon): its live row, the newest one only (all of them are in
//     Recipes), and the kids' live questions to answer by voice (LiveQuestions); both gone when empty
//  3. <UpdatesCard/>: questions to answer, requests, and who made my dishes (gone when empty)
//  4. "Invite family"
// From the 1st to the 7th only, "Your November in the kitchen" (3.7: last month's recap, until it's
// opened; nothing at all for an empty month) comes after all three, the last thing on the page, so
// its arrival moves nothing: no space is held while its answer is on its way, and an empty month or a
// failed call leaves the page exactly as on any other day (RecapCard, `last`). TODO(caleb): where the
// month's card goes on the cook Home (under the big button it needed a held space, which an empty
// month or a failed call then let go, moving the questions under it up).
// Sending recipes and recordings still on their way live in the Recipes tab.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { InviteButton } from '@/components/invite/InviteButton';
import { LiveQuestions } from '@/components/parent/LiveQuestions';
import { PendingList, usePendingRecipes } from '@/components/parent/PendingRecipes';
import { UpdatesCard } from '@/components/parent/UpdatesCard';
import { ActingAsBar, MoveRequestPrompt, ProfileButton } from '@/components/profiles';
import { RecapCard, useRecapCard } from '@/components/recap/RecapCard';
import { HomeTableRow } from '@/components/table/HomeTableRow';
import { ActionButton, LargeHeader, listEnter, RecordDotIcon, ScreenWash, ScrollHold, StickyHeader, useScrollHold, useScrollY } from '@/components/ui';
import { goodGreeting, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, space, tabBar } from '@/theme/tokens';

export default function ParentHome() {
  const { me } = useSession();
  const { scrollY, onScroll } = useScrollY();
  // A postcard's "Hold to talk" holds the page still while a finger is on it (ui/ScrollHold).
  const hold = useScrollHold();

  const name = me?.name ?? '';
  const greeting = `${goodGreeting()}${name ? `, ${name}` : ''}`;

  // "Mom ▾" on the date line (tap: "Who’s in the kitchen?" with Back) keeps the greeting's full
  // width, like the bible.
  const avatar = <ProfileButton />;
  const recap = useRecapCard(me?.id, { last: true });
  const pending = usePendingRecipes();

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
          <LargeHeader eyebrow={longDate()} eyebrowTone="parent" title={greeting} size={34} eyebrowRight={avatar} scrollY={scrollY} fadeEnd={40} />
          <ActingAsBar />
          <HomeTableRow large style={styles.table} />

          <View style={styles.col}>
            <Animated.View entering={listEnter(0)}>
              <ActionButton
                label="Record a new recipe"
                size="xl"
                icon={
                  <View style={styles.recordDot}>
                    <RecordDotIcon size={14} color={colors.danger} />
                  </View>
                }
                onPress={() => router.push('/record')}
                accessibilityHint="Film yourself cooking, then send it to the family"
              />
            </Animated.View>

            <PendingList pending={pending} jobs={pending.jobs.slice(0, 1)} startIndex={1} />
            <LiveQuestions enterIndex={1} />
            <UpdatesCard enterIndex={1} />

            <Animated.View entering={listEnter(2)}>
              <InviteButton />
            </Animated.View>

            <RecapCard card={recap} onOpen={(month) => router.push({ pathname: '/recap', params: { month } })} />
          </View>
        </Animated.ScrollView>
      </ScrollHold>
      <StickyHeader title="Home" scrollY={scrollY} start={40} />
      <MoveRequestPrompt />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  table: { paddingHorizontal: space.gutter, marginTop: space.lg },
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
