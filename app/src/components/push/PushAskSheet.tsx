// The one explainer shown before the OS push prompt (RETENTION-HANDOFF 2.3), so the iPhone's own
// "Allow notifications?" never arrives cold:
//   kid    "Want a note when Mom answers?"      [Yes] [Not now]
//   cook   "Want a note when Leo writes back?"  [Yes] [Not now]   (PR 1; see COOK_ASK_COOKS_IT)
//   v2     kid-card-saved "Want a note when Mom answers?" ("…when they answer?" with no name);
//          cook-craving-sent "Want a note when they pick a dish?"
// Its words read in the cook's language (lib/words, common.push.*); a kid's stay English.
// Yes asks the OS (lib/push requestAndRegister): the button shows its check only when the phone is
// really set up for notes; an OS "no" just closes the sheet. Not now, the close button or the
// backdrop all mean "Not now". Either way without a yes: no ask for 30 days. No line telling people
// what to tap in the OS prompt (App Review 5.1.1: never steer the choice).
//
// Two ways to use it:
//   <PushAskSheet visible who="kid" otherName="Mom" onYes={…} onNotNow={…} />   // just the sheet
//   <PushAskSheet visible kind="kid-card-saved" otherName="Mom" onYes={…} onNotNow={…} />   // a moment's own words
//   <PushAskHost register={(token, platform) => api.pushToken({ token, platform })} />  // once, root layout
//   askForPush({ kind: 'kid-first-made', profileId: me.id, name: 'Mom' })  // from anywhere, even lib code
//   askForPushSoon({ … })                    // the same, once a screen change has settled
// Where it's asked (RETENTION-HANDOFF 2.3): kid-first-made when cook mode's "I made it" flow ends
// (cook/[id].tsx), kid-first-question when a question reaches the server (lib/messaging deliver),
// cook-first-send after Send's burst (send.tsx) and after a recipe card goes out (messaging
// sendRecipe), kid-card-saved once a kid's dish card is claimed (components/signin/ClaimLink), and
// cook-craving-sent after she shares the craving link (parent Home, App screens & recording). Never on
// a lent phone (its notes go to the phone's own person).
// askForPush checks shouldAskPush first (pushes work in this build, not the first launch except for
// the two v2 moments, the OS prompt can still show, no recent "Not now"), so Expo Go and web never
// see the sheet.
import { useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton, Avatar, BottomSheet, EggMark, PressableScale, Txt, useSheetsUp, type ActionState, type AvatarProps } from '@/components/ui';
import { pushAskWho, requestAndRegister, shouldAskPush, snoozePushAsk, type PushAskKind, type RegisterPush } from '@/lib/push';
import { useWords } from '@/lib/words/useWords';
import { english, type T } from '@/lib/words/words';
import { colors } from '@/theme/tokens';

export type PushAskSheetProps = {
  visible: boolean;
  /** The moment asking: the v2 moments have their own question. Left out: the question goes by `who`. */
  kind?: PushAskKind;
  /**
   * kid: a note when the cook answers; cook: a note when the kid writes back (see COOK_ASK_COOKS_IT).
   * Left out: from `kind` (pushAskWho), else kid.
   */
  who?: 'kid' | 'cook';
  /** The other person, as the family calls them ("Mom", "Leo"). */
  otherName: string;
  /** Their face above the question; the egg mark when there is none. */
  profile?: AvatarProps['profile'];
  /**
   * Return a promise to keep the button loading while the OS prompt is up. It resolves true when the
   * phone is set up (the button shows its check), false when it isn't (no check: close the sheet).
   * A rejection shows "Try again".
   */
  onYes: () => void | Promise<boolean>;
  onNotNow: () => void;
};

/**
 * The cook's question only promises a note this build really sends. PR 1 pushes the kid's messages
 * and questions to the cook, never the kid's cooking (a 'cooked' message sends no push), so it says
 * "writes back". PR 2 (the "Leo is cooking" push) turns this on for the handoff's "cooks it".
 * TODO(caleb): even with PR 2 and PR 3, a kid who answers "Not now" to sharing their cooking and
 * sends no photo sends the cook no note at all. Keep "cooks it" only if that case gets a note too.
 */
export const COOK_ASK_COOKS_IT = false;

