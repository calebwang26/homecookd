// "Have a family code?" / "Have a code?": the small backup way in (and the way to switch families).
// A family code is checked, then swapped for this phone's own key (session.joinFamily), so the code
// itself is never saved, shown back or logged. Then "Who's in the kitchen?".
// The invite page's 6-letter code (or a pasted invite link) works here too: it goes to /i.
// Same look as the first screen (components/signin).
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorLine, Headline, leaveTo, routeInvite, SignInField, SignInScreen } from '@/components/signin';
import { ActionButton } from '@/components/ui';
import { parseInviteInput } from '@/lib/auth';
import { useSession } from '@/lib/session';

export default function JoinCodeScreen() {
  const { joinFamily, family, status } = useSession();
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
      <Headline title={switching ? 'Switch family' : 'Type your code'} line={switching ? `You’re in ${family!.name}.` : null} />

      <View style={styles.form}>
        <SignInField
          code
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase());
            if (error) setError(null);
          }}
          placeholder={switching ? 'XXXX-XXXX' : 'Family or invite code'}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          textContentType="oneTimeCode"
          returnKeyType="go"
          onSubmitEditing={() => void Promise.resolve(go()).catch(() => {})}
          maxLength={300}
          accessibilityLabel={switching ? 'Family code' : 'Family code or invite code'}
          invalid={!!error}
        />
        <ErrorLine error={error} />
      </View>

      {/* The default reset brings a wrong code's "Try again" back to a working button. */}
      <ActionButton label={switching ? 'Switch' : 'Come in'} onPress={go} disabled={!code.trim()} successLabel="You’re in" />
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
});
