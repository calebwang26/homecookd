'use client';
// Marker highlight (brief 5 "Highlighter").
//
//   <Highlighter>A handful.</Highlighter>                       // draws left→right (450ms) on first view
//   <Highlighter drawn={progress > 0.56}>A handful.</Highlighter> // controlled (instant CSS transition)
//   <Highlighter scrub ref={hlRef}>A handful.</Highlighter>   // scrub scenes:
//     tl.fromTo(hlRef.current, { '--hl': '0%' }, { '--hl': '100%' }, 52)   // GSAP drives --hl inline
//
// background-size is driven by the --hl custom property (default 100%).
// SSR / no-JS / reduced motion: fully drawn.
import { inView } from '@/lib/motion/lazy';
import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import styles from './Highlighter.module.css';

export interface HighlighterProps {
  children: ReactNode;
  /** controlled: true = drawn, false = empty. Omit to draw on first view. */
  drawn?: boolean;
  color?: 'highlighter' | 'lemon' | 'chartreuse' | 'sun';
  /** scrubbed by GSAP: no CSS transition; the static state is fully drawn */
  scrub?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
}

export function Highlighter({ children, drawn, scrub = false, color = 'highlighter', className, style, ref: outerRef }: HighlighterProps) {
  const ref = useRef<HTMLElement>(null);
  const controlled = drawn !== undefined || scrub;

  useEffect(() => {
    const el = ref.current;
    if (!el || controlled) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.drawn = '';
      return;
    }
    const stop = inView(el, () => {
      stop();
      el.dataset.drawn = '';
    }, { amount: 0.8 });
    return stop;
  }, [controlled]);

  return (
    <mark
      ref={(node) => {
        ref.current = node;
        if (typeof outerRef === 'function') outerRef(node);
        else if (outerRef) (outerRef as { current: HTMLElement | null }).current = node;
      }}
      className={[styles.hl, scrub ? styles.scrub : controlled ? styles.controlled : styles.auto, className].filter(Boolean).join(' ')}
      style={{ ['--hl-color' as string]: `var(--${color})`, ...style }}
      data-drawn={scrub ? '' : controlled ? (drawn ? '' : undefined) : undefined}
    >
      {children}
    </mark>
  );
}
