// Profile avatars. The seeded demo family's photos (app/assets/avatars/{mom,dad,grandma,leo}.jpg) for
// a profile whose avatar_key names one, else the bible's initial tile (lime-wash #EDF2BE, #3C4A0B
// Fraunces 600). Never a photo guessed from a real person's name. Extras from the bible:
//  ring  - 0 0 0 3px #FFFDF7 (Kid-Home header avatar)
//  dot   - green unread dot top-right with a cream ring (Main "Mom", Kid-Messages "Mom")
//  badge - sun "New" pill at right -6 / top -4 (Main "Leo")
//  check - green check disc bottom-right (Parent-Recipe "Leo cooked it")
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, shadows } from '@/theme/tokens';

import { CheckIcon } from './icons';
import { Txt } from './Txt';

const photos: Record<string, number> = {
  mom: require('@/assets/avatars/mom.jpg'),
  dad: require('@/assets/avatars/dad.jpg'),
  grandma: require('@/assets/avatars/grandma.jpg'),
  leo: require('@/assets/avatars/leo.jpg'),
};

const aliases: Record<string, string> = {
  mother: 'mom',
  mum: 'mom',
  mama: 'mom',
  father: 'dad',
  papa: 'dad',
  grandmother: 'grandma',
  granny: 'grandma',
  'nai nai': 'grandma',
  nainai: 'grandma',
};

/**
 * The bundled photo, or null. Never invent a face: a person's photo comes only from their
 * `avatar_key` (set for the seeded demo family), so a real "Mom" without one gets her initial, not
 * the demo Mom's photo. `avatarKey: null` means exactly that: no photo, don't look at the name.
 * Only with no key at all (undefined: a library recipe's cook who isn't anyone in this family) does
 * the name pick one of the demo cooks' photos.
 */
export function avatarSource(avatarKey?: string | null, name?: string | null): number | null {
  if (avatarKey === null) return null;
  const raw = avatarKey ?? name;
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  const key = photos[k] ? k : aliases[k];
  return key && photos[key] ? photos[key] : null;
}

export type AvatarProfile = { name: string; avatar_key?: string | null };

export type AvatarProps = {
  /** A person ({name, avatar_key}): a photo only from their avatar_key, never from the name. */
  profile?: AvatarProfile | null;
  /** Just a name: a library cook who isn't a profile here (pass avatarKey={null} for a real person). */
  name?: string;
  avatarKey?: string | null;
  /** Diameter. Bible sizes: 24, 28, 32, 36, 40, 44, 48, 52, 64, 68. */
  size?: number;
  /** Cream ring around the avatar (3 px). */
  ring?: boolean;
  /** Green unread dot. */
  dot?: boolean;
  /** Sun badge text, e.g. "New". */
  badge?: string | null;
  /** Green check disc (cooked it). */
  check?: boolean;
  /** Tile colours for the initial fallback. */
  tileBg?: string;
  tileFg?: string;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ profile, name, avatarKey, size = 48, ring, dot, badge, check, tileBg = colors.limeWash, tileFg = colors.sageInk, style }: AvatarProps) {
  const who = profile?.name ?? name ?? '';
  const src = avatarSource(profile ? (profile.avatar_key ?? null) : avatarKey, who);
  const initial = who.trim().charAt(0).toUpperCase() || '?';
  // Initial size from the bible: 68 -> 30, 52 -> 22, 48 -> 20, 40 -> 18.
  const initialSize = Math.round(size <= 40 ? size * 0.45 : size <= 52 ? size * 0.42 : size * 0.44);
  const dotSize = size >= 64 ? 16 : 14;
  return (
    <View style={[{ width: size, height: size }, style]} accessibilityLabel={who || undefined}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: src ? colors.well : tileBg },
          ring ? { boxShadow: shadows.ringCard } : null,
        ]}>
        {src ? (
          <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <Txt variant="name" size={initialSize} color={tileFg}>
            {initial}
          </Txt>
        )}
      </View>
      {dot ? (
        <View
          accessibilityLabel="New"
          style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2 }]}
        />
      ) : null}
      {badge ? (
        <View style={styles.badge}>
          <Txt variant="label" size={12} weight={700} color={colors.ink}>
            {badge}
          </Txt>
        </View>
      ) : null}
      {check ? (
        <View style={styles.check}>
          <CheckIcon size={12} strokeWidth={3.5} color={colors.card} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, top: 0, backgroundColor: colors.green, boxShadow: shadows.ringCard },
  badge: {
    position: 'absolute',
    right: -6,
    top: -4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.sun,
    justifyContent: 'center',
    boxShadow: shadows.ringCard,
  },
  check: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.ringCard,
  },
});
