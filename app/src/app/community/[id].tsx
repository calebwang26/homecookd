// A neighbor family's shared recipe, text only (community.recipe, live): the dish, whose it is, the
// story card (written with AI, and labelled so) and the steps. Never /recipe/<id>: that page plays the
// family's video, which stays with the family. The query rides on this person's session, so a cold
// open from a link waits for sign-in instead of failing.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { coverFor, useWaited } from '@/components/community/data';
import { DetailPage, goBack } from '@/components/community/DetailPage';
import { privacyNote } from '@/components/community/labels';
import { StepNumber } from '@/components/recipe/StepNumber';
import { EmptyState, Skeleton, Txt } from '@/components/ui';
import { useCommunityRecipe } from '@/lib/live/community';
import { colors, radii } from '@/theme/tokens';

/** Still nothing after this long (no session, no connection): say so, with a way to try again. */
const STUCK_MS = 10_000;

export default function CommunityRecipePage() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [attempt, setAttempt] = useState(0);
  // A new id or a retry starts over: a fresh subscription, and the wait counts again.
  return <SharedRecipe key={`${id}:${attempt}`} id={id} onRetry={() => setAttempt((n) => n + 1)} />;
}

function SharedRecipe({ id, onRetry }: { id: string; onRetry: () => void }) {
  const recipe = useCommunityRecipe(id);
  const stuck = useWaited(STUCK_MS);

  if (!id || recipe === null) {
    return (
      <DetailPage title="" photo={null}>
        <EmptyState title="This recipe isn’t shared anymore" actionLabel="Back" onAction={() => goBack()} />
      </DetailPage>
    );
  }

  if (recipe === undefined && stuck) {
    return (
      <DetailPage title="" photo={coverFor(id)}>
        <EmptyState title="Couldn’t open this recipe" actionLabel="Try again" onAction={onRetry} />
      </DetailPage>
    );
  }

  const steps = recipe ? [...recipe.steps].sort((a, b) => a.order - b.order) : [];
  return (
    <DetailPage title={recipe?.dish ?? ''} photo={coverFor(id)}>
      {recipe ? (
        <>
          <View style={styles.head}>
            <Txt variant="display" size={30} accessibilityRole="header">
              {recipe.dish}
            </Txt>
            <Txt variant="body" size={16}>
              {recipe.familyName}
            </Txt>
          </View>

          {recipe.story ? (
            <View style={styles.story}>
              <Txt variant="bodyInk" size={17} leading={1.4} color={colors.lavenderInk}>
                {recipe.story}
              </Txt>
              <Txt variant="caption" color={colors.lavenderInk}>
                Story written with AI from their recipe
              </Txt>
            </View>
          ) : null}

          <View style={styles.steps}>
            {steps.map((s, i) => (
              <View key={s.order} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}. ${s.title}. ${s.text}`}>
                <StepNumber n={i + 1} />
                <View style={styles.stepText}>
                  <Txt variant="rowTitle" size={17}>
                    {s.title}
                  </Txt>
                  <Txt variant="bodyInk" leading={1.45}>
                    {s.text}
                  </Txt>
                </View>
              </View>
            ))}
          </View>

          <Txt variant="caption" align="center">
            {privacyNote(recipe.cookName, false)}
          </Txt>
        </>
      ) : (
        <View style={styles.head}>
          <Skeleton width="70%" height={30} />
          <Skeleton width="40%" height={16} />
          <Skeleton height={90} radius={radii.quote} style={styles.gap} />
          <Skeleton height={60} radius={radii.tile} />
        </View>
      )}
    </DetailPage>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
  gap: { marginTop: 16 },
  story: { gap: 8, paddingVertical: 16, paddingHorizontal: 20, borderRadius: radii.quote, backgroundColor: colors.lavender },
  steps: { gap: 20 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepText: { flex: 1, minWidth: 0, gap: 4 },
});
