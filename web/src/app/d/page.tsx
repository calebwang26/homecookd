// /d?t=<token>: a dinner's invite link opened outside the app (the app's "Invite friends"). Static
// export: the token is read on the client (components/dinner-invite). The OG tags are static because
// message previews don't run JavaScript (and must never count as an open). Hidden from search.
import type { Metadata, Viewport } from 'next';
import { DinnerInvitePage } from '@/components/dinner-invite/DinnerInvitePage';

const TITLE = 'You’re invited to dinner';
const DESCRIPTION = 'A neighbor is cooking their family’s dish. Come to dinner.';
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
    url: '/d',
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
  themeColor: '#FBF5EA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function DinnerInviteRoute() {
  return <DinnerInvitePage />;
}
