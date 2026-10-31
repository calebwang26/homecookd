// /r?s=<token>: the web recipe page someone opens from a shared link (docs/build/SPEC.md section 6).
// Static export: the token is read on the client. Hidden from search; generic share preview.
import type { Metadata, Viewport } from 'next';
import { RecipeWebApp } from '@/components/recipe-web/RecipeWebApp';

const TITLE = 'A family recipe on homecookd';
const DESCRIPTION = 'Someone in your family sent you a recipe, with their steps, their stories and their voice.';
// The parent card, so the preview shows who the cook is (Caleb, Oct 16; same as /i).
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
    url: '/r',
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
  themeColor: '#18221D',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function SharedRecipePage() {
  return <RecipeWebApp />;
}
