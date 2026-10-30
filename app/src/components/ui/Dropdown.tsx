// The "More from Mom" accordion from Kid-Step / Kid-Step-Open.
//  closed: yolk-tint #FCEBD0 row, 56 tall, radius 20, padding 0 20, 16/700 title + chevron-down
//  open:   white #FFFFFF panel, radius 28, card shadow, padding 8 20 20, 48 px header row with
//          chevron-up, content 18 px below the header
// The panel grows with an animated height; the yolk-tint fill crossfades to white with the shadow.
// `variant="link"` is Kid-Ingredients' centred green "Swaps and shopping tips" text toggle.
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { colors, radii, shadows } from '@/theme/tokens';

import { haptic } from './haptics';
import { ChevronDownIcon } from './icons';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type DropdownProps = {
  title: string;
  children?: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  /** 'panel' (default) = More from Mom; 'link' = centred green text toggle. */
  variant?: 'panel' | 'link';
  /** Fill while closed (default yolk tint). */
  closedBg?: string;
  /** Something next to the title (e.g. a yolk "Special" chip). */
  accessory?: ReactNode;
  /** Read after the title by screen readers (e.g. "Has something special" for the Special chip). */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const DURATION = 280;

export function Dropdown({ title, children, open: controlled, defaultOpen = false, onToggle, variant = 'panel', closedBg = colors.yolkTint, accessory, accessibilityHint, style }: DropdownProps) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const reduce = useReducedMotion();
  const [contentH, setContentH] = useState(0);

  const p = useDerivedValue(
    () =>
      withTiming(open ? 1 : 0, {
        duration: reduce ? 150 : DURATION,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      }),
    [open, reduce],
  );

  const toggle = () => {
    haptic('selection');
    const next = !open;
    if (controlled == null) setOwn(next);
    onToggle?.(next);
  };

  const panel = variant === 'panel';

  const bodyStyle = useAnimatedStyle(() => ({
    // The measured content already includes its padding (18 above, 20 below in the panel).
    height: reduce ? (p.value > 0.5 ? contentH : 0) : p.value * contentH,
    opacity: reduce ? p.value : interpolate(p.value, [0, 0.4, 1], [0, 0.4, 1]),
  }), [contentH, reduce]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${p.value * 180}deg` }] }));
  const peachLayer = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    borderRadius: interpolate(p.value, [0, 1], [radii.quote, radii.panel]),
  }));
  // Closed: the title row is centred in 56. Open: 8 top padding + a 48 row (bible), same 56 total.
  const headerPad = useAnimatedStyle(() => ({ paddingTop: 8 * p.value }));
  const creamLayer = useAnimatedStyle(() => ({
    opacity: p.value,
    borderRadius: interpolate(p.value, [0, 1], [radii.quote, radii.panel]),
  }));

  // Collapsed content is height 0 but still mounted: keep it out of the accessibility tree and
  // untouchable until the panel opens.
  const hidden = {
    accessibilityElementsHidden: !open,
    importantForAccessibility: open ? ('auto' as const) : ('no-hide-descendants' as const),
    'aria-hidden': !open,
    pointerEvents: open ? ('auto' as const) : ('none' as const),
  };

  const measure = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h !== contentH) setContentH(h);
  };

  if (!panel) {
    return (
      <View style={style}>
        <PressableScale
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.link}>
          <Txt variant="label" weight={600} color={colors.yolkDeep}>
            {title}
          </Txt>
          <Animated.View style={chevron}>
            <ChevronDownIcon size={18} color={colors.yolkDeep} />
          </Animated.View>
        </PressableScale>
        <Animated.View {...hidden} style={[styles.clip, bodyStyle]}>
          <View style={[styles.measure, { paddingTop: 8 }]} onLayout={measure}>
            {children}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.panel, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: closedBg }, peachLayer]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.cream, creamLayer]} />
      <PressableScale
        onPress={toggle}
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint}
        style={[styles.header, headerPad]}>
        <Txt variant="rowTitle" style={styles.title} numberOfLines={1}>
          {title}
        </Txt>
        {accessory}
        <Animated.View style={chevron}>
          <ChevronDownIcon size={20} color={colors.ink} />
        </Animated.View>
      </PressableScale>
      <Animated.View {...hidden} style={[styles.clip, bodyStyle]}>
        <View style={[styles.measure, { paddingTop: 18, paddingBottom: 20 }]} onLayout={measure}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 20 },
  cream: { backgroundColor: colors.card, boxShadow: shadows.card },
  // 56 total in both states: closed = 56 row; open = 8 top padding + 48 row (bible).
  header: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  clip: { overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, right: 0, top: 0 },
  link: { alignSelf: 'center', height: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
});
