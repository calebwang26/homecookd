// The Community pages' frame (a shared recipe, a dinner), in the recipe page's shape: a dish photo
// with a Back pill, then a rounded sheet that rises over it, and a compact header once scrolled.
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, BackPill, detailContentEnter, heroEnter, IconButton, StickyHeader, useScrollY } from '@/components/ui';
import { colors, radii, space } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';

const HERO_H = 260;
const SHEET_TOP = 228;

/** Back, or to `home` when the page was opened from a link with nothing under it. */
export function goBack(home: Href = '/kid/home') {
  if (router.canGoBack()) router.back();
  else router.replace(home);
}

export function DetailPage({ title, photo, children }: { title: string; photo: string | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { scrollY, onScroll } = useScrollY();
  const top = Math.max(space.topDetail, insets.top + 9);
  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.grow}>
        <Animated.View entering={heroEnter} style={styles.hero}>
          <DishPhoto uri={photo} label={title} pot={72} style={StyleSheet.absoluteFill} />
          <BackPill overPhoto onPress={() => goBack()} style={[styles.back, { top }]} />
        </Animated.View>
        <Animated.View entering={detailContentEnter} style={[styles.sheet, { paddingBottom: Math.max(40, insets.bottom + 24) }]}>
          {children}
        </Animated.View>
      </Animated.ScrollView>
      <StickyHeader
        title={title}
        scrollY={scrollY}
        start={SHEET_TOP - 80}
        left={<IconButton tone="clear" size={40} accessibilityLabel="Back" icon={<BackIcon size={22} color={colors.ink} />} onPress={() => goBack()} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  grow: { flexGrow: 1 },
  hero: { height: HERO_H, backgroundColor: colors.peach },
  back: { position: 'absolute', left: space.gutter },
  sheet: {
    flexGrow: 1,
    marginTop: SHEET_TOP - HERO_H,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    backgroundColor: colors.page,
    paddingTop: 28,
    paddingHorizontal: space.gutter,
    gap: 20,
  },
});
