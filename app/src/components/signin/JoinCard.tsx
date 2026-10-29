// The join card (docs/build/JOIN-SIMPLE.md §1, mockup 1): what a join link opens. Name first, then the
// system Sign in with Apple button (Google on Android), in one card:
//   [face]  Join Test family            a family join link (/i): the family's own name
//           Mom sent this.              who sent it, when the link says
//   What do they call you?  [ Leo ]
//   [face] Are you Leo?                 a family join link, when the family has a Leo with no phone yet:
//   [ Yes, that's me ]                  the chips and Sign in wait for an answer; "that's me" signs in
//   [ No, I'm someone else ]            as him (he keeps his own role), "someone else" brings the chips
//   [ I cook ] [ I miss the food ]      chips, only on a family join link ("I miss the food" picked);
//   [  Sign in with Apple  ]            a recipe link's side sets the role, so it shows none
// A dish card's link (ClaimLink) puts the dish in the title ("Caleb's tomato egg") and prefills the
// name. The terms line goes under the card (the screen adds it).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Avatar, haptic, PotMark, PressableScale, Txt } from '@/components/ui';
import type { Claimable, Role } from '@/lib/api';
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
  claim,
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
  /** "Are you Leo?" (a family join link only): `me` is null until they pick; the chips wait for "No". */
  claim?: { person: Claimable; me: boolean | null; onAnswer: (me: boolean) => void } | null;
}) {
  const { t } = useWords();
  const answered = !claim || claim.me !== null;
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
        {claim ? <ClaimQuestion person={claim.person} me={claim.me} onAnswer={claim.onAnswer} /> : null}
        {onRole && role && (!claim || claim.me === false) ? <RoleChips value={role} onChange={onRole} /> : null}
      </View>
      {answered ? <ProviderButtons busy={busy} onPress={onSignIn} /> : null}
      <ErrorLine error={error} />
    </View>
  );
}

/** "Are you Leo?" with Leo's face, and "Yes, that's me" / "No, I'm someone else" (one under the other). */
function ClaimQuestion({ person, me, onAnswer }: { person: Claimable; me: boolean | null; onAnswer: (me: boolean) => void }) {
  const { t } = useWords();
  const question = t('signin.joinCard.areYou', { name: person.name });
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.claim}>
      <View style={styles.claimAsk}>
        <Avatar profile={person} size={FACE} />
        <Txt variant="display" size={22} leading={1.15} style={styles.claimText}>
          {question}
        </Txt>
      </View>
      <View style={styles.claimChoices} accessibilityRole="radiogroup" accessibilityLabel={question}>
        <Choice label={t('signin.joinCard.thatsMe')} on={me === true} onPress={() => onAnswer(true)} />
        <Choice label={t('signin.joinCard.someoneElse')} on={me === false} onPress={() => onAnswer(false)} />
      </View>
    </Animated.View>
  );
}

/** One pill of a pick-one row (the role chips, the claim answers). */
function Choice({ label, on, onPress, style }: { label: string; on: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <PressableScale
      onPress={() => {
        if (!on) haptic('selection');
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={[styles.chip, on ? styles.chipOn : null, style]}>
      <Txt variant="label" size={15} color={on ? colors.card : colors.ink} numberOfLines={2} align="center">
        {label}
      </Txt>
    </PressableScale>
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
      {CHIPS.map(({ role, label: key }) => (
        <Choice key={role} label={t(key)} on={value === role} onPress={() => onChange(role)} style={styles.chipHalf} />
      ))}
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
  chip: { minHeight: 48, borderRadius: 999, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  chipHalf: { flex: 1 },
  chipOn: { backgroundColor: colors.ink },
  claim: { gap: 12, marginTop: 6 },
  claimAsk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  claimText: { flex: 1 },
  claimChoices: { gap: 10 },
});
