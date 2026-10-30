// The big card at the top of the invite sheet (FEEDBACK-OCT16c E2), in ShareCard's clothes: a yolk-tint
// stage (radius 28) holding a white card with the family seated round a white table (the egg mark in the
// middle, their faces round it and one open seat at the front for whoever opens the link), then
// "Join <Family> on homecookd" in Fraunces.
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';

import { Avatar, PlusIcon, EggMark, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, radii } from '@/theme/tokens';

const FACE = 46;
/** Faces round the table before the last seat turns into "+3". */
const MAX_FACES = 7;
const TABLE_H = 176;
const STAGE_PAD = 16;
const CARD_PAD = 12;
/** The stage stays clear of the sheet's close button (40 pt, 16 from the right) on both sides. */
const stageWidthFor = (winW: number) => Math.min(winW - 120, 320);

export type InviteCardProps = {
  /** "Our family", "The Wangs"; null while the family is unknown. */
  familyName: string | null;
  /** Everyone at the table (cooks first reads best). */
  people: Profile[];
};

export function InviteCard({ familyName, people }: InviteCardProps) {
  const { t } = useWords();
  const { width: winW } = useWindowDimensions();
  // The table's width once laid out; until then the sheet's width minus the paddings.
  const [measured, setMeasured] = useState<number | null>(null);
  const stageW = stageWidthFor(winW);
  const W = measured ?? stageW - 2 * STAGE_PAD - 2 * CARD_PAD;

  const over = people.length > MAX_FACES ? people.length - (MAX_FACES - 1) : 0;
  const faces = over ? people.slice(0, MAX_FACES - 1) : people;
  // Seat 0 is the open seat at the front (bottom); the family fills the rest round the table.
  const n = faces.length + (over ? 1 : 0) + 1;
  const cx = W / 2;
  const cy = TABLE_H / 2;
  const seatRx = Math.min(W / 2 - FACE / 2 - 2, 124);
  const seatRy = TABLE_H / 2 - FACE / 2 - 2;
  const at = (i: number) => {
    const t = Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { left: cx + seatRx * Math.cos(t) - FACE / 2, top: cy + seatRy * Math.sin(t) - FACE / 2 };
  };

  const family = midSentence(familyName ?? '');
  const title = family ? t('share.invite.title', { family }) : t('share.invite.titleNoName');
  const names = faces.map((p) => p.name).join(', ');
  const label = names
    ? over
      ? t('share.invite.a11yNamesMore', { title, names, count: over })
      : t('share.invite.a11yNames', { title, names })
    : title;

  return (
    <View style={[styles.stage, { width: stageW }]} accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.card}>
        <View style={styles.table} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
          <Svg width={W} height={TABLE_H} style={StyleSheet.absoluteFill}>
            <Ellipse cx={cx} cy={cy} rx={Math.max(40, seatRx - FACE / 2 - 12)} ry={seatRy - FACE / 2 - 8} fill={colors.card} />
          </Svg>
          <View style={[styles.pot, { left: cx - 24, top: cy - 22 }]}>
            <EggMark size={48} />
          </View>
          {faces.map((p, i) => (
            <View key={p.id} style={[styles.seat, at(i + 1)]}>
              <Avatar profile={p} size={FACE} ring />
            </View>
          ))}
          {over ? (
            <View style={[styles.seat, styles.more, at(n - 1)]}>
              <Txt variant="label" weight={700} color={colors.green}>
                +{over}
              </Txt>
            </View>
          ) : null}
          <View style={[styles.seat, styles.open, at(0)]}>
            <PlusIcon size={20} color={colors.yolkDeep} />
          </View>
        </View>
        <Txt variant="display" size={22} leading={1.15} align="center" numberOfLines={2} style={styles.title}>
          {title}
        </Txt>
      </View>
    </View>
  );
}

/** "Our family" -> "our family", "The Wangs" -> "the Wangs": the name reads mid-sentence. */
function midSentence(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  return /^(our|the|my) /i.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'center', borderRadius: radii.panel, backgroundColor: colors.yolkTint, padding: STAGE_PAD },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    padding: CARD_PAD,
    paddingBottom: 20,
    gap: 10,
    boxShadow: '0 10px 30px rgba(31,36,48,0.10)',
  },
  table: { height: TABLE_H },
  pot: { position: 'absolute', width: 48, alignItems: 'center' },
  seat: { position: 'absolute', width: FACE, height: FACE, borderRadius: FACE / 2, alignItems: 'center', justifyContent: 'center' },
  more: { backgroundColor: colors.greenTint, boxShadow: `0 0 0 3px ${colors.card}` },
  open: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: alpha.dashed, backgroundColor: colors.card },
  title: { paddingHorizontal: 4 },
});
