// The dark dinner card (a tap on "You" on the Community map): "Dinner tonight · 7 pm", the dish, and
// "In your building · 2 of 6 seats taken". It follows the dinner live (dinners.get), so the seats, the
// host's new requests and "You're in" change on both phones as they happen; until that first answer
// it shows what it was given ("4 seats left").
import { StyleSheet, View } from 'react-native';

import { ArrowRightIcon, Pill, PressableScale, Txt } from '@/components/ui';
import { useDinner, type Dinner, type FeedDinner } from '@/lib/live/community';
import { alpha, colors, radii, shadows, space } from '@/theme/tokens';

import { cardWhen, plural, seatLine } from './labels';

export type DinnerPick = { mine: Dinner } | { feed: FeedDinner };

function badgeFor(d: Dinner | null): { label: string; tone: 'sage' | 'butter' } | null {
  if (!d) return null;
  if (d.isHost) {
    const asked = d.requests?.filter((r) => r.status === 'pending').length ?? 0;
    return asked ? { label: plural(asked, 'new request'), tone: 'butter' } : null;
  }
  if (d.myRequest?.status === 'accepted') return { label: 'You’re in', tone: 'sage' };
  if (d.myRequest?.status === 'pending') return { label: 'You asked to join', tone: 'butter' };
  return null;
}

export function DinnerCard({ pick, now, onOpen }: { pick: DinnerPick; now: number; onOpen: () => void }) {
  const known = 'mine' in pick ? pick.mine : null;
  const id = known?.dinnerId ?? ('feed' in pick ? pick.feed.dinnerId : '');
  const live = useDinner(id);
  // useDinner keeps the last dinner's answer until the new one arrives: use it only for this dinner.
  const full = (live?.dinnerId === id ? live : null) ?? known;
  const d = full ?? ('feed' in pick ? pick.feed : null);
  if (!d) return null;
  const when = cardWhen(d.startsAt, now);
  const lead = full?.isHost ? 'You’re hosting' : d.distanceLabel;
  const meta = `${lead} · ${seatLine(full?.seats, d.seatsLeft)}`;
  const badge = badgeFor(full);
  return (
    <PressableScale
      onPress={onOpen}
      haptic
      scaleTo={0.97}
      accessibilityRole="link"
      accessibilityLabel={[when, d.dish, meta, badge?.label].filter(Boolean).join(', ')}
      style={styles.card}>
      <View style={styles.top}>
        <View style={styles.text}>
          <Txt variant="label" weight={700} color={colors.sun}>
            {when}
          </Txt>
          <Txt variant="display" size={30} color={colors.card} numberOfLines={2}>
            {d.dish}
          </Txt>
        </View>
        <View style={styles.go}>
          <ArrowRightIcon size={22} color={colors.ink} />
        </View>
      </View>
      {/* The full width, so "In your building · 2 of 6 seats taken" stays on one line. */}
      <Txt variant="body" size={15} color={alpha.glassChip} numberOfLines={2}>
        {meta}
      </Txt>
      {badge ? <Pill tone={badge.tone} size="sm" label={badge.label} style={styles.badge} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: space.xxl,
    borderRadius: radii.panel,
    backgroundColor: colors.ink,
    boxShadow: shadows.hero,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  text: { flex: 1, minWidth: 0, gap: 6 },
  badge: { alignSelf: 'flex-start', marginTop: 8 },
  go: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
