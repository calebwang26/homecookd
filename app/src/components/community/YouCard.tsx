// What a tap on "You" opens under the map: the dinner you host or are in (the dark card, live, with
// "1 new request" for the host), the swaps and "cook together" asks another family sent yours (Accept /
// Decline), the swaps you agreed on ("You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family", a
// tap opens their recipe) and the dishes you're cooking together ("Cooking Jollof Rice together with the
// Okafor family", with "Host a dinner" as the next step), or one line saying they show up here. Hosting
// your own dinner lives only under "Share your recipe". Kept off the map until asked for.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionButton, ChevronRightIcon, PlusIcon, PressableScale, Txt, useToast } from '@/components/ui';
import { respondSwap, type Swap } from '@/lib/live/community';
import { colors, radii, shadows } from '@/theme/tokens';

import { swapLine } from './choices';
import { DinnerCard, type DinnerPick } from './DinnerCard';
import { errorText } from './labels';

export function YouCard({ next, swaps, now }: { next: DinnerPick | null; swaps: Swap[]; now: number }) {
  const id = next ? ('mine' in next ? next.mine.dinnerId : next.feed.dinnerId) : null;
  const asked = swaps.filter((s) => s.incoming && s.status === 'pending');
  const swapping = swaps.filter((s) => s.status === 'accepted');
  return (
    <View style={styles.wrap}>
      {next && id ? (
        <DinnerCard key={id} pick={next} now={now} onOpen={() => router.push({ pathname: '/dinner/[id]', params: { id } })} />
      ) : null}
      {asked.map((s) => (
        <SwapAsk key={s.swapId} swap={s} />
      ))}
      {swapping.map((s) => {
        const theirs = s.theirDish;
        const line = swapLine(s);
        if (s.kind === 'cook') return <CookingTogether key={s.swapId} swap={s} line={line} />;
        return theirs ? (
          <PressableScale
            key={s.swapId}
            scaleTo={0.98}
            accessibilityRole="link"
            accessibilityLabel={line}
            accessibilityHint={`Opens their ${theirs.dish}`}
            onPress={() => router.push({ pathname: '/community/[id]', params: { id: theirs.recipeId } })}
            style={[styles.card, styles.row]}>
            <Txt variant="rowTitle" size={17} style={styles.flex}>
              {line}
            </Txt>
            <ChevronRightIcon size={20} strokeWidth={2.2} color={colors.muted} />
          </PressableScale>
        ) : (
          <View key={s.swapId} style={styles.card}>
            <Txt variant="rowTitle" size={17}>
              {line}
            </Txt>
          </View>
        );
      })}
      {!(next && id) && !asked.length && !swapping.length ? (
        <View style={styles.card}>
          <Txt variant="body" size={17} leading={1.4} align="center">
            Your dinners and the dishes you swap or cook together show up here.
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/** "Cooking Jollof Rice together with the Okafor family", and the next step: host a dinner of it. */
function CookingTogether({ swap, line }: { swap: Swap; line: string }) {
  const dish = swap.theirDish ?? swap.ourDish;
  return (
    <View style={styles.card}>
      <Txt variant="rowTitle" size={17}>
        {line}
      </Txt>
      {dish ? (
        <ActionButton
          label="Host a dinner"
          size="sm"
          icon={<PlusIcon size={20} color={colors.card} strokeWidth={2.2} />}
          accessibilityHint={`Pick a time and place for ${dish.dish}`}
          onPress={() => router.push({ pathname: '/dinner/new', params: { recipeId: dish.recipeId } })}
        />
      ) : null}
    </View>
  );
}

/** "The Pawar family would swap their Kanda Poha for your Dumplings." with Decline / Accept. */
function SwapAsk({ swap }: { swap: Swap }) {
  const toast = useToast();
  const what = swap.kind === 'cook' ? 'cooking together' : 'the swap';
  const answer = (accept: boolean) => async () => {
    try {
      await respondSwap(swap.swapId, accept);
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Txt variant="rowTitle" size={17}>
        {swapLine(swap)}
      </Txt>
      <View style={styles.answers}>
        <ActionButton label="Decline" variant="outline" size="xs" padH={16} onPress={answer(false)} accessibilityLabel={`Decline ${what} with ${swap.familyName}`} />
        <ActionButton label="Accept" size="xs" padH={16} flat onPress={answer(true)} accessibilityLabel={`Accept ${what} with ${swap.familyName}`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: { gap: 12, padding: 16, borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.card },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  answers: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
