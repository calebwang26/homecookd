// The join card (docs/build/JOIN-SIMPLE.md §1, mockup 1): what a join link opens. Name first, then the
// system Sign in with Apple button (Google on Android), in one card:
//   [face]  Join Test family            a family join link (/i): the family's own name
//           Mom sent this.              who sent it, when the link says
//   What do they call you?  [ Asha ]
//   [ I cook ] [ I miss the food ]      chips, only on a family join link ("I miss the food" picked);
//   [  Sign in with Apple  ]            a recipe link's side sets the role, so it shows none
// A dish card's link (ClaimLink) puts the dish in the title ("Caleb's tomato egg") and prefills the
// name. The terms line goes under the card (the screen adds it).
import { StyleSheet, View } from 'react-native';

import { Avatar, haptic, PotMark, PressableScale, Txt } from '@/components/ui';
import type { Role } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, radii, shadows } from '@/theme/tokens';

import type { InviteFace } from './InviteCard';
import { ProviderButtons, type Provider } from './ProviderButtons';
import { ErrorLine, SignInField } from './SignInScreen';

const FACE = 48;
const MAX_NAME = 40;

/** The small face at the top of the join and move cards: whoever sent the link, else the pot. */
export function CardFace({ face }: { face: InviteFace }) {
  return face ? (
    <Avatar profile={face} size={FACE} />
  ) : (
    <View style={styles.pot}>
      <PotMark size={28} />
    </View>
  );
}

export function JoinCard({
  face,
  title,
  line,
  name,
  onName,
  role,
  onRole,
  busy,
  onSignIn,
  error,
  nameError,
}: {
  face: InviteFace;
  title: string;
  line?: string | null;
  name: string;
  onName: (name: string) => void;
  /** The chips show only with `onRole` (a family join link). */
  role?: Role;
  onRole?: (role: Role) => void;
  busy: Provider | null;
  onSignIn: (p: Provider) => void;
  /** Under the sign-in button (offline, server trouble). */
  error?: string | null;
  /** Under the name ("Type your name first.", "Asha is already in this family."). */
  nameError?: string | null;
}) {
  const { t } = useWords();
  return (
    <View style={styles.card}>
      <CardFace face={face} />
      <View style={styles.words}>
        <Txt variant="display" size={30} leading={1.1} accessibilityRole="header">
          {title}
        </Txt>
        {line ? <Txt variant="lead">{line}</Txt> : null}
      </View>
      <View style={styles.form}>
        <Txt variant="label" size={16}>
          {t('signin.joinCard.ask')}
        </Txt>
        <SignInField
          value={name}
          onChangeText={onName}
          placeholder={t('signin.name.placeholder')}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="name"
          textContentType="givenName"
          returnKeyType="done"
          maxLength={MAX_NAME}
          accessibilityLabel={t('signin.joinCard.ask')}
          invalid={!!nameError}
        />
        <ErrorLine error={nameError} />
        {onRole && role ? <RoleChips value={role} onChange={onRole} /> : null}
      </View>
      <ProviderButtons busy={busy} onPress={onSignIn} />
      <ErrorLine error={error} />
    </View>
  );
}

const CHIPS: { role: Role; label: WordKey }[] = [
  { role: 'cook', label: 'signin.joinCard.cook' },
  { role: 'learner', label: 'signin.joinCard.missFood' },
];

/** "I cook" / "I miss the food": a cook records the family's dishes, a learner cooks them. */
function RoleChips({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  const { t } = useWords();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('signin.joinCard.roleLabel')}>
      {CHIPS.map(({ role, label: key }) => {
        const on = value === role;
        return (
          <PressableScale
            key={role}
            onPress={() => {
              if (!on) haptic('selection');
              onChange(role);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(key)}
            style={[styles.chip, on ? styles.chipOn : null]}>
            <Txt variant="label" size={15} color={on ? colors.card : colors.ink} numberOfLines={1}>
              {t(key)}
            </Txt>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.sheet,
    boxShadow: shadows.cardRaised,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 20,
    overflow: 'hidden',
  },
  words: { gap: 8 },
});

const styles = StyleSheet.create({
  ...cardStyles,
  pot: { width: FACE, height: FACE, borderRadius: FACE / 2, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
  form: { gap: 10 },
  chips: { flexDirection: 'row', gap: 10, marginTop: 4 },
  chip: { flex: 1, minHeight: 48, borderRadius: 999, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.ink },
});
