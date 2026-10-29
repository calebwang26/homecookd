// /a?t=<ask token>: Mom's ask for a kid's dish card, opened in the app (homecookd://a?t=…, or pasted
// on the first screen after "Sent"; the https link stays on the web, where she answers by voice). The
// steps are ClaimLink's (docs/build/V2-LINKING.md 2.6).
import { useLocalSearchParams } from 'expo-router';

import { ClaimLink } from '@/components/signin';

export default function AskLinkScreen() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  return <ClaimLink kind="ask" token={typeof t === 'string' ? t : null} />;
}
