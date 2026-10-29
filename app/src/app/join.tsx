// The first screen: how someone gets into homecookd on a new phone (FEEDBACK-OCT16c B2). Bible Main
// look: the peach wash, the pot + "homecookd" row, one Fraunces line, the ways in at thumb height.
//   1. Continue with Apple (iOS) / Continue with Google (builds that have it). Someone the server
//      already knows is in at once and goes to "Who's in the kitchen?".
//   2. Someone new: "What does your family call you?" (prefilled from Apple or Google), then, only
//      when they didn't come from a recipe link, "What do you want to do first?" Record a dish (a
//      cook, in a family of their own) / Learn a dish (a learner). Then Profiles. That step also
//      has a small "Got an invite?": an invited Dad who tapped Apple first would otherwise end up
//      in a new family of his own. A cook picks her language once she's in, on the language screen
//      before her home (components/language/LanguageTiles). These screens read in the phone's language.
//   3. "Paste invite" + Paste ("Have an invite code?" where the system Paste button isn't
//      available) opens /i for that invite. A pasted recipe link stays here as `?s=`. When a link
//      is on the clipboard (the invite page's "Get the app" put it there), this row comes first
//      with the green Paste: the invite is the way in.
//   4. One small link to the code screen (join-code.tsx), the backup: "Have a family code?", or
//      "Have a code?" next to the system Paste, since that screen also takes the invite's 6 letters.
// `/join?s=<share>` (a recipe link, via /r): Apple/Google joins the sharer's family as a learner,
// and the shared dish opens once they pick their face. A link the server says is gone is dropped
// ("That recipe link stopped working."), so someone new is asked what they want to do first.
// `/join?claim=<path>&name=…&role=learner|cook` (a dish card's link, /miss?k=… or /a?t=…, that has
// no family to take them in yet: components/signin/ClaimLink, V2-LINKING.md 2.6): the name step is
// prefilled from the card ("Caleb", "Mom"), the role step is skipped (the link says it), and once
// they're in the link opens again, signed in, and the card becomes theirs.
// Opened on a phone that's already in a family (an old link): a recipe link goes on to /r (the
// dish), a dish card's link back to itself, anything else to your home, else "Who's in the kitchen?".
// Dev (web only): ?fixture=name|role|share|code draws each step without signing in.
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import {
  ErrorLine,
  Headline,
  leaveTo,
  openAfterPick,
  PasteInvite,
  PASTE_BUTTON,
  peekShare,
  plainError,
  shareIsDead,
  ProviderButtons,
  RoleCards,
  routeInvite,
  SignInField,
  SignInScreen,
  SmallLink,
  TermsLine,
  useInviteOnClipboard,
  type Provider,
} from '@/components/signin';
import { ActionButton, haptic, type ActionState } from '@/components/ui';
import type { Role } from '@/lib/api';
import { claimFromParam, nameFromParam, roleFromParam } from '@/lib/linkClaim';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { motion } from '@/theme/tokens';

const MAX_NAME = 40;
const SHARE = /^[0-9A-Za-z_-]{4,64}$/;
const WEB = Platform.OS === 'web';
const DEV_WEB = __DEV__ && WEB;

type Step = 'start' | 'name' | 'role';
type Fixture = 'name' | 'role' | 'share' | 'code';
const FIXTURES: readonly string[] = ['name', 'role', 'share', 'code'];

