'use client';
// Measures: the a7 lime band, made of how families really measure (brief 8.10, a7 M21–M22). Owner: B4.
//
// A canvas section holding one inset chartreuse panel (85.5vw × 78vh, radius 32, tone-on-tone
// swirl). A huge Fraunces marquee of the cooks' own measures runs along its top edge, each phrase
// with its small ~estimate (or English) underneath; the H2 and body sit left-aligned below; and when
// the panel's floor scrolls into view, ingredient stickers drop and pile up, the pot mascot last.
//
// Static (SSR, reduced motion, no JS): the marquee stands still and scrolls sideways; the pile is
// already resting at its final positions; the mascot's chip is showing.
// Parent version (/teach, FEEDBACK-OCT16 C2): the H2 and the one-line body fade up once and the pile
// fades up at rest (no drop). The slow marquee and its Pause stay.
import { useEffect, useRef } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { Marquee } from '@/components/motion/Marquee';
import { Reveal } from '@/components/motion/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { PlainHeading } from '@/components/sections/SeeItWork/PlainHeading';
import { PauseButton } from '@/components/providers/PauseProvider';
import { Pile } from './Pile';
import s from './Measures.module.css';

// COPY-REQUEST: nothing on the page says "~" means "about", and it's the product's core idea. Change
// copy.measures.body to "We never replace their words. We just add a ~, for about." and, in the
// copy.questions.faq answer about AI, "Amounts stay in the cook's own words with a ~ estimate beside
// them" to "Amounts stay in the cook's own words, with an estimate like ~1 cup beside them".

function Flower() {
  return (
    <svg viewBox="0 0 40 40" className={s.flower} aria-hidden="true" focusable="false">
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={20} cy={10.6} rx={6.6} ry={9.6} transform={`rotate(${a} 20 20)`} fill="var(--yolk)" />
      ))}
      <circle cx={20} cy={20} r={5.2} fill="#E89A12" />
    </svg>
  );
}

export function Measures() {
  const c = useCopy().measures;
  const parent = useAudience() === 'parent';
  // "Their handful. / Your ~½ cup." reads as two beats; the break also leaves the panel's right side
  // open for the pile and the mascot.
  const H2 = c.h2.replace('. ', '.\n');
  const marqueeRef = useRef<HTMLDivElement>(null);

  // The marquee region only scrolls under reduced motion (the primitive's overflow-x: auto); while it
  // moves it's overflow: hidden, so its Tab stop would be a big ring that does nothing. Keep it
  // focusable only while it can scroll; the Pause button is the keyboard control otherwise. (SSR and
  // no-JS keep the primitive's tabIndex 0: there, focusing the row is the only way to pause it.)
  useEffect(() => {
    const region = marqueeRef.current?.querySelector<HTMLElement>('[role="region"]');
    if (!region) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      if (mq.matches) region.tabIndex = 0;
      else region.removeAttribute('tabindex');
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <section id="measures" className={s.section} aria-labelledby="measures-h2">
      <div className={s.panel}>
        <div className={s.content}>
          {parent ? (
            <PlainHeading id="measures-h2" className={['t-h2', s.h2].join(' ')} text={H2} accent={c.accent} accentColor="var(--forest)" />
          ) : (
            <WordReveal
              id="measures-h2"
              as="h2"
              className={['t-h2', s.h2].join(' ')}
              text={H2}
              accent={c.accent}
              accentColor="forest"
            />
          )}
          <div className={s.bodyRow}>
            {parent ? (
              <Reveal as="p" className={['t-lead', s.body].join(' ')} y={16} delay={0.2}>
                {c.body}
              </Reveal>
            ) : (
              <WordReveal as="p" className={['t-lead', s.body].join(' ')} text={c.body} stagger={0.02} delay={0.3} />
            )}
            <PauseButton variant="ink" labels={{ pause: c.pause, play: c.play }} className={s.pause} />
          </div>
        </div>

        <div ref={marqueeRef} className={s.marqueeWrap}>
          <Marquee label={c.marqueeLabel} durationSec={70} gap="0px" className={s.marquee}>
            {c.marquee.map((m) => (
              <span key={m.text} className={s.item}>
                <span className={s.phrase}>
                  <span className={s.say} lang={'lang' in m ? m.lang : undefined}>
                    {m.text}
                  </span>
                  <span className={s.caption}>{m.caption}</span>
                </span>
                <Flower />
              </span>
            ))}
          </Marquee>
        </div>

        {/* the bouncing drop on both versions (Caleb, Oct 17: the still pile was boring) */}
        <Pile spawnFrom={marqueeRef} />
      </div>
    </section>
  );
}
