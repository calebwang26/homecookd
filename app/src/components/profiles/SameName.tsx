// "There's already a Grandma. Same person?": adding a name that matches someone in the family once
// case, digits and spaces are set aside ("grandma1", "Grand ma") asks first, so one person doesn't
// end up as two faces (FEEDBACK QA: Grandma and "grandma1"). Yes closes the sheet and adds nobody;
// No adds them anyway (a name the server already has exactly still gets its own sentence).
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActionButton, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { colors } from '@/theme/tokens';

const nameKey = (s: string) => s.toLowerCase().replace(/[\d\s]+/g, '');

/** Someone in `people` whose name is this one, ignoring case, digits and spaces. */
export function sameNameAs(people: Profile[], name: string): Profile | null {
  const k = nameKey(name);
  return k ? (people.find((p) => nameKey(p.name) === k) ?? null) : null;
}

export function SameNameAsk({ who, noLabel, onYes, onNo }: { who: Profile; noLabel: string; onYes: () => void; onNo: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.card} accessibilityLiveRegion="polite">
      <Txt variant="body" weight={600} color={colors.ink}>
        There’s already a {who.name}. Same person?
      </Txt>
      <View style={styles.row}>
        <ActionButton label="Yes" variant="outline" size="sm" onPress={onYes} accessibilityHint="Closes this without adding anyone" style={styles.flex} />
        <ActionButton label={noLabel} variant="outline" size="sm" fg={colors.greenDeep} onPress={onNo} style={styles.flex} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.page },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
