// Motion spec 2: the large title scrolls away with the content, and a compact sticky header
// (17 px DM Sans 600, centred) fades in over the first 48 px of scroll on a frosted background
// (BlurView 40, light, + rgba(247,247,242,0.72)).
//
//   const { scrollY, onScroll } = useScrollY();
//   <View style={{ flex: 1 }}>
//     <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16}>
//       <ScreenWash tone="kid" />
//       <LargeHeader eyebrow="Sunday evening" title="Hi, Leo" right={<Avatar ... />} />
//       ...
//     </Animated.ScrollView>
//     <StickyHeader title="Hi, Leo" scrollY={scrollY} />
//   </View>
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alpha, colors, motion, space } from '@/theme/tokens';

import { Txt } from './Txt';

/** Scroll position for StickyHeader. Spread `onScroll` on an Animated.ScrollView / FlatList. */
export function useScrollY() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  return { scrollY, onScroll };
}

export type LargeHeaderProps = {
  title: string;
  /** Line above the title ("Sunday evening", "Monday, October 13"). */
  eyebrow?: string;
  /** Eyebrow colour: muted 15/400 for kid (default), peach-ink 16/600 for parent. */
  eyebrowTone?: 'kid' | 'parent';
  /** Line under the title ("They answer in their own voice."). */
  subtitle?: string;
  /** Title size: 32 kid (default), 34 parent, 40 Main. */
  size?: number;
  /** Right side, e.g. the 48 px avatar with a ring. */
  right?: ReactNode;
  /**
   * Element at the right end of the eyebrow line (e.g. Parent-Home's 48 pt "Mom ▾"), centred on that
   * line; the line grows to fit it, so it never sits over the title, which keeps the full width.
   */
  eyebrowRight?: ReactNode;
  /** Top inset under the status bar. The bible puts the first line at y=60 on an 844 frame. */
  top?: number;
  /**
   * Pass the screen's scrollY to fade the block out as it slides under the StickyHeader, so the
   * large title never shows through the compact one. Fully gone at `fadeEnd` px (default 48).
   */
  scrollY?: SharedValue<number>;
  fadeEnd?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * The bible's screen title block: optional eyebrow, Fraunces 500 title (-0.02em, 1.1), optional
 * subtitle (16 muted, 6 px under). Lays out from the safe area so y matches the bible on an iPhone.
 */
export function LargeHeader({
  title,
  eyebrow,
  eyebrowTone = 'kid',
  subtitle,
  size = 32,
  right,
  top,
  eyebrowRight,
  scrollY,
  fadeEnd = motion.stickyFadeDistance,
  style,
}: LargeHeaderProps) {
  const insets = useSafeAreaInsets();
  // Bible frames have no status bar; 60 px from the top equals ~13 px under a 47 px safe area.
  const padTop = top ?? Math.max(space.top, insets.top + 13);
  const fade = useAnimatedStyle(() =>
    scrollY ? { opacity: interpolate(scrollY.value, [0, fadeEnd], [1, 0], Extrapolation.CLAMP) } : {},
  );
  return (
    <Animated.View style={[styles.large, { paddingTop: padTop }, style, fade]}>
      <View style={[styles.titleCol, { gap: eyebrow ? (eyebrowTone === 'parent' ? 4 : 2) : 6 }]}>
        {eyebrow ? (
          <View style={styles.eyebrowRow}>
            {eyebrowTone === 'parent' ? (
              <Txt variant="label" size={16} weight={600} color={colors.peachInk} style={styles.shrink}>
                {eyebrow}
              </Txt>
            ) : (
              <Txt variant="body" size={15} style={styles.shrink}>
                {eyebrow}
              </Txt>
            )}
            {eyebrowRight ? <View style={styles.eyebrowRight}>{eyebrowRight}</View> : null}
          </View>
        ) : null}
        <Txt variant="display" size={size} accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="body" leading={1.4}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </Animated.View>
  );
}

export type StickyHeaderProps = {
  title: string;
  scrollY: SharedValue<number>;
  /** Scroll offset where the fade starts (default 0; set to the large title's bottom for later). */
  start?: number;
  left?: ReactNode;
  right?: ReactNode;
};

/** Compact frosted header that fades in over the first 48 px of scroll. Absolutely positioned. */
export function StickyHeader({ title, scrollY, start = 0, left, right }: StickyHeaderProps) {
  const insets = useSafeAreaInsets();
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [start, start + motion.stickyFadeDistance], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View style={[styles.sticky, { paddingTop: insets.top, height: insets.top + 48 }, a]} pointerEvents="box-none">
      {/* On web the blur smears the photos underneath into dark bands, and any see-through tone lets
          the large title bleed into the compact one; a solid page tone instead. */}
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.page }]} />
      ) : (
        <>
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha.headerFrosted }]} />
        </>
      )}
      <View style={[StyleSheet.absoluteFill, styles.hairline, { top: undefined }]} />
      <View style={styles.bar}>
        <View style={styles.side}>{left}</View>
        <Txt variant="heading" numberOfLines={1} style={styles.compactTitle}>
          {title}
        </Txt>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  large: {
    paddingHorizontal: space.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleCol: { flex: 1 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  shrink: { flexShrink: 1 },
  eyebrowRight: { justifyContent: 'center', alignItems: 'flex-end' },
  sticky: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10 },
  // Barely there: the bible's scrolled frames show no rule under the header.
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(30,36,16,0.04)' },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  side: { width: 64, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  compactTitle: { flex: 1, textAlign: 'center' },
});
