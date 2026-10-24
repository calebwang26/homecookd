// The cook's mirror of "Grandma's kitchen" (RETENTION-HANDOFF 3.6), under "Your recipes" on her
// Recipes tab:
//
//   (L)(M)  Leo can cook 4 of your 7. Maya, 2.
//
// Who has cooked how many of her real dishes (kitchenCounts.ts cookMirror + mirrorLine: samples and
// YouTube never count, kids first, nobody at 0, never a memorial person). Hidden when nobody has cooked one yet, or she has no
// real dishes. Data from GET /dish-stats (useDishStats over her own recipe ids), which only answers
// the dish's cook. Presentational and not tappable.
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { cookMirror, mirrorLine, type DishStatsLike } from '@/lib/kitchenCounts';
import type { LibraryEntry } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { FacesRow } from './FacesRow';

export type CookMirrorLineProps = {
  /** My dishes: recipesByCook(entries, me.name). */
  entries: LibraryEntry[];
  /** GET /dish-stats for those dishes (null while loading: nothing shows). */
  stats: DishStatsLike | null | undefined;
  /** The family (session profiles). */
  profiles: Pick<Profile, 'id' | 'name' | 'role' | 'avatar_key' | 'memorial'>[];
  meId: string | null | undefined;
  style?: StyleProp<ViewStyle>;
};

export function CookMirrorLine({ entries, stats, profiles, meId, style }: CookMirrorLineProps) {
  const mirror = useMemo(() => cookMirror(entries, stats ?? {}, profiles, meId), [entries, stats, profiles, meId]);
  const line = mirrorLine(mirror);
  const faces = useMemo(() => {
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return mirror.people.map((p) => byId.get(p.profileId)).filter((p): p is (typeof profiles)[number] => !!p);
  }, [mirror, profiles]);
  if (!stats || !line) return null;
  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={line}>
      <FacesRow people={faces.slice(0, 3)} more={Math.max(0, faces.length - 3)} size={28} />
      <Txt variant="lead" size={17} leading={1.35} color={colors.text} style={styles.text}>
        {line}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0 },
});
