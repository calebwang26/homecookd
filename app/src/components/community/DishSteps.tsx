// A tapped dish, one step at a time (Caleb's final Community canvas): its card with ONE button, "Connect
// with Mama Ngozi"; then the chooser: "Join Mama Ngozi’s dinner" (when she hosts one still ahead), "Swap
// recipes", "Cook together" ("Ask Mama Ngozi to make it with you"; once they said yes it's "Host a
// dinner" of that dish); then, for a swap, which of our shared dishes to offer. A shared circle (the
// floormates) keeps its row of dishes above the card. The card rises in; each next step crossfades.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { haptic, useToast } from '@/components/ui';
import { cookTogether, requestSwap, type Dinner, type FamilyDish, type FeedRecipe, type Swap } from '@/lib/live/community';

import { Chooser } from './Chooser';
import { connectRows, dishTitle, midSentence, offerRows } from './choices';
import { ClusterRow } from './ClusterRow';
import { DishCard } from './DishCard';
import { errorText } from './labels';
import type { Spot } from './mapLayout';
import { crossIn, fadeOut, riseIn } from './motion';

export type DishStep = 'info' | 'connect' | 'offer';

export function DishSteps({
  spot,
  member,
  step,
  onMember,
  onStep,
  mine,
  swaps,
  dishes,
  now,
  width,
}: {
  spot: Spot<FeedRecipe>;
  member: number;
  step: DishStep;
  onMember: (i: number) => void;
  onStep: (s: DishStep) => void;
  mine: Dinner[];
  swaps: Swap[];
  dishes: FamilyDish[] | null;
  now: number;
  width: number;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  // The card rises in when this dish opens (the parent keys this by the dish); back from the chooser it crossfades.
  const [back, setBack] = useState(false);

  const recipe = spot.members[member] ?? spot.members[0];
  if (!recipe) return null;
  const dinner = recipe.dinner && recipe.dinner.startsAt > now ? recipe.dinner : null;
  const myRequest = (dinner && mine.find((d) => d.dinnerId === dinner.dinnerId)?.myRequest?.status) || null;
  const ours = (kind: Swap['kind']) => swaps.find((s) => s.kind === kind && !s.incoming && s.theirDish?.recipeId === recipe.recipeId) ?? null;
  const swap = ours('swap');
  const cook = ours('cook');
  const offers = (dishes ?? []).filter((d) => d.shared);

  const asked = async (send: () => Promise<unknown>, next?: DishStep) => {
    try {
      await send();
      haptic('success');
      toast.show(`Asked ${midSentence(recipe.familyName)}`);
      if (next) onStep(next);
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };
  const askSwap = (myRecipeId?: string) => asked(() => requestSwap(recipe.recipeId, myRecipeId), 'connect');

  const pick = (key: string) => {
    if (key === 'join' && dinner) return router.push({ pathname: '/dinner/[id]', params: { id: dinner.dinnerId } });
    if (key === 'cook') {
      // They said yes: host a dinner of their dish together.
      if (cook?.status === 'accepted') return router.push({ pathname: '/dinner/new', params: { recipeId: recipe.recipeId } });
      return asked(() => cookTogether(recipe.recipeId));
    }
    if (key !== 'swap') return;
    if (swap?.status === 'accepted') return router.push({ pathname: '/community/[id]', params: { id: recipe.recipeId } });
    // Still loading our dishes: the offer step fills in as they come.
    return dishes === null || offers.length ? onStep('offer') : askSwap();
  };

  const entering = step === 'info' && !back ? riseIn(reduce) : crossIn();
  return (
    <Animated.View key={step} entering={entering} exiting={fadeOut()}>
      {step === 'connect' ? (
        <Chooser
          title={dishTitle(recipe.cookName, recipe.dish)}
          rows={connectRows({ recipe, dinner, myRequest, swap: swap?.status ?? null, cook: cook?.status ?? null, now })}
          onBack={() => {
            setBack(true);
            onStep('info');
          }}
          onPick={pick}
        />
      ) : step === 'offer' ? (
        <Chooser title="Offer one of yours" rows={offerRows(offers)} onBack={() => onStep('connect')} onPick={(key) => askSwap(key === 'none' ? undefined : key)} />
      ) : (
        <View style={styles.info}>
          {spot.members.length > 1 ? <ClusterRow members={spot.members} picked={spot.members.indexOf(recipe)} onPick={onMember} width={width} /> : null}
          <DishCard
            key={recipe.recipeId}
            recipe={recipe}
            onConnect={() => onStep('connect')}
            onHost={() => router.push({ pathname: '/dinner/new', params: { recipeId: recipe.recipeId } })}
          />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ info: { gap: 16 } });
