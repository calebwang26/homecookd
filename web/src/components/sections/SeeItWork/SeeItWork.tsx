'use client';
// 8.6 See it work: the real app, in a hand, on ONE green (a8 + VERO's phone-in-hand).
//
// Three layouts, one section:
//   static  — the SSR / no-JS HTML and desktop reduced motion: intro + 4 rows, each with its own
//             phone (poster + ▶). Always the final, readable state.
//   desktop — ≥1024 × ≥600 with motion: sticky phone in a hand, rows scroll past (DesktopTour).
//   mobile  — < 1024 (or a short desktop): one phone + a 2×2 tablist (MobileTour); with reduced
//             motion the tabs still work, as instant swaps with posters.
import { useRef, useSyncExternalStore } from 'react';
import { useAudience } from '@/components/providers/CopyProvider';
import { useMotionOK, useReducedMotionPref } from '@/components/providers/MotionProvider';
import { DesktopTour } from './DesktopTour';
import { MobileTour } from './MobileTour';
import { StaticTour } from './StaticTour';
import { useNear } from './lazy';
import styles from './SeeItWork.module.css';

type Layout = 'static' | 'desktop' | 'mobile';

const MQ_WIDE = '(min-width: 1024px)';
const MQ_TALL = '(min-height: 600px)';

function subscribe(cb: () => void) {
  const a = matchMedia(MQ_WIDE);
  const b = matchMedia(MQ_TALL);
  a.addEventListener('change', cb);
  b.addEventListener('change', cb);
  return () => {
    a.removeEventListener('change', cb);
    b.removeEventListener('change', cb);
  };
}
const getWide = () => matchMedia(MQ_WIDE).matches && matchMedia(MQ_TALL).matches;

function useLayout(): Layout {
  const motionOK = useMotionOK();
  const reduced = useReducedMotionPref();
  // null on the server and during hydration → the static HTML
  const wide = useSyncExternalStore(subscribe, getWide, () => null);
  if (wide === null) return 'static';
  if (!wide) return 'mobile';
  return motionOK && !reduced ? 'desktop' : 'static';
}

export function SeeItWork() {
  const layout = useLayout();
  const reduced = useReducedMotionPref();
  // posters and recordings wait until the section is ~1.5 viewports away. /teach puts this section
  // right after How it works (FEEDBACK-OCT16b 3), under a screen below the hero, so there it waits
  // until ~0.6 viewports away: nothing downloads before the first scroll (npm run perf).
  const parent = useAudience() === 'parent';
  const ref = useRef<HTMLElement>(null);
  const near = useNear(ref, parent ? '60% 0px' : undefined);
  return (
    <section
      ref={ref}
      id="see-it-work"
      className={[styles.section, styles[`l_${layout}`], parent && styles.overSheet].filter(Boolean).join(' ')}
      data-theme="dark"
      data-layout={layout}
      aria-labelledby="see-it-work-title"
    >
      {layout === 'desktop' ? (
        <DesktopTour near={near} />
      ) : layout === 'mobile' ? (
        <MobileTour reduced={reduced} near={near} />
      ) : (
        <StaticTour near={near} />
      )}
    </section>
  );
}
