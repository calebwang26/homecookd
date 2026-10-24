// A small drawn flame for the Sunday table (RETENTION-HANDOFF 3.2): the badge on a lit face, and the
// "6 weeks" line in a 1:1 chat header. Sun yellow by default, never an emoji. Same conventions as
// icons.tsx (24x24 viewBox, `size` / `color` / `strokeWidth`, round joins).
//
//   <FlameIcon size={14} />            // filled, for badges on faces
//   <FlameIcon filled={false} />       // stroke only, next to text
//
// Unlit faces get nothing at all (no grey flame): render this only when lit.
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import type { IconProps } from './icons';

// An outer tongue with a small lick on the left, and an inner flame low in the body.
const OUTER = 'M12 2.5c.5 3.2 2.6 4.9 4.3 6.9 1.6 1.9 2.7 3.9 2.7 6.1a7 7 0 0 1-14 0c0-2.6 1.3-4.6 3-6.1.2 1.6.9 2.7 2 3.3-.3-3.9.4-7.4 2-10.2z';
const INNER = 'M12 13.2c1.6 1.5 3 2.9 3 4.8a3 3 0 0 1-6 0c0-1.3.6-2.3 1.4-3 .1.7.5 1.2 1 1.4.1-1.2.3-2.3.6-3.2z';

export function FlameIcon({
  size = 16,
  color = colors.sun,
  strokeWidth = 1.5,
  filled = true,
}: IconProps & {
  /** Filled body with a pale heart (default), or stroke only. */
  filled?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={OUTER} fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <Path
        d={INNER}
        fill={filled ? colors.butter : 'none'}
        stroke={filled ? 'none' : color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
