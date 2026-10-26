// "Delete my account" (App Store guideline 5.1.1(v)): the sheet behind the quiet link at the foot of
// "Who's in the kitchen?" (app/src/app/index.tsx), only ever for this phone's own person. It says plainly
// what goes: their account, messages and voice notes, and for a cook her recipes, for everyone in the
// family. "Delete my account" runs session.deleteAccount (Convex's account.deleteMe, then POST
// /profiles/:id/remove); once both are done `onDeleted` closes the sheet and signs this phone out. A step
// that fails shows its sentence under the buttons, and nothing says it worked.
//
//   <DeleteAccountSheet visible person={owner} onClose={...} onDeleted={...} />
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

const TITLE = 'Delete your account?';

export type DeleteAccountSheetProps = {
  visible: boolean;
  /** This phone's own person (session `owner`). */
  person: Profile | null;
  onClose: () => void;
  /** Both steps are done: close the sheet, then sign this phone out (session leaveFamily). */
  onDeleted: () => void;
};

export function DeleteAccountSheet(props: DeleteAccountSheetProps) {
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Sheet key={opened.n} {...props} />;
}

function Sheet({ visible, person, onClose, onDeleted }: DeleteAccountSheetProps) {
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
    if (btn !== 'idle') return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    const res = await deleteAccount(deleteMyAccount);
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Gone on the server: this phone signs out even if the sheet went away meanwhile.
    if (res.ok) return onDeleted();
    if (!alive.current) return;
    setError(res.error);
    setBtn('error');
  }

  if (!person) return null;
  const cook = person.role === 'cook';

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissOnBackdrop={!busy}
      accessibilityLabel={TITLE}
      footer={
        <View style={styles.choices}>
          <ActionButton
            label="Delete my account"
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
            accessibilityHint={cook ? 'Deletes your account and your recipes for good' : 'Deletes your account for good'}
          />
          <ActionButton label="Keep my account" size="lg" disabled={busy} onPress={close} />
          <ErrorLine error={error} align="center" />
        </View>
      }>
      <View style={styles.body}>
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header" style={styles.title}>
          {TITLE}
        </Txt>
        <Txt variant="body" size={18} align="center">
          Your account, your messages and voice notes go for good.
        </Txt>
        {cook ? (
          <Txt variant="body" size={18} weight={700} align="center">
            Your recipes go too, for everyone in your family.
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
