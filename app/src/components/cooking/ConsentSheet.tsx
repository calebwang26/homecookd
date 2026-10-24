// The one-time question before cook mode shares anything (RETENTION-HANDOFF 3.1, guardrail 6):
//   "Let Mom see when you cook their dishes?"
//   Each cook in the family gets a note when you start one of their dishes.
//   [Yes]  Not now
// Shown the first time a kid opens cook mode on another family cook's dish (the server answered
// consent 'unasked'); the answer is one setting for every cook and holds on every phone
// (profiles.share_cooking). "Not now" means nothing is ever sent. Only a tap on one of the two buttons
// answers: no close button, no backdrop tap and no drag (no grabber either), so a stray gesture never
// answers for the kid. The Android back button (Escape on web) only closes the sheet for this visit
// (`onDismiss`: nothing saved, nothing shared, asked again next visit). The answer can't be changed
// in the app until ShareCookingRow is mounted (TODO(caleb) there).
// Presentational: lib/useCookingSession.ts owns the answer (askConsent / answerConsent / dismissConsent).
import { StyleSheet, View } from 'react-native';

import { ActionButton, Avatar, BottomSheet, PotMark, PressableScale, Txt, type AvatarProps } from '@/components/ui';
import { consentDetail, consentQuestion } from '@/lib/cookingLogic';
import { colors } from '@/theme/tokens';

export type ConsentSheetProps = {
  visible: boolean;
  /** The dish's cook, as the family calls them ("Mom"). */
  cookName: string | null | undefined;
  /** Their face above the question; the pot when there is none. */
  profile?: AvatarProps['profile'];
  /** Yes. Return a promise: the button shows loading, then the sheet closes (or "Try again"). */
  onYes: () => void | Promise<unknown>;
  /** Not now, tapped: saved, nothing is ever sent. */
  onNotNow: () => void;
  /** Android back / Escape: the sheet goes for this visit only, nothing saved (asked again next visit). */
  onDismiss: () => void;
};

export function ConsentSheet({ visible, cookName, profile, onYes, onNotNow, onDismiss }: ConsentSheetProps) {
  const question = consentQuestion(cookName);
  return (
    <BottomSheet
      visible={visible}
      onClose={onDismiss}
      showClose={false}
      dismissOnBackdrop={false}
      dismissOnDrag={false}
      accessibilityLabel={question}>
      <View style={styles.body}>
        {profile ? <Avatar profile={profile} size={72} /> : <PotMark size={64} />}
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
          {question}
        </Txt>
        <Txt variant="lead" align="center">
          {consentDetail()}
        </Txt>
      </View>
      <View style={styles.actions}>
        <ActionButton label="Yes" size="xl" onPress={onYes} />
        <PressableScale onPress={onNotNow} haptic accessibilityRole="button" accessibilityLabel="Not now" style={styles.later}>
          <Txt variant="label" size={17} weight={600} color={colors.greenDeep}>
            Not now
          </Txt>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 8 },
  actions: { gap: 10, paddingTop: 24, paddingBottom: 4 },
  later: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
