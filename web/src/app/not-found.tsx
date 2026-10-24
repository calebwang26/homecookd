// The site's 404 (QA B25), in the lander's look: the pot, one line and a plain way home. Static export
// writes it to out/404.html, which Vercel serves for any unknown path. Server component, no JS.
// The way home is a plain <a>: '/' must load in full so ROUTE_GATE (the layout's <head> script) runs.
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from 'next';
import { PotMascot } from '@/components/primitives/PotMascot';
import s from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Page not found · homecookd',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main" className={s.page}>
      <PotMascot size={112} mood="talk" />
      <h1 className={`t-h2 ${s.title}`}>This page isn’t here.</h1>
      <a className={s.home} href="/">
        Go to homecookd
      </a>
    </main>
  );
}
