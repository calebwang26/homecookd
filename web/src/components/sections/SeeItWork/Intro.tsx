'use client';
// Eyebrow, H2 and the Caveat note (the parent version: the H2 only, PlainHeading). The eyebrow's last word sits on a chartreuse pill: chartreuse
// text on green is only 3.89:1 (large text only), ink on chartreuse is 10.99:1.
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { WordReveal } from '@/components/motion/WordReveal';
import { Reveal } from '@/components/motion/Reveal';
import { HandNote } from '@/components/primitives/HandNote';
import { PlainHeading } from './PlainHeading';
import styles from './SeeItWork.module.css';

export function Intro({ arrow, className }: { arrow: 'left' | 'right' | 'down'; className?: string }) {
  const c = useCopy().seeItWork;
  // the parent version (/teach) is the H2 alone, fading up once (no eyebrow, no hand note)
  const parent = useAudience() === 'parent';
  const [eyebrowHead, eyebrowLast] = splitLast(c.eyebrow);
  return (
    <div className={[styles.intro, className].filter(Boolean).join(' ')}>
      {c.eyebrow ? (
        <Reveal as="p" y={12} className={`t-eyebrow ${styles.eyebrow}`}>
          {eyebrowHead} <span className={styles.eyebrowPill}>{eyebrowLast}</span>
        </Reveal>
      ) : null}
      {parent ? (
        <PlainHeading
          id="see-it-work-title"
          className={[`t-h2`, styles.h2, styles.h2Plain, c.eyebrow ? '' : styles.h2Top].filter(Boolean).join(' ')}
          text={c.h2}
          accent={c.accent}
          accentColor="var(--yolk)"
        />
      ) : (
        <WordReveal as="h2" id="see-it-work-title" className={`t-h2 ${styles.h2}`} tone="cream" text={c.h2} accent={c.accent} />
      )}
      {c.note ? (
        <Reveal y={12} delay={0.5}>
          <HandNote arrow={arrow} tone="cream" rotate={arrow === 'left' ? -3 : -2} className={styles.note}>
            {c.note}
          </HandNote>
        </Reveal>
      ) : null}
    </div>
  );
}

function splitLast(s: string): [string, string] {
  const i = s.lastIndexOf(' ');
  return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)];
}
