// /i: an invite (homecookd://i?t=…, https://homecookd.app/i?t=…, or ?c=<6-letter code> from Paste
// invite / a typed code). The invited person's landing page in the app (FEEDBACK-OCT16c B2, E3): peek
// at the invite (that never uses it), then one big card: the inviter's face, "Join Test family?" (the
// family's own name, whoever sent it: QA B28), one line naming the sender, and one big Join (nothing
// else). Join uses the invite (once) and saves this phone's key.
//   a family invite (the usual one: it names nobody)  "Mom invited you." After Join: "Who's in the
//       kitchen?", which reads "Tap + to add yourself." (+ under the cooks or the ones who miss it)
//   an invite for one person (older)  "Mom invited you as Dad." After Join, Dad is `me` and goes
//       straight to his home
// Later launches show "Who's in the kitchen?" as always. The other cards (components/signin/invite.ts):
//   used / expired / turned off   the server's sentence + "Ask Mom for a new one." + Back to start
//   no such invite                the server's sentence + Back to start ("Type it again" for a code)
//   offline / server trouble      a plain sentence + Try again
//   signed in to that family      "You're already in." -> Profiles (Mom opening her own link never
//                                 uses it up)
//   signed in to another family   "Join Test family instead?" Join / Not now
// The peek sends this phone's key, so the server says whether it's already in that family; a
// signed-in phone also reloads its family first, for an older server that doesn't say.
// Dev (web only): ?fixture=pending|used|expired|revoked|notfound|badcode|offline|already|other
// [&to=none][&role=learner][&from=none|Dad] draws each card without the API (`to=none`: a family invite).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import {
  askForNew,
  describeInvite,
  ErrorLine,
  InviteCard,
  InviteCardSkeleton,
  inviteFixture,
  isInviteFixture,
  joiningAs,
  joinTitle,
  leaveTo,
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
  type Viewer,
} from '@/components/signin';
import { ActionButton, type ActionState } from '@/components/ui';
import { api, ApiError, type InviteRef } from '@/lib/api';
import { parseInviteInput } from '@/lib/auth';
import { useSession, type AcceptInviteResult } from '@/lib/session';
import { motion } from '@/theme/tokens';

const DEV_WEB = __DEV__ && Platform.OS === 'web';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The invite this link names (its token wins over its code), and what to hand acceptInvite. */
function inviteFrom(t: string | undefined, c: string | undefined): { ref: InviteRef; raw: string; key: string } | null {
  const byToken = parseInviteInput(t);
  if (byToken?.kind === 'token') return { ref: { token: byToken.token }, raw: byToken.token, key: `t:${byToken.token}` };
  const byCode = parseInviteInput(c);
  if (byCode?.kind === 'code') return { ref: { code: byCode.code }, raw: byCode.code, key: `c:${byCode.code}` };
  return null;
}

/** A failed peek, in people's words. Only the server's own invite sentences are shown as they are. */
function peekFailed(e: unknown): Peeked {
  if (!(e instanceof ApiError)) return { state: 'unreachable', sentence: OUR_SIDE, line: TRY_SOON };
  if ((e.status === 404 || e.status === 400) && /^That invite/.test(e.message)) return { state: 'missing', sentence: e.message };
  if (e.kind === 'network' || e.kind === 'timeout') return { state: 'unreachable', sentence: UNREACHABLE, line: CHECK_CONNECTION };
  if (e.status === 429) return { state: 'unreachable', sentence: 'Too many tries for now.', line: TRY_SOON };
  return { state: 'unreachable', sentence: OUR_SIDE, line: TRY_SOON };
}

