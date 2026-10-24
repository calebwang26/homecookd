// 8.8 In their words · #in-their-words · B5
// Full-bleed sun block with the VERO swirl. Left: eyebrow, LetterArc H2, body, and a star photo
// under the body, bleeding off the left (mobile/tablet: top-right, beside the H2). Right: the
// TranslatorCard (website UI, never a phone) with the "Coming to the app" seal on its corner and
// the honesty note under it.
// Static (SSR, no JS, reduced motion): everything visible, the card on the language the body names
// (or 中文), instant swaps.
// Parent version (/teach, FEEDBACK-OCT16 C2): the H2 (fading up once), the star, the card and the
// honesty note; no eyebrow or body; the star and the seal come in with plain fades.
import type { CSSProperties } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { useFill } from '@/components/providers/RelationProvider';
import { PHOTOS, SWIRLS } from '@/content/media';
import { LetterArc } from '@/components/motion/LetterArc';
import { Reveal } from '@/components/motion/Reveal';
import { StarClip } from '@/components/primitives/StarClip';
import { Sticker } from '@/components/primitives/Sticker';
import { PlainHeading } from '@/components/sections/SeeItWork/PlainHeading';
import { PopIn } from './PopIn';
import { TranslatorCard } from './TranslatorCard';
import s from './InTheirWords.module.css';

export function InTheirWords() {
  const T = useCopy().inTheirWords;
  const parent = useAudience() === 'parent';
  const f = useFill(); // the parent version's body names {kids}
  /** "Their words. Translated." → two lines */
  const H2 = T.h2.replace('. ', '.\n');
  return (
    <section
      id="in-their-words"
      className={[s.section, T.body ? '' : s.lean].filter(Boolean).join(' ')}
      aria-labelledby="in-their-words-h2"
      style={{ ['--swirl' as string]: `url(${SWIRLS.sun})` } as CSSProperties}
    >
      <div className={s.inner}>
        <div className={s.copy}>
          {T.eyebrow ? (
            <Reveal as="p" className={`t-eyebrow ${s.eyebrow}`} y={12} amount={0.8}>
              {T.eyebrow}
            </Reveal>
          ) : null}
          {parent ? (
            <PlainHeading id="in-their-words-h2" className={`t-block ${s.h2}`} text={H2} accent={T.accent} accentColor="var(--forest)" />
          ) : (
            <LetterArc
              as="h2"
              id="in-their-words-h2"
              className={`t-block ${s.h2}`}
              text={H2}
              accent={T.accent}
              style={{ ['--accent' as string]: 'var(--forest)' } as CSSProperties}
            />
          )}
          {T.body ? (
            <Reveal as="p" className={`t-lead ${s.body}`} delay={0.35} y={16}>
              {f(T.body)}
            </Reveal>
          ) : null}
          <div className={s.starSlot}>
            <StarClip
              image={PHOTOS.grandmaGranddaughterDumplings.src}
              alt={T.starAlt}
              size="var(--star-size)"
              sizes="(min-width: 1024px) 320px, 38vw"
              rotate={-8}
              focus={PHOTOS.grandmaGranddaughterDumplings.focus}
              delay={0.2}
              enter={parent ? 'fade' : 'spin'}
            />
          </div>
        </div>

        <div className={s.cardCol}>
          <Reveal className={s.cardWrap} y={56} delay={0.25} amount={0.25}>
            <TranslatorCard />
            {parent ? (
              // no slap: the seal simply comes in with the card
              <span className={s.seal}>
                <Sticker lines={T.sticker} tone="sunOnCream" size={150} rotate={10} className={s.sticker} />
              </span>
            ) : (
              <PopIn className={s.seal} delay={0.75} from={-50}>
                <Sticker lines={T.sticker} tone="sunOnCream" size={150} rotate={10} className={s.sticker} />
              </PopIn>
            )}
          </Reveal>
          <p className={`t-body ${s.note}`}>{T.note}</p>
        </div>
      </div>

    </section>
  );
}
