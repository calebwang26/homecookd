// Global CSS first, always: tokens, reset and type roles sit in cascade layers (see globals.css),
// and loading them before any component pulls in its CSS module keeps dev and the static export in
// the same order as well.
import '@/styles/globals.css';
import '@/styles/fonts.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from './fonts';
import { FONT_PRELOADS } from './fontPreload';
import { copyParent } from '@/content/copy.parent';
import { ROUTE_GATE } from '@/lib/audience-gate';

// Canonical origin: NEXT_PUBLIC_SITE_URL, else https://homecookd.app on Vercel production builds,
// else Vercel's production domain (previews), else (local builds only) localhost. A production
// build that would still ship localhost URLs in the canonical link and og:image fails loudly.
const PRODUCTION_URL = 'https://homecookd.app';
function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const isProd = process.env.VERCEL_ENV === 'production';
  const url = explicit || (isProd ? PRODUCTION_URL : vercel ? `https://${vercel}` : 'http://localhost:3000');
  if (isProd && /\/\/(localhost|127\.0\.0\.1)\b/.test(url)) {
    throw new Error(`Set NEXT_PUBLIC_SITE_URL (e.g. ${PRODUCTION_URL}) for the production build.`);
  }
  return url;
}
const SITE_URL = siteUrl();

// Defaults for every page: the parent version's words and share image (the home page). /, /learn
// and /teach set their own (src/app/lander.tsx landerMetadata); /r sets its own too.
const { meta } = copyParent;
const OG_IMAGE = { url: '/og.jpg', width: 1200, height: 630, alt: meta.ogAlt, type: 'image/jpeg' };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: meta.title,
  description: meta.description,
  applicationName: meta.siteName,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: meta.siteName,
    title: meta.title,
    description: meta.description,
    url: '/',
    locale: 'en_US',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
    images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
  },
};

export const viewport: Viewport = {
  themeColor: '#EEF3F0',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
};

// Motion gating (brief 4.1): runs before CSS paints. Hidden "before" states only exist under
// html[data-motion="on"]; if the app hasn't hydrated within 4s, everything is shown. A page whose
// scripts are still arriving (a slow connection, a dev server compiling the route) gets until 12s:
// switching motion off early left the hero frozen (no rotation) once the app did hydrate.
// Adaptive mode (src/lib/perf.ts reads these): html[data-net="slow"] on Save-Data or a 2G/3G
// connection (no autoplaying video, no background prefetch); html[data-weak] on a low-memory or
// 2-core device (motion off: the calm static layout). Only Chromium reports these, so iPhones are
// never guessed at. ?lite=1 forces both and ?lite=0 neither (testing).
const MOTION_GATE = `(function(){var d=document.documentElement,t=Date.now(),n=navigator,c=n.connection||{},q=location.search.match(/[?&]lite=([01])/),f=q&&q[1],m=n.deviceMemory,slow=f?f==='1':!!c.saveData||/(^|-)2g$|^3g$/.test(c.effectiveType||''),weak=f?f==='1':!!m&&(m<=2||(n.hardwareConcurrency||8)<=2);if(slow)d.dataset.net='slow';if(weak)d.dataset.weak='';d.dataset.motion=weak||matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on';function check(){if(window.__homecookdHydrated)return;if(document.readyState!=='complete'&&Date.now()-t<12000)return setTimeout(check,500);d.dataset.motion='off'}setTimeout(check,4000);})();`;

// Open at the top. The browser's own scroll restoration replays the old offset into a page whose
// pinned scenes change height as they mount, so a reload landed mid-page (6000 → 3930px). Deep
// links (/#questions) still land on their section (LenisProvider re-lands them once laid out).
const SCROLL_START = `(function(){try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch(e){}if(!location.hash)window.scrollTo(0,0);})();`;

const ORG_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: meta.siteName,
  url: SITE_URL,
});

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* first: which version this visitor sees (may leave / for /learn before paint) */}
        <script dangerouslySetInnerHTML={{ __html: ROUTE_GATE }} />
        <script dangerouslySetInnerHTML={{ __html: SCROLL_START }} />
        <script dangerouslySetInnerHTML={{ __html: MOTION_GATE }} />
        {FONT_PRELOADS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        {/* each page brings its own <Providers audience> (the words follow the chosen version) */}
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ORG_LD }} />
      </body>
    </html>
  );
}
