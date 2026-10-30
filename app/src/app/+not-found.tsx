// Any path the app doesn't have (a mistyped or old link). The first screen's look (the yolk-tint wash,
// the egg lockup), one Fraunces line, "This page isn't here.", and one way out: Go home,
// to your home, else "Who's in the kitchen?". Replaces Expo Router's black "Unmatched Route" page,
// whose Sitemap link listed every screen.
import { StyleSheet, View } from 'react-native';

import { Headline, leaveTo, SignInScreen } from '@/components/signin';
import { ActionButton } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function NotFound() {
  const { me, homeFor } = useSession();
  return (
    <SignInScreen>
      <Headline title="This page isn’t here." />
      <View style={styles.ways}>
        <ActionButton label="Go home" size="xl" onPress={() => leaveTo(me ? homeFor(me) : '/')} />
      </View>
    </SignInScreen>
  );
}

const styles = StyleSheet.create({
  // The button sits at thumb height, as on the first screen.
  ways: { marginTop: 'auto' },
});
