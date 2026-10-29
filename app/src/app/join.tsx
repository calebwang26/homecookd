// The first screen, with no link (docs/build/JOIN-SIMPLE.md §1.4, mockup 2): starting a family is the
// one way in without a link; everyone else joins from one (/i, or a dish card's /miss and /a). Bible
// Main look: the peach wash, the pot + "homecookd" row, then at thumb height:
//   "Cook your family's food."  "Start your family's kitchen. Everyone else joins from your link."
//   [ Sign in with Apple ]       the system button (Google on Android only). Someone the server
//                                already knows is in at once and goes to "Who's in the kitchen?"
//   "Got a link from your family? Tap it again."   the backup that always works (a tapped link opens
//                                the app on its own card)
// Someone new then gets today's steps: "What does your family call you?" (prefilled from Apple or
// Google), "What do you want to do first?" Record a dish (a cook) / Learn a dish (a learner), then
// Profiles; a cook picks her language on the language screen before her home. These read in the
// phone's language.
// The invisible pickup (components/signin/useLinkPickup): while this screen is signed out and on its
// start, a join link copied by the web page's "Get the app" opens its card. No button for it.
// `/join?claim=<path>&name=…&role=learner|cook` (a dish card's link with no family to take them in
// yet: components/signin/ClaimLink, V2-LINKING.md 2.6): the name step is prefilled from the card
// ("Caleb", "Mom"), the role step is skipped (the link says it), and once they're in the link opens
// again, signed in, and the card becomes theirs.
// Opened on a phone that's already in a family: a dish card's link goes back to itself, anything else
// to your home, else "Who's in the kitchen?".
// Dev (web only): ?fixture=name|role draws each step without signing in.
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import {
  ErrorLine,
  Headline,
  leaveTo,
  openAfterPick,
  plainError,
  ProviderButtons,
  RoleCards,
  SignInField,
  SignInScreen,
  TermsLine,
  useLinkPickup,
  type Provider,
} from '@/components/signin';
import { ActionButton, haptic, Txt, type ActionState } from '@/components/ui';
import type { Role } from '@/lib/api';
import { claimFromParam, nameFromParam, roleFromParam } from '@/lib/linkClaim';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion } from '@/theme/tokens';

const MAX_NAME = 40;
const WEB = Platform.OS === 'web';
const DEV_WEB = __DEV__ && WEB;

type Step = 'start' | 'name' | 'role';
type Fixture = 'name' | 'role';
const FIXTURES: readonly string[] = ['name', 'role'];

/** "Got a link from your family? Tap it again.": words, not a button (the link itself is the way in). */
function TapAgain() {
  const { t } = useWords();
  return (
    <Txt variant="body" align="center" color={colors.muted}>
      {t('signin.join.gotLink')}
      {'\n'}
      <Txt variant="body" weight={700} color={colors.ink}>
        {t('signin.join.tapAgain')}
      </Txt>
    </Txt>
  );
}

