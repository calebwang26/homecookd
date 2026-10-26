// One face on "Who's in the kitchen?" (bible Main): a 156 px cream tile, radius 24, the card shadow;
// 68 px avatar (+ green unread dot or sun "New" badge), name in Fraunces 600 20, a 13 px line
// (700 green-deep when it's news, else 400 muted).
//
// Choosing: press-in scales the tile to 0.97 (motion spec 3). Once chosen, a green ring draws
// around the face and the other tiles quietly step back, then the screen hands off to that home.
// Someone invited ("Hasn't joined yet") or on their own phone ("On their phone") looks the same, but their
// tile never enters: the screen opens a small sheet about them instead (PersonSheet).
// `lit`: they did their part at the Sunday table this week (RETENTION-HANDOFF 3.2): the same small
// sun-yellow flame as on the Homes, at the face's bottom-right (clear of the dot & "New", top-right).
// Unlit faces get nothing.
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Avatar, PlusIcon, PressableScale, Skeleton, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import { colors, motion, radii, shadows } from '@/theme/tokens';

import { FlameBadge } from '@/components/table/FlameBadge';

import type { PersonStatus } from './status';

export const TILE_HEIGHT = 156;
const AVATAR = 68;
const RING_GAP = 4;

export type TileChoice = 'idle' | 'chosen' | 'other';

export function ProfileTile({
  profile,
  status,
  width,
  choice = 'idle',
  lit = false,
  onPress,
}: {
  profile: Profile;
  /** undefined while loading: the line is held invisible so nothing jumps. */
  status: PersonStatus | undefined;
  width: number;
  choice?: TileChoice;
  /** At the Sunday table this week: a flame on the face. */
  lit?: boolean;
  onPress: () => void;
}) {
  const { t } = useWords();
  const reduce = useReducedMotion();
  const dim = useSharedValue(1);
  const ring = useSharedValue(0);

  useEffect(() => {
    dim.set(withTiming(choice === 'other' ? 0.45 : 1, { duration: 180, easing: Easing.out(Easing.cubic) }));
    if (choice === 'chosen') {
      ring.set(reduce ? withTiming(1, { duration: motion.reducedFadeMs }) : withSpring(1, { damping: 18, stiffness: 260, mass: 1 }));
    } else {
      ring.set(withTiming(0, { duration: 120 }));
    }
  }, [choice, dim, ring, reduce]);

  const dimStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: reduce ? [] : [{ scale: 0.98 + 0.02 * dim.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: reduce ? [] : [{ scale: 0.86 + 0.14 * ring.value }],
  }));

  const line = status?.line ?? ' ';
  const said = status?.line;
  const label = said
    ? t(lit ? 'profiles.tile.withLineLit' : 'profiles.tile.withLine', { name: profile.name, line: said })
    : lit
      ? t('profiles.tile.withLit', { name: profile.name })
      : profile.name;

  return (
    <Animated.View style={[{ width }, dimStyle]}>
      <PressableScale
        scaleTo={motion.pressScaleCard}
        haptic
        onPress={onPress}
        disabled={choice !== 'idle'}
        accessibilityLabel={label}
        accessibilityHint={
          profile.locked
            ? t('profiles.tile.lockedHint')
            : profile.invited
              ? t('profiles.tile.invitedHint')
              : profile.role === 'cook'
                ? t('profiles.tile.cookHint')
                : t('profiles.tile.learnerHint')
        }
        style={styles.tile}>
        <View style={styles.face}>
          <Animated.View pointerEvents="none" style={[styles.ring, ringStyle]} />
          <Avatar profile={profile} size={AVATAR} dot={status?.mark === 'dot'} badge={status?.mark === 'new' ? t('profiles.tile.new') : null} />
          {lit ? <FlameBadge avatarSize={AVATAR} /> : null}
        </View>
        <Txt
          variant="name"
          size={nameSize(profile.name, width)}
          numberOfLines={1}
          adjustsFontSizeToFit={Platform.OS !== 'web'}
          minimumFontScale={0.75}
          style={styles.name}>
          {profile.name}
        </Txt>
        <Animated.View key={line} entering={status ? FadeIn.duration(220) : undefined}>
          <Txt
            variant="caption"
            weight={status?.strong ? 700 : 400}
            color={status?.strong ? colors.greenDeep : colors.muted}
            numberOfLines={1}
            adjustsFontSizeToFit={Platform.OS !== 'web'}
            minimumFontScale={0.85}
            style={[styles.line, !status && styles.hidden]}>
            {line}
          </Txt>
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
}

