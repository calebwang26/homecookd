// 8.11 Questions (canvas breather). Server component; the FAQ text is a client island because
// {R} follows the "Cooking with" picker.
//
// Desktop: grid 5/7. Left (sticky while the list is read): H2, Caveat note, and the real
// web-answer recording in a phone, captioned. Right: native <details> accordion (works with
// no JS; the open/close height animates where ::details-content is supported, snaps elsewhere).
// Tablet (768–1023): H2 + note beside a small phone, then the accordion.
// Phones (< 768): H2, note, accordion. No phone (brief 8.11; it kept the section over its scroll budget).
// Parent version (/teach): the H2 fades up once (PlainHeading), and there is no hand note.
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { WordReveal } from '@/components/motion/WordReveal';
import { Reveal } from '@/components/motion/Reveal';
import { HandNote } from '@/components/primitives/HandNote';
import { PlainHeading } from '@/components/sections/SeeItWork/PlainHeading';
import { FaqList } from './FaqList';
import { PhoneClip } from './PhoneClip';
import styles from './Questions.module.css';

export function Questions() {
  const q = useCopy().questions;
  const parent = useAudience() === 'parent';
  return (
    <section id="questions" className={styles.section} aria-labelledby="questions-title">
      <div className={styles.grid}>
        <div className={styles.aside}>
          <div className={styles.head}>
            {parent ? (
              <PlainHeading id="questions-title" className={`t-h2 ${styles.h2}`} text={q.h2} accent={q.accent} />
            ) : (
              <WordReveal as="h2" id="questions-title" className={`t-h2 ${styles.h2}`} text={q.h2} accent={q.accent} />
            )}
          </div>
          {q.note ? (
            <Reveal y={12} delay={0.45} className={styles.note}>
              <HandNote arrow="right" tone="cocoa" rotate={-3}>
                {q.note}
              </HandNote>
            </Reveal>
          ) : null}
          <Reveal y={40} zoomImages={false} amount={0.25} className={styles.phoneFig}>
            <PhoneClip />
          </Reveal>
          {q.phoneCaption ? (
            <Reveal as="p" y={12} delay={0.3} className={`t-ui ${styles.caption}`}>
              {q.phoneCaption}
            </Reveal>
          ) : null}
        </div>
        <FaqList className={styles.list} />
      </div>
    </section>
  );
}