export default function JoinScreen() {
  const params = useLocalSearchParams<{ fixture?: string; claim?: string; name?: string; role?: string }>();
  const fixture = DEV_WEB && params.fixture && FIXTURES.includes(params.fixture) ? (params.fixture as Fixture) : null;
  // A dish card's link to open again once they're in, with the card's name and side.
  const claim = claimFromParam(params.claim);
  const claimName = claim ? nameFromParam(params.name) : null;
  const claimRole = claim ? roleFromParam(params.role) : null;
  const { status, signedIn, me, homeFor, error: sessionError, signInWithApple, signInWithGoogle, finishSignIn } = useSession();
  const { t } = useWords();

  const [step, setStep] = useState<Step>(fixture ?? 'start');
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(fixture ? 'Dana' : '');
  const [needsRole, setNeedsRole] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [btn, setBtn] = useState<ActionState>('idle');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // Already in a family when this screen first opens: nothing to sign in to. Decided once, so a
  // sign-in that finishes here still goes through enter().
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || fixture || status === 'loading') return;
    settled.current = true;
    if (!signedIn || status === 'needs-code') return;
    if (claim) leaveTo(claim as Href);
    else leaveTo(me ? homeFor(me) : '/');
  }, [status, signedIn, me, homeFor, fixture, claim]);

  // A join link copied before installing opens its card (signed out, on the start, nothing going on).
  useLinkPickup(status === 'needs-code' && step === 'start' && !busy && !claim && !fixture);

  // An error clears after a moment (or as soon as they change something), so a second try always sends.
  useEffect(() => {
    if (btn !== 'error') return;
    const t = setTimeout(() => setBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
    return () => clearTimeout(t);
  }, [btn]);
  const edited = () => {
    setError(null);
    setBtn((b) => (b === 'error' ? 'idle' : b));
  };

  /** In: "Who's in the kitchen?" next (and the dish card's link, once they pick their face). */
  const enter = () => {
    if (claim) openAfterPick(claim);
    leaveTo('/');
  };

  async function signIn(p: Provider) {
    if (busy || btn !== 'idle') return;
    if (WEB) {
      // The stand-in button on the web (screenshots): there's no Apple sheet here.
      setError(t('signin.join.appOnly'));
      return;
    }
    setError(null);
    setBusy(p);
    const res = await (p === 'apple' ? signInWithApple : signInWithGoogle)();
    if (!alive.current) return;
    setBusy(null);
    switch (res.status) {
      case 'cancelled':
        return;
      case 'error':
        haptic('error');
        setError(res.error);
        return;
      case 'needs-name':
        // A dish card's link already says who they are to the family and which side they're on.
        setName(claimName ?? res.suggestedName);
        setNeedsRole(res.needsRole && !claimRole);
        setRole(res.needsRole ? claimRole : null);
        setStep('name');
        return;
      case 'signed-in':
        haptic('success');
        enter();
    }
  }

  async function finish() {
    const clean = name.trim();
    if (btn !== 'idle' || !clean || (needsRole && !role)) return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    // `role` is null unless the role step asked, or a dish card's link said it.
    const res = fixture ? ({ status: 'error', error: t('signin.join.appOnly') } as const) : await finishSignIn({ name: clean, role });
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    if (res.status === 'signed-in') {
      setBtn('success');
      setTimeout(enter, 450);
    } else if (res.status === 'restart') {
      // The Apple / Google sign-in went stale: start over from the button.
      setBtn('idle');
      setStep('start');
      setError(res.error);
    } else if (res.status === 'error') {
      // "Dad is already in this family": the fix is a different name, so show it under the name.
      if ('why' in res && res.why === 'name') setStep('name');
      setError(res.error);
      setBtn('error');
    }
  }

  const next = () => {
    if (!name.trim()) return;
    if (needsRole) {
      setError(null);
      setStep('role');
    } else void finish();
  };

  const back = () => {
    setBtn('idle');
    setError(null);
    setStep(step === 'role' ? 'name' : 'start');
  };

  // Why they're here again ("You were signed out of Our family."), else what this screen is for.
  const line = (status === 'needs-code' && plainError(sessionError, t)) || t('signin.join.line');

  return (
    <SignInScreen onBack={step === 'start' ? null : back}>
      {step === 'start' ? (
        <Animated.View key="start" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.start}>
          <View style={styles.ways}>
            <Headline title={t('signin.join.title')} line={line} />
            <View style={styles.form}>
              <ProviderButtons busy={busy} onPress={(p) => void signIn(p)} />
              <ErrorLine error={error} />
            </View>
            <TapAgain />
            <TermsLine />
          </View>
        </Animated.View>
      ) : step === 'name' ? (
        <Animated.View key="name" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.step}>
          <Headline title={t('signin.name.title')} />
          <View style={styles.form}>
            <SignInField
              value={name}
              onChangeText={(text) => {
                setName(text);
                edited();
              }}
              placeholder={t('signin.name.placeholder')}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="givenName"
              autoFocus={Platform.OS !== 'web'}
              returnKeyType={needsRole ? 'next' : 'go'}
              onSubmitEditing={next}
              maxLength={MAX_NAME}
              accessibilityLabel={t('signin.name.label')}
              invalid={!!error}
            />
            <ErrorLine error={error} />
          </View>
          <ActionButton label={t('signin.shared.continue')} onPress={next} state={btn} disabled={!name.trim()} successLabel={t('signin.shared.youreIn')} />
        </Animated.View>
      ) : step === 'role' ? (
        <Animated.View key="role" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.step}>
          <Headline title={t('signin.role.title')} />
          <View style={styles.form}>
            <RoleCards
              value={role}
              onChange={(r) => {
                setRole(r);
                edited();
              }}
            />
            <ErrorLine error={error} />
          </View>
          <View style={styles.form}>
            <ActionButton
              label={t('signin.shared.continue')}
              onPress={() => void finish()}
              state={btn}
              disabled={!role}
              successLabel={t('signin.shared.youreIn')}
            />
            {/* Someone with a family link who tapped Apple first would start a family of their own. */}
            <TapAgain />
          </View>
        </Animated.View>
      ) : null}
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  start: { flexGrow: 1 },
  // The headline and the way in sit together at thumb height.
  ways: { marginTop: 'auto', gap: 24 },
  step: { gap: 32 },
  form: { gap: 12 },
});
