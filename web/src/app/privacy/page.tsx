// /privacy: what homecookd keeps, why, who receives it and how to delete it, in plain words (QA B19,
// App Store guideline 5.1.1(i): what's collected, how, every use, retention, and how to delete or take
// back consent). The app links here from sign-in, the AI consent screen and the profile sheet.
// Server component, no JS. Every line is a fact about how homecookd works today; when that changes,
// change this page in the same commit.
//   videos, clips, recipe photos, recipe.json  Google Cloud buckets at open, unlisted links (pipeline/)
//   recipes, family, messages, voice notes,    Convex (convex/schema.ts) and Supabase (sign-in, invites,
//     photos sent home                         older screens; voice notes + photos in private buckets)
//   AI                                         Claude (videos and photos, writes, translates the family's
//                                              questions), Cartesia (transcripts); the AWS build sends nothing to
//                                              Moss or Gemini, listed as old services until they're off. Matches
//                                              the consent sheet's words (#357). homie's voice
//                                              is off (app/src/lib/homie/switch.ts): no live mic stream, no
//                                              hands-free cooking, no cloned voice. Turning homie on means
//                                              changing this page first (docs/agents/memory/homie-off.md).
//   1.0 (build 6, released Nov 8)              predates the homie switch (c668053a0): live mic to Cartesia, camera
//                                              frames + words to Claude (homie's decide), Moss search, Gemini for
//                                              languages Ink can't hear and the backup voice (voice/src at 5ab9f6f69).
//                                              Remove the "If your app is still version 1.0" paragraph when the voice
//                                              service is turned off (CUTOVER.md, "After 1.1 is out")
//   Community                                  place rounded to ~1 km, never shown (convex/lib/geo.ts)
//   Delete account                             the app's profile sheet (convex/account.ts); media in GCS
//                                              and Supabase rows are purged from accountDeletions
//   this website's visit log                   POST /web-events: page, referrer, taps; no IP
//   /miss and /a (no account)                  Convex dishAsks (DISH-ASK-SPEC.md): dish, relation, name,
//                                              photos, voice notes, message, her answers + translation;
//                                              Claude (guess, her version, translation), Cartesia Ink;
//                                              links stored hashed; IP as HMAC only; kept until asked to delete
//   AWS (1.1, CUTOVER.md step 5)               the api's Postgres and S3 in us-west-2 (infra/envs/production);
//                                              raw uploads expire after 14 days, old S3 versions after 28
//                                              (infra/modules/env/storage.tf); database backups 14 days
//   Sentry                                     the api and worker only: an error's type and place, scrubbed
//                                              of request data (api/src/sentry.ts); not in the app or site
//   one-to-one chats on delete                 what they sent goes, the other person's half stays (SCHEMA.md C1)
//   Expo                                       delivers pushes (api/src/modules/messages/expo.ts)
// TODO(caleb): a lawyer reads "Where it's kept" and the one-to-one chats line (AWS-MIGRATION.md item 4).
// TODO(caleb): the legal entity and address, and confirm the 30-day deletion windows (docs/app-store).
// Links home are plain <a>: '/' must load in full so ROUTE_GATE (the layout's <head> script) runs.
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from 'next';
import { Logo } from '@/components/primitives/Logo';
import { CONTACT_EMAIL } from '@/content/site';
import s from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Privacy · homecookd',
  description: 'What homecookd keeps, why, who gets it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

const UPDATED = 'November 8, 2026';

const mail = (
  <a className={s.link} href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);