export default function InviteScreen() {
  const params = useLocalSearchParams<{ t?: string; c?: string; fixture?: string; role?: string; from?: string; to?: string }>();
  const { status, signedIn, family, profiles, acceptInvite, homeFor, refresh } = useSession();
  const [fixtureKind, fixtureRole, fixtureFrom, fixtureTo] = [one(params.fixture), one(params.role), one(params.from), one(params.to)];
  const fixture = useMemo(
    () =>
      DEV_WEB && isInviteFixture(fixtureKind) ? inviteFixture(fixtureKind, { role: fixtureRole, from: fixtureFrom, to: fixtureTo }) : null,
    [fixtureKind, fixtureRole, fixtureFrom, fixtureTo],
  );
  const [t, c] = [one(params.t), one(params.c)];
  const invite = useMemo(() => inviteFrom(t, c), [t, c]);
  const key = invite?.key ?? null;
  const typedCode = fixture ? fixtureKind === 'badcode' : !!invite?.ref.code;

  // --- This phone's family, fresh: a cache from before the invite can't say whether it's ours. ---
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
  const [result, setResult] = useState<{ key: string; attempt: number; peeked: Peeked } | null>(null);
  useEffect(() => {
    if (fixture || !invite) return;
    const ctrl = new AbortController();
    api
      .invitePeek(invite.ref, { signal: ctrl.signal })
      .then((peek): Peeked => ({ state: 'ok', peek }))
      .catch(peekFailed)
      .then((peeked) => {
        if (!ctrl.signal.aborted) setResult({ key: invite.key, attempt, peeked });
      });
    return () => ctrl.abort();
  }, [invite, attempt, fixture]);

  const peeked: Peeked = fixture
    ? fixture.peeked
    : !invite
      ? { state: 'missing', sentence: NOT_FOUND }
      : result && result.key === key && result.attempt === attempt
        ? result.peeked
        : { state: 'loading' };
  const viewer: Viewer = fixture
    ? fixture.viewer
    : status === 'loading' || (inFamily && !fresh)
      ? null
      : { signedIn: inFamily, family, profiles };

  // --- What the card shows. Frozen from the Join tap on, while the session switches family. ------
  const [frozen, setFrozen] = useState<InviteView | null>(null);
  const view = frozen ?? describeInvite(peeked, viewer);

  const [btn, setBtn] = useState<ActionState>('idle');
  const [joinError, setJoinError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    if (btn !== 'error') return;
    const t = setTimeout(() => setBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
    return () => clearTimeout(t);
  }, [btn]);

  const toStart = () => {
    if (router.canGoBack()) router.back();
    else leaveTo(signedIn ? '/' : '/join');
  };

  const retry = () => {
    setFrozen(null);
    setAttempt((a) => a + 1);
  };

  async function join() {
    if (btn !== 'idle' || view.kind !== 'join' || (!invite && !fixture)) return;
    const card = view;
    setFrozen(card);
    setJoinError(null);
    setBtn('loading');
    const started = Date.now();
    const res: AcceptInviteResult = fixture
      ? await new Promise((ok) => setTimeout(() => ok({ status: 'joined', familyName: card.peek.family_name, me: null }), 600))
      : await acceptInvite(invite?.raw ?? '');
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    if (res.status === 'joined') {
      // Someone named: straight to their home, which greets them by name. A family invite: "Who's
      // in the kitchen?", where they add themselves with +.
      if (!fixture) return leaveTo(res.me ? homeFor(res.me) : '/');
      setBtn('success');
      setTimeout(() => {
        if (!alive.current) return;
        setFrozen(null);
        setBtn('idle');
      }, 1200);
    } else if (res.status === 'gone') {
      setBtn('idle');
      setFrozen({ kind: 'gone', peek: card.peek, status: res.invite, sentence: res.error });
    } else {
      // Nothing changed: the same card stays up with the sentence under Join.
      setJoinError(res.error);
      setBtn('error');
    }
  }

  return (
    <SignInScreen>
      <View style={styles.middle}>
        <Animated.View key={view.kind} entering={FadeIn.duration(220)} style={styles.stack}>
          {view.kind === 'loading' ? (
            <InviteCardSkeleton />
          ) : view.kind === 'join' ? (
            <>
              <InviteCard face={view.peek.inviter} title={joinTitle(view.peek, view.instead)} line={joiningAs(view.peek)}>
                <ActionButton
                  label="Join"
                  size="xl"
                  onPress={() => void join()}
                  state={btn}
                  accessibilityLabel={view.peek.invitee ? `Join as ${view.peek.invitee.name}` : `Join ${view.peek.family_name}`}
                />
                <ErrorLine error={joinError} align="center" />
              </InviteCard>
              {/* Only when it would move this phone out of the family it's in. */}
              {view.instead ? <SmallLink label="Not now" onPress={toStart} /> : null}
              <TermsLine />
            </>
          ) : view.kind === 'already' ? (
            <InviteCard face={view.peek.inviter} title="You’re already in.">
              <ActionButton label="Come in" size="xl" onPress={() => leaveTo('/')} />
            </InviteCard>
          ) : view.kind === 'gone' ? (
            <InviteCard face={view.peek?.inviter ?? null} faded title={view.sentence} line={askForNew(view.peek)}>
              <ActionButton label="Back to start" size="xl" onPress={toStart} />
            </InviteCard>
          ) : view.kind === 'missing' ? (
            // Asking again can't find it: the way on is a fixed code, or the start.
            <InviteCard face={null} title={view.sentence} line={typedCode ? 'Check it, or ask for a new one.' : 'Check the link, or ask for a new one.'}>
              <ActionButton label={typedCode ? 'Type it again' : 'Back to start'} size="xl" onPress={toStart} />
            </InviteCard>
          ) : (
            <>
              <InviteCard face={null} title={view.sentence} line={view.line}>
                <ActionButton label="Try again" size="xl" onPress={retry} />
              </InviteCard>
              <SmallLink label="Back to start" onPress={toStart} />
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
