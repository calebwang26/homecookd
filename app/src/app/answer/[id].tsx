// Placeholder: the walkie-talkie (the cook answers a kid's question by holding a big pot) lands here
// next (parent UI track). /answer/<questionId>; homie reads the question aloud with lib/live/speak.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackPill, ScreenWash, Txt } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

export default function AnswerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={320} />
      <View style={[styles.col, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]}>
        <BackPill onPress={() => (router.canGoBack() ? router.back() : router.replace('/parent/home'))} />
        <Txt variant="display" size={34} accessibilityRole="header">
          Answer
        </Txt>
        <Txt variant="lead">Coming next.</Txt>
        {__DEV__ && id ? <Txt variant="meta">Question {id}</Txt> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { paddingHorizontal: space.gutter, gap: 16, alignItems: 'flex-start' },
});
