// The claim screens' one flow (docs/build/V2-LINKING.md 2.6), for /miss?k=… (a kid's dish card) and
// /a?t=… (Mom's ask for it), however the link came in: the universal link, homecookd://, or Paste on
// the first screen. No confirm tap (Caleb, Oct 29): while it works, one calm card shows the dish
// ("Caleb's tomato egg"). lib/linkClaim planClaim decides what happens:
//   claim    in, someone picked: links.claim, then the card's screen
//   pick     in, nobody picked yet: "Who's in the kitchen?", then this link again (openAfterPick)
//   join     signed out, with a join ticket: in as a new person in the card's family (session
//            joinByLink, no Apple sign-in), named from the card ("Caleb", or "Mom" for the ask; the
//            name step shows only when the card has no name), then the claim. Until /auth/link is
//            live it goes on as signIn
//   signIn   signed out, no ticket: /join?claim=…&name=…&role=…, where Apple or Google starts their
//            own family and the link opens again, signed in
//   dead     "This link doesn't work anymore."    taken  "This one's already with Mom." + ask for an invite
// Offline, or a claim that failed: "We can't reach homecookd." with Try again. Once a kid's card is
// theirs, the push ask follows on top of the card (1.2: "Want a note when Mom answers?", kid-card-saved,
// even on the first launch). Mom's language pre-pick belongs to the card's screen (App screens & recording).
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { askForPushSoon } from '@/components/push/PushAskSheet';
import { ActionButton, type ActionState } from '@/components/ui';
import type { Role } from '@/lib/api';
import { claimHref, planClaim, roleFor, sideName, signInHref, type LinkInfo, type LinkKind } from '@/lib/linkClaim';
import { claimLink, openLink } from '@/lib/live/links';
import { useSession, type Session } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { colors } from '@/theme/tokens';

import { leaveTo, openAfterPick } from './handoff';
import { CHECK_CONNECTION, OUR_SIDE, TRY_SOON, UNREACHABLE } from './invite';
import { InviteCard, InviteCardSkeleton } from './InviteCard';
import { ErrorLine, Headline, SignInField, SignInScreen, SmallLink, TermsLine } from './SignInScreen';

const MAX_NAME = 40;
/** A new person's card opens on top of their new home (two screen changes): ask once both settle. */
const ASK_AFTER_JOIN_MS = 1200;

type Step =
  | { kind: 'working'; info: LinkInfo | null }
  | {
      kind: 'name';
      info: LinkInfo;
      ticket: string;
      role: Role;
      error: string | null;
    }
  | { kind: 'dead' }
  | { kind: 'taken'; name: string | null; role: Role }
  | { kind: 'failed'; offline: boolean; error?: string };

/** What a run needs from the screen; `show` is ignored once the screen is gone. */
type Run = {
  kind: LinkKind;
  token: string;
  inFamily: boolean;
  meId: string | null;
  joinByLink: Session['joinByLink'];
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
      return r.show({
        kind: 'taken',
        name: plan.name,
        role: roleFor(info.side),
      });
    case 'pick':
      openAfterPick(href);
      return leaveTo('/');
    case 'signIn':
      return leaveTo(signInHref(href, plan));
    case 'claim':
      r.show({ kind: 'working', info });
      return claim(r, info, r.meId, false);
    case 'join':
      if (!plan.name)
        return r.show({
          kind: 'name',
          info,
          ticket: plan.ticket,
          role: plan.role,
          error: null,
        });
      r.show({ kind: 'working', info });
      return join(r, info, plan.ticket, plan.name, plan.role);
  }
}

async function join(r: Run, info: LinkInfo, ticket: string, name: string, role: Role): Promise<void> {
  const res = await r.joinByLink(ticket, name);
  if (res.status === 'joined') return claim(r, info, res.profileId, true);
  if (res.status === 'unavailable') return leaveTo(signInHref(claimHref(r.kind, r.token), { name, role }));
  if (res.status === 'name') return r.show({ kind: 'name', info, ticket, role, error: res.error });
  if (res.status === 'taken') return r.show({ kind: 'taken', name: sideName(info), role });
  r.show({ kind: 'failed', offline: false, error: res.error });
}

