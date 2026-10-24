// One feature row's words: number pill, H3, one body line, one real-app chip. Server-safe.
// The cook-it row's "Watch · Mix the dough" is a plain caption, not a chip: with an outline and a ▶ it
// looked like a button that did nothing (QA B25).
import { Fragment } from 'react';
import { Pill } from '@/components/primitives/Pill';
import { useCopy } from '@/components/providers/CopyProvider';
import { useFill } from '@/components/providers/RelationProvider';
import { SHARE_ROW, WATCH_ROW, shareText } from './tour';
import styles from './SeeItWork.module.css';

// On desktop a two-sentence title breaks between its sentences ("Record it. / Or pick videos."), not
// inside one ("Record it. Or / pick videos."): each sentence is an inline-block there (.l_desktop).
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);

export function RowText({ i }: { i: number }) {
  const copy = useCopy();
  const f = useFill(); // rows may carry person tokens ({kids}, {her})
  const row = copy.seeItWork.rows[i];
  return (
    <>
      <span className={styles.num} data-reveal-item="" aria-hidden="true">
        {row.number}
      </span>
      <h3 className={`t-h3 ${styles.h3}`} data-reveal-item="">
        {sentences(row.title).map((s, k) => (
          <Fragment key={k}>
            {k ? ' ' : null}
            <span className={styles.sentence}>{s}</span>
          </Fragment>
        ))}
      </h3>
      <p className={`t-body ${styles.body}`} data-reveal-item="">
        {f(row.body)}
        {i === SHARE_ROW ? <span className="sr-only"> {shareText(copy).sr}</span> : null}
      </p>
      <span className={styles.chipLine} data-reveal-item="">
        {i === WATCH_ROW ? <span className={styles.caption}>{row.chip}</span> : <Pill tone="outlineCream">{row.chip}</Pill>}
      </span>
    </>
  );
}
