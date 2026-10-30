// The numbered circle on step lists and substeps: solid green with a light green number (kid QA
// round 2, Oct 22). `soft` (a step not done yet, in "All steps") is the reverse: light green with a
// dark green number.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function StepNumber({ n, size = 32, soft = false, style }: { n: number; size?: number; soft?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.circle, soft ? styles.soft : null, { width: size, height: size, borderRadius: size / 2 }, style]} accessible={false}>
      <Txt variant="label" size={Math.round(size * 0.47)} weight={700} color={soft ? colors.green : colors.ink}>
        {n}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.yolk, alignItems: 'center', justifyContent: 'center' },
  soft: { backgroundColor: colors.greenTint },
});
