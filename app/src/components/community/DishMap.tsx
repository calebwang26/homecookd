// The Community map (Caleb's mockup, Oct 24): one square, bordered map with a few streets and the real
// neighborhood names around, "You" in the middle, and a round dish photo per ~1 km cell
// (mapLayout.ts). It's a drawing with react-native-svg, not map tiles: no native module, so it ships
// by EAS Update. A tap on the map itself (not a circle) closes the card.
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { PressableScale, Txt } from '@/components/ui';
import { alpha, colors, radii } from '@/theme/tokens';

import { spotLabel } from './labels';
import type { Spot } from './mapLayout';
import { MapSpot } from './MapSpot';

/** The streets and parks are drawn on this grid and scaled to the map. */
const GRID = 358;
const AREA_W = 128; // wider than mapLayout's nameBox, so a name never truncates
const YOU_HALO = 44;
const YOU_DOT = 20;

type Dish = { recipeId: string; dish: string; cookName: string; distanceLabel: string; coverUrl: string | null };

export type DishMapProps<R extends Dish> = {
  size: number;
  spots: Spot<R>[];
  areas: { name: string; x: number; y: number }[];
  pickedKey: string | null;
  onPick: (key: string | null) => void;
  you: { picked: boolean; news: boolean; label: string; onPress: () => void };
};

export function DishMap<R extends Dish>({ size, spots, areas, pickedKey, onPick, you }: DishMapProps<R>) {
  return (
    <View style={[styles.map, { width: size, height: size }]}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={() => onPick(null)} style={StyleSheet.absoluteFill}>
        <Streets size={size} />
      </Pressable>

      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        {areas.map((a) => (
          <Txt key={a.name} variant="name" size={13} color={colors.muted} align="center" numberOfLines={1} style={[styles.area, { left: a.x - AREA_W / 2, top: a.y - 9 }]}>
            {a.name}
          </Txt>
        ))}
      </View>

      <PressableScale
        onPress={you.onPress}
        haptic
        accessibilityRole="button"
        accessibilityLabel={you.label}
        accessibilityHint="Shows your dinners and Host a dinner"
        accessibilityState={{ selected: you.picked }}
        style={[styles.you, { left: size / 2 - YOU_HALO / 2, top: size / 2 - YOU_HALO / 2 }]}>
        <View style={[styles.halo, you.picked ? styles.haloOn : null]}>
          <View style={styles.dot} />
          {you.news ? <View style={styles.news} /> : null}
        </View>
        <View style={styles.youTag}>
          <Txt variant="label" size={12} weight={700} color={colors.sageInk}>
            You
          </Txt>
        </View>
      </PressableScale>

      {spots.map((s) => (
        <MapSpot
          key={s.key}
          x={s.x}
          y={s.y}
          photo={s.members.find((m) => m.coverUrl)?.coverUrl ?? null}
          count={s.members.length}
          picked={s.key === pickedKey}
          label={spotLabel(s.members)}
          onPress={() => onPick(s.key === pickedKey ? null : s.key)}
        />
      ))}
    </View>
  );
}

/** A few made-up streets and parks: a sense of a neighborhood, not real roads. */
function Streets({ size }: { size: number }) {
  const main = { stroke: colors.card, strokeWidth: 12, strokeLinecap: 'round' as const };
  const minor = { stroke: colors.card, strokeWidth: 6, strokeLinecap: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
      <Rect x={34} y={28} width={70} height={50} rx={14} fill={colors.sage} />
      <Rect x={258} y={262} width={64} height={62} rx={14} fill={colors.sage} />
      <Rect x={140} y={300} width={50} height={36} rx={12} fill={colors.sage} />
      <Path d="M-10 122 L368 94" {...main} />
      <Path d="M-10 268 L368 238" {...main} />
      <Path d="M92 -10 L150 368" {...main} />
      <Path d="M266 -10 L232 368" {...main} />
      <Path d="M-10 198 L368 180" {...minor} />
      <Path d="M-10 334 L368 312" {...minor} />
      <Path d="M182 -10 L198 368" {...minor} />
      <Path d="M28 -10 L52 368" {...minor} />
      <Path d="M330 -10 L312 368" {...minor} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden', borderRadius: radii.card, borderWidth: 1.5, borderColor: alpha.border, backgroundColor: colors.well },
  area: { position: 'absolute', width: AREA_W, opacity: 0.8 },
  you: { position: 'absolute', width: YOU_HALO, alignItems: 'center' },
  halo: { width: YOU_HALO, height: YOU_HALO, borderRadius: YOU_HALO / 2, backgroundColor: 'rgba(91,111,0,0.14)', alignItems: 'center', justifyContent: 'center' },
  haloOn: { backgroundColor: 'rgba(254,190,41,0.4)' },
  dot: { width: YOU_DOT, height: YOU_DOT, borderRadius: YOU_DOT / 2, borderWidth: 3, borderColor: colors.card, backgroundColor: colors.green, boxShadow: '0 2px 8px rgba(30,36,16,0.2)' },
  news: { position: 'absolute', top: 6, right: 6, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.card, backgroundColor: colors.sun },
  youTag: { marginTop: -6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.card },
});
