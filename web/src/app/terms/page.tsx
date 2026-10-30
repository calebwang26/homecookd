// /terms: the terms of use and the copyright (takedown) policy, in plain words. It carries what App Store
// guideline 1.2 asks of shared content (no tolerance for objectionable content, a way to report it, blocking)
// and sits on top of Apple's standard license agreement. The app links here from sign-in and the profile sheet.
// Same reading column as /privacy (its stylesheet). Server component, no JS.
// TODO(caleb): the governing state, the legal entity, and the copyright agent (register at
// copyright.gov/dmca-directory, then name the agent and a postal address in "Copyright policy").
// Links home are plain <a>: '/' must load in full so ROUTE_GATE (the layout's <head> script) runs.
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from 'next';
import { Logo } from '@/components/primitives/Logo';
import { CONTACT_EMAIL } from '@/content/site';
import s from '../privacy/privacy.module.css';

export const metadata: Metadata = {
  title: 'Terms · homecookd',
  description: 'The rules for using homecookd, and how to report content or a copyright problem.',
  alternates: { canonical: '/terms' },
};

const UPDATED = 'October 25, 2026';

const mail = (
  <a className={s.link} href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);

export default function TermsPage() {
  return (
    <main id="main" className={s.page}>
      <a className={s.home} href="/" aria-label="homecookd, home">
        <Logo height={32} />
      </a>

      <h1 className={`t-h2 ${s.h1}`}>Terms of use.</h1>
      <p className={s.updated}>Last updated {UPDATED}.</p>
      <p className={s.lead}>
        By using homecookd you agree to these terms and to our{' '}
        <a className={s.link} href="/privacy">
          privacy policy
        </a>
        . If you don’t agree, please don’t use the app.
      </p>

      <section className={s.block} aria-labelledby="account">
        <h2 id="account" className={s.h2}>
          Your account
        </h2>
        <p>
          You must be at least 13 to use homecookd. Keep your phone and sign-in safe; you’re responsible for what happens
          on your account. You can delete your account at any time in the app.
        </p>
      </section>

      <section className={s.block} aria-labelledby="yours">
        <h2 id="yours" className={s.h2}>
          Your recipes stay yours
        </h2>
        <p>
          You own the videos, photos, voice notes, recipes and stories you add. You let us store them, process them
          (including with the AI services in our privacy policy), turn them into recipes, and show them to the people you
          share them with, only to run homecookd. That ends when you delete them or your account, except for copies
          already sent to your family.
        </p>
        <p>
          Only add what you have the right to share. Ask before you film or record someone, and only clone your own
          voice.
        </p>
      </section>

      <section className={s.block} aria-labelledby="harm">
        <h2 id="harm" className={s.h2}>
          No tolerance for harmful content
        </h2>
        <p>
          Don’t post anything illegal, hateful, harassing, sexual, violent or threatening, anything that invades someone’s
          privacy, or anything you don’t have the rights to. We filter what’s shared in Community, and we remove content
          and close accounts that break these rules.
        </p>
        <p>
          To report a recipe or a family in Community, tap Report or block on it, or write to {mail}. We look at every
          report within a day. You can also block a family, and you won’t see each other in Community.
        </p>
      </section>

      <section className={s.block} aria-labelledby="care">
        <h2 id="care" className={s.h2}>
          Cook with care
        </h2>
        <p>
          Recipes are written from your family’s videos with the help of AI. Amounts, times and temperatures are estimates
          and can be wrong. Check for allergies, cook meat and eggs through, and trust your own judgment in the kitchen.
          homecookd isn’t responsible for how a dish turns out or for harm from cooking it.
        </p>
      </section>

      <section className={s.block} aria-labelledby="app">
        <h2 id="app" className={s.h2}>
          The app
        </h2>
        <p>
          homecookd, its name, the pot and its design are ours. Don’t copy, resell or take apart the app, or use it to
          build a competing service. We may change, pause or stop features. homecookd is provided “as is”, without
          warranties, and as far as the law allows, our total liability to you is limited to $100.
        </p>
      </section>

      <section className={s.block} aria-labelledby="apple">
        <h2 id="apple" className={s.h2}>
          Apple
        </h2>
        <p>
          These terms are between you and us, not Apple. Apple isn’t responsible for homecookd or its content and has no
          duty to support it. Apple is a third-party beneficiary of these terms, and its standard license agreement also
          applies.
        </p>
      </section>

      <section className={s.block} aria-labelledby="copyright">
        <h2 id="copyright" className={s.h2}>
          Copyright policy
        </h2>
        <p>
          We respect copyright. If you think something on homecookd copies your work, write to {mail} with:
        </p>
        <ol className={s.olist}>
          <li>Your name, address, phone and email, and your signature (typing your full name is fine).</li>
          <li>The work you think is copied.</li>
          <li>Where it is on homecookd: a link, or a description we can find.</li>
          <li>A statement that you believe in good faith the use isn’t allowed by the owner, its agent or the law.</li>
          <li>
            A statement, under penalty of perjury, that your notice is accurate and that you own the work or may act for
            the owner.
          </li>
        </ol>
        <p>
          We’ll take the material down and tell the person who posted it. If they think it was a mistake, they can send a
          counter-notice with their contact details, what was removed, a statement under penalty of perjury that it was a
          mistake, and their consent to the federal court where they live. We’ll put it back in 10 to 14 business days
          unless the owner tells us they’ve gone to court. We close the accounts of people who copy others’ work again and
          again.
        </p>
      </section>

      <section className={s.block} aria-labelledby="changes">
        <h2 id="changes" className={s.h2}>
          Changes and questions
        </h2>
        <p>
          We’ll tell you in the app before a big change to these terms. Questions? Write to us at {mail}.
        </p>
      </section>

      <p className={s.back}>
        <a className={s.link} href="/">
          Back to homecookd
        </a>
      </p>
    </main>
  );
}
