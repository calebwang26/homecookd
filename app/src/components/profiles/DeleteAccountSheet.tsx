// "Delete my account" (App Store guideline 5.1.1(v)): the sheet behind the quiet link at the foot of
// "Who's in the kitchen?" (app/src/app/index.tsx), for whoever this phone may delete (session
// accountRemoval): its own person ("Delete your account?"), or someone with no phone of their own it
// is acting as ("Delete Grandma's account?"). It says plainly what goes: the account, messages and voice
// notes, and for a cook the recipes, for everyone in the family. Confirming runs session.deleteAccount
// (Convex's account.deleteMe, then POST /profiles/:id/remove); once both are done `onDeleted` closes the
// sheet and either signs this phone out or lets go of that person here. A step that fails shows its
// sentence under the buttons, and nothing says it worked.
//
//   <DeleteAccountSheet visible person={leo} own={false} onClose={...} onDeleted={(who, signedOut) => ...} />
//
// It starts fresh on every open.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorLine } from '@/components/signin/SignInScreen';
import { ActionButton, type ActionState, BottomSheet, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { deleteMyAccount } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { colors, motion } from '@/theme/tokens';

export type DeleteAccountSheetProps = {
  visible: boolean;
  /** Whose account: someone session.accountRemoval allows. */
  person: Profile | null;
  /** They're this phone's own person: the words say "your", and deleting signs this phone out. */
  own: boolean;
  onClose: () => void;
  /** Both steps are done: close the sheet, then leaveFamily when `signedOut`, else forgetPerson. */
  onDeleted: (person: Profile, signedOut: boolean) => void;
};

export function DeleteAccountSheet(props: DeleteAccountSheetProps) {
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Sheet key={opened.n} {...props} />;
}

/** The sheet's words, for this phone's own person or for someone else by name. */
export function deleteAccountWords(name: string, own: boolean) {
  const whose = own ? 'your' : `${name}’s`;
  return {
    title: `Delete ${whose} account?`,
    goes: own ? 'Your account, your messages and voice notes go for good.' : `${name}’s account, messages and voice notes go for good.`,
    recipes: own ? 'Your recipes go too, for everyone in your family.' : `${name}’s recipes go too, for everyone in the family.`,
    confirm: own ? 'Delete my account' : `Delete ${name}’s account`,
    keep: own ? 'Keep my account' : `Keep ${name}’s account`,
  };
}

function Sheet({ visible, person, own, onClose, onDeleted }: DeleteAccountSheetProps) {
  const { deleteAccount } = useSession();
  const [btn, setBtn] = useState<ActionState>('idle');
  const [error, setError] = useState<string | null>(null);
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

  const busy = btn === 'loading' || btn === 'success';
  const close = () => {
    if (!busy) onClose();
  };

  async function confirm() {
    if (!person || btn !== 'idle') return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    const res = await deleteAccount(person, deleteMyAccount);
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Gone on the server: this phone follows even if the sheet went away meanwhile.
    if (res.ok) return onDeleted(person, res.signedOut);
    if (!alive.current) return;
    setError(res.error);
    setBtn('error');
  }

  if (!person) return null;
  const words = deleteAccountWords(person.name.trim(), own);

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissOnBackdrop={!busy}
      accessibilityLabel={words.title}
      footer={
        <View style={styles.choices}>
          <ActionButton
            label={words.confirm}
            variant="outline"
            size="lg"
            fg={colors.danger}
            borderColor={colors.danger}
            labelWeight={700}
            haptics
            state={btn}
            loadingLabel="Deleting"
            errorLabel="Not deleted"
            onPress={() => void confirm()}
            accessibilityHint={person.role === 'cook' ? 'Deletes the account and its recipes for good' : 'Deletes the account for good'}
          />
          <ActionButton label={words.keep} size="lg" disabled={busy} onPress={close} />
          <ErrorLine error={error} align="center" />
        </View>
      }>
      <View style={styles.body}>
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header" style={styles.title}>
          {words.title}
        </Txt>
        <Txt variant="body" size={18} align="center">
          {words.goes}
        </Txt>
        {person.role === 'cook' ? (
          <Txt variant="body" size={18} weight={700} align="center">
            {words.recipes}
          </Txt>
        ) : null}
        <Txt variant="body" size={16} align="center" color={colors.muted}>
          This can’t be undone.
        </Txt>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  // Clear of the sheet's round close button on both sides, so it stays centred.
  title: { paddingHorizontal: 36 },
  choices: { gap: 12 },
});
