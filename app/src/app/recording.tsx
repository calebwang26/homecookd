// Placeholder: Grandma's recording screen ("Recording 12:34", "I'm done") lands here next (parent UI
// track). homie is already on it, top-right (components/homie); its live questions use showMoment.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackPill, ScreenWash, Txt } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

export default function RecordingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={320} />
      <View style={[styles.col, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]}>
        <BackPill onPress={() => (router.canGoBack() ? router.back() : router.replace('/parent/home'))} />
        <Txt variant="display" size={34} accessibilityRole="header">
          Recording
        </Txt>
        <Txt variant="lead">Coming next.</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { paddingHorizontal: space.gutter, gap: 16, alignItems: 'flex-start' },
});
