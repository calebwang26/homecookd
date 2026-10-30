// A small hand-drawn "cooked it" stamp (RETENTION-HANDOFF 3.6): beside the activity words on a dish row
// in the kid's Recipes list, only for a family cook's real dish they have cooked (kitchenCounts.ts
// earnsStamp), and next to "Keeper of Grandma's kitchen". A slightly wobbly inked ring, a dashed
// inner ring and a check that leans a little, like a rubber stamp pressed by hand. The lean is in the
// path itself (no transform: crisp everywhere, and react-native-svg's rotation warns on web), and
// nothing moves, so Reduce Motion has nothing to turn off. Decorative: the words beside it ("You
// cooked it") already say it, so screen readers skip it.
//
//   <CookStamp />              // 18 pt, green ink
//   <CookStamp size={22} color={colors.green} />
import Svg, { Circle, Path } from 'react-native-svg';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

// A circle of radius ~9 whose edge wobbles a little, the way a pressed stamp's ink does.
const RING =
  'M12 2.6c2.7.1 5 1.2 6.6 3.1 1.5 1.8 2.3 4 2.2 6.5-.1 2.6-1.2 4.8-3 6.4-1.8 1.6-4.1 2.5-6.6 2.3-2.4-.1-4.6-1.1-6.2-2.9C3.5 16.3 2.6 14.1 2.7 11.7c.1-2.5 1.1-4.7 2.9-6.3C7.3 3.6 9.6 2.5 12 2.6z';
// Leans a few degrees clockwise: the short stroke sits low, the long one reaches up and right.
const CHECK = 'M8.2 12.9l2.6 2.1 4.6-5.9';

export function CookStamp({ size = 18, color = colors.green, style }: { size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d={RING} stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeOpacity={0.92} />
        <Circle cx={12} cy={12} r={6.6} stroke={color} strokeWidth={0.9} strokeDasharray="1.6 1.4" strokeOpacity={0.6} />
        <Path d={CHECK} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.92} />
      </Svg>
    </View>
  );
}
