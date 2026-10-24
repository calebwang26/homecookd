// One Community dinner (dinners.get, live): the photo, "Tonight · 7:00 pm · 6 seats", the dish,
// "Hosted by Shreya · the Pawar family", then what this person can do: the host answers requests
// and sees the address; a guest asks to join and, once the host says yes, sees the exact address;
// then "Who's coming", the recipe's text, and the note that the cook's video and voice stay home.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { coverFor, useNow, useWaited } from '@/components/community/data';
import { DetailPage, goBack } from '@/components/community/DetailPage';
import { GuestStatus, HostPanel, WhoComing } from '@/components/community/DinnerParts';
import { detailWhen, hostLine, privacyNote } from '@/components/community/labels';
import { ChevronRightIcon, EmptyState, PressableScale, Skeleton, Txt } from '@/components/ui';
import { getCommunityRecipe, useDinner, type CommunityRecipe } from '@/lib/live/community';
import { alpha, colors, radii } from '@/theme/tokens';

/** dinners.get answers null while it loads and for a dinner that's gone: wait this long to say so. */
const MISSING_MS = 4000;

export default function DinnerPage() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const dinner = useDinner(id || null);
  const now = useNow();
  const waited = useWaited(MISSING_MS);

  // The recipe's text says whose family it is (and who cooked it), when it can be opened.
  const recipeId = dinner?.recipeId ?? null;
  const [story, setStory] = useState<{ id: string; recipe: CommunityRecipe | null } | null>(null);
  useEffect(() => {
    if (!recipeId) return;
    let alive = true;
    getCommunityRecipe(recipeId).then(
      (recipe) => alive && setStory({ id: recipeId, recipe }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [recipeId]);
  const recipe = story && story.id === recipeId ? story.recipe : null;

  if (!dinner) {
    return (
      <DetailPage title="" photo={null}>
        {waited || !id ? (
          <EmptyState title="This dinner isn’t here anymore" actionLabel="Back" onAction={() => goBack()} />
        ) : (
          <View style={styles.head}>
            <Skeleton width="55%" height={16} />
            <Skeleton width="75%" height={30} />
            <Skeleton width="60%" height={16} />
            <Skeleton height={64} radius={radii.pill} style={styles.gap} />
          </View>
        )}
      </DetailPage>
    );
  }

  const past = dinner.startsAt <= now;
  const ended = dinner.status === 'cancelled' ? 'This dinner was called off.' : past ? 'This dinner already happened.' : null;

  return (
    <DetailPage title={dinner.dish} photo={coverFor(recipeId)}>
      <View style={styles.head}>
        <Txt variant="label" size={16} weight={700} color={colors.greenDeep}>
          {detailWhen(dinner.startsAt, dinner.seats, now)}
        </Txt>
        <Txt variant="display" size={30} accessibilityRole="header">
          {dinner.dish}
        </Txt>
        <Txt variant="body" size={16}>
          {hostLine(dinner.isHost ? 'you' : dinner.hostName, recipe?.familyName)}
        </Txt>
      </View>

      {ended ? (
        <View style={styles.ended}>
          <Txt variant="title" size={18}>
            {ended}
          </Txt>
        </View>
      ) : dinner.isHost ? (
        <HostPanel dinner={dinner} />
      ) : (
        <GuestStatus dinner={dinner} />
      )}

      <WhoComing dinner={dinner} />

      {recipeId ? (
        <PressableScale
          onPress={() => router.push({ pathname: '/community/[id]', params: { id: recipeId } })}
          accessibilityRole="link"
          accessibilityLabel="See the recipe"
          style={styles.recipe}>
          <Txt variant="title" size={16} style={styles.flex}>
            See the recipe
          </Txt>
          <ChevronRightIcon size={20} strokeWidth={2.2} color={colors.muted} />
        </PressableScale>
      ) : null}

      {dinner.isHost ? null : (
        <Txt variant="caption" align="center">
          {privacyNote(recipe?.cookName, !!recipeId)}
        </Txt>
      )}
    </DetailPage>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
  gap: { marginTop: 16 },
  ended: { padding: 20, borderRadius: radii.card, backgroundColor: colors.well },
  flex: { flex: 1 },
  recipe: {
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: alpha.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
