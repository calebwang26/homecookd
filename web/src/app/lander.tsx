// One lander, two versions (brief 9.1 page structure). Server component.
//   / and /teach → <Lander audience="parent" />  the one who cooks (the default home page)
//   /learn       → <Lander audience="kid" />     the one who misses the cooking
// Same sections and media; the words come from getCopy(audience) (useCopy() inside). The parent
// version is calmer (FEEDBACK-OCT16 C2): DeckFilm is the hero alone (no pass-down, no call),
// StepsToBox is How it works alone (2nd screen, no card motion), and the family table is its own
// forest block after the app demo (FEEDBACK-OCT16b 3: hero → how it works → the app → the table).
// On the parent page, Far apart ("Send it off. Get photos back.") moves up between the app and the table.
// On /learn, StickySend keeps "Send this to {R}" at the bottom of a phone's screen between the hero and
// the final section (QA B18).
// Nav and DeckFilm (the first screen) hydrate with the page. Every section after them is a
// deferred slot (src/app/sections.tsx): server-rendered as usual, with its JS in a separate chunk
// that mounts when the section nears the viewport or the page goes idle (brief 11, first-load JS).
import type { Metadata } from 'next';
import { SkipLink } from '@/components/chrome/SkipLink/SkipLink';
import { Nav } from '@/components/chrome/Nav/Nav';
import { DeckFilm } from '@/components/sections/DeckFilm/DeckFilm';
import { Providers } from '@/components/providers/Providers';
import { LandLogger } from '@/components/chrome/LandLogger';
import { StickySend } from '@/components/chrome/StickySend/StickySend';
import { AUDIENCE_PATH, type Audience } from '@/content/audience';
import { getCopy } from '@/content/copies';
import { Section } from './sections';

export function Lander({ audience }: { audience: Audience }) {
  const copy = getCopy(audience);
  const parent = audience === 'parent';
  return (
    <Providers audience={audience}>
      <LandLogger audience={audience} /> {/* one 'land' or 'switch' event per page load */}
      <SkipLink href="#how-it-works" label={copy.nav.skipLink} />
      <Nav />
      <main id="main">
        <DeckFilm /> {/* #top, #pass-down (/teach: #top only) */}
        <Section id="steps-to-box" /> {/* #how-it-works, #recipe-box (/teach: #how-it-works only) */}
        <Section id="see-it-work" /> {/* #see-it-work */}
        {/* /teach: "Send it off. Get photos back." sits between the app and the family table */}
        {parent ? <Section id="far-apart" /> : null} {/* #far-apart (/teach) */}
        {parent ? <Section id="family-table" /> : null} {/* #recipe-box (/teach only) */}
        <Section id="every-family" /> {/* #every-family */}
        <Section id="in-their-words" /> {/* #in-their-words */}
        {parent ? null : <Section id="far-apart" />} {/* #far-apart (/learn) */}
        <Section id="measures" /> {/* #measures */}
        <Section id="questions" /> {/* #questions */}
        <Section id="final-cta" /> {/* #early-access */}
      </main>
      <Section id="footer" /> {/* #footer */}
      {parent ? null : <StickySend />}
    </Providers>
  );
}

/**
 * Title, description, canonical and the version's own share image: the parent version (/ and
 * /teach) is canonical / with /og.jpg; the kid version is /learn with /learn/og.jpg.
 */
export function landerMetadata(audience: Audience): Metadata {
  const { meta } = getCopy(audience);
  const path = AUDIENCE_PATH[audience];
  const imageUrl = path === '/' ? '/og.jpg' : `${path}/og.jpg`; // never '//og.jpg' (protocol-relative)
  const image = { url: imageUrl, width: 1200, height: 630, alt: meta.ogAlt, type: 'image/jpeg' };
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: meta.siteName,
      title: meta.title,
      description: meta.description,
      url: path,
      locale: 'en_US',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}
