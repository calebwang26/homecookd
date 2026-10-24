// The bible's top-of-screen wash: a linear gradient from lavender #ECE6F2 (kid) or peach #F9E3CF
// (parent) at the top to the page #F7F7F2. Heights in the bible: 300 (most tabs), 360 Kid-Home,
// 380 Parent-Home, 420 Main. Place it as the first child of the screen (or of the scroll content to
// let it scroll away with the title).
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { washes } from '@/theme/tokens';

export function ScreenWash({ tone = 'kid', height = 300, style }: { tone?: 'kid' | 'parent'; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={washes[tone] as unknown as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.wash, { height }, style]}
    />
  );
}

const styles = StyleSheet.create({
  wash: { position: 'absolute', left: 0, right: 0, top: 0 },
});
