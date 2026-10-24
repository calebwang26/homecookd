// The cook's own line on one of her dishes (RETENTION-HANDOFF 3.5): how the family has taken to it.
//
//   card  (Recipes card, components/parent/RecipeRow.tsx):  ♥ 4 · cooked 3 times  (o)(o)(o)
//   page  (her recipe page, near "Who cooked it"):         ♥ 4 · Leo, Maya, Dad
//
// The card line is always one line, so a card is never taller than its title + two lines: the words
// stay whole and the faces (at most 3, 20 pt) take only the room left beside them, fewer when it's
// tight (with "+N" for the rest) and none when even one won't fit; the label still says who.
// onFacesShown reports which faces are actually drawn, so the card's activity line can keep naming
// whoever cooked it when their faces don't fit (lib/heartsCopy.ts cardActivityLine).
// Each zero part is hidden, and with nothing at all the line isn't drawn (no "0 hearts"). Data from
// GET /dish-stats (useDishStats), which only ever answers the dish's cook, so this never shows on
// anyone else's dish. Presentational: pass the dish's stat and the family; nothing here is tappable
// (it sits inside the card's own press).
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { HeartIcon, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { CARD_FACES, dishStatsLabel, dishStatsParts, facesThatFit, heartNames, statFaces, type MadeVerb } from '@/lib/heartsCopy';
import type { DishStat } from '@/lib/kitchenCounts';
import { colors } from '@/theme/tokens';

import { FacesRow } from './FacesRow';

export type DishStatsLineProps = {
  stat: DishStat | null | undefined;
  /** The family (session profiles): faces and names come only from people still in it. */
  profiles: Pick<Profile, 'id' | 'name' | 'avatar_key'>[];
  /** 'card' (default): hearts & times made, plus faces. 'page': hearts & who left them. */
  variant?: 'card' | 'page';
  /** "baked" for breads & cakes (components/parent/kitchen.ts madeVerb). */
  verb?: MadeVerb;
  /** Most faces drawn on a card (default 3, then "+N"; fewer when the words leave less room). */
  maxFaces?: number;
  /**
   * Card only: called with the profile ids of the faces drawn whenever they change ([] when none fit
   * or the line hides). Pass a stable function (a state setter).
   */
  onFacesShown?: (ids: string[]) => void;
  style?: StyleProp<ViewStyle>;
};

export function DishStatsLine(props: DishStatsLineProps) {
  return props.variant === 'page' ? <PageLine {...props} /> : <CardLine {...props} />;
}

function PageLine({ stat, profiles, style }: DishStatsLineProps) {
  const h = heartNames(stat, profiles);
  if (!h) return null;
  return (
    <View style={[styles.words, style]} accessible accessibilityLabel={h.label}>
      <Heart />
      <Txt variant="label" size={16} weight={700} color={colors.ink} style={styles.num}>
        {h.count}
      </Txt>
      <Dot size={16} />
      <Txt variant="body" size={16} color={colors.muted} numberOfLines={1} style={styles.shrink}>
        {h.names}
      </Txt>
    </View>
  );
}

/** Gap between the words and the faces. */
const FACES_GAP = 8;

function CardLine({ stat, profiles, verb = 'cooked', maxFaces = CARD_FACES.max, onFacesShown, style }: DishStatsLineProps) {
  // The row's width and the words' own width, measured, decide how many faces fit (0 until then).
  const [rowW, setRowW] = useState(0);
  const [wordsW, setWordsW] = useState(0);
  const p = dishStatsParts(stat, verb);
  const everyone = p ? statFaces(stat, profiles, profiles.length).shown : [];
  // 2 pt of slack so rounding never squeezes the words.
  const fit = p && rowW && wordsW ? facesThatFit(rowW - wordsW - FACES_GAP - 2, everyone.length, CARD_FACES.size, maxFaces) : 0;
  const drawnKey = everyone
    .slice(0, fit)
    .map((x) => x.id)
    .join(',');
  useEffect(() => {
    onFacesShown?.(drawnKey ? drawnKey.split(',') : []);
  }, [drawnKey, onFacesShown]);
  if (!p) return null;
  const width = (set: (n: number) => void) => (e: LayoutChangeEvent) => set(Math.ceil(e.nativeEvent.layout.width));
  return (
    <View style={[styles.card, style]} onLayout={width(setRowW)} accessible accessibilityLabel={dishStatsLabel(stat, profiles, verb) ?? p.label}>
      <View style={styles.words} onLayout={width(setWordsW)}>
        {p.hearts ? (
          <>
            <Heart />
            <Txt variant="label" size={15} weight={700} color={colors.ink} style={styles.num}>
              {p.hearts}
            </Txt>
          </>
        ) : null}
        {p.hearts && p.made ? <Dot size={15} /> : null}
        {p.made ? (
          <Txt variant="meta" size={15} color={colors.muted} numberOfLines={1} style={styles.shrink}>
            {p.made}
          </Txt>
        ) : null}
      </View>
      {fit ? <FacesRow people={everyone.slice(0, fit)} more={everyone.length - fit} size={CARD_FACES.size} style={styles.faces} /> : null}
    </View>
  );
}

/** The middle dot between parts, as its own piece (a leading space in a text run collapses on web). */
function Dot({ size }: { size: number }) {
  return (
    <Txt variant="meta" size={size} color={colors.muted} style={styles.dot}>
      ·
    </Txt>
  );
}

/** The saved-heart red, filled: the same glyph the kids tapped. Wrapped so web keeps it in the row. */
function Heart() {
  return (
    <View style={styles.heart}>
      <HeartIcon size={15} filled color={colors.danger} strokeWidth={1.5} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', columnGap: FACES_GAP },
  words: { flexDirection: 'row', alignItems: 'center', minHeight: 24, flexShrink: 1 },
  heart: { marginRight: 4 },
  num: { fontVariant: ['tabular-nums'] },
  dot: { marginHorizontal: 6 },
  shrink: { flexShrink: 1 },
  faces: { flexShrink: 0 },
});
