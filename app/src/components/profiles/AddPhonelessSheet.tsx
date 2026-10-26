// "Add someone without a phone": for Grandpa Joe, who cooks on Mom's phone. Opened from "Who's in
// the kitchen?" (its "+ Add someone without a phone" link) and from the invite sheet's "No phone?
// Add them to this phone" row (AddFamilySheet), so Home has it too.
// Their name and The cooks / The ones who miss it (the picker's own section names; POST /profiles).
// A name that is nearly someone's already ("grandma1") asks "There's already a Grandma. Same
// person?" first (SameName: Yes closes, No adds). Then the family reloads and the sheet turns to
// "Grandpa Joe is in the family." with a big Done (stay who you are: nothing goes out under his name
// by surprise) and a quiet "Switch to Grandpa Joe" (`onSwitch(them)`; the "Cooking as Grandpa Joe"
// bar then shows on an owner's phone). If they get a phone later, their own link moves the face.
// A taken name comes back as the server's sentence under the field. It starts fresh on every open.
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ErrorLine, SignInField } from '@/components/signin/SignInScreen';
import { ActionButton, type ActionState, Avatar, BottomSheet, PressableScale, SegmentedChoice, Txt } from '@/components/ui';
import { api, errorMessage, type Profile, type Role } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion } from '@/theme/tokens';

import { sameNameAs, SameNameAsk } from './SameName';

const MAX_NAME = 40;
const TITLE = 'profiles.phoneless.title';

export type AddPhonelessSheetProps = {
  visible: boolean;
  /** Closed, or Done after adding (still the same person on this phone). */
  onClose: () => void;
  /** "Switch to Grandpa Joe" after adding: cook as them now. */
  onSwitch: (them: Profile) => void;
};

export function AddPhonelessSheet(props: AddPhonelessSheetProps) {
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <AddPhoneless key={opened.n} {...props} />;
}

function AddPhoneless({ visible, onClose, onSwitch }: AddPhonelessSheetProps) {
  const { refresh, profiles } = useSession();
  const { t } = useWords();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('cook');
  const [error, setError] = useState<string | null>(null);
  // Someone with nearly this name already: asked about before anything is added.
  const [dupe, setDupe] = useState<Profile | null>(null);
  const [btn, setBtn] = useState<ActionState>('idle');
  // Added: the sheet says so and waits for Done (or Switch).
  const [added, setAdded] = useState<Profile | null>(null);
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

  const clean = name.trim();
  // Worked out here, before go(): below it, the React Compiler lint reads go()'s Date.now as run in render.
  const addLabel = clean && clean.length <= 18 ? t('profiles.phoneless.addName', { name: clean }) : t('profiles.phoneless.addThem');

  /** `sure`: they said this isn't the person with the same name. */
  async function go(sure = false) {
    if (btn !== 'idle' || !clean) return;
    const same = sure ? null : sameNameAs(profiles, clean);
    setDupe(same);
    if (same) return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    let made: Profile | null = null;
    try {
      made = await api.createProfile({ name: clean, role });
      await refresh();
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
      setBtn('error');
      return;
    }
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    setBtn('success');
    const them = made;
    setTimeout(() => alive.current && setAdded(them), 450);
  }

  if (added) {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        accessibilityLabel={t('profiles.phoneless.addedLabel', { name: added.name })}
        footer={<ActionButton label={t('profiles.sheet.done')} size="xl" onPress={onClose} />}>
        <Animated.View entering={FadeIn.duration(180)} style={styles.added}>
          <Avatar profile={added} size={72} />
          <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
            {t('profiles.phoneless.added', { name: added.name })}
          </Txt>
          <PressableScale
            onPress={() => onSwitch(added)}
            accessibilityRole="button"
            accessibilityLabel={t('profiles.phoneless.switchTo', { name: added.name })}
            accessibilityHint={t('profiles.phoneless.switchHint')}
            style={styles.switch}>
            <Txt variant="label" weight={600} color={colors.greenDeep}>
              {t('profiles.phoneless.switchTo', { name: added.name })}
            </Txt>
          </PressableScale>
        </Animated.View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissOnBackdrop={btn !== 'loading' && btn !== 'success'}
      accessibilityLabel={t(TITLE)}
      footer={
        <ActionButton
          label={addLabel}
          size="xl"
          onPress={() => void go()}
          state={btn}
          disabled={!clean}
          successLabel={t('profiles.phoneless.addedButton')}
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
            setDupe(null);
            if (error) setError(null);
            if (btn === 'error') setBtn('idle');
          }}
          placeholder={t('profiles.phoneless.placeholder')}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus={Platform.OS !== 'web'}
          returnKeyType="go"
          onSubmitEditing={() => void go()}
          maxLength={MAX_NAME}
          accessibilityLabel={t('profiles.phoneless.nameLabel')}
          invalid={!!error}
          style={styles.field}
        />
        <ErrorLine error={error} />
        {dupe ? <SameNameAsk who={dupe} noLabel={t('profiles.phoneless.noAddThem')} onYes={onClose} onNo={() => void go(true)} /> : null}
        <SegmentedChoice
          options={[
            { key: 'cook', title: t('profiles.picker.cooks') },
            { key: 'learner', title: t('profiles.picker.missIt') },
          ]}
          value={role}
          onChange={setRole}
          height={68}
          accessibilityLabel={t('profiles.phoneless.sectionLabel')}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { paddingRight: 44, letterSpacing: -0.9 },
  form: { gap: 12, paddingTop: 4 },
  field: { backgroundColor: colors.page },
  added: { alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 8 },
  switch: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
