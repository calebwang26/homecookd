// /privacy: what homecookd keeps, why, who receives it and how to delete it, in plain words (QA B19,
// App Store guideline 5.1.1(i): what's collected, how, every use, retention, and how to delete or take
// back consent). The app links here from sign-in, the AI consent screen and the profile sheet.
// Server component, no JS. Every line is a fact about how homecookd works today; when that changes,
// change this page in the same commit.
//   videos, clips, recipe photos, recipe.json  Google Cloud buckets at open, unlisted links (pipeline/)
//   recipes, family, messages, voice notes,    Convex (convex/schema.ts) and Supabase (sign-in, invites,
//     photos sent home                         older screens; voice notes + photos in private buckets)
//   AI                                         Claude (watches video stills, writes, translates, homie),
//                                              Cartesia (transcripts, Ink, Sonic, a cloned voice with
//                                              consent), Moss (finds the moment), Gemini (glasses only)
//   Community                                  place rounded to ~1 km, never shown (convex/lib/geo.ts)
//   Delete account                             the app's profile sheet (convex/account.ts); media in GCS
//                                              and Supabase rows are purged from accountDeletions
//   this website's visit log                   POST /web-events: page, referrer, taps; no IP
// TODO(caleb): the legal entity and address, and confirm the 30-day deletion windows (docs/app-store).
// Links home are plain <a>: '/' must load in full so ROUTE_GATE (the layout's <head> script) runs.
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from 'next';
import { PotMascot } from '@/components/primitives/PotMascot';
import { CONTACT_EMAIL } from '@/content/site';
import s from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Privacy · homecookd',
  description: 'What homecookd keeps, why, who gets it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

const UPDATED = 'October 26, 2026';

const mail = (
  <a className={s.link} href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);

