// "Have a family code?" / "Have a code?": the small backup way in (and the way to switch families).
// A family code is checked, then swapped for this phone's own key (session.joinFamily), so the code
// itself is never saved, shown back or logged. Then "Who's in the kitchen?".
// The invite page's 6-letter code (or a pasted invite link) works here too: it goes to /i.
// Same look as the first screen (components/signin).
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorLine, Headline, leaveTo, routeInvite, SignInField, SignInScreen, TermsLine } from '@/components/signin';
import { ActionButton } from '@/components/ui';
import { parseInviteInput } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';

export default function JoinCodeScreen() {
  const { joinFamily, family, status } = useSession();
  const { t } = useWords();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const switching = status === 'ready' && !!family;
  const back = () => (router.canGoBack() ? router.back() : router.replace(switching ? '/' : '/join'));

  /** An invite typed or pasted here goes to /i; a family code signs in. */
  const go = () => {
    const invite = parseInviteInput(code);
    if (invite) {
      setError(null);
      routeInvite(invite);
      return; // not a promise: the button doesn't spin
    }
    return submit();
  };

  async function submit() {
    setError(null);
    const res = await joinFamily(code);
    if (!res.ok) {
      setError(res.error);
      throw new Error(res.error); // ActionButton shows its error state
    }
    setCode('');
    setTimeout(() => leaveTo('/'), 450);
  }

  return (
    <SignInScreen onBack={back}>
      <Headline
        title={switching ? t('signin.code.switchTitle') : t('signin.code.title')}
        line={switching ? t('signin.code.inFamily', { family: family!.name }) : null}
      />

      <View style={styles.form}>
        <SignInField
          code
          value={code}
          onChangeText={(text) => {
            setCode(text.toUpperCase());
            if (error) setError(null);
          }}
          placeholder={switching ? 'XXXX-XXXX' : t('signin.code.placeholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          textContentType="oneTimeCode"
          returnKeyType="go"
          onSubmitEditing={() => void Promise.resolve(go()).catch(() => {})}
          maxLength={300}
          accessibilityLabel={switching ? t('signin.code.familyLabel') : t('signin.code.label')}
          invalid={!!error}
        />
        <ErrorLine error={error} />
      </View>

      {/* The default reset brings a wrong code's "Try again" back to a working button. */}
      <View style={styles.form}>
        <ActionButton
          label={switching ? t('signin.code.switch') : t('signin.shared.comeIn')}
          onPress={go}
          disabled={!code.trim()}
          successLabel={t('signin.shared.youreIn')}
        />
        <TermsLine />
      </View>
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
});
