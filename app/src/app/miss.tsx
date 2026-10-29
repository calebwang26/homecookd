// /miss?k=<kid token>: a kid's dish card opened in the app (https://homecookd.app/miss?k=…, the
// universal link; homecookd://miss?k=…; or pasted on the first screen). The steps are ClaimLink's
// (docs/build/V2-LINKING.md 2.6). The plain /miss page and craving links (/miss?c=…) stay on the web.
import { useLocalSearchParams } from 'expo-router';

import { ClaimLink } from '@/components/signin';

export default function DishCardLinkScreen() {
  const { k } = useLocalSearchParams<{ k?: string }>();
  return <ClaimLink kind="card" token={typeof k === 'string' ? k : null} />;
}
