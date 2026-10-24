'use client';
// Desktop (≥1024 × ≥600, motion on): a CSS-sticky stage on the left holds the phone in a hand;
// the four feature rows scroll past on the right (a8 on one green). The row crossing the viewport's
// middle line is active and its recording plays. No GSAP, no pin, no scrub: nothing to get stuck in.
import { animate } from 'motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { Reveal } from '@/components/motion/Reveal';
import { PauseButton } from '@/components/providers/PauseProvider';
import { EASE } from '@/lib/motion/tokens';
import { ClipStack } from './ClipStack';
import { Handset } from '@/components/primitives/Handset';
import { Intro } from './Intro';
import { Ribbon } from './Ribbon';
import { RowText } from './RowText';
import { ShareBubble } from './ShareBubble';
import { saveData } from './lazy';
import { ROW_SLIDES, SHARE_ROW, SHARE_SLIDE, nextInRow, rowOfSlide, singleClipRow } from './tour';
import styles from './SeeItWork.module.css';

export function DesktopTour({ near }: { near: boolean }) {
  const c = useCopy().seeItWork;
  const ROWS = c.rows;
  // Save-Data: posters with a ▶, nothing preloads (client-only layout, so navigator is there)
  const [lean] = useState(saveData);
  const [active, setActive] = useState(0);
  const [row, setRow] = useState(0);
  const [slide, setSlide] = useState(0);
  const [tapped, setTapped] = useState(false);
  // a new active row restarts its first recording and clears the share bubble
  if (active !== row) {
    setRow(active);
    setSlide(ROW_SLIDES[active][0]);
    setTapped(false);
  }

  // active row = the one under the viewport's middle line
  const rowsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const items = rowsRef.current?.querySelectorAll<HTMLElement>('[data-row]');
    if (!items) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.row));
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // the phone settles .985 → 1 on every swap
  const settleRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = settleRef.current;
    if (!el) return;
    const a = animate(el, { scale: [0.985, 1] }, { duration: 0.45, ease: EASE.soft });
    return () => a.stop();
  }, [slide]);

  // a one-recording row loops it; a row with several chains them and starts over
  const loop = useCallback((s: number) => singleClipRow(s), []);
  const onEnded = useCallback((s: number) => {
    const n = nextInRow(s);
    setSlide(n ?? ROW_SLIDES[rowOfSlide(s)][0]);
  }, []);
  const onShareTap = useCallback(() => setTapped(true), []);

  return (
    <div className={styles.desk}>
      <div className={styles.stageCol}>
        <div className={styles.stage}>
          <div className={styles.blob} aria-hidden="true" />
          <Ribbon className={styles.ribbonDesk} />
          <Reveal y="8vh" zoomImages={false} amount={0.2} className={styles.phoneRise}>
            <div ref={settleRef} className={styles.phoneSettle}>
              <Handset width="var(--phone-w)" hand>
                <ClipStack slide={slide} loop={loop} onEnded={onEnded} onShareTap={onShareTap} near={near} lean={lean} />
              </Handset>
              <ShareBubble shown={tapped && slide === SHARE_SLIDE} variant="stage" />
            </div>
          </Reveal>
          <div className={styles.progress}>
            <ol className={styles.dots} aria-hidden="true">
              {ROWS.map((r, i) => (
                <li key={r.number} className={styles.dot} data-on={i === row ? '' : undefined} />
              ))}
            </ol>
            <PauseButton variant="cream" size={48} labels={{ pause: c.pauseTabs, play: c.playTabs }} />
          </div>
        </div>
      </div>

      <div className={styles.flow}>
        <Intro arrow="left" className={styles.introDesk} />
        <ol ref={rowsRef} className={styles.rows} role="list">
          {ROWS.map((r, i) => (
            <li key={r.number} className={styles.row} data-row={i} data-active={i === row ? '' : undefined}>
              <Reveal className={styles.rowInner} stagger={0.07} y={20} amount={0.5}>
                <RowText i={i} />
                {i === SHARE_ROW ? <ShareBubble shown={tapped && row === SHARE_ROW && slide === SHARE_SLIDE} variant="row" /> : null}
              </Reveal>
            </li>
          ))}
        </ol>
        <div className={styles.tail} aria-hidden="true" />
      </div>
    </div>
  );
}
