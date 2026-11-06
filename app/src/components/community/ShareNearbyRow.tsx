// The cook's Community switch, one quiet row at the foot of her own recipe page (my-recipe/[id]),
// in the shape of ShareCookingRow:
//   Share with people nearby · Off
//   Neighbors see the recipe text, one line you said and homie’s guess at where it’s from, never your
//   video or voice.
// (The line is the map card's quote, one of her own step quotes; the guess is Muse's culture label.)
// A tap flips it (community.setShare; a failure flips it back with a toast). The first time it goes
// on, Muse writes the dish's story card, so turning it on asks first the first time (lib/aiConsent;
// "Not now" leaves it off). Hidden unless this dish has a ready Convex row and the
// person here is its cook (the server checks that again).
// On AWS, a recipe the team took off the map after a report (`hiddenAt`) shows that instead of the
// switch, and can't be turned on until the team lifts it (JOBS.md, `hiddenAt`).
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptic, PressableScale, Txt, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { AWS_ON } from '@/lib/aws/config';
import { setShare } from '@/lib/live/community';
import { colors } from '@/theme/tokens';

import { useFamilyRecipes } from './data';
import { errorText } from './labels';

// TODO(caleb): the words a cook reads before she shares (the map card shows one line she said and
// Muse's guess at the dish's culture, tagged AI).
const WHAT_NEIGHBORS_SEE = 'Neighbors see the recipe text, one line you said and homie’s guess at where it’s from, never your video or voice.';
// errors.taken_down's English (the api's 409 says the same).
const TAKEN_DOWN = 'Our team took this recipe off the map after a report. It stays with your family.';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export type ShareNearbyRowProps = {
  /** The library id on this page (recipes.libraryId in Convex). */
  libraryId: string;
  /** Who is acting on this phone; only a cook whose name is on the dish sees the row. */
  me: { name: string; role: string } | null | undefined;
  style?: StyleProp<ViewStyle>;
};

export function ShareNearbyRow({ libraryId, me, style }: ShareNearbyRowProps) {
  const toast = useToast();
  const isCook = me?.role === 'cook';
  const rows = useFamilyRecipes(isCook && !!libraryId);
  const row = rows?.find((r) => r.libraryId === libraryId) ?? null;
  // What the cook just tapped, until the live row says the same (or the save fails).
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isCook || !row || row.status !== 'ready' || norm(row.cookName) !== norm(me?.name)) return null;
  if (AWS_ON && row.hiddenAt) {
    return (
      <View style={[styles.wrap, style]} accessible accessibilityLabel={`Off the map. ${TAKEN_DOWN}`}>
        <View style={styles.row}>
          <Txt variant="label" weight={600} color={colors.muted}>
            Share with people nearby ·{' '}
            <Txt variant="label" weight={700} color={colors.muted}>
              Off the map
            </Txt>
          </Txt>
        </View>
        <Txt variant="caption" align="center">
          {TAKEN_DOWN}
        </Txt>
      </View>
    );
  }
  const live = !!row.sharedAt;
  const on = saving && wanted !== null ? wanted : live;

  const flip = async () => {
    if (saving) return;
    const next = !on;
    if (next && !(await ensureAiConsent())) return;
    setWanted(next);
    setSaving(true);
    try {
      await setShare(row._id, next);
      haptic('selection');
    } catch (e) {
      toast.show(errorText(e, 'Couldn’t save that. Try again.'), { tone: 'error' });
    } finally {
      setSaving(false);
      setWanted(null);
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <PressableScale
        onPress={flip}
        disabled={saving}
        accessibilityRole="switch"
        accessibilityLabel="Share with people nearby"
        accessibilityHint={WHAT_NEIGHBORS_SEE}
        accessibilityState={{ checked: on, busy: saving }}
        style={styles.row}>
        <Txt variant="label" weight={600} color={colors.muted}>
          Share with people nearby ·{' '}
          <Txt variant="label" weight={700} color={on ? colors.green : colors.muted}>
            {on ? 'On' : 'Off'}
          </Txt>
        </Txt>
      </PressableScale>
      <Txt variant="caption" align="center" importantForAccessibility="no" accessibilityElementsHidden>
        {WHAT_NEIGHBORS_SEE}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  // ShareCookingRow's 48 pt tap target.
  row: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