export default function JoinScreen() {
  const params = useLocalSearchParams<{ s?: string; fixture?: string; claim?: string; name?: string; role?: string }>();
  const fixture = DEV_WEB && params.fixture && FIXTURES.includes(params.fixture) ? (params.fixture as Fixture) : null;
  const linkToken = params.s && SHARE.test(params.s) ? params.s : null;
  // A dish card's link to open again once they're in, with the card's name and side.
  const claim = claimFromParam(params.claim);
  const claimName = claim ? nameFromParam(params.name) : null;
  const claimRole = claim ? roleFromParam(params.role) : null;
  const { status, signedIn, me, homeFor, error: sessionError, signInWithApple, signInWithGoogle, finishSignIn } = useSession();
  const { t } = useWords();

  const [step, setStep] = useState<Step>(fixture === 'name' || fixture === 'role' ? fixture : 'start');
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(fixture === 'name' || fixture === 'role' ? 'Dana' : '');
  const [needsRole, setNeedsRole] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [btn, setBtn] = useState<ActionState>('idle');
  const [share, setShare] = useState<{ token: string; from: string | null; recipeId: string } | null>(null);
  const [deadShare, setDeadShare] = useState<string | null>(null);
  const [inviteAsked, setInviteAsked] = useState(false);
  const inviteOnClipboard = useInviteOnClipboard();
  const inviteFirst = inviteAsked || inviteOnClipboard;
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // Already in a family when this screen first opens: nothing to sign in to. Decided once, so a
  // sign-in that finishes here still goes through enter() (and the shared dish).
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || fixture || status === 'loading') return;
    settled.current = true;
    if (!signedIn || status === 'needs-code') return;
    if (claim) leaveTo(claim as Href);
    else if (linkToken) leaveTo({ pathname: '/r', params: { s: linkToken } });
    else leaveTo(me ? homeFor(me) : '/');
  }, [status, signedIn, me, homeFor, fixture, linkToken, claim]);

  // Who shared the dish they came from ("Leo shared a dish with you."). Read once per link.
  useEffect(() => {
    if (!linkToken) return;
    let on = true;
    void peekShare(linkToken).then((s) => {
      if (!on) return;
      if (s) setShare({ token: linkToken, from: s.sender?.name?.trim() || null, recipeId: s.recipe_id });
      else if (shareIsDead(linkToken)) setDeadShare(linkToken);
    });
    return () => {
      on = false;
    };
  }, [linkToken]);
  // A link that's gone joins nobody: sign in as if there were none (and ask what to do first).
  const shareToken = linkToken && deadShare !== linkToken ? linkToken : null;
  const sharedBy = fixture === 'share' ? 'Leo' : share && share.token === shareToken ? share.from : null;

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

  /** In: "Who's in the kitchen?" next (and the dish card's link, or the shared dish, once they pick their face). */
  const enter = () => {
    if (claim) openAfterPick(claim);
    else if (share && share.token === shareToken) openAfterPick(share.recipeId);
    leaveTo('/');
  };

  async function signIn(p: Provider) {
    if (busy || btn !== 'idle') return;
    if (WEB) {
      // The look-alike buttons on the web (screenshots): there's no Apple or Google sheet here.
      setError(t('signin.join.appOnly'));
      return;
    }
    setError(null);
    setBusy(p);
    const res = await (p === 'apple' ? signInWithApple : signInWithGoogle)({ shareToken });
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
      // The Apple / Google sign-in went stale: start over from the buttons.
      setBtn('idle');
      setStep('start');
      setError(res.error);
    } else {
      // "Dad is already in this family": the fix is a different name, so show it under the name.
      if (/already in this family|\bname\b/i.test(res.error)) setStep('name');
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

  /** The role step's "Got an invite?": back to the start, with Paste first. */
  const toInvite = () => {
    setBtn('idle');
    setError(null);
    setInviteAsked(true);
    setStep('start');
  };

  // Why they're here again ("You were signed out of Our family."), else who sent the dish.
  const line =
    (status === 'needs-code' && plainError(sessionError, t)) ||
    (sharedBy ? t('signin.join.sharedDish', { name: sharedBy }) : linkToken && !shareToken ? t('signin.join.deadLink') : null);
  const paste = <PasteInvite onInvite={routeInvite} codeOnly={fixture === 'code'} primary={inviteFirst} />;

  return (
    <SignInScreen onBack={step === 'start' ? null : back}>
      {step === 'start' ? (
        <Animated.View key="start" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.start}>
          <Headline title={t('signin.join.welcome')} line={line} />
          <View style={styles.ways}>
            {inviteFirst ? paste : null}
            <ProviderButtons busy={busy} onPress={(p) => void signIn(p)} />
            <ErrorLine error={error} />
            {inviteFirst ? null : paste}
            <SmallLink
              label={PASTE_BUTTON && fixture !== 'code' ? t('signin.join.haveCode') : t('signin.join.haveFamilyCode')}
              hint={t('signin.join.codeHint')}
              onPress={() => router.push('/join-code')}
            />
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
            <SmallLink label={t('signin.role.gotInvite')} hint={t('signin.role.gotInviteHint')} onPress={toInvite} />
          </View>
        </Animated.View>
      ) : null}
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  start: { flexGrow: 1, gap: 32 },
  // The ways in sit at thumb height; the headline keeps the top.
  ways: { marginTop: 'auto', gap: 16 },
  step: { gap: 32 },
  form: { gap: 12 },
});
