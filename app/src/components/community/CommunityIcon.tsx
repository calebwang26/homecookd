// The kid Community tab's icon: two neighbors side by side, drawn like the tab bar's other icons
// (components/ui/icons.tsx: 24x24 viewBox, 2 px round strokes, no fill). Not in the bible.
import Svg, { Circle, Path } from 'react-native-svg';

import type { IconProps } from '@/components/ui';
import { colors } from '@/theme/tokens';

export const CommunityIcon = ({ size = 24, color = colors.ink, strokeWidth = 2 }: IconProps) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round">
    <Circle cx={9} cy={8.5} r={3.5} />
    <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <Path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" />
    <Path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
  </Svg>
);
