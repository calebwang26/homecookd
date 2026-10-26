// Kid (learner) tabs: Home | Recipes | Ask, on the bible's floating pill tab bar.
// Community ("Dishes near you", the map) was a hackathon-only tab: it's off (Caleb, Oct 25). Its screen and pages
// stay in the code; to bring it back, set `href` back to undefined below.
// Recipes is a stack (list -> dish); on a dish the tab bar fades away so the page keeps the bible
// layout (sticky "Start cooking"), and comes back on the list. While the phone is lent, Home shows
// "Cooking as Grandma · Back to Mom" under its title (ActingAsBar); the other tabs don't (Caleb, Oct 26).
import { getFocusedRouteNameFromRoute } from 'expo-router/react-navigation';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { CommunityIcon } from '@/components/community/CommunityIcon';
import { ChatIcon, FloatingTabBar, GridIcon, HomeIcon } from '@/components/ui';
import { useKidTabsPresence } from '@/lib/navigation';
import { useUnread } from '@/lib/session';
import { colors } from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

function useAskBadge(): number | undefined {
  return useUnread().total || undefined;
}

/** True while the Recipes tab shows a dish (not its list). */
function onDish(state: TabBarProps['state']): boolean {
  const route = state.routes[state.index];
  if (route?.name !== 'recipes') return false;
  const inner = getFocusedRouteNameFromRoute(route);
  return !!inner && inner !== 'index';
}

const HIDE_MS = 140;
const SHOW_MS = 220;

function KidTabBar(props: TabBarProps) {
  const hidden = onDish(props.state);
  const reduce = useReducedMotion();
  const shown = useSharedValue(hidden ? 0 : 1);
  // Once faded out the bar leaves the layout (display none): on web a parent's pointer-events
  // none doesn't stop the bar's own buttons, which would sit over "Start cooking".
  const [gone, setGone] = useState(hidden);
  const [wasHidden, setWasHidden] = useState(hidden);
  if (wasHidden !== hidden) {
    // Coming back: back in the layout in this same render, before it fades in.
    setWasHidden(hidden);
    if (!hidden) setGone(false);
  }
  useEffect(() => {
    shown.set(withTiming(hidden ? 0 : 1, { duration: hidden ? HIDE_MS : SHOW_MS, easing: Easing.out(Easing.cubic) }));
    if (!hidden) return;
    const t = setTimeout(() => setGone(true), HIDE_MS);
    return () => clearTimeout(t);
  }, [hidden, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: reduce || shown.value === 1 ? [] : [{ translateY: (1 - shown.value) * 16 }],
  }));
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[styles.anchor, gone ? styles.gone : null, style]}>
      <FloatingTabBar {...props} />
    </Animated.View>
  );
}

export default function KidTabs() {
  useKidTabsPresence();
  const ask = useAskBadge();
  return (
    <Tabs
      tabBar={(props) => <KidTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color }) => <HomeIcon color={String(color)} /> }} />
      <Tabs.Screen name="recipes" options={{ title: 'Recipes', tabBarIcon: ({ color }) => <GridIcon color={String(color)} /> }} />
      <Tabs.Screen name="community" options={{ href: null, title: 'Community', tabBarIcon: ({ color }) => <CommunityIcon color={String(color)} /> }} />
      <Tabs.Screen
        name="ask"
        options={{ title: 'Ask', tabBarBadge: ask || undefined, tabBarIcon: ({ color }) => <ChatIcon color={String(color)} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Same anchor as the bar's own (absolute, bottom 0): the bar positions itself inside it.
  anchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  gone: { display: 'none' },
});
