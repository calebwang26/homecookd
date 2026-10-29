// /i?t=<token>: a family join link (22 characters) or an older invite (16), opened in the app
// (https://homecookd.app/i?t=…, homecookd://i?t=…, or the first screen's invisible pickup). Joining is by
// link only, name first, then Sign in with Apple (docs/build/JOIN-SIMPLE.md §1, mockups 1 and 3). The
// app peeks at the link (that never uses it), then shows one card (components/signin/invite.ts):
//   join      signed out: "Join Test family", "Mom sent this.", "What do they call you?" [name], the
//             chips "I cook" / "I miss the food" (a family link; an older invite for one person says
//             who and needs none), and the system Apple button (Google on Android). Sign-in sends the
//             name, the role and the link (`joinToken`); then "Who's in the kitchen?", which opens
//             their home. The terms line goes under the card. On a family link, a name the family
//             already has for someone with no phone yet asks "Are you Leo?" with his face first
//             (useClaimPeek, lib/auth/join's claimStep): "Yes, that's me" signs in as him
//             (`claimProfileId`, no chips), "No, I'm someone else" as someone new
//   move      signed in to another family: "You're in Wang family. Join Test family instead?" with
//             Join Test family and Not now. Join shows the Apple button ("Sign in with Apple to join
//             Test family."), and that sign-in moves them (`move: true`). A signed-out sign-in can
//             get the same answer (a returning Apple ID in another family): the same card shows
//   already   signed in to that family: "You're already in." -> Profiles (Mom opening her own link)
//   gone      used, expired or turned off: the sentence + "Ask Mom for a new one." + Back to start
//   missing   no such link: the sentence + Back to start
//   offline / server trouble: a plain sentence + Try again
// An old code link (/i?c=…, 1.0's typed codes) only says to tap the link instead: there's no code entry.
// The peek sends this phone's key, so the server says whether it's already in that family; a
// signed-in phone also reloads its family first, for an older server that doesn't say.
// Dev (web only): ?fixture=pending|used|expired|revoked|notfound|offline|already|other
// [&to=Dad][&role=learner][&from=none|Dad][&claim=Leo] draws each card without the API (default: a family
// join link; `claim`: typing that name asks "Are you Leo?").
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import {
  askForNew,
  describeInvite,
  familyName,
  InviteCard,
  InviteCardSkeleton,
  inviteFixture,
  isInviteFixture,
  JoinCard,
  joinTitle,
  leaveTo,
  MoveCard,
  sentBy,
  CHECK_CONNECTION,
  NOT_FOUND,
  OUR_SIDE,
  SignInScreen,
  SmallLink,
  TermsLine,
  TRY_SOON,
  UNREACHABLE,
  type InviteView,
  type Peeked,
  type Provider,
  type Viewer,
  useClaimPeek,
} from '@/components/signin';
import { ActionButton, haptic } from '@/components/ui';
import { api, ApiError, type Role } from '@/lib/api';
import { isJoinToken } from '@/lib/auth';
import { claimStep, nameKey, type ClaimAnswer } from '@/lib/auth/join';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';

const WEB = Platform.OS === 'web';
const DEV_WEB = __DEV__ && WEB;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A failed peek, in people's words. Only the server's own invite sentences are shown as they are. */
function peekFailed(e: unknown, t: T): Peeked {
  if (!(e instanceof ApiError)) return { state: 'unreachable', sentence: t(OUR_SIDE), line: t(TRY_SOON) };
  if ((e.status === 404 || e.status === 400) && /^That invite/.test(e.message)) return { state: 'missing', sentence: e.message };
  if (e.kind === 'network' || e.kind === 'timeout') return { state: 'unreachable', sentence: t(UNREACHABLE), line: t(CHECK_CONNECTION) };
  if (e.status === 429) return { state: 'unreachable', sentence: t('signin.invite.tooMany'), line: t(TRY_SOON) };
  return { state: 'unreachable', sentence: t(OUR_SIDE), line: t(TRY_SOON) };
}

/** What the peek answered. A failure is put in words when the card draws (in this phone's language). */
type Answer = Extract<Peeked, { state: 'ok' }> | { state: 'failed'; error: unknown };

