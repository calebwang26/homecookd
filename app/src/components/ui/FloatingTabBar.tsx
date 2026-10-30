// The bible's floating tab bar: a cream pill (left/right 20, bottom 24, height 76, padding 8,
// gap 4) with 0 10px 30px rgba(31,36,48,0.14) + a 1px 0.04 ring. Tabs are equal columns: 24 px stroke
// icon over a 13 px label; the active tab is a dark ink #1F2430 bubble with a white icon + 700 label,
// inactive tabs are ink #1F2430 with a 600 label. Frosted (blur + 0.88 cream) so content passes under it
// (motion spec 2). The ink bubble slides between tabs on a spring, and grows past its column when the
// label needs it ("Community" on a 390 pt phone), so a label never runs off its round ends. Numeric badge per tab from the
// screen option `tabBarBadge` or the `badges` prop ({ routeName: count }). A short cream fade rises
// behind the bar (28 px above it), so a row half under it reads as "scroll for more" (QA: taps on a
// half-covered last row did nothing); it never takes a touch.
//
//   <Tabs tabBar={(p) => <FloatingTabBar {...p} />} screenOptions={{ headerShown: false }}>
//     <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color }) => <HomeIcon color={color} /> }} />
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { Tabs } from 'expo-router/js-tabs';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { alpha, colors, motion, shadows, tabBar } from '@/theme/tokens';

import { haptic } from './haptics';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';

export type FloatingTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0] & {
  /** Extra badge counts by route name (in addition to each screen's `tabBarBadge`). */
  badges?: Record<string, number | undefined>;
};

export function FloatingTabBar({ state, descriptors, navigation, badges }: FloatingTabBarProps) {
  const reduce = useReducedMotion();
  // Only routes that should appear (expo-router hides `href: null` screens via tabBarItemStyle display none / tabBarButton null).
  const routes = state.routes.filter((r) => {
    const o = descriptors[r.key]?.options as { href?: unknown; tabBarItemStyle?: { display?: string } } | undefined;
    return !(o?.href === null || o?.tabBarItemStyle?.display === 'none');
  });
  const activeKey = state.routes[state.index]?.key;
  const activeIdx = Math.max(0, routes.findIndex((r) => r.key === activeKey));

  const [innerW, setInnerW] = useState(0);
  const n = Math.max(routes.length, 1);
  const contentW = innerW > 0 ? innerW - tabBar.padding * 2 : 0;
  const colW = contentW > 0 ? (contentW - tabBar.gap * (n - 1)) / n : 0;
  // Each label's width, so the bubble can grow past its column for a long one ("Community" at 390 pt).
  const [labelW, setLabelW] = useState<Record<string, number>>({});
  const activeLabel = labelW[routes[activeIdx]?.key ?? ''] ?? 0;
  const bubbleW = colW ? Math.min(contentW, Math.max(colW, activeLabel + 2 * LABEL_AIR)) : 0;

  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (!colW) return;
    // Centred on its tab, kept inside the bar.
    const target = Math.min(Math.max(0, activeIdx * (colW + tabBar.gap) - (bubbleW - colW) / 2), contentW - bubbleW);
    if (!placed.current || reduce) {
      placed.current = true;
      x.value = reduce ? withTiming(target, { duration: motion.reducedFadeMs }) : target;
      w.value = reduce ? withTiming(bubbleW, { duration: motion.reducedFadeMs }) : bubbleW;
    } else {
      x.value = withSpring(target, motion.tab);
      w.value = withSpring(bubbleW, motion.tab);
    }
  }, [activeIdx, colW, bubbleW, contentW, reduce, x, w]);
  const bubble = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <LinearGradient pointerEvents="none" colors={PAGE_FADE} locations={[0, 0.4]} style={styles.fade} />
      <View style={styles.bar} accessibilityRole="tablist">
        <View style={[StyleSheet.absoluteFill, styles.clip]}>
          {Platform.OS === 'android' ? null : <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'android' ? alpha.tabBar : alpha.tabBarFrosted }]} />
        </View>
        <View style={styles.inner} onLayout={(e: LayoutChangeEvent) => setInnerW(e.nativeEvent.layout.width)}>
          {colW ? <Animated.View style={[styles.bubble, bubble]} /> : null}
          {routes.map((route, i) => {
            const { options } = descriptors[route.key];
            const focused = i === activeIdx;
            const label =
              typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
            const color = focused ? colors.card : colors.text;
            const rawBadge = options.tabBarBadge ?? badges?.[route.name];
            const badge = typeof rawBadge === 'number' ? (rawBadge > 0 ? (rawBadge > 9 ? '9+' : String(rawBadge)) : null) : rawBadge ?? null;
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                haptic('selection');
                navigation.navigate(route.name, route.params);
              }
            };
            return (
              <PressableScale
                key={route.key}
                onPress={onPress}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? (badge ? `${label}, ${badge} new` : label)}
                testID={options.tabBarButtonTestID}
                style={[styles.tab, !colW && focused ? styles.staticBubble : null]}>
                <View>
                  {options.tabBarIcon?.({ focused, color, size: 24 })}
                  {badge ? (
                    <View style={styles.badge}>
                      <Txt variant="tiny" size={11} weight={700} color={colors.ink} leading={1.2}>
                        {badge}
                      </Txt>
                    </View>
                  ) : null}
                </View>
                <Txt
                  variant="caption"
                  weight={focused ? 700 : 600}
                  color={color}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  onLayout={(e: LayoutChangeEvent) => {
                    const lw = Math.ceil(e.nativeEvent.layout.width);
                    setLabelW((m) => (m[route.key] === lw ? m : { ...m, [route.key]: lw }));
                  }}>
                  {label}
                </Txt>
              </PressableScale>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** Room each side of a label inside the bubble, past the round ends' curve (60 pt tall, so 30 pt radius). */
const LABEL_AIR = 12;

/** The page tone (cream #FBF5EA), clear above the bar to nearly solid behind it. */
const PAGE_FADE = ['rgba(251,245,234,0)', 'rgba(251,245,234,0.92)'] as const;

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: tabBar.bottom + tabBar.height + 28 },
  bar: {
    position: 'absolute',
    left: tabBar.side,
    right: tabBar.side,
    bottom: tabBar.bottom,
    height: tabBar.height,
    borderRadius: 999,
    boxShadow: shadows.tabBar,
  },
  clip: { borderRadius: 999, overflow: 'hidden' },
  inner: { flex: 1, flexDirection: 'row', padding: tabBar.padding, gap: tabBar.gap },
  bubble: {
    position: 'absolute',
    left: tabBar.padding,
    top: tabBar.padding,
    bottom: tabBar.padding,
    borderRadius: 999,
    backgroundColor: colors.ink,
  },
  tab: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 3 },
  staticBubble: { backgroundColor: colors.ink },
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.yolk,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 2px #FFFFFF',
  },
});
