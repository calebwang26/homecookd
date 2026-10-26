// The Home pop-up for "Dad is on a new phone" (lib/moveRequests): it slides up when someone settled,
// on their own phone, opens the app (or comes back to it) while a request is waiting. It says when
// they asked and what letting them in does: "Asked 2 min ago. Their old phone will be signed out."
//   Let Dad in      approves (first tap in the family wins); while it works the other two grey out,
//                   then the sheet turns to a check, "Dad's in." and one Done
//   That's not Dad  declines; then "Okay. Dad's old phone stays as it is." and Done
// The phone lines are only for someone with a phone signed in (GET /family `has_phone`). Grandma,
// who only ever cooked on Mom's phone, has none: "The new phone will be theirs." / "Nothing changes
// for Grandma."
//   Not now         closes it for this visit; the request stays (the parent updates card shows it too)
// Nothing closes on its own after an answer here: Done does. Someone else answering first: phones
// ask every 3 s while a request waits, so an unanswered pop-up closes on its own everywhere, with no
// note. A tap that lost the race (409/410/404) closes quietly too; only a "Please try again." clash
// keeps the pop-up, with that sentence.
// `openMoveRequest(id)` re-opens it from the updates card.
import { useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActionButton, Avatar, BottomSheet, PressableScale, SuccessBurst, Txt, useToast } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { forgetMoveRequest, MoveError, moveApi, reloadMoveRequests, useMoveRequests, type MoveRequest } from '@/lib/moveRequests';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

// Closed with "Not now" this visit, and one asked for by the updates card.
const later = new Set<string>();
let wanted: string | null = null;
const listeners = new Set<() => void>();
const ping = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let version = 0;

/** Show this request's pop-up now (from the updates card). */
export function openMoveRequest(id: string) {
  later.delete(id);
  wanted = id;
  version++;
  ping();
}

/** Which answer is on its way, and how it ended (the sheet then waits for Done). */
type Busy = 'yes' | 'no' | null;
type Answered = { id: string; yes: boolean; hadPhone: boolean } | null;

export function MoveRequestPrompt() {
  const requests = useMoveRequests();
  const { profiles } = useSession();
  const { t } = useWords();
  const toast = useToast();
  useSyncExternalStore(subscribe, () => version, () => version);
  const next: MoveRequest | null = (wanted ? requests.find((r) => r.id === wanted) : null) ?? requests.find((r) => !later.has(r.id)) ?? null;
  // The request on screen; kept after it goes, so its words stay while the sheet slides away.
  const [shown, setShown] = useState<MoveRequest | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [answered, setAnswered] = useState<Answered>(null);
  const settled = !!answered && answered.id === shown?.id;
  // An answer here holds the sheet (and the next request waits) until Done.
  if (!settled && !busy && next && next.id !== shown?.id) setShown(next);
  // While an answer is on its way it stays up too, even if a poll drops the request meanwhile (our
  // own approval landing first), so it never slides away and pops back with the result.
  const open = settled || !!busy || (!!next && next.id === shown?.id);

  if (!shown) return null;
  const name = shown.profile.name;
  // Letting them in signs out a phone only if one is signed in as them.
  const hasPhone = !!profiles.find((p) => p.id === shown.profile.id)?.has_phone;
  // "Dad’s old phone", "James’ old phone" (the English possessive, as lib/format possessive).
  const oldPhoneKey = /s$/i.test(name.trim()) ? 'profiles.move.oldPhoneStaysS' : 'profiles.move.oldPhoneStays';

  const close = () => {
    later.add(shown.id);
    if (wanted === shown.id) wanted = null;
    version++;
    ping();
  };
  const done = () => {
    if (wanted === shown.id) wanted = null;
    forgetMoveRequest(shown.id);
    setAnswered(null);
  };
  const answer = async (yes: boolean) => {
    if (busy) return;
    // Read before the family reloads with them on the new phone.
    const hadPhone = hasPhone;
    setBusy(yes ? 'yes' : 'no');
    try {
      await (yes ? moveApi.approve(shown.id) : moveApi.decline(shown.id));
    } catch (e) {
      // Answered elsewhere, expired, or gone: the server's list says whether it still waits. Only a
      // "Please try again." clash keeps it here (with that sentence); otherwise it just closes.
      if (e instanceof MoveError && (e.status === 404 || e.status === 409 || e.status === 410)) {
        if (wanted === shown.id) wanted = null;
        await reloadMoveRequests();
        if (/try again/i.test(e.message)) toast.show(e.message);
        return;
      }
      throw e; // the button shows its error state
    } finally {
      setBusy(null);
    }
    // No note anywhere (seamless): the sheet says what happened and waits for Done.
    setAnswered({ id: shown.id, yes, hadPhone });
  };

  return (
    <BottomSheet visible={open} onClose={settled ? done : close} accessibilityLabel={t('profiles.move.title', { name })}>
      {settled ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.result}>
          {answered.yes ? (
            <SuccessBurst
              title={t('profiles.move.in', { name })}
              subtitle={answered.hadPhone ? t('profiles.move.signedOut') : t('profiles.move.theirsNow')}
            />
          ) : (
            <View style={styles.body}>
              <Avatar profile={shown.profile} size={72} />
              <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
                {t('profiles.move.okay')}
              </Txt>
              <Txt variant="body" size={16} align="center">
                {answered.hadPhone ? t(oldPhoneKey, { name: name.trim() }) : t('profiles.move.nothingChanges', { name })}
              </Txt>
            </View>
          )}
          <ActionButton label={t('profiles.sheet.done')} size="xl" onPress={done} style={styles.done} />
        </Animated.View>
      ) : (
        <>
          <View style={styles.body}>
            <Avatar profile={shown.profile} size={72} />
            <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
              {t('profiles.move.title', { name })}
            </Txt>
            <Txt variant="body" size={16} align="center">
              {t(hasPhone ? 'profiles.move.askedSignOut' : 'profiles.move.askedNewPhone', { when: timeAgo(shown.created_at, undefined, t) })}
            </Txt>
          </View>
          <View style={styles.actions}>
            <ActionButton label={t('profiles.move.letIn', { name })} size="xl" onPress={() => answer(true)} disabled={busy === 'no'} successLabel={t('profiles.move.letInDone')} />
            <ActionButton
              label={t('profiles.move.notThem', { name })}
              variant="outline"
              size="lg"
              onPress={() => answer(false)}
              disabled={busy === 'yes'}
              haptics={false}
            />
            <PressableScale
              onPress={close}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel={t('profiles.move.notNow')}
              accessibilityState={{ disabled: !!busy }}
              style={[styles.later, busy ? styles.dim : null]}>
              <Txt variant="label" weight={600} color={colors.greenDeep}>
                {t('profiles.move.notNow')}
              </Txt>
            </PressableScale>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 8 },
  actions: { gap: 10, paddingTop: 20, paddingBottom: 4 },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
  result: { alignItems: 'center', gap: 20, paddingTop: 8, paddingBottom: 4 },
  done: { alignSelf: 'stretch' },
});