/** Average advance of Fraunces 600, in em (measured). */
const NAME_ADVANCE = 0.66;

/** Fraunces 600 20 as in the bible; a name that wouldn't fit the tile steps down so it stays whole. */
function nameSize(name: string, width: number) {
  const n = Math.max(1, name.trim().length);
  return Math.max(12, Math.min(20, Math.floor((width - 4) / (n * NAME_ADVANCE))));
}

/**
 * The bible's dashed + tile (1.5 px dashed rgba(71,67,42,0.28), green-deep ink), in the slot where
 * the next face would go: the + and one short word under it ("Add", or "Add me" on a phone that
 * hasn't said who it is yet); VoiceOver reads `a11y` ("Add a cook" / "Add family"). No `label`: the
 * + alone.
 * `compact`: a full row of faces above it, so it would sit alone on a row of its own: a short,
 * full-width dashed bar instead of an empty tall tile.
 */
export const ADD_BAR_HEIGHT = 64;

export function AddFamilyTile({
  width,
  label,
  onPress,
  dimmed,
  compact,
  a11y,
}: {
  width: number;
  /** Text under the +. None: the + alone. */
  label?: string;
  onPress: () => void;
  dimmed?: boolean;
  compact?: boolean;
  a11y?: { label?: string; hint?: string };
}) {
  const { t } = useWords();
  const dim = useSharedValue(1);
  useEffect(() => {
    dim.set(withTiming(dimmed ? 0.45 : 1, { duration: 180, easing: Easing.out(Easing.cubic) }));
  }, [dimmed, dim]);
  // Dimming on a wrapper: PressableScale owns the opacity of its own view.
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  return (
    <Animated.View style={dimStyle}>
      <PressableScale
        scaleTo={motion.pressScaleCard}
        onPress={onPress}
        disabled={dimmed}
        accessibilityLabel={a11y?.label ?? label ?? t('profiles.picker.addFamily')}
        accessibilityHint={a11y?.hint ?? t('profiles.tile.addHint')}
        style={[styles.add, compact ? styles.addBar : null, { width }]}>
        <PlusIcon size={label ? (compact ? 24 : 28) : compact ? 28 : 40} color={colors.greenDeep} strokeWidth={2} />
        {label ? (
          <Txt variant="label" weight={700} color={colors.greenDeep} numberOfLines={1}>
            {label}
          </Txt>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

/** A tile-shaped breathing block while the family loads. */
export function TileSkeleton({ width }: { width: number }) {
  return (
    <View style={[styles.tile, styles.skeleton, { width }]}>
      <Skeleton circle width={AVATAR} height={AVATAR} style={styles.skelFace} />
      <Skeleton width={52} height={16} radius={6} />
      <Skeleton width={64} height={10} radius={5} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: TILE_HEIGHT,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  face: { width: AVATAR, height: AVATAR, marginBottom: 6 },
  ring: {
    position: 'absolute',
    left: -RING_GAP,
    top: -RING_GAP,
    width: AVATAR + RING_GAP * 2,
    height: AVATAR + RING_GAP * 2,
    borderRadius: (AVATAR + RING_GAP * 2) / 2,
    borderWidth: 2.5,
    borderColor: colors.green,
  },
  name: { maxWidth: '100%' },
  line: { maxWidth: '100%' },
  hidden: { opacity: 0 },
  add: {
    height: TILE_HEIGHT,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(71,67,42,0.28)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  addBar: { height: ADD_BAR_HEIGHT, flexDirection: 'row', gap: 8, borderRadius: 20 },
  skeleton: { boxShadow: undefined, backgroundColor: 'rgba(255,253,247,0.6)' },
  skelFace: { marginBottom: 6 },
});
