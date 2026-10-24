'use client';
// Mobile and tablet (< 1024, or a short desktop): one phone, a 2×2 tablist, one panel.
// Clips don't loop while touring: each recording's end advances to the next tab, one full cycle,
// then it rests on tab 4. Playback (and so the tour) only runs while the phone is ≥ 50% visible,
// and the PauseButton / global pause stops it. Any tap or key press stops the tour for good.
// Reduced motion: no tour, no crossfade, posters with a ▶ (AppClip's manual mode), the ▶ outside
// the phone at its lower-right corner (OuterPlay).
import { animate } from 'motion';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { useFill } from '@/components/providers/RelationProvider';
import { Reveal } from '@/components/motion/Reveal';
import { PauseButton } from '@/components/providers/PauseProvider';
import { Pill } from '@/components/primitives/Pill';
import { EASE } from '@/lib/motion/tokens';
import { ClipStack } from './ClipStack';
import { Handset } from '@/components/primitives/Handset';
import { Intro } from './Intro';
import { OuterPlay, PLAY_HOST } from './OuterPlay';
import { Ribbon } from './Ribbon';
import { ShareBubble } from './ShareBubble';
import { saveData } from './lazy';
import { ROW_COUNT, ROW_SLIDES, SHARE_ROW, WATCH_ROW, nextInRow, rowOfSlide, shareText, singleClipRow } from './tour';
import styles from './SeeItWork.module.css';

export function MobileTour({ reduced, near }: { reduced: boolean; near: boolean }) {
  const copy = useCopy();
  const f = useFill(); // rows may carry person tokens ({kids}, {her})
  const c = copy.seeItWork;
  const ROWS = c.rows;
  const uid = useId();
  // reduced motion or Save-Data: no tour, nothing preloads, posters with a ▶
  const [save] = useState(saveData);
  const lean = reduced || save;
  const [tab, setTab] = useState(0);
  const [slide, setSlide] = useState(0);
  const [touring, setTouring] = useState(!lean);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = useCallback((i: number, byUser: boolean) => {
    setTab(i);
    setSlide(ROW_SLIDES[i][0]);
    if (byUser) setTouring(false);
  }, []);

  // While touring nothing loops; afterwards a one-recording tab loops it and a multi-recording
  // tab keeps chaining its recordings.
  const loop = useCallback((s: number) => !touring && singleClipRow(s), [touring]);
  const onEnded = useCallback(
    (s: number) => {
      const n = nextInRow(s);
      if (n !== null) return setSlide(n); // the next recording in this tab
      const r = rowOfSlide(s);
      if (r === ROW_COUNT - 1) {
        if (touring) return setTouring(false); // one full cycle: rest on tab 4
        return setSlide(ROW_SLIDES[r][0]);
      }
      if (touring) select(r + 1, false);
    },
    [touring, select],
  );

  // the phone settles .985 → 1 on every swap (motion only)
  const settleRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || reduced) {
      first.current = false;
      return;
    }
    const el = settleRef.current;
    if (!el) return;
    const a = animate(el, { scale: [0.985, 1] }, { duration: 0.45, ease: EASE.soft });
    return () => a.stop();
  }, [slide, reduced]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = ROWS.length;
    const map: Record<string, number> = { ArrowRight: tab + 1, ArrowDown: tab + 1, ArrowLeft: tab - 1, ArrowUp: tab - 1, Home: 0, End: n - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const i = (map[e.key] + n) % n;
    select(i, true);
    tabRefs.current[i]?.focus();
  };

  const row = ROWS[tab];
  const panelId = `${uid}-panel`;

  return (
    <div className={styles.mob}>
      <Intro arrow="right" className={styles.introMob} />

      <div className={[styles.mStage, lean ? styles.mStageLean : ''].filter(Boolean).join(' ')}>
        <div className={styles.blob} aria-hidden="true" />
        <Ribbon className={styles.ribbonMob} />
        <Reveal y="6vh" zoomImages={false} amount={0.2} className={styles.mPhone}>
          <div ref={settleRef} className={[styles.phoneSettle, PLAY_HOST].join(' ')}>
            <Handset width="var(--phone-w)" hand>
              <ClipStack slide={slide} loop={loop} onEnded={onEnded} instant={reduced} near={near} lean={lean} />
            </Handset>
          </div>
          {/* outside phoneSettle: its hand mask applies to every svg inside it */}
          {lean ? <OuterPlay scope={settleRef} watch={slide} className={styles.posterPlay} /> : null}
        </Reveal>
        <PauseButton
          variant="cream"
          size={48}
          className={styles.mPause}
          labels={{ pause: c.pauseTabs, play: c.playTabs }}
        />
      </div>

      <div role="tablist" aria-label={c.tablistLabel} className={styles.tabs} onKeyDown={onKey}>
        {ROWS.map((r, i) => (
          <button
            key={r.number}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${i}`}
            aria-selected={i === tab}
            aria-controls={panelId}
            tabIndex={i === tab ? 0 : -1}
            className={styles.tab}
            onClick={() => select(i, true)}
          >
            <span className={styles.tabNum} aria-hidden="true">
              {r.number}
            </span>
            <span className={styles.tabLabel}>{r.tab}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${uid}-tab-${tab}`} className={styles.panel}>
        <h3 className="sr-only">{row.title}</h3>
        <p className={`t-body ${styles.panelBody}`}>
          {f(row.body)}
          {tab === SHARE_ROW ? <span className="sr-only"> {shareText(copy).sr}</span> : null}
        </p>
        {tab === SHARE_ROW ? (
          // the share payload says more than the chip here, and keeps the panel short
          <ShareBubble shown variant="panel" />
        ) : (
          <div className={styles.panelMeta}>
            {/* the cook-it row's "Watch · …" is a plain caption, not a button-looking chip (QA B25) */}
            {tab === WATCH_ROW ? <span className={styles.caption}>{row.chip}</span> : <Pill tone="outlineCream">{row.chip}</Pill>}
          </div>
        )}
      </div>
    </div>
  );
}
