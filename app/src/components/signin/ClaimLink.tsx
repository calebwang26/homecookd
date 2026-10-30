// The claim screens' one flow (docs/build/V2-LINKING.md 2.6), for /miss?k=… (a kid's dish card) and
// /a?t=… (Mom's ask for it), however the link came in: the universal link, homecookd://, or the first
// screen's invisible pickup. No confirm tap (Caleb, Oct 29): while it works, one calm card shows the
// dish ("Caleb's tomato egg"). lib/linkClaim planClaim decides what happens:
//   claim    in, someone picked: links.claim, then the card's screen
//   pick     in, nobody picked yet: "Who's in the kitchen?", then this link again (openAfterPick)
//   join     signed out, with a join ticket: the join card (docs/build/JOIN-SIMPLE.md §1, mockup 1)
//            titled with the dish, the name prefilled from the card ("Caleb", or "Mom" for the ask),
//            no role chips (the card's side says it), and the system Apple button (Google on Android).
//            Sign-in sends the ticket and the name: a new person in the card's family, then the claim.
//            A returning Apple ID in another family gets "You're in Wang family. Join Pawar family
//            instead?" (MoveCard): Join shows the Apple button again, and that sign-in moves them
//   signIn   signed out, no ticket: /join?claim=…&name=…&role=…, where Apple or Google starts their
//            own family and the link opens again, signed in
//   dead     "This link doesn't work anymore."    taken  "This one's already with Mom." + ask for an invite
// Offline, a stale ticket, or a claim that failed: "We can't reach homecookd." with Try again. Once a
// kid's card is theirs, the push ask follows on top of the card (1.2: "Want a note when Mom answers?",
// kid-card-saved, even on the first launch). Mom's language pre-pick belongs to the card's screen.
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { askForPushSoon } from '@/components/push/PushAskSheet';
import { ActionButton, haptic } from '@/components/ui';
import type { Role } from '@/lib/api';
import { claimHref, planClaim, roleFor, sideName, signInHref, type LinkInfo, type LinkKind } from '@/lib/linkClaim';
import { claimLink, openLink } from '@/lib/live/links';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { colors } from '@/theme/tokens';

import { leaveTo, openAfterPick } from './handoff';
import { CHECK_CONNECTION, familyName, OUR_SIDE, TRY_SOON, UNREACHABLE } from './invite';
import { InviteCard, InviteCardSkeleton, type InviteFace } from './InviteCard';
import { JoinCard } from './JoinCard';
import { MoveCard } from './MoveCard';
import type { Provider } from './ProviderButtons';
import { SignInScreen, SmallLink, TermsLine } from './SignInScreen';

const WEB = Platform.OS === 'web';
/** A new person's card opens on top of their new home (two screen changes): ask once both settle. */
const ASK_AFTER_JOIN_MS = 1200;

type Step =
  | { kind: 'working'; info: LinkInfo | null }
  | { kind: 'join'; info: LinkInfo; ticket: string; name: string | null }
  | { kind: 'move'; info: LinkInfo; ticket: string; from: string; to: string }
  | { kind: 'dead' }
  | { kind: 'taken'; name: string | null; role: Role }
  | { kind: 'failed'; offline: boolean; error?: string };

/** What a run needs from the screen; `show` is ignored once the screen is gone. */
type Run = {
  kind: LinkKind;
  token: string;
  inFamily: boolean;
  meId: string | null;
  show: (s: Step) => void;
};

async function start(r: Run): Promise<void> {
  const opened = await openLink(r.token);
  if (!opened.ok && opened.why === 'offline') return r.show({ kind: 'failed', offline: true });
  const info = opened.ok ? opened.link : null;
  const plan = planClaim(info, { signedIn: r.inFamily, picked: !!r.meId });
  const href = claimHref(r.kind, r.token);
  if (!info || plan.kind === 'dead') return r.show({ kind: 'dead' });
  switch (plan.kind) {
    case 'taken':
      return r.show({ kind: 'taken', name: plan.name, role: roleFor(info.side) });
    case 'pick':
      openAfterPick(href);
      return leaveTo('/');
    case 'signIn':
      return leaveTo(signInHref(href, plan));
    case 'claim':
      r.show({ kind: 'working', info });
      return claim(r, info, r.meId, false);
    case 'join':
      return r.show({ kind: 'join', info, ticket: plan.ticket, name: plan.name });
  }
}

