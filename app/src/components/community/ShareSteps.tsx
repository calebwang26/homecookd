// "Share your recipe", one step at a time (Caleb's Community canvas): "Put it on the map" ("homie asks
// Grandma Rajani first. The video stays private.") and "Host a dinner". With several family dishes,
// "Put it on the map" asks which one. A dish she cooks goes on at once; anyone else's becomes homie's
// question to its cook (shareRequests.ask), and the row says "Asked Grandma Rajani" until she answers,
// then "Grandma Rajani said not now" for a day if she didn't say yes. Each step crossfades in.
import { router } from 'expo-router';
import Animated from 'react-native-reanimated';

import { haptic, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { askToShare, type FamilyDish } from '@/lib/live/community';

import { Chooser } from './Chooser';
import { dishRows, shareChoices } from './choices';
import { errorText } from './labels';
import { crossIn, fadeOut } from './motion';

export type ShareStep = 'menu' | 'dishes';

export function ShareSteps({
  step,
  onStep,
  onClose,
  dishes,
  now,
}: {
  step: ShareStep;
  onStep: (s: ShareStep) => void;
  onClose: () => void;
  dishes: FamilyDish[] | null;
  now: number;
}) {
  const toast = useToast();
  const { title, rows } = shareChoices(dishes, now);

  const put = async (d: FamilyDish) => {
    // The map's story card is Muse's (and an ask is translated for the cook): asked first, once.
    if (!(await ensureAiConsent())) return;
    try {
      const done = await askToShare(d.recipeId, d.cookName);
      haptic('success');
      toast.show(done === 'shared' ? 'It’s on the map.' : `Asked ${d.cookName.trim() || 'the cook'}`);
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };

  const pickMenu = (key: string) => {
    if (key === 'host') return router.push('/dinner/new');
    if (key !== 'map' || !dishes?.length) return;
    return dishes.length === 1 ? put(dishes[0]) : onStep('dishes');
  };

  return (
    <Animated.View key={step} entering={crossIn()} exiting={fadeOut()}>
      {step === 'dishes' && dishes ? (
        <Chooser
          title="Put it on the map"
          rows={dishRows(dishes, now)}
          onBack={() => onStep('menu')}
          onPick={(id) => {
            const d = dishes.find((x) => x.recipeId === id);
            return d ? put(d) : undefined;
          }}
        />
      ) : (
        <Chooser title={title} rows={rows} onBack={onClose} onPick={pickMenu} />
      )}
    </Animated.View>
  );
}
