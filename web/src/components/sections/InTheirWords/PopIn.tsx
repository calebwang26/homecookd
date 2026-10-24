'use client';
// Local one-shot "sticker slap" for a seal or chip: scale .4 → 1 and a quarter turn of rotation
// settling to rest, once, when it enters the viewport. Used for the "Coming to the app" seal (B5).
// SSR / no-JS / reduced motion: final (the hidden state only exists under html[data-motion="on"]).
import { animate, inView } from 'motion';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { EASE } from '@/lib/motion/tokens';
import s from './PopIn.module.css';

export interface PopInProps {
  children: ReactNode;
  delay?: number;
  /** starting extra rotation in degrees (settles to 0) */
  from?: number;
  className?: string;
  style?: CSSProperties;
  amount?: number;
}

export function PopIn({ children, delay = 0, from = -40, className, style, amount = 0.6 }: PopInProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const stop = inView(
      el,
      () => {
        stop();
        el.style.opacity = '0';
        el.dataset.revealed = '';
        animate(
          el,
          { scale: [0.4, 1], rotate: [from, 0], opacity: [0, 1] },
          { duration: 0.9, delay, ease: EASE.expo, opacity: { duration: 0.25, delay } },
        );
      },
      { amount },
    );
    return stop;
  }, [delay, from, amount]);

  return (
    <span ref={ref} className={[s.pop, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </span>
  );
}
