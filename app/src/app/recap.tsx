// Month in the kitchen (RETENTION-HANDOFF 3.7): the full-screen story slides. The Home card (both Homes,
// the 1st-7th) and the 1st-of-month push open /recap?month=YYYY-MM; a missing or malformed month means
// last month. RecapScreen does the loading & states; this route adds Close and Share.
//
// Share renders the slide on screen (its colour, photos, numbers and the homecookd mark) to a PNG with
// react-native-view-shot (in Expo Go for SDK 57) and opens the system share sheet (expo-sharing). The
// button never shows on web (RecapStory), and a phone that can't share gets the slide's own "Couldn’t
// share that one" toast. TODO(caleb) #4: no cookbook offer on the last slide until printing exists.
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { RecapScreen } from '@/components/recap/RecapScreen';
import { useSession } from '@/lib/session';

async function shareSlide(view: View): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available here');
  const uri = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your month' });
}

export default function RecapRoute() {
  const { month } = useLocalSearchParams<{ month?: string }>();
  const router = useRouter();
  const { me, homeFor } = useSession();
  return (
    <RecapScreen
      month={month}
      // Opened cold (a link with nothing under it): Close lands on this person's Home.
      onClose={() => (router.canGoBack() ? router.back() : router.replace(me ? homeFor(me) : '/'))}
      shareSlide={Platform.OS === 'web' ? undefined : shareSlide}
    />
  );
}
