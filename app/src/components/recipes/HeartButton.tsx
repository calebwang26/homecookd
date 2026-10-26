// The heart on a dish (rows, photo cards, the recipe hero). Server-backed per profile through
// lib/favorites, so the same dish shows the same heart everywhere.
//  row:       44 px (48 pt tap), no fill; outline muted grey, hearted = filled #9A4F47 (Kid-Browse rows)
//  glass:     48 px cream glass circle over a photo; ink outline (Kid-Recipe hero)
//  glassDark: 40 px dark glass circle on a photo card; cream outline
//  hearted on a photo (glass, glassDark): a solid cream circle, so the red heart reads on any photo
//  (bible Kid-Home-Scrolled: #FFFDF7 circle, #9A4F47 heart)
//
// Crisp by construction: no transform ever touches the glyph. The tap answers with the press
// opacity, a haptic and the fill; there is no scale pop. Each state mounts its own Svg (key), so
// iOS never reuses a bitmap drawn mid-animation. (The old pop was a spring that, with Reanimated
// 4's default mass of 4, wobbled around 1.00 for ~6 s; a vector glyph resampled at 0.995 reads as
// a fuzzy outline.)
//
// Retention PR 7 (RETENTION-HANDOFF 4): a heart that goes on also bursts into a few tiny particles
// (HeartPop, the same pop as a cook's heart mid-cook) in an overlay behind the glyph, kept close so a
// photo card's edge doesn't cut it; the glyph itself still never moves. Nothing under Reduce Motion.
// The pop mounts on the first tap only, so a long list of hearts carries no idle animated nodes. It
// plays on the tap, like the fill: both are optimistic (lib/favorites), and a save that fails rolls
// the fill back with the error toast.
//
// Since PR 4 a dish's cook sees the hearts on it (RETENTION-HANDOFF 3.5), so the first heart this
// person leaves on another family cook's dish says so once, as a toast: "Mom sees your hearts"
// (lib/heartsNote: off -> on, saved, the cook is someone else in the family whom GET /family says is
// not memorial; once per profile on this phone).
import { useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HeartPop } from '@/components/cooking/HeartBurst';
import { HeartIcon, PressableScale, useToast } from '@/components/ui';
import { useFavorites } from '@/lib/favorites';
import { useWords } from '@/lib/words/useWords';
import { takeHeartsNoteFor } from '@/lib/heartsNote';
import { getCachedEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { alpha, colors } from '@/theme/tokens';

export type HeartTone = 'row' | 'glass' | 'glassDark';

const TONES: Record<HeartTone, { size: number; icon: number; bg: string; outline: string }> = {
  row: { size: 44, icon: 22, bg: 'transparent', outline: colors.muted },
  glass: { size: 48, icon: 22, bg: alpha.glassButton, outline: colors.ink },
  glassDark: { size: 40, icon: 20, bg: alpha.glassHeart, outline: colors.card },
};

type Props = {
  recipeId: string;
  /** The dish's name, for the screen reader. */
  title: string;
  tone?: HeartTone;
  style?: StyleProp<ViewStyle>;
};

export function HeartButton({ recipeId, title, tone = 'row', style }: Props) {
  const fav = useFavorites();
  const toast = useToast();
  const { t: words } = useWords();
  const { me, profiles } = useSession();
  const on = fav.isFav(recipeId);
  const t = TONES[tone];
  // Each heart that goes on plays the pop once (0 = never).
  const [pop, setPop] = useState(0);

  const onPress = () => {
    const wasOn = on;
    if (!wasOn) setPop((n) => n + 1);
    const meId = me?.id ?? null;
    void fav.toggle(recipeId).then(async (ok) => {
      if (!ok) {
        toast.show(words(wasOn ? 'parent.heart.removeFailed' : 'parent.heart.saveFailed'), {
          tone: 'error',
          icon: <HeartIcon size={14} filled color={colors.card} />,
        });
        return;
      }
      const note = await takeHeartsNoteFor({ meId, entry: getCachedEntry(recipeId), profiles, wasOn, ok });
      if (note) toast.show(note, { icon: <HeartIcon size={14} filled color={colors.card} /> });
    });
  };

  return (
    <PressableScale
      onPress={onPress}
      haptic={on ? 'selection' : 'light'}
      scaleTo={1}
      pressedOpacity={0.7}
      accessibilityLabel={words(on ? 'parent.heart.on' : 'parent.heart.off', { title })}
      accessibilityState={{ selected: on }}
      // Every heart answers to at least a 48 pt square.
      hitSlop={t.size < 48 ? (48 - t.size) / 2 : 0}
      style={[styles.base, { width: t.size, height: t.size, borderRadius: t.size / 2, backgroundColor: on && tone !== 'row' ? colors.card : t.bg }, style]}>
      {pop > 0 ? <HeartPop trigger={pop} radius={t.size / 2 - 4} reach={14} size={0.7} /> : null}
      <HeartIcon key={on ? 'on' : 'off'} size={t.icon} filled={on} color={on ? colors.danger : t.outline} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
