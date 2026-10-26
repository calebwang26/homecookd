// "Is this you on a new phone?": a phone that just joined with a family link (it has no person yet)
// can't take over a face; tapping one asks the family instead (lib/moveRequests).
//   ask       their face, "Is this you on a new phone?", Ask the family / Not me
//   waiting   "Waiting for Mom or Dad": the server names up to 3 who can let them in (settled, on
//             their own phone; the Home pop-up on their phones), else "Waiting for the family".
//             "Asks last 7 days. Open homecookd again anytime." and a "Text Mom" button: Messages
//             with "It's Maya on a new phone. Open homecookd to let me in." and no recipient (the
//             text goes from their own Messages; nothing is posted in the family). Checks every few
//             seconds while open, and again when the screen comes back (`resume`: an earlier request
//             that is still waiting).
//   approved  the family reloads (this phone is theirs now), a toast says "You're back. Auntie let
//             you in." and `onIn(them)` takes them home
//   declined / expired   one sentence and a way to try again
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { copyLink, openMessages } from '@/components/share/shareLink';
import { ActionButton, Avatar, BottomSheet, PressableScale, Txt, useToast } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { listNames } from '@/lib/format';
import { MoveError, moveApi, type MyMoveRequest } from '@/lib/moveRequests';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

const POLL_MS = 4000;

type Stage = 'ask' | 'waiting' | 'declined' | 'expired';

export function NewPhoneSheet({
  person,
  visible,
  resume,
  onClose,
  onIn,
}: {
  person: Profile | null;
  visible: boolean;
  /** Open straight on "waiting" (a request from before is still pending). */
  resume?: boolean;
  onClose: () => void;
  onIn: (them: Profile) => void;
}) {
  const { family, refresh } = useSession();
  const { t } = useWords();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>(resume ? 'waiting' : 'ask');
  const [error, setError] = useState<string | null>(null);
  // Who can let them in, from the server while it waits (none named yet: "the family").
  const [asked, setAsked] = useState<string[]>([]);
  const done = useRef(false);

  // Each open starts where it should: a fresh ask, or still waiting.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStage(resume ? 'waiting' : 'ask');
      setError(null);
      // Names from an earlier ask (maybe for someone else) wait for this one's first answer.
      setAsked([]);
    }
  }

  const settle = useCallback(
    async (r: MyMoveRequest | null) => {
      if (!r || done.current || !person || r.profile_id !== person.id) return;
      if (r.status === 'pending' && Array.isArray(r.asked)) setAsked(r.asked);
      if (r.status === 'approved') {
        done.current = true;
        await refresh();
        toast.show(r.let_in_by ? t('profiles.newPhone.backLetIn', { name: r.let_in_by }) : t('profiles.newPhone.back'));
        onIn(person);
      } else if (r.status === 'declined') setStage('declined');
      else if (r.status === 'expired') setStage('expired');
    },
    [person, refresh, onIn, toast, t],
  );

  useEffect(() => {
    if (!visible || stage !== 'waiting') return;
    let alive = true;
    const check = () =>
      moveApi
        .mine()
        .then((r) => alive && void settle(r))
        .catch(() => {});
    void check();
    const t = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [visible, stage, settle]);

  if (!person) return null;
  const familyName = family?.name;

  const ask = async () => {
    setError(null);
    try {
      await moveApi.ask(person.id);
      setStage('waiting');
    } catch (e) {
      setError(e instanceof MoveError ? e.message : t('profiles.newPhone.wentWrong'));
      throw e; // the button shows its error state
    }
  };

  /** A nudge from their own Messages, to no one in particular: they pick who. */
  const nudge = async () => {
    const text = t('profiles.newPhone.nudge', { name: person.name });
    const res = await openMessages(text);
    if (res === 'unavailable') {
      toast.show((await copyLink(text)) ? t('profiles.newPhone.copied') : t('profiles.newPhone.noTexting'));
    }
  };
  const first = asked[0];

  const title =
    stage === 'waiting'
      ? asked.length
        ? t('profiles.newPhone.waitingFor', { names: listNames(asked, 'or', t) })
        : t('profiles.newPhone.waitingFamily')
      : stage === 'declined'
        ? t('profiles.newPhone.declined', { name: person.name })
        : stage === 'expired'
          ? t('profiles.newPhone.expired')
          : t('profiles.newPhone.ask');
  const line =
    stage === 'waiting'
      ? t('profiles.newPhone.waitingLine')
      : stage === 'declined'
        ? t('profiles.newPhone.declinedLine')
        : stage === 'expired'
          ? t('profiles.newPhone.expiredLine')
          : familyName != null
            ? t('profiles.newPhone.askLine', { family: familyName, name: person.name })
            : t('profiles.newPhone.askLineNoFamily', { name: person.name });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={title}
      footer={
        stage === 'waiting' ? (
          <ActionButton
            label={first ? t('profiles.newPhone.textName', { name: first }) : t('profiles.newPhone.textFamily')}
            variant="outline"
            size="xl"
            haptics
            onPress={() => void nudge()}
            accessibilityHint={t('profiles.newPhone.textHint')}
          />
        ) : (
          <View style={styles.footer}>
            <ActionButton label={stage === 'ask' ? t('profiles.newPhone.askFamily') : t('profiles.newPhone.askAgain')} size="xl" onPress={ask} successLabel={t('profiles.newPhone.asked')} />
            {stage === 'ask' ? (
              <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel={t('profiles.newPhone.notMeLabel', { name: person.name })} style={styles.notMe}>
                <Txt variant="label" weight={600} color={colors.greenDeep}>
                  {t('profiles.newPhone.notMe')}
                </Txt>
              </PressableScale>
            ) : null}
          </View>
        )
      }>
      <View style={styles.body}>
        <Avatar profile={person} size={72} />
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
          {title}
        </Txt>
        <Txt variant="body" size={16} align="center">
          {line}
        </Txt>
        {stage === 'waiting' ? <ActivityIndicator color={colors.greenDeep} style={styles.spinner} /> : null}
        {error ? (
          <Txt variant="meta" color={colors.danger} align="center" accessibilityRole="alert">
            {error}
          </Txt>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 4, paddingBottom: 8, paddingHorizontal: 8 },
  spinner: { marginTop: 8 },
  footer: { gap: 6 },
  notMe: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
