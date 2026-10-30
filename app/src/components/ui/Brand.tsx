// The brand row: the kit's horizontal lockup (the egg + the outlined "homecookd" wordmark), never typed
// text. `size` is the old wordmark's type size (22 on Main), so the row keeps its height (34 pt at 22).
// `reversed` on dark grounds. The logo never changes its face (the kit), so there's no mood here.
import type { StyleProp, ViewStyle } from 'react-native';

import { Lockup } from './Egg';

export function Brand({ size = 22, reversed = false, style }: { size?: number; reversed?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Lockup height={Math.round((size * 34) / 22)} reversed={reversed} style={style} />;
}
