'use client';
// Static state (SSR, no JS, reduced motion on desktop): the intro, then the four rows in flow,
// each with its own phone showing the recording's poster and a ▶ (outside the phone, at its
// lower-right corner) that plays it on tap.
// Posters wait until the section is near (this HTML ships with every page load); without JS the
// <noscript> still shows them.
import { useEffect, useRef } from 'react';
import type { AppClipName } from '@/content/types';
import { APP_CLIPS } from '@/content/media';
import { AppClip } from '@/components/primitives/AppClip';
import { Handset } from '@/components/primitives/Handset';
import { Intro } from './Intro';
import { OuterPlay, PLAY_HOST } from './OuterPlay';
import { RowText } from './RowText';
import { ShareBubble } from './ShareBubble';
import { startFrom } from './lazy';
import { useCopy } from '@/components/providers/CopyProvider';
import { ROW_SLIDES, SHARE_ROW, SLIDES, START_AT, posterOf } from './tour';
import styles from './SeeItWork.module.css';

export function StaticTour({ near }: { near: boolean }) {
  const ROWS = useCopy().seeItWork.rows;
  const rowsRef = useRef<HTMLOListElement>(null);
  // recordings whose payoff comes late start further in (START_AT)
  useEffect(() => {
    const phones = rowsRef.current?.querySelectorAll<HTMLElement>('[data-clip]') ?? [];
    const offs = Array.from(phones).flatMap((el) => {
      const at = START_AT[el.dataset.clip as keyof typeof START_AT];
      const v = el.querySelector('video');
      return v && at ? [startFrom(v, at)] : [];
    });
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <div className={styles.stat}>
      <Intro arrow="down" className={styles.introStat} />
      <ol ref={rowsRef} className={styles.sRows} role="list">
        {ROWS.map((r, i) => {
          const name = SLIDES[ROW_SLIDES[i][0]];
          return (
            <li key={r.number} className={styles.sRow}>
              <div className={styles.sPhone} data-clip={name}>
                <StaticPhone name={name} near={near} />
              </div>
              <div className={styles.sText}>
                <RowText i={i} />
                {i === SHARE_ROW ? <ShareBubble shown variant="static" /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StaticPhone({ name, near }: { name: AppClipName; near: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`${styles.sDevice} ${PLAY_HOST}`}>
      <Handset width="var(--s-phone-w)">
        <AppClip
          name={name}
          tapToPlay
          loop
          preload="none"
          // an empty poster fetches nothing; it fills in once the section is near
          poster={near ? posterOf(name, true) : ''}
          label={APP_CLIPS[name].label}
        />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- no-JS fallback only */}
          <img className={styles.sPoster} src={posterOf(name, true)} alt="" />
        </noscript>
      </Handset>
      <OuterPlay scope={ref} className={styles.posterPlay} />
    </div>
  );
}
