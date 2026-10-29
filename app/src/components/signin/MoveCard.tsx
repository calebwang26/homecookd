// "You're in Wang family. Join Pawar family instead?" (docs/build/JOIN-SIMPLE.md §1.5 and §4, mockup 3):
// someone in one family opened another family's link. Nothing moves until they tap, twice:
//   ask      "Your messages stay with Wang family. Nothing moves until you tap." [ Join Pawar family ]
//   signIn   "Sign in with Apple to join Pawar family." and the system Apple button (Google on
//            Android): the server needs proof it's the same person, and that sign-in moves them
// "Not now" (the screen's) changes nothing. "Join …" is a plain button, never the Apple sign-in itself.
import { Platform, View } from 'react-native';

import { ActionButton, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';

import type { InviteFace } from './InviteCard';
import { cardStyles, CardFace } from './JoinCard';
import { ProviderButtons, type Provider } from './ProviderButtons';
import { ErrorLine } from './SignInScreen';

export function MoveCard({
  face,
  from,
  to,
  confirmed,
  onConfirm,
  busy,
  onSignIn,
  error,
}: {
  face: InviteFace;
  /** The family they're in now, and the link's. */
  from: string;
  to: string;
  /** They tapped "Join …": the sign-in shows. */
  confirmed: boolean;
  onConfirm: () => void;
  busy: Provider | null;
  onSignIn: (p: Provider) => void;
  error?: string | null;
}) {
  const { t } = useWords();
  const google = Platform.OS === 'android';
  return (
    <View style={cardStyles.card}>
      <CardFace face={face} />
      <View style={cardStyles.words}>
        <Txt variant="display" size={30} leading={1.1} accessibilityRole="header">
          {t('signin.move.title', { from, to })}
        </Txt>
        <Txt variant="lead">{confirmed ? t(google ? 'signin.move.signInGoogle' : 'signin.move.signInApple', { to }) : t('signin.move.line', { from })}</Txt>
      </View>
      {confirmed ? (
        <ProviderButtons busy={busy} onPress={onSignIn} />
      ) : (
        <ActionButton label={t('signin.move.join', { to })} variant="ink" size="md" onPress={onConfirm} />
      )}
      <ErrorLine error={error} />
    </View>
  );
}
