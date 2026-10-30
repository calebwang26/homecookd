// /r?s=<share>: a recipe link (https://homecookd.app/r?s=…, homecookd://r?s=…) opened on a phone
// that has the app. Nothing to read here: it hands off at once (FEEDBACK-OCT16c B2). A recipe link
// opens the dish; it joins nobody (docs/build/JOIN-SIMPLE.md §3.1: only a join link does).
//   signed out                     -> the first screen (Sign in with Apple starts their own family)
//   signed in, someone picked      -> that dish (a kid's opens in their Recipes tab)
//   signed in, nobody picked yet   -> "Who's in the kitchen?", and the dish opens right after they
//   (every cold start)                tap their face (the root layout does that)
//   unknown link or dish, offline  -> wherever they'd be anyway: Profiles or their home
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { leaveTo, openAfterPick, peekShare, SignInScreen } from '@/components/signin';
import { kidRecipeHref } from '@/lib/navigation';
import { fetchRecipe, getCachedEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { colors } from '@/theme/tokens';

const SHARE = /^[0-9A-Za-z_-]{4,64}$/;

/** The shared dish's id, if the link works and the dish is in the library. */
async function sharedDish(token: string): Promise<string | null> {
  const share = await peekShare(token);
  const id = share?.recipe_id;
  if (!id) return null;
  if (getCachedEntry(id)) return id;
  return (await fetchRecipe(id).catch(() => null)) ? id : null;
}

export default function ShareLinkScreen() {
  const { s } = useLocalSearchParams<{ s?: string }>();
  const { status, signedIn, me, homeFor } = useSession();
  const token = typeof s === 'string' && SHARE.test(s) ? s : null;
  const started = useRef(false);

  useEffect(() => {
    if (started.current || status === 'loading') return;
    started.current = true;
    const inFamily = signedIn && status !== 'needs-code';
    if (!inFamily) {
      leaveTo('/join');
      return;
    }
    if (!token) {
      leaveTo(me ? homeFor(me) : '/');
      return;
    }
    void sharedDish(token).then((id) => {
      if (!id) return leaveTo(me ? homeFor(me) : '/');
      if (!me) {
        openAfterPick(id);
        return leaveTo('/');
      }
      // Back from the dish lands where they were: under this screen, or their home.
      if (me.role === 'learner') router.dismissTo(kidRecipeHref(id), { withAnchor: true });
      else router.dismissTo({ pathname: '/recipe/[id]', params: { id } });
    });
  }, [status, signedIn, me, homeFor, token]);

  return (
    <SignInScreen>
      <View style={styles.middle} accessibilityLabel="Opening the dish" accessibilityState={{ busy: true }}>
        <ActivityIndicator color={colors.yolkDeep} size="large" />
      </View>
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  middle: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 96 },
});
