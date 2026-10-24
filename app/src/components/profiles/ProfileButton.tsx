// "Mom ▾" on Kid-Home / Parent-Home (top right): a 48 pt cream pill with your face and name, so it
// reads as a button (QA: Dad found the family by poking his own face; Linda didn't know her circle
// was a button). `faceOnly` (kid Home, whose title already says "Hi, Leo") drops the name: face + ▾. Tapping it goes back to "Who's in the kitchen?" (/?pick=1) with "Back to <you>",
// and Switch family / Sign out of this phone at its foot. Every launch opens straight to this
// phone's default person (session `defaultPerson`), so the family gateway is only ever one tap
// away, never in the way.
// ActingAsBar is the reminder at the top of each tab while an owner's phone is lent ("Cooking as
// Grandma · Back to Mom"): inline under the header, so it never floats over a button.
import { router } from 'expo-router';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Avatar, ChevronDownIcon, haptic, PressableScale, Txt } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors, shadows, space } from '@/theme/tokens';

/** Back to the phone's owner, at their home (nothing of the lent person's screens left behind). */
export function useBackToOwner(): (() => void) | null {
  const { owner, setMe, homeFor } = useSession();
  if (!owner) return null;
  return () => {
    haptic('selection');
    if (router.canDismiss()) router.dismissAll();
    setMe(owner);
    router.replace(homeFor(owner));
  };
}

/** "Who's in the kitchen?" again, with Back to the current person. */
export function openFamilyGateway() {
  haptic('selection');
  if (router.canDismiss()) router.dismissAll();
  router.replace('/?pick=1');
}

export function ProfileButton({ faceOnly = false }: { faceOnly?: boolean }) {
  const { me } = useSession();
  if (!me) return null;
  return (
    <PressableScale
      onPress={openFamilyGateway}
      accessibilityRole="button"
      accessibilityLabel={`${me.name}. Who’s in the kitchen?`}
      accessibilityHint="Shows everyone in the family, with Switch family and Sign out"
      hitSlop={4}
      style={[styles.pill, faceOnly ? styles.pillFace : null]}>
      <Avatar profile={me} size={36} />
      {faceOnly ? null : (
        <Txt variant="label" size={17} weight={700} color={colors.ink} numberOfLines={1} style={styles.pillName}>
          {me.name}
        </Txt>
      )}
      <ChevronDownIcon size={16} color={colors.ink} strokeWidth={2.4} />
    </PressableScale>
  );
}

/**
 * "Cooking as Grandma · Back to Mom" while the phone is lent: put it at the top of a tab's content,
 * under the header (it scrolls with the page and never covers a button). Long names wrap.
 */
export function ActingAsBar({ style }: { style?: StyleProp<ViewStyle> }) {
  const { me, owner } = useSession();
  const backToOwner = useBackToOwner();
  if (!me || !owner || me.id === owner.id || !backToOwner) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.barWrap, style]}>
      <View style={styles.bar} accessibilityRole="summary" accessibilityLabel={`Cooking as ${me.name} on ${owner.name}’s phone`}>
        <Avatar profile={me} size={28} />
        <Txt variant="label" size={15} weight={600} color={colors.ink} style={styles.flex}>
          Cooking as {me.name}
        </Txt>
        <PressableScale onPress={backToOwner} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Back to ${owner.name}`} style={styles.barBack}>
          <Txt variant="label" size={15} weight={700} color={colors.greenDeep}>
            Back to {owner.name}
          </Txt>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 48,
    maxWidth: 190,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillName: { flexShrink: 1 },
  pillFace: { paddingRight: 12, gap: 6 },
  flex: { flex: 1, minWidth: 0 },
  barWrap: { marginHorizontal: space.gutter, marginTop: 12 },
  bar: {
    minHeight: 52,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 26,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barBack: { minHeight: 44, maxWidth: '50%', paddingHorizontal: 12, justifyContent: 'center' },
});
