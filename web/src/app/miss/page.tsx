// /miss: the kid's dish box (docs/PRD-V2.md §4 Phase 2). A kid names a dish they miss, gets tonight's
// version, and asks Mom for the rest. /miss?k=<kid token> reopens a card. Static export: the token is
// read on the client. The OG tags are static (message previews run no JavaScript). Hidden from search,
// and no referrer leaves the page, so the token in the address never travels.
import type { Metadata, Viewport } from 'next';
import { MissApp } from '@/components/miss/MissApp';

const TITLE = 'What do you miss from home?';
const DESCRIPTION = 'Name the dish you miss. Make it tonight, then ask the cook for the rest.';
const OG_IMAGE = { url: '/og.jpg', width: 1200, height: 630, alt: 'homecookd', type: 'image/jpeg' };

// Before the first paint: a link that opens a card hides the dish box the server rendered.
const BOOT = `(function(){if(/[?&]k=/.test(location.search))document.documentElement.setAttribute('data-miss-open','')})();`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  referrer: 'no-referrer',
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: { type: 'website', siteName: 'homecookd', title: TITLE, description: DESCRIPTION, url: '/miss', locale: 'en_US', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }] },
};

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function MissRoute() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      <MissApp />
    </>
  );
}
