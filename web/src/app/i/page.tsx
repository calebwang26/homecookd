// /i?t=<token>: a family invite opened outside the app (docs/build/FEEDBACK-OCT16c.md section C).
// Static export: the token is read on the client. The OG tags are static because iMessage previews
// don't run JavaScript (and must never use the invite up). Hidden from search.
import type { Metadata, Viewport } from 'next';
import { InvitePage } from '@/components/invite/InvitePage';

const TITLE = 'You’re invited to a family table';
const DESCRIPTION = 'Someone in your family invited you to homecookd.';
const OG_IMAGE = { url: '/og.jpg', width: 1200, height: 630, alt: 'homecookd', type: 'image/jpeg' };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: {
    type: 'website',
    siteName: 'homecookd',
    title: TITLE,
    description: DESCRIPTION,
    url: '/i',
    locale: 'en_US',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
  },
};

export const viewport: Viewport = {
  themeColor: '#EEF3F0',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function InviteRoute() {
  return <InvitePage />;
}