/** links.claim as `as`, then the card. `joined`: someone new, so it opens on top of their new home. */
async function claim(r: Run, info: LinkInfo, as: string | null, joined: boolean): Promise<void> {
  let id: string;
  try {
    const claimed = await claimLink(r.token, as ?? undefined);
    if (claimed.taken) return r.show({ kind: 'taken', name: sideName(info), role: roleFor(info.side) });
    id = claimed.dishAskId;
  } catch (e) {
    console.warn('[links] claim failed', String(e).slice(0, 160));
    return r.show({ kind: 'failed', offline: false });
  }
  // /dish/[id], the card in the app, is App screens & recording's screen.
  const dish = `/dish/${id}`;
  if (joined) {
    openAfterPick(dish);
    leaveTo('/');
  } else router.replace(dish as Href);
  // The kid's own card: a note when Mom answers (askForPush decides whether to ask at all).
  const kid = as ?? r.meId;
  if (info.side === 'kid' && kid) {
    askForPushSoon({ kind: 'kid-card-saved', profileId: kid, name: info.relation ?? '' }, joined ? ASK_AFTER_JOIN_MS : undefined);
  }
}

const dishTitle = (info: LinkInfo, t: T) => (info.kidName ? t('signin.link.dish', { name: info.kidName, dish: info.dish }) : info.dish);
/** The card's other side: Mom's ask shows the kid who sent it; the kid's own card shows Mom. */
const otherSide = (info: LinkInfo): InviteFace => {
  const name = info.side === 'cook' ? info.kidName : info.relation;
  return name ? { name } : null;
};