export default function JoinLinkScreen() {
  const params = useLocalSearchParams<{ t?: string; c?: string; fixture?: string; role?: string; from?: string; to?: string; claim?: string }>();
  const { status, signedIn, family, profiles, owner, me, refresh, signInWithApple, signInWithGoogle } = useSession();
  const { t } = useWords();
  const [fixtureKind, fixtureRole, fixtureFrom, fixtureTo] = [one(params.fixture), one(params.role), one(params.from), one(params.to)];
  const fixture = useMemo(
    () =>
      DEV_WEB && isInviteFixture(fixtureKind) ? inviteFixture(fixtureKind, { role: fixtureRole, from: fixtureFrom, to: fixtureTo }, t) : null,
    [fixtureKind, fixtureRole, fixtureFrom, fixtureTo, t],
  );
  const tokenParam = one(params.t);
  const token = isJoinToken(tokenParam) ? tokenParam : null;
  // 1.0's code links: a card that says to tap the link instead.
  const codeLink = !token && !!one(params.c);

  // --- This phone's family, fresh: a cache from before the link can't say whether it's ours. ---
  const inFamily = signedIn && status !== 'needs-code';
  const [fresh, setFresh] = useState(false);
  const askedFamily = useRef(false);
  useEffect(() => {
    if (fixture || askedFamily.current || status === 'loading' || !inFamily) return;
    askedFamily.current = true;
    void refresh().finally(() => setFresh(true));
  }, [fixture, status, inFamily, refresh]);

  // --- Peek (no side effects). `attempt` bumps on Try again. -----------------------------------
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ token: string; attempt: number; answer: Answer } | null>(null);
  useEffect(() => {
    if (fixture || !token) return;
    const ctrl = new AbortController();
    api
      .invitePeek(token, { signal: ctrl.signal })
      .then((peek): Answer => ({ state: 'ok', peek }))
      .catch((error: unknown): Answer => ({ state: 'failed', error }))
      .then((answer) => {
        if (!ctrl.signal.aborted) setResult({ token, attempt, answer });
      });
    return () => ctrl.abort();
  }, [token, attempt, fixture]);

  const peeked: Peeked = fixture
    ? fixture.peeked
    : !token
      ? { state: 'missing', sentence: t(NOT_FOUND) }
      : result && result.token === token && result.attempt === attempt
        ? result.answer.state === 'failed'
          ? peekFailed(result.answer.error, t)
          : result.answer
        : { state: 'loading' };
  const viewer: Viewer = fixture
    ? fixture.viewer
    : status === 'loading' || (inFamily && !fresh)
      ? null
      : { signedIn: inFamily, family, profiles };

  // --- What the card shows. Held from the first sign-in tap on, while the session switches family,
  // and set by the server's answer ("Join … instead?", a link that's gone). ----------------------
  const [held, setHeld] = useState<InviteView | null>(null);
  const view = held ?? describeInvite(peeked, viewer, t);
  const peek = view.kind === 'join' || view.kind === 'move' ? view.peek : null;

  // The card's name and role (null: untouched). An older invite for one person says both; someone
  // moving from another family keeps theirs (a family-code phone may know neither).
  const [typedName, setName] = useState<string | null>(null);
  const [pickedRole, setRole] = useState<Role | null>(null);
  const current = inFamily ? (owner ?? me) : null;
  const name = typedName ?? peek?.invitee?.name ?? current?.name ?? '';
  const role = pickedRole ?? peek?.invitee?.role ?? current?.role ?? 'learner';

  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // "Are you Leo?": a family link's join card, for someone signed out (a known account's sign-in
  // ignores a claim). An answer counts only for the name it was given for.
  const fixtureClaim = fixture ? (one(params.claim) ?? null) : null;
  const claimOn = (!fixture || !!fixtureClaim) && view.kind === 'join' && !view.peek.invitee && !moving && !inFamily;
  const claimPeek = useClaimPeek(token, name, claimOn && !fixture);
  const found = fixtureClaim ? { name: nameKey(fixtureClaim), claimable: { id: 'fixture', name: fixtureClaim, avatar_key: null } } : claimPeek.found;
  const [answer, setAnswer] = useState<ClaimAnswer | null>(null);
  const claim = claimStep(name, found, answer);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const toStart = () => {
    if (router.canGoBack()) router.back();
    else leaveTo(inFamily ? '/' : '/join');
  };

  const retry = () => {
    setHeld(null);
    setAttempt((a) => a + 1);
  };

  async function signIn(p: Provider) {
    if (busy || !peek || (view.kind !== 'join' && view.kind !== 'move')) return;
    if (WEB) {
      // The stand-in button on the web (screenshots): there's no Apple sheet here.
      setError(t('signin.join.appOnly'));
      return;
    }
    const card = view;
    const typed = name.trim();
    if (card.kind === 'join' && !typed) {
      haptic('error');
      setNameError(t('signin.joinCard.nameFirst'));
      return;
    }
    if (claimOn && claim.needsPeek) {
      // Typed faster than the peek: ask now, and if the family has this person, ask them first.
      setBusy(p);
      const f = await claimPeek.settle(typed);
      if (!alive.current) return;
      setBusy(null);
      if (claimStep(typed, f, null).ask) return haptic('warning');
    }
    setHeld(card);
    setError(null);
    setNameError(null);
    setBusy(p);
    const move = moving || card.kind === 'move';
    const res = await (p === 'apple' ? signInWithApple : signInWithGoogle)({
      joinToken: token,
      name: typed || null,
      role: peek.invitee || claim.claimProfileId ? null : role,
      move,
      claimProfileId: claimOn ? claim.claimProfileId : null,
    });
    if (!alive.current) return;
    setBusy(null);
    switch (res.status) {
      case 'cancelled':
        return;
      case 'signed-in':
        haptic('success');
        return leaveTo('/');
      case 'needs-move':
        // A returning Apple ID that's in another family: nothing changed yet.
        setMoving(false);
        return setHeld({ kind: 'move', peek, from: familyName(res.fromFamily), to: familyName(res.toFamily) });
      case 'needs-name':
        setName(typed || res.suggestedName);
        setHeld({ kind: 'join', peek });
        return setNameError(t('signin.joinCard.nameFirst'));
      case 'error':
        haptic('error');
        if (res.why === 'gone') return setHeld({ kind: 'gone', peek, status: res.invite ?? 'expired', sentence: res.error });
        if (res.why === 'not-found') return setHeld({ kind: 'missing', sentence: res.error });
        if (res.why === 'name') {
          // "Asha is already in Test family": a different name fixes it, on the join card (still a move).
          setName(typed);
          setHeld({ kind: 'join', peek });
          return setNameError(res.error);
        }
        setError(res.error);
    }
  }

  return (
    <SignInScreen>
      <View style={styles.middle}>
        <Animated.View key={view.kind} entering={FadeIn.duration(220)} style={styles.stack}>
          {codeLink ? (
            <InviteCard face={null} title={t('signin.joinCard.codeTitle')} line={t('signin.joinCard.codeLine')}>
              <ActionButton label={t('signin.shared.backToStart')} size="xl" onPress={toStart} />
            </InviteCard>
          ) : view.kind === 'loading' ? (
            <InviteCardSkeleton />
          ) : view.kind === 'join' ? (
            <>
              <JoinCard
                face={view.peek.inviter}
                title={joinTitle(view.peek, t)}
                line={sentBy(view.peek, t)}
                name={name}
                onName={(text) => {
                  if (nameKey(text) !== nameKey(name)) setAnswer(null); // a new name, a new question
                  setName(text);
                  setNameError(null);
                }}
                role={role}
                onRole={view.peek.invitee ? undefined : setRole}
                busy={busy}
                onSignIn={(p) => void signIn(p)}
                error={error}
                nameError={nameError}
                claim={
                  claimOn && claim.ask
                    ? {
                        person: claim.ask,
                        me: claim.me,
                        onAnswer: (me) => {
                          setAnswer({ name: nameKey(name), me });
                          setNameError(null);
                        },
                      }
                    : null
                }
              />
              {moving ? <SmallLink label={t('signin.shared.notNow')} onPress={toStart} /> : null}
              <TermsLine />
            </>
          ) : view.kind === 'move' ? (
            <>
              <MoveCard
                face={view.peek.inviter}
                from={view.from}
                to={view.to}
                confirmed={moving}
                onConfirm={() => setMoving(true)}
                busy={busy}
                onSignIn={(p) => void signIn(p)}
                error={error}
              />
              <SmallLink label={t('signin.shared.notNow')} onPress={toStart} />
              {moving ? <TermsLine /> : null}
            </>
          ) : view.kind === 'already' ? (
            <InviteCard face={view.peek.inviter} title={t('signin.invite.already')}>
              <ActionButton label={t('signin.shared.comeIn')} size="xl" onPress={() => leaveTo('/')} />
            </InviteCard>
          ) : view.kind === 'gone' ? (
            <InviteCard face={view.peek?.inviter ?? null} faded title={view.sentence} line={askForNew(view.peek, t)}>
              <ActionButton label={t('signin.shared.backToStart')} size="xl" onPress={toStart} />
            </InviteCard>
          ) : view.kind === 'missing' ? (
            <InviteCard face={null} title={view.sentence} line={t('signin.invite.checkLink')}>
              <ActionButton label={t('signin.shared.backToStart')} size="xl" onPress={toStart} />
            </InviteCard>
          ) : (
            <>
              <InviteCard face={null} title={view.sentence} line={view.line}>
                <ActionButton label={t('signin.invite.tryAgain')} size="xl" onPress={retry} />
              </InviteCard>
              <SmallLink label={t('signin.shared.backToStart')} onPress={toStart} />
            </>
          )}
        </Animated.View>
      </View>
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  // The card sits a little above the middle of the space under the brand row.
  middle: { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 },
  stack: { gap: 12 },
});