/** links.claim as `as`, then the card. `joined`: someone new, so it opens on top of their new home. */
async function claim(r: Run, info: LinkInfo, as: string | null, joined: boolean): Promise<void> {
  let id: string;
  try {
    const claimed = await claimLink(r.token, as ?? undefined);
    if (claimed.taken)
      return r.show({
        kind: 'taken',
        name: sideName(info),
        role: roleFor(info.side),
      });
    id = claimed.dishAskId;
  } catch (e) {
    console.warn('[links] claim failed', String(e).slice(0, 160));
    return r.show({ kind: 'failed', offline: false });
  }
  // /dish/[id], the card in the app, is App screens & recording's screen (being built in another session).
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

export function ClaimLink({ kind, token }: { kind: LinkKind; token: string | null }) {
  const { status, signedIn, me, joinByLink } = useSession();
  const { t } = useWords();
  const [step, setStep] = useState<Step>(token ? { kind: 'working', info: null } : { kind: 'dead' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [btn, setBtn] = useState<ActionState>('idle');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const show = useCallback((s: Step) => {
    if (alive.current) setStep(s);
  }, []);

  const inFamily = signedIn && status !== 'needs-code';
  const meId = me?.id ?? null;

  // Once per link and per Try again, as soon as the session knows whether this phone is in.
  const ran = useRef(-1);
  useEffect(() => {
    if (!token || status === 'loading' || ran.current === attempt) return;
    ran.current = attempt;
    void start({ kind, token, inFamily, meId, joinByLink, show });
  }, [kind, token, status, attempt, inFamily, meId, joinByLink, show]);

  const home = () => leaveTo(inFamily ? '/' : '/join');
  const retry = () => {
    setStep({ kind: 'working', info: null });
    setAttempt((a) => a + 1);
  };

  async function submitName() {
    const clean = name.trim();
    if (step.kind !== 'name' || !token || !clean || btn !== 'idle') return;
    setBtn('loading');
    await join({ kind, token, inFamily, meId, joinByLink, show }, step.info, step.ticket, clean, step.role);
    if (alive.current) setBtn('idle');
  }

  if (step.kind === 'name') {
    return (
      <SignInScreen onBack={home}>
        <Animated.View key="name" entering={FadeIn.duration(220)} style={styles.step}>
          <Headline title={t('signin.name.title')} line={dishTitle(step.info, t)} />
          <View style={styles.form}>
            <SignInField
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (step.error) setStep({ ...step, error: null });
              }}
              placeholder={t('signin.name.placeholder')}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="givenName"
              autoFocus={Platform.OS !== 'web'}
              returnKeyType="go"
              onSubmitEditing={() => void submitName()}
              maxLength={MAX_NAME}
              accessibilityLabel={t('signin.name.label')}
              invalid={!!step.error}
            />
            <ErrorLine error={step.error} />
          </View>
          <ActionButton label={t('signin.shared.continue')} onPress={() => void submitName()} state={btn} disabled={!name.trim()} />
          <TermsLine />
        </Animated.View>
      </SignInScreen>
    );
  }

  return (
    <SignInScreen>
      <View style={styles.middle}>
        <Animated.View key={step.kind} entering={FadeIn.duration(220)} style={styles.stack}>
          {step.kind === 'working' ? (
            <>
              {step.info ? (
                <InviteCard face={null} title={dishTitle(step.info, t)} line={t('signin.link.opening')}>
                  <View accessibilityLabel={t('signin.link.opening')} accessibilityState={{ busy: true }}>
                    <ActivityIndicator color={colors.green} size="large" />
                  </View>
                </InviteCard>
              ) : (
                <InviteCardSkeleton />
              )}
              {/* Signed out, this can make them someone in a family with no tap: the small print shows. */}
              {inFamily ? null : <TermsLine />}
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
  step: { gap: 32 },
  form: { gap: 12 },
});
