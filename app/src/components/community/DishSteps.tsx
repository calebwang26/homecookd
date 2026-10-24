// A tapped dish, one step at a time (Caleb's Community mockup): its card with ONE button, "Connect
// with Mama Ngozi"; then the chooser: "Join Mama Ngozi’s dinner" (when she hosts one still ahead),
// "Swap recipes", "Host a dinner"; then, for a swap, which of our shared dishes to offer. A shared
// circle (the floormates) keeps its row of dishes above the card.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { haptic, listEnter, useToast } from '@/components/ui';
import { requestSwap, type Dinner, type FamilyDish, type FeedRecipe, type Swap } from '@/lib/live/community';

import { Chooser } from './Chooser';
import { connectRows, dishTitle, midSentence, offerRows } from './choices';
import { ClusterRow } from './ClusterRow';
import { DishCard } from './DishCard';
import { errorText } from './labels';
import type { Spot } from './mapLayout';

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
  const recipe = spot.members[member] ?? spot.members[0];
  if (!recipe) return null;
  const dinner = recipe.dinner && recipe.dinner.startsAt > now ? recipe.dinner : null;
  const myRequest = (dinner && mine.find((d) => d.dinnerId === dinner.dinnerId)?.myRequest?.status) || null;
  const swap = swaps.find((s) => !s.incoming && s.theirDish?.recipeId === recipe.recipeId) ?? null;
  const offers = (dishes ?? []).filter((d) => d.shared);

  const ask = async (myRecipeId?: string) => {
    try {
      await requestSwap(recipe.recipeId, myRecipeId);
      haptic('success');
      toast.show(`Asked ${midSentence(recipe.familyName)}`);
      onStep('connect');
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };

  const pick = (key: string) => {
    if (key === 'join' && dinner) return router.push({ pathname: '/dinner/[id]', params: { id: dinner.dinnerId } });
    if (key === 'host') return router.push('/dinner/new');
    if (key !== 'swap') return;
    if (swap?.status === 'accepted') return router.push({ pathname: '/community/[id]', params: { id: recipe.recipeId } });
    // Still loading our dishes: the offer step fills in as they come.
    return dishes === null || offers.length ? onStep('offer') : ask();
  };

  return (
    <Animated.View key={`${spot.key}:${step}`} entering={listEnter(0)}>
      {step === 'connect' ? (
        <Chooser
          title={dishTitle(recipe.cookName, recipe.dish)}
          rows={connectRows({ recipe, dinner, myRequest, swap: swap?.status ?? null, now })}
          onBack={() => onStep('info')}
          onPick={pick}
        />
      ) : step === 'offer' ? (
        <Chooser title="Offer one of yours" rows={offerRows(offers)} onBack={() => onStep('connect')} onPick={(key) => ask(key === 'none' ? undefined : key)} />
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
