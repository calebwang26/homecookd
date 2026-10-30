// "Mom ▾" on Kid-Home / Parent-Home (top right): a 48 pt cream pill with your face and name, so it
// reads as a button (QA: Dad found the family by poking his own face; Linda didn't know her circle
// was a button). `faceOnly` (kid Home, whose title already says "Hi, Leo") drops the name: face + ▾. Tapping it goes back to "Who's in the kitchen?" (/?pick=1) with "Back to <you>",
// and Switch family / Sign out of this phone / Delete my account / Privacy policy / Terms of use at its
// foot. Every launch opens straight to this
// phone's default person (session `defaultPerson`), so the family gateway is only ever one tap
// away, never in the way.
// ActingAsBar is the reminder on Home (kid and parent) while an owner's phone is lent ("Cooking as
// Grandma · Back to Mom"): inline under the header, so it never floats over a button. Only Home has
// it (Caleb, Oct 26): on Recipes and Ask it was clutter.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Avatar, ChevronDownIcon, haptic, PressableScale, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { useHomieSlot } from '@/lib/homie/hooks';
import { HOMIE_ON } from '@/lib/homie/switch';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
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

/**
 * `homieRoom` (Parent Home's date line, Kid Home's "Hi, Leo"): the pill also keeps the room to its left
 * where homie's egg rests (lib/homie restFrame puts it just left of the pill), so the words beside it
 * never run under the egg; a long date or name wraps instead.
 */
export function ProfileButton({ faceOnly = false, homieRoom = false }: { faceOnly?: boolean; homieRoom?: boolean }) {
  const { me } = useSession();
  if (!me) return null;
  const pill = <Pill faceOnly={faceOnly} me={me} />;
  // No egg to keep room for while homie is switched off (lib/homie/switch).
  return homieRoom && HOMIE_ON ? <HomieRoom>{pill}</HomieRoom> : pill;
}

function HomieRoom({ children }: { children: ReactNode }) {
  const slot = useHomieSlot();
  const { width } = useWindowDimensions();
  // From the egg's left edge to the header's right padding (the row ends there).
  const room = Math.max(0, width - space.gutter - slot.x);
  return <View style={[styles.room, { minWidth: room }]}>{children}</View>;
}

function Pill({ faceOnly, me }: { faceOnly: boolean; me: Profile }) {
  const { t } = useWords();
  return (
    <PressableScale
      onPress={openFamilyGateway}
      accessibilityRole="button"
      accessibilityLabel={t('profiles.button.label', { name: me.name })}
      accessibilityHint={t('profiles.button.hint')}
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
  const { t } = useWords();
  const backToOwner = useBackToOwner();
  if (!me || !owner || me.id === owner.id || !backToOwner) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={[styles.barWrap, style]}>
      <View style={styles.bar} accessibilityRole="summary" accessibilityLabel={t('profiles.button.actingAsLabel', { name: me.name, owner: owner.name })}>
        <Avatar profile={me} size={28} />
        <Txt variant="label" size={15} weight={600} color={colors.ink} style={styles.flex}>
          {t('profiles.button.actingAs', { name: me.name })}
        </Txt>
        <PressableScale onPress={backToOwner} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('profiles.picker.backTo', { name: owner.name })} style={styles.barBack}>
          <Txt variant="label" size={15} weight={700} color={colors.yolkDeep}>
            {t('profiles.picker.backTo', { name: owner.name })}
          </Txt>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  room: { alignItems: 'flex-end' },
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
