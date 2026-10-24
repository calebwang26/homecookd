// /_sitemap: Expo Router's list of every screen, the /dev ones included. Kept while building the
// app; in a production build it sends you home (your home, else "Who's in the kitchen?").
import { Redirect, Sitemap } from 'expo-router';

import { useSession } from '@/lib/session';

export default function SitemapRoute() {
  const { me, homeFor } = useSession();
  if (!__DEV__) return <Redirect href={me ? homeFor(me) : '/'} />;
  return <Sitemap />;
}
