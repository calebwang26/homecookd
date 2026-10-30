// One step of the map's choosers (Caleb's Community mockup): a cream card with back ‹ and a title
// ("Mama Ngozi’s Jollof Rice"), then big rows, each a title and one line, the first one you can press
// green. A row that only says how things stand ("Asked · waiting") isn't a button and is never green.
// While a row's action runs, the rows wait.
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BackIcon, ChevronRightIcon, IconButton, PressableScale, Txt } from '@/components/ui';
import { colors, radii, shadows } from '@/theme/tokens';

import type { ChoiceRow } from './choices';

export function Chooser({
  title,
  rows,
  onBack,
  onPick,
}: {
  title: string;
  rows: ChoiceRow[];
  onBack: () => void;
  onPick: (key: string) => void | Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await onPick(key);
    } catch {
      // the caller said what went wrong (a toast)
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <IconButton tone="well" size={40} accessibilityLabel="Back" icon={(c) => <BackIcon size={20} color={c} />} onPress={onBack} />
        <Txt variant="kitchen" numberOfLines={2} accessibilityRole="header" style={styles.title}>
          {title}
        </Txt>
      </View>
      {rows.map((r) => {
        const main = r.primary && !r.disabled;
        const ink = colors.ink;
        const sub = main ? colors.ink : colors.muted;
        const body = (
          <>
            <View style={styles.text}>
              <Txt variant="title" color={ink}>
                {r.title}
              </Txt>
              {r.line ? (
                <Txt variant="meta" color={sub}>
                  {r.line}
                </Txt>
              ) : null}
            </View>
            {busy === r.key ? <ActivityIndicator color={ink} /> : r.disabled ? null : <ChevronRightIcon size={22} strokeWidth={2.2} color={ink} />}
          </>
        );
        const look = [styles.row, { backgroundColor: main ? colors.yolk : colors.page }];
        if (r.disabled) {
          return (
            <View key={r.key} style={look} accessible accessibilityLabel={[r.title, r.line].filter(Boolean).join('. ')} accessibilityState={{ disabled: true }}>
              {body}
            </View>
          );
        }
        return (
          <PressableScale
            key={r.key}
            haptic
            scaleTo={0.98}
            disabled={!!busy}
            onPress={() => void pick(r.key)}
            accessibilityLabel={[r.title, r.line].filter(Boolean).join('. ')}
            accessibilityState={{ busy: busy === r.key }}
            style={look}>
            {body}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 14, borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.cardRaised },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  title: { flex: 1, minWidth: 0 },
  row: { minHeight: 60, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 1 },
});
