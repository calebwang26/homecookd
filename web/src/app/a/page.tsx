// /a?t=<ask token>: Mom hears her kid, sees the kid's guess, and fixes it with her voice (docs/PRD-V2.md
// §4 Phase 3). Static export: the token is read on the client. The OG tags are static because message
// previews don't run JavaScript. Hidden from search; no referrer leaves the page.
import type { Metadata, Viewport } from 'next';
import { MomApp } from '@/components/mom/MomApp';

const TITLE = 'Your family wants to make your dish';
const DESCRIPTION = 'A few quick questions. You can just talk.';
const OG_IMAGE = { url: '/og.jpg', width: 1200, height: 630, alt: 'homecookd', type: 'image/jpeg' };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  referrer: 'no-referrer',
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: { type: 'website', siteName: 'homecookd', title: TITLE, description: DESCRIPTION, url: '/a', locale: 'en_US', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }] },
};

export const viewport: Viewport = {
  themeColor: '#F9E3CF',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function AskRoute() {
  return <MomApp />;
}