export function ClaimLink({ kind, token }: { kind: LinkKind; token: string | null }) {
  const { status, signedIn, me, signInWithApple, signInWithGoogle } = useSession();
  const { t } = useWords();
  const [step, setStep] = useState<Step>(token ? { kind: 'working', info: null } : { kind: 'dead' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const show = useCallback((s: Step) => {
    if (!alive.current) return;
    // The join card starts with the card's name ("Caleb", "Mom"), once.
    if (s.kind === 'join') setName((cur) => cur || s.name || '');
    setStep(s);
  }, []);

  const inFamily = signedIn && status !== 'needs-code';
  const meId = me?.id ?? null;

  // Once per link and per Try again, as soon as the session knows whether this phone is in.
  const ran = useRef(-1);
  useEffect(() => {
    if (!token || status === 'loading' || ran.current === attempt) return;
    ran.current = attempt;
    void start({ kind, token, inFamily, meId, show });
  }, [kind, token, status, attempt, inFamily, meId, show]);

  const home = () => leaveTo(inFamily ? '/' : '/join');
  const retry = () => {
    setStep({ kind: 'working', info: null });
    setError(null);
    setAttempt((a) => a + 1);
  };

  async function signIn(p: Provider) {
    if (busy || !token || (step.kind !== 'join' && step.kind !== 'move')) return;
    if (WEB) {
      setError(t('signin.join.appOnly'));
      return;
    }
    const card = step;
    const typed = name.trim();
    if (card.kind === 'join' && !typed) {
      haptic('error');
      setNameError(t('signin.joinCard.nameFirst'));
      return;
    }
    setError(null);
    setNameError(null);
    setBusy(p);
    const res = await (p === 'apple' ? signInWithApple : signInWithGoogle)({
      linkTicket: card.ticket,
      name: typed || null,
      move: moving || card.kind === 'move',
    });
    if (!alive.current) return;
    setBusy(null);
    const run: Run = { kind, token, inFamily, meId, show };
    const { info } = card;
    switch (res.status) {
      case 'cancelled':
        return;
      case 'signed-in':
        haptic('success');
        show({ kind: 'working', info });
        return claim(run, info, res.profileId, true);
      case 'needs-move':
        setMoving(false);
        return show({ kind: 'move', info, ticket: card.ticket, from: familyName(res.fromFamily), to: familyName(res.toFamily) });
      case 'needs-name':
        show({ kind: 'join', info, ticket: card.ticket, name: res.suggestedName || null });
        return setNameError(t('signin.joinCard.nameFirst'));
      case 'error':
        haptic('error');
        if (res.why === 'link-used') return show({ kind: 'taken', name: sideName(info), role: roleFor(info.side) });
        if (res.why === 'not-found' || res.why === 'gone') return show({ kind: 'dead' });
        // A stale ticket: Try again opens the link again for a fresh one.
        if (res.why === 'bad-ticket') return show({ kind: 'failed', offline: false, error: res.error });
        if (res.why === 'name') {
          show({ kind: 'join', info, ticket: card.ticket, name: typed });
          return setNameError(res.error);
        }
        setError(res.error);
    }
  }

  return (
    <SignInScreen>
      <View style={styles.middle}>
        <Animated.View key={step.kind} entering={FadeIn.duration(220)} style={styles.stack}>
          {step.kind === 'working' ? (
            step.info ? (
              <InviteCard face={null} title={dishTitle(step.info, t)} line={t('signin.link.opening')}>
                <View accessibilityLabel={t('signin.link.opening')} accessibilityState={{ busy: true }}>
                  <ActivityIndicator color={colors.yolkDeep} size="large" />
                </View>
              </InviteCard>
            ) : (
              <InviteCardSkeleton />
            )
          ) : step.kind === 'join' ? (
            <>
              <JoinCard
                face={otherSide(step.info)}
                title={dishTitle(step.info, t)}
                line={step.info.side === 'cook' && step.info.kidName ? t('signin.joinCard.sent', { name: step.info.kidName }) : null}
                name={name}
                onName={(text) => {
                  setName(text);
                  setNameError(null);
                }}
                busy={busy}
                onSignIn={(p) => void signIn(p)}
                error={error}
                nameError={nameError}
              />
              {moving ? <SmallLink label={t('signin.shared.notNow')} onPress={home} /> : null}
              <TermsLine />
            </>
          ) : step.kind === 'move' ? (
            <>
              <MoveCard
                face={otherSide(step.info)}
                from={step.from}
                to={step.to}
                confirmed={moving}
                onConfirm={() => setMoving(true)}
                busy={busy}
                onSignIn={(p) => void signIn(p)}
                error={error}
              />
              <SmallLink label={t('signin.shared.notNow')} onPress={home} />
              {moving ? <TermsLine /> : null}
            </>
          ) : step.kind === 'dead' ? (
            <InviteCard face={null} faded title={t('signin.link.dead')}>
              <ActionButton label={t('signin.shared.backToStart')} size="xl" onPress={home} />
            </InviteCard>
          ) : step.kind === 'taken' ? (
            <>
              <InviteCard
                face={step.name ? { name: step.name } : null}
                faded
                title={step.name ? t('signin.link.taken', { name: step.name }) : t('signin.link.takenSomeone')}
                line={t('signin.link.askInvite')}>
                <ActionButton label={t('signin.shared.backToStart')} size="xl" onPress={home} />
              </InviteCard>
              {/* The card's own person on a new phone: Apple or Google gets them back in, then the link opens again. */}
              {inFamily || !token ? null : (
                <SmallLink label={t('signin.link.haveAccount')} onPress={() => leaveTo(signInHref(claimHref(kind, token), { name: null, role: step.role }))} />
              )}
            </>
          ) : (
            <>
              <InviteCard
                face={null}
                title={step.error ?? t(step.offline ? UNREACHABLE : OUR_SIDE)}
                line={t(step.offline ? CHECK_CONNECTION : TRY_SOON)}>
                <ActionButton label={t('signin.invite.tryAgain')} size="xl" onPress={retry} />
              </InviteCard>
              <SmallLink label={t('signin.shared.backToStart')} onPress={home} />
            </>
          )}
        </Animated.View>
      </View>
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  // The card sits a little above the middle of the space under the brand row, as on /i.
  middle: { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 },
  stack: { gap: 12 },
});