export default function PrivacyPage() {
  return (
    <main id="main" className={s.page}>
      <a className={s.home} href="/" aria-label="homecookd, home">
        <Logo height={32} />
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
            <strong>Your voice:</strong> the voice notes and voice answers you record, and what you say in the cooking
            videos you film. The microphone is on only while you record.
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
          To write recipes from your videos and voice answers, send messages, questions and photos between your family, send the notifications you asked for, keep homecookd safe, and fix and improve it. Never for ads.
        </p>
      </section>

      <section className={s.block} aria-labelledby="ai">
        <h2 id="ai" className={s.h2}>
          The AI services we use
        </h2>
        <p>homecookd asks your permission in the app before sending these services anything.</p>
        <ul className={s.list}>
          <li>
            <strong>Anthropic Claude</strong> watches your videos and photos, writes the recipe and its stories, and
            translates your family’s questions into your language. It also drafts notes you can edit before you send
            them.
          </li>
          <li>
            <strong>Cartesia</strong> writes down what you say in your videos and voice notes.
          </li>
        </ul>
        <p>
          Before our move to AWS, <strong>Moss</strong> searched what a cook said to find a moment in the video, and{' '}
          <strong>Google Gemini</strong> watched videos filmed with homecookd glasses. The app sends them nothing now.
          They still hold some of that data until we turn them off.
        </p>
        <p>
          <strong>If your app is still version 1.0</strong> (added November 8, 2026): homie listens while you cook and
          film. What you say goes live to <strong>Cartesia</strong>, which understands it and
          speaks homie&rsquo;s answers. While you film, homie also sends still frames from the camera, with your words, to{' '}
          <strong>Anthropic Claude</strong> to decide what to say. To find a moment in a recipe&rsquo;s video, it searches{' '}
          <strong>Moss</strong>. For the few languages Cartesia can&rsquo;t hear, and as a backup voice, it uses{' '}
          <strong>Google Gemini</strong>. Version 1.1 removes all of this: update to stop it. This paragraph
          comes down when version 1.0 stops working.
        </p>
        <p>They get only what each task needs, and we use them only to run homecookd.</p>
      </section>

      <section className={s.block} aria-labelledby="pages">
        <h2 id="pages" className={s.h2}>
          Recipes made on this website
        </h2>
        <p>
          On homecookd.app/miss you can ask for a dish from home, and on the link you get, your family can answer by
          voice. Neither needs an account.
        </p>
        <ul className={s.list}>
          <li>
            <strong>What we keep:</strong> the dish you typed, who makes it, the name you give, the photos and voice notes
            you add, and the message you send. If you answer, we keep your voice answers, what they say, and their
            English translation.
          </li>
          <li>
            <strong>Who works on it:</strong> when you tap to make the recipe or send an answer, Anthropic Claude writes
            the recipe from what you typed and your photos, and translates. Cartesia turns voice into text.
          </li>
          <li>
            <strong>Who can see it:</strong> anyone who has the recipe’s link or the answer link, so share them only with
            family. The links are long and random, and we store only a scrambled copy of them.
          </li>
          <li>
            <strong>Your IP address:</strong> to stop abuse, we keep only a scrambled form of it, never the address
            itself.
          </li>
          <li>
            <strong>How long:</strong> until you ask us to delete it. Write to {mail} with the link, and we’ll delete it
            within 30 days. If you keep the recipe in the app, Delete account deletes it too.
          </li>
        </ul>
      </section>

      <section className={s.block} aria-labelledby="where">
        <h2 id="where" className={s.h2}>
          Where it’s kept
        </h2>
        <p>
          Your account, recipes, family details, messages, voice notes, photos and cooking videos are stored with Amazon
          Web Services (AWS), in the United States. We’re moving there from Convex and Supabase, two database services,
          and Google Cloud, which stores videos, clips and recipe photos. Until the move is done, some of it is still
          stored with them too. This website runs on Vercel.
        </p>
        <p>
          When something breaks on our servers, Sentry, an error-reporting service, gets what kind of error it was and
          where in our code it happened. Never your recipes, messages, voice, photos or account details. Expo and Apple
          deliver the notifications you allow.
        </p>
        <p>They work for us and may not use your data for anything else.</p>
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
          within 30 more. That includes the messages and voice notes you sent, in the family chat and in one-to-one
          chats. What others sent stays, in both, so they keep their side of the conversation.
        </p>
        <p>
          The full cooking videos you film or upload are deleted 14 days after they reach us, and leave our backups
          within 30 more. The recipe keeps its short clips and photos for as long as the recipe stays.
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
            <strong>Take back a yes</strong> at any time: turn off Community sharing or notifications in the app, or
            write to us to stop sending your data to AI services. Recipe writing can’t work without them.
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
