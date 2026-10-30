// A postcard (retention PR 3, RETENTION-HANDOFF 3.4): the kid's photo of the dish in a cream frame,
// tilted a little (at most 1.5°, the same for the same card; flat under Reduce Motion), with an
// optional stamp in its top corner. Used on the cook's updates card, in the chat and on the kid's
// postcard step (no tilt there: it is still a photo being taken, not a card yet).
//
//   <PostcardPhoto uri={m.photo_url} id={m.id} style={{ width: '100%', aspectRatio: 3 / 2 }} />
//   <LikeStamp animate />   // "Just like mine", pressed onto the card when the cook taps it
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, ZoomIn, useReducedMotion } from 'react-native-reanimated';

import { HeartIcon, Txt } from '@/components/ui';
import { postcardTilt } from '@/lib/postcardLogic';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, fonts } from '@/theme/tokens';

export function PostcardPhoto({
  uri,
  id,
  tilt = true,
  label,
  stamp,
  onError,
  style,
}: {
  uri: string | null | undefined;
  /** The message id: the tilt is the same every time this card shows. */
  id: string;
  /** false = flat (the kid's own preview). */
  tilt?: boolean;
  label?: string;
  /** Pressed onto the top corner (LikeStamp). */
  stamp?: ReactNode;
  onError?: () => void;
  /** Size it here (width + height, or width + aspectRatio). */
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const deg = tilt && !reduce ? postcardTilt(id) : 0;
  return (
    <View style={[styles.frame, deg ? { transform: [{ rotate: `${deg}deg` }] } : null, style]} accessible={!!label} accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.photo}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} onError={onError} /> : null}
      </View>
      {stamp ? (
        <View style={styles.stamp} pointerEvents="none">
          {stamp}
        </View>
      ) : null}
    </View>
  );
}

/**
 * "Just like mine", pressed onto the postcard like a postmark (a slight turn, flat under Reduce
 * Motion). `animate`: it lands with a small thunk the moment the cook taps (a fade under Reduce
 * Motion); without it, it is simply there (sent earlier).
 */
export function LikeStamp({ animate = false }: { animate?: boolean }) {
  const { t } = useWords();
  const reduce = useReducedMotion();
  const entering = !animate ? undefined : reduce ? FadeIn.duration(150) : ZoomIn.duration(260);
  return (
    <Animated.View entering={entering} style={[styles.likeStamp, reduce ? null : styles.likeTurn]} accessible accessibilityLabel={t('parent.postcard.stamped')}>
      <HeartIcon size={13} filled color={colors.danger} strokeWidth={1.5} />
      <Txt variant="label" size={15} weight={600} color={colors.danger} style={styles.likeWords} numberOfLines={1}>
        {t('parent.postcard.like')}
      </Txt>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Cream on cream needs the hairline and a soft lift to read as a card.
  frame: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: alpha.hairline,
    boxShadow: '0 6px 18px rgba(31,36,48,0.12)',
  },
  photo: { flex: 1, borderRadius: 11, overflow: 'hidden', backgroundColor: colors.well },
  stamp: { position: 'absolute', top: 14, right: 14 },
  likeStamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: alpha.glassButton,
  },
  likeTurn: { transform: [{ rotate: '-6deg' }] },
  likeWords: { fontFamily: fonts.serifMediumItalic },
});
