// The /dev screens (gallery, media) are for building the app. In a production build they aren't
// there: opening one sends you home (your home, else "Who's in the kitchen?").
import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/lib/session';
import { colors } from '@/theme/tokens';

export default function DevLayout() {
  const { me, homeFor } = useSession();
  if (!__DEV__) return <Redirect href={me ? homeFor(me) : '/'} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
      <Stack.Screen name="gallery" options={{ title: 'Gallery' }} />
      <Stack.Screen name="media" options={{ title: 'Media' }} />
    </Stack>
  );
}
