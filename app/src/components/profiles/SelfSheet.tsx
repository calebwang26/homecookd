// "What does your family call you?" (docs/build/FEEDBACK-OCT16c.md E3): the sheet behind + on "Who's
// in the kitchen?" for a phone that came in through a family invite and hasn't said who it is yet
// (session.deviceNeedsProfile). One field, one Continue. + under the cooks adds them as a cook, +
// under the ones who miss it as a learner (session.createSelf -> POST /profiles/self), and this
// phone becomes theirs. A name that is nearly someone's already ("grandma1") asks "There's already
// a Grandma. Same person?" first (SameName: Yes closes, so they can tap their face; No adds them).
// A 409 sentence ("Dad is already in this family. Pick another name or tap your face.") shows under
// the field. Done: the button reads "You're in", then `onDone(me)` hands
// back to the screen, which closes the sheet and takes them home.
//
//   <SelfSheet visible role="cook" onClose={...} onDone={(me) => ...} />
//
// It starts fresh on every open.
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ErrorLine, SignInField } from '@/components/signin/SignInScreen';
import { ActionButton, type ActionState, BottomSheet, Txt } from '@/components/ui';
import { sameNameAs, SameNameAsk } from './SameName';
import type { Profile, Role } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion } from '@/theme/tokens';

const MAX_NAME = 40;
const TITLE = 'profiles.self.title';

export type SelfSheetProps = {
  visible: boolean;
  /** 'cook' from + under "The cooks", 'learner' from + under "The ones who miss it". */
  role: Role;
  onClose: () => void;
  /** They're in, as `me`: go to their home. */
  onDone: (me: Profile) => void;
};

export function SelfSheet(props: SelfSheetProps) {
  // A fresh field on every open.
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Self key={opened.n} {...props} />;
}

function Self({ visible, role, onClose, onDone }: SelfSheetProps) {
  const { createSelf, profiles } = useSession();
  const { t } = useWords();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<Profile | null>(null);
  const [btn, setBtn] = useState<ActionState>('idle');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // A failed try comes back for another after a moment (typing clears it at once).
  useEffect(() => {
    if (btn !== 'error') return;
    const t = setTimeout(() => setBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
    return () => clearTimeout(t);
  }, [btn]);

  const edited = () => {
    setDupe(null);
    if (error) setError(null);
    if (btn === 'error') setBtn('idle');
  };

  /** `sure`: they said they aren't the person with the same name. */
  async function go(sure = false) {
    const clean = name.trim();
    if (btn !== 'idle' || !clean) return;
    const same = sure ? null : sameNameAs(profiles, clean);
    setDupe(same);
    if (same) return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    const res = await createSelf(clean, role);
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    if (res.ok) {
      setBtn('success');
      setTimeout(() => onDone(res.me), 450);
    } else {
      setError(res.error);
      setBtn('error');
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissOnBackdrop={btn !== 'loading' && btn !== 'success'}
      accessibilityLabel={t(TITLE)}
      footer={
        <ActionButton
          label={t('profiles.self.continue')}
          size="xl"
          onPress={() => void go()}
          state={btn}
          disabled={!name.trim()}
          successLabel={t('profiles.self.youreIn')}
          accessibilityHint={role === 'cook' ? t('profiles.self.cookHint') : t('profiles.self.learnerHint')}
        />
      }>
      <Txt variant="display" size={30} leading={1.1} accessibilityRole="header" style={styles.title}>
        {t(TITLE)}
      </Txt>
      <View style={styles.form}>
        <SignInField
          value={name}
          onChangeText={(text) => {
            setName(text);
            edited();
          }}
          placeholder={role === 'cook' ? t('profiles.self.cookPlaceholder') : t('profiles.self.learnerPlaceholder')}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="name"
          textContentType="givenName"
          autoFocus={Platform.OS !== 'web'}
          returnKeyType="go"
          onSubmitEditing={() => void go()}
          maxLength={MAX_NAME}
          accessibilityLabel={t('profiles.self.nameLabel')}
          invalid={!!error}
          style={styles.field}
        />
        <ErrorLine error={error} />
        {dupe ? <SameNameAsk who={dupe} noLabel={t('profiles.self.noAddMe')} onYes={onClose} onNo={() => void go(true)} /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Clear of the sheet's round close button.
  title: { paddingRight: 44, letterSpacing: -0.9 },
  form: { gap: 10, paddingTop: 4 },
  // The cream field on the cream sheet: the page tone sets it apart.
  field: { backgroundColor: colors.page },
});
