// "Move me to the cooks" / "Move me to the ones who miss it" (Caleb, Nov 8): someone who joined in the wrong
// section moves themselves, from Account & privacy on "Who's in the kitchen?". Who may move whom is
// session.accountRemoval's rule: this phone's own person, or someone with no phone of their own who lives on it.
// Nobody moves someone else who has their own phone. POST /profiles/:id/role; their messages, recipes and asks
// stay as they are. Done: the screen takes them to their new home (onMoved).
//
//   <SwitchRoleSheet visible person={backTo} own={removal === 'own'} onClose={...} onMoved={(p) => ...} />
//
// It starts fresh on every open.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorLine } from '@/components/signin/SignInScreen';
import { ActionButton, type ActionState, BottomSheet, Txt } from '@/components/ui';
import { api, ApiError, errorMessage, type Profile } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import { colors, motion } from '@/theme/tokens';

import { otherRole, switchRoleWords } from './switchRole';

export { otherRole, switchRoleWords } from './switchRole';

export type SwitchRoleSheetProps = {
  visible: boolean;
  /** Who moves: someone session.accountRemoval allows. */
  person: Profile | null;
  /** They're this phone's own person: the words say "me" and "you". */
  own: boolean;
  onClose: () => void;
  /** Moved on the server: close the sheet, then take them home as `moved` (its new role). */
  onMoved: (moved: Profile) => void;
};

export function SwitchRoleSheet(props: SwitchRoleSheetProps) {
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Sheet key={opened.n} {...props} />;
}

function Sheet({ visible, person, own, onClose, onMoved }: SwitchRoleSheetProps) {
  const { t } = useWords();
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
    const timer = setTimeout(() => setBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
    return () => clearTimeout(timer);
  }, [btn]);

  const busy = btn === 'loading' || btn === 'success';
  const close = () => {
    if (!busy) onClose();
  };

  async function move() {
    if (!person || btn !== 'idle') return;
    const to = otherRole(person.role);
    setError(null);
    setBtn('loading');
    const started = Date.now();
    let failed: string | null = null;
    try {
      await api.setRole(person.id, to, { profileId: person.id });
    } catch (e) {
      // Before the api has the route (a 404), say so in plain words.
      failed = e instanceof ApiError && e.status === 404 ? t('profiles.switch.notReady') : errorMessage(e, t('profiles.switch.notMoved'));
    }
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Moved on the server: this phone follows even if the sheet went away meanwhile.
    if (!failed) return onMoved({ ...person, role: to });
    if (!alive.current) return;
    setError(failed);
    setBtn('error');
  }

  if (!person) return null;
  const words = switchRoleWords(person.name.trim(), own, otherRole(person.role), t);

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissOnBackdrop={!busy}
      accessibilityLabel={words.title}
      footer={
        <View style={styles.choices}>
          <ActionButton
            label={t('profiles.switch.move')}
            size="lg"
            labelWeight={700}
            haptics
            state={btn}
            loadingLabel={t('profiles.switch.moving')}
            errorLabel={t('profiles.switch.notMovedShort')}
            onPress={() => void move()}
            accessibilityLabel={words.row}
          />
          <ActionButton label={t('profiles.switch.keep')} variant="outline" size="lg" disabled={busy} onPress={close} />
          <ErrorLine error={error} align="center" />
        </View>
      }>
      <View style={styles.body}>
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header" style={styles.title}>
          {words.title}
        </Txt>
        <Txt variant="body" size={18} align="center">
          {words.line}
        </Txt>
        <Txt variant="body" size={16} align="center" color={colors.muted}>
          {t('profiles.switch.stays')}
        </Txt>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  // Clear of the sheet's round close button on both sides, so it stays centred.
  title: { paddingHorizontal: 40 },
  choices: { gap: 10 },
});