export default function PrivacyPage() {
  return (
    <main id="main" className={s.page}>
      <a className={s.home} href="/" aria-label="homecookd, home">
        <PotMascot size={32} />
        <span className={s.word}>homecookd</span>
      </a>

      <h1 className={`t-h2 ${s.h1}`}>Privacy, in plain words.</h1>
      <p className={s.updated}>Last updated {UPDATED}.</p>
      <p className={s.lead}>
        homecookd helps a family member film themself cooking and turns the video into a recipe the rest of the family
        can follow. Here’s what we keep, why, who gets it, and how to delete it.
      </p>

      <section className={s.block} aria-labelledby="keep">
        <h2 id="keep" className={s.h2}>
          What we keep
        </h2>
        <ul className={s.list}>
          <li>
            <strong>Your account:</strong> your name, what your family calls you, the email, Apple or Google account you
            sign in with, your language, and your phone number if you add one.
          </li>
          <li>
            <strong>What you make:</strong> cooking videos (filmed in the app, on glasses, or picked from your photos),
            photos of dishes, voice notes, messages to your family, the recipes and stories we write from your videos,
            and questions and answers about a recipe.
          </li>
          <li>
            <strong>Your voice while cooking:</strong> when you cook hands-free, the app sends your microphone to our
            voice service so it hears “next” or a question. While a cook films in the app, the helper listens and looks
            at the camera to know when to speak.
          </li>
          <li>
            <strong>A cloned voice, only if you say yes:</strong> a cook can let us copy their voice to read their
            recipes aloud. We ask first, keep a record of the yes, and they can turn it off.
          </li>
          <li>
            <strong>Community:</strong> if your family joins, your place rounded to about 1 km (never shown to anyone)
            and the recipes the cook chooses to share.
          </li>
          <li>
            <strong>How you use the app:</strong> which recipes you open, cook and save, so we can show the right ones.
          </li>
          <li>
            <strong>Your phone:</strong> a sign-in key and, if you allow notifications, a push token.
          </li>
          <li>
            <strong>This website:</strong> the page you opened, what sent you here, and which buttons you tapped. We
            don’t store your IP address.
          </li>
        </ul>
        <p>
          We don’t collect payment details, health data, your contacts or your browsing history. We don’t sell your
          data, show ads, or track you across other apps and websites.
        </p>
      </section>

      <section className={s.block} aria-labelledby="use">
        <h2 id="use" className={s.h2}>
          How we use it
        </h2>
        <p>
          To write recipes from your videos, cook with you hands-free, send messages, questions and photos between your
          family, send the notifications you asked for, keep homecookd safe, and fix and improve it. Never for ads.
        </p>
      </section>

      <section className={s.block} aria-labelledby="ai">
        <h2 id="ai" className={s.h2}>
          The AI services we use
        </h2>
        <p>homecookd asks your permission in the app before sending these services anything.</p>
        <ul className={s.list}>
          <li>
            <strong>Anthropic Claude</strong> watches cooking videos and reads what the cook said, then writes the recipe,
            its stories and dish ideas. It also translates, drafts notes you can edit before you send them, and decides how
            to help while you cook hands-free or film.
          </li>
          <li>
            <strong>Cartesia</strong> turns speech into text, reads steps aloud, and makes a cloned voice only with the
            cook’s yes.
          </li>
          <li>
            <strong>Moss</strong> searches what the cook said, to find the moment in the video that answers a question.
          </li>
          <li>
            <strong>Google Gemini</strong> watches videos filmed with homecookd glasses.
          </li>
        </ul>
        <p>They get only what each task needs, and we use them only to run homecookd.</p>
      </section>

      <section className={s.block} aria-labelledby="where">
        <h2 id="where" className={s.h2}>
          Where it’s kept
        </h2>
        <p>
          Recipes, family details, messages, voice notes and photos are stored with Convex and Supabase, two database
          services. Cooking videos, clips and recipe photos are stored with Google Cloud. This website runs on Vercel.
          They store data for us and may not use it for anything else.
        </p>
      </section>

      <section className={s.block} aria-labelledby="see">
        <h2 id="see" className={s.h2}>
          Who can see it
        </h2>
        <ul className={s.list}>
          <li>
            <strong>Your family</strong> sees your family’s recipes, videos and stories. A message goes to the people you
            send it to.
          </li>
          <li>
            <strong>Recipe videos and photos sit at unlisted web links.</strong> They aren’t listed or searchable, but
            anyone who has the exact link can open them. When you send a recipe link, anyone with it can open the
            recipe.
          </li>
          <li>
            <strong>Community neighbors</strong> see only the recipes a cook chooses to share: the dish, the steps and a
            short story card. Never the video, the cook’s voice, or your exact place.
          </li>
        </ul>
      </section>

      <section className={s.block} aria-labelledby="keep-time">
        <h2 id="keep-time" className={s.h2}>
          How long we keep it
        </h2>
        <p>
          While your account is open. When you delete it, we delete your data within 30 days, and it leaves our backups
          within 30 more. That includes the messages and voice notes you sent, and your one-to-one chats. What others
          posted in the family chat stays.
        </p>
      </section>

      <section className={s.block} aria-labelledby="delete">
        <h2 id="delete" className={s.h2}>
          Deleting and your choices
        </h2>
        <ul className={s.list}>
          <li>
            <strong>Delete your account</strong> in the app: tap your name at the top, then Delete my account. It
            deletes your account, messages and voice notes, and a cook’s recipes.
          </li>
          <li>
            <strong>Take back a yes</strong> at any time: turn off the cloned voice, Community sharing or notifications
            in the app, or write to us to stop sending your data to AI services. Recipe writing and hands-free cooking
            can’t work without them.
          </li>
          <li>
            <strong>Get a copy, or fix something:</strong> write to {mail} and we’ll answer within 30 days. Depending on
            where you live (for example California, the EU or the UK), you may have more rights over your data.
          </li>
        </ul>
      </section>

      <section className={s.block} aria-labelledby="kids">
        <h2 id="kids" className={s.h2}>
          Children
        </h2>
        <p>
          homecookd is for adults and families, not for children under 13. We don’t knowingly collect data from children
          under 13. If you think a child signed up, write to us and we’ll delete it.
        </p>
      </section>

      <section className={s.block} aria-labelledby="safe">
        <h2 id="safe" className={s.h2}>
          Keeping it safe
        </h2>
        <p>
          Data travels over encrypted connections, and phone sign-in keys are stored only as scrambled hashes. No system
          is perfect, so please tell us right away if you see a problem.
        </p>
      </section>

      <section className={s.block} aria-labelledby="changes">
        <h2 id="changes" className={s.h2}>
          Changes
        </h2>
        <p>If we change this page, we’ll update the date above and tell you in the app before a big change.</p>
      </section>

      <section className={s.block} aria-labelledby="ask">
        <h2 id="ask" className={s.h2}>
          Questions?
        </h2>
        <p>
          Write to us at {mail}. Our terms of use are{' '}
          <a className={s.link} href="/terms">
            here
          </a>
          .
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
