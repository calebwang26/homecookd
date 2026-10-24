// /privacy: what homecookd keeps, where, who can see it and how to get it deleted, in plain words
// (QA B19). Server component, no JS. Every line here is a fact about how homecookd works today; when
// that changes (e.g. the recipe media turns private), change this page in the same commit.
//   recipe videos, photos, recipe.json  a public Google Cloud bucket; anyone with a link opens them, and
//                                       library.json at its root (read by the app) lists every recipe
//   writing the recipe                  Google's Gemini (pipeline/)
//   messages, voice notes, family       Supabase; voice notes in a private bucket. A cook's text or voice
//                                       answer to a recipe question is also saved on that recipe as a note
//                                       the whole family sees (POST /threads/:id/messages, Save to recipe)
//   photos sent after "I made it"       Supabase, the private 'photos' bucket (1-hour signed links)
//   sign-in email / Apple / Google, what each person opens, cooks and hearts: Supabase too (API.md)
//   this website's visit log            POST /web-events: the page, what sent you (site, ad, or the in-app
//                                       browser named from the user agent), button taps; no IP, no raw user
//                                       agent (docs/build/API.md)
// The contact lines show only once CONTACT_EMAIL is set (src/content/site.ts).
// Links home are plain <a>: '/' must load in full so ROUTE_GATE (the layout's <head> script) runs.
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from 'next';
import { PotMascot } from '@/components/primitives/PotMascot';
import { CONTACT_EMAIL } from '@/content/site';
import s from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Privacy · homecookd',
  description: 'What homecookd keeps, where it’s kept, and who can see it.',
  alternates: { canonical: '/privacy' },
};

const UPDATED = 'October 17, 2026';

const mail = CONTACT_EMAIL ? (
  <a className={s.link} href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
) : null;

export default function PrivacyPage() {
  return (
    <main id="main" className={s.page}>
      <a className={s.home} href="/" aria-label="homecookd, home">
        <PotMascot size={32} />
        <span className={s.word}>homecookd</span>
      </a>

      <h1 className={`t-h2 ${s.h1}`}>Privacy, in plain words.</h1>
      <p className={s.updated}>Last updated {UPDATED}.</p>

      <section className={s.block} aria-labelledby="keep">
        <h2 id="keep" className={s.h2}>
          What we keep
        </h2>
        <ul className={s.list}>
          <li>The cooking videos you add, the photos, and the recipe we write from them.</li>
          <li>Photos you send of a dish you made.</li>
          <li>Your family’s messages and voice notes, and each person’s name and place in the family.</li>
          <li>The email, Apple or Google account you sign in with, and which recipes you open, cook and save.</li>
          <li>Your email, if you sign up for early access.</li>
        </ul>
      </section>

      <section className={s.block} aria-labelledby="where">
        <h2 id="where" className={s.h2}>
          Where it’s kept
        </h2>
        <p>
          <strong>Recipe videos, recipe photos and recipes</strong> are stored with Google Cloud, at open web links. They are not
          private: anyone who has a link can open it, and the list of recipes sits at an open link too.
        </p>
        <p>
          <strong>Messages, voice notes, photos you send, family details and sign-in details</strong> are stored
          with Supabase, a database service. Voice notes and photos you send are kept in private storage, not
          behind open links.
        </p>
      </section>

      <section className={s.block} aria-labelledby="ai">
        <h2 id="ai" className={s.h2}>
          Who writes the recipe
        </h2>
        <p>
          We send your videos to Gemini, an AI from Google. It watches and listens to them and writes the steps. Your
          own words for amounts stay in the recipe, with an estimate beside them.
        </p>
      </section>

      <section className={s.block} aria-labelledby="see">
        <h2 id="see" className={s.h2}>
          Who can see it
        </h2>
        <p>
          Your family sees your recipes in the app. Messages and voice notes go to the chat you send them in. When a
          cook answers a question about a recipe, the answer is also saved on that recipe for the whole family.
        </p>
        <p>When you send someone a recipe link, anyone who has that link can open the recipe.</p>
      </section>

      <section className={s.block} aria-labelledby="site">
        <h2 id="site" className={s.h2}>
          This website
        </h2>
        <p>
          When you visit, we count the visit: which page you opened, the site, app or ad that sent you, and which of
          our buttons you tap. We don’t store your IP address.
        </p>
      </section>

      <section className={s.block} aria-labelledby="delete">
        <h2 id="delete" className={s.h2}>
          Deleting
        </h2>
        <p>
          There’s no delete button in the app yet.
          {mail ? <> Write to us at {mail} and tell us what to delete.</> : null}
        </p>
      </section>

      {mail ? (
        <section className={s.block} aria-labelledby="ask">
          <h2 id="ask" className={s.h2}>
            Questions?
          </h2>
          <p>Write to us at {mail}.</p>
        </section>
      ) : null}

      <p className={s.back}>
        <a className={s.link} href="/">
          Back to homecookd
        </a>
      </p>
    </main>
  );
}
