// The small flame on a lit face (RETENTION-HANDOFF 3.2): a white disc with the sun-yellow flame,
// at the avatar's bottom-right, popping in gently (Reduce Motion: no pop). One look everywhere a lit
// face shows: "This week at the table" (TableRow) and the "Who's in the kitchen?" tiles.
//
//   <View>
//     <Avatar profile={p} size={68} />
//     {lit.has(p.id) ? <FlameBadge avatarSize={68} /> : null}     // lit = litIds(table)
//   </View>
//
// Unlit faces get nothing (no grey flame, no empty disc): render this only when lit.
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion, ZoomIn } from 'react-native-reanimated';

import { FlameIcon } from '@/components/ui/FlameIcon';
import { colors, shadows } from '@/theme/tokens';

export function FlameBadge({ avatarSize = 48, style }: { avatarSize?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const disc = avatarSize >= 64 ? 30 : avatarSize >= 44 ? 24 : 20;
  const inset = avatarSize >= 64 ? -2 : -4;
  return (
    <Animated.View
      entering={reduce ? undefined : ZoomIn.duration(220)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2, right: inset, bottom: inset }, style]}>
      <FlameIcon size={Math.round(disc * 0.62)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  disc: {
    position: 'absolute',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.chip,
  },
});