/** The question, in a few words, for a moment (or just a side). */
export function pushAskQuestion(kindOrWho: PushAskKind | 'kid' | 'cook', otherName: string, t: T = english): string {
  // A cold craving link: the kid hasn't said who they are yet.
  if (kindOrWho === 'cook-craving-sent') return t('common.push.pickDish');
  const who = kindOrWho === 'kid' || kindOrWho === 'cook' ? kindOrWho : pushAskWho(kindOrWho);
  const name = otherName.trim();
  if (who === 'cook') {
    if (!name) return t('common.push.theyWriteBack');
    return t(COOK_ASK_COOKS_IT ? 'common.push.cooksIt' : 'common.push.writesBack', { name });
  }
  return name ? t('common.push.answers', { name }) : t('common.push.theyAnswer');
}

export function PushAskSheet({ visible, kind, who, otherName, profile, onYes, onNotNow }: PushAskSheetProps) {
  const { t } = useWords();
  const question = pushAskQuestion(kind ?? who ?? 'kid', otherName, t);
  // Driven here rather than by ActionButton's own cycle, which would show a check for any answer.
  const [yesState, setYesState] = useState<ActionState>('idle');
  const pressYes = async () => {
    const answer = onYes();
    if (!answer) return;
    setYesState('loading');
    let next: ActionState = 'success';
    try {
      if (!(await answer)) next = 'idle';
    } catch {
      next = 'error';
    }
    setYesState(next);
    if (next !== 'idle') setTimeout(() => setYesState('idle'), 1800);
  };
  return (
    <BottomSheet visible={visible} onClose={onNotNow} accessibilityLabel={question}>
      <View style={styles.body}>
        {profile ? <Avatar profile={profile} size={72} /> : <EggMark size={64} />}
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
          {question}
        </Txt>
      </View>
      <View style={styles.actions}>
        <ActionButton label={t('common.push.yes')} size="xl" state={yesState} onPress={pressYes} />
        <PressableScale onPress={onNotNow} haptic accessibilityRole="button" accessibilityLabel={t('common.push.notNow')} style={styles.later}>
          <Txt variant="label" size={17} weight={600} color={colors.yolkDeep}>
            {t('common.push.notNow')}
          </Txt>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Host: one sheet for the whole app, opened by askForPush from anywhere.

/** `name`: the other person as the family calls them ("Mom"), '' when there's nobody to name yet. */
export type PushAsk = { kind: PushAskKind; profileId: string; name: string; profile?: AvatarProps['profile'] };
type Ask = PushAsk;

let pending: Ask | null = null;
let checking = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const setPending = (next: Ask | null) => {
  pending = next;
  listeners.forEach((l) => l());
};

/**
 * Shows the explainer when this moment should ask (see shouldAskPush). Resolves true when it opened.
 * One at a time: a second moment while the sheet is up does nothing.
 */
export async function askForPush(ask: Ask): Promise<boolean> {
  if (pending || checking) return false;
  checking = true;
  try {
    if (!(await shouldAskPush(ask.kind, ask.profileId))) return false;
    if (pending) return false;
    setPending(ask);
    return true;
  } finally {
    checking = false;
  }
}

/** After a navigation: long enough for the screen change to settle before the sheet rises. */
const SOON_MS = 450;

/** askForPush once a screen change has settled (e.g. right after leaving cook mode). */
export function askForPushSoon(ask: PushAsk, delayMs = SOON_MS): void {
  setTimeout(() => void askForPush(ask), delayMs);
}

export function PushAskHost({ register }: { register: RegisterPush }) {
  const ask = useSyncExternalStore(subscribe, () => pending, () => pending);
  // An ask made while another sheet is up (the craving sheet, the share sheet's family row) waits
  // for it to go: iOS won't present this Modal over that one, and the ask would be lost.
  const sheetsUp = useSheetsUp();
  // The ask on screen; kept after it closes so its words stay while the sheet slides away.
  const [shown, setShown] = useState<Ask | null>(null);
  if (ask && ask !== shown && sheetsUp === 0) setShown(ask);
  if (!shown) return null;

  const close = () => {
    if (pending === shown) setPending(null);
  };
  const yes = async () => {
    // Anything but 'registered' also starts the 30-day snooze (inside requestAndRegister).
    const result = await requestAndRegister({ register, profileId: shown.profileId });
    // Registered: the button's check, then the sheet slides away. Otherwise it just closes.
    setTimeout(close, result === 'registered' ? 600 : 0);
    return result === 'registered';
  };
  const notNow = () => {
    void snoozePushAsk(shown.profileId);
    close();
  };

  return (
    <PushAskSheet
      visible={!!ask && ask === shown}
      kind={shown.kind}
      otherName={shown.name}
      profile={shown.profile}
      onYes={yes}
      onNotNow={notNow}
    />
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 8 },
  actions: { gap: 10, paddingTop: 24, paddingBottom: 4 },
  later: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
