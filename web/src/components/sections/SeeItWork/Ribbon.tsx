'use client';
// a8's tone-on-tone ribbon: one broad (~48px) looping band in --green-swirl behind the phone.
// It draws itself in once when the stage enters (stroke-dashoffset, 2.4s). SSR, no-JS and reduced
// motion show it fully drawn (the hidden state lives under html[data-motion="on"] only).
import { inView } from 'motion';
import { useEffect, useRef } from 'react';
import styles from './SeeItWork.module.css';

/** viewBox 0 0 1000 1000, stretched to the stage; the stroke stays 48px (non-scaling). */
const PATH =
  'M -80 230 C 160 90, 620 40, 820 210 C 1010 370, 900 650, 640 700 C 420 742, 250 640, 270 480 C 292 300, 560 300, 640 470 C 730 660, 560 900, 330 1080';

export function Ribbon({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.documentElement.dataset.motion !== 'on' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.dataset.drawn = '';
      return;
    }
    const stop = inView(el, () => {
      el.dataset.drawn = '';
      stop();
    }, { amount: 0.25 });
    return stop;
  }, []);
  return (
    <svg ref={ref} className={[styles.ribbon, className].filter(Boolean).join(' ')} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={PATH} pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
