// The one-time milestone in a 1:1 chat (RETENTION-HANDOFF 3.2): when a kid & cook reach 4, 12, 26 or
// 52 weeks at the table, the next time either opens their chat a small SuccessBurst says "12 weeks at
// the table with Mom" (the other person, from the viewer's side), then fades. Once per person, pair &
// milestone on this phone (lib/sundayTable.ts): remembered in lib/storage only once it has played to
// the end. A chat closed before that (during the claim or the 2 s hold, a quick back tap) releases
// it, so it plays the next time the chat opens instead of being used up unseen.
//
//   <MilestoneBurst meId={me.id} pair={pairWith(table, me.id, other.id)} otherName={other.name} />
//
// Place it last inside the chat screen's container: it overlays the log, centred, and never takes a
// touch (pointerEvents none), so the chat stays usable while it plays. Reduce Motion: SuccessBurst
// fades instead of moving; the card fades in & out.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SuccessBurst } from '@/components/ui';
import { claimMilestone, milestoneSeen, milestoneTitle, releaseMilestone, type TablePair } from '@/lib/sundayTable';
import { colors, radii, shadows } from '@/theme/tokens';

const HOLD_MS = 2000;

export function MilestoneBurst({
  meId,
  pair,
  otherName,
  onDone,
  style,
}: {
  meId: string | null | undefined;
  pair: TablePair | null | undefined;
  otherName: string;
  onDone?: (milestone: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [shown, setShown] = useState<number | null>(null);
  // The milestone this burst holds: claimed, not yet seen. Released if the chat goes away first.
  const held = useRef<{ meId: string; pair: TablePair; n: number } | null>(null);
  // Mounted at all, not "this effect run": a claim holds the milestone, so its answer must land even
  // when the effect re-ran meanwhile (a new table object, Strict Mode's double run).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const h = held.current;
      held.current = null;
      if (h) releaseMilestone(h.meId, h.pair, h.n);
    };
  }, []);

  useEffect(() => {
    if (!meId || !pair) return;
    void claimMilestone(meId, pair).then((n) => {
      if (n === null) return;
      if (!mounted.current) {
        releaseMilestone(meId, pair, n); // closed while storage answered: next time
        return;
      }
      const before = held.current;
      if (before) releaseMilestone(before.meId, before.pair, before.n);
      held.current = { meId, pair, n };
      setShown(n);
    });
  }, [meId, pair]);

  if (shown === null) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(240)}
      style={[StyleSheet.absoluteFill, styles.center, style]}
      pointerEvents="none">
      <View style={styles.card}>
        <SuccessBurst
          size="sm"
          title={milestoneTitle(shown, otherName)}
          holdMs={HOLD_MS}
          onDone={() => {
            // Played to the end: now it's remembered, never shown again on this phone.
            const h = held.current;
            held.current = null;
            if (h) void milestoneSeen(h.meId, h.pair, h.n);
            setShown(null);
            onDone?.(shown);
          }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, zIndex: 10 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingVertical: 28,
    paddingHorizontal: 24,
    maxWidth: 320,
    boxShadow: shadows.cardRaised,
  },
});
