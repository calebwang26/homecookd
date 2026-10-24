'use client';
// Fade-and-rise once on enter (brief 5 "Reveal"). 800ms soft ease; images inside go scale 1.04 → 1.
//
//   <Reveal><p className="t-body">…</p></Reveal>
//   <Reveal as="ul" stagger={0.08} y={40}>
//     <li data-reveal-item>…</li><li data-reveal-item>…</li>
//   </Reveal>
//   <Reveal y="8vh">{phone}</Reveal>           // any CSS length works for y
//
// SSR / no-JS / reduced motion: final. The hidden state exists only under html[data-motion="on"].
import { animate, inView } from 'motion';
import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { EASE } from '@/lib/motion/tokens';
import styles from './motion.module.css';

export interface RevealProps {
  as?: ElementType;
  children?: ReactNode;
  /** rise distance: px number or any CSS length */
  y?: number | string;
  delay?: number;
  /** when set, animates the children marked [data-reveal-item] with this stagger (s) instead of the root */
  stagger?: number;
  amount?: number;
  duration?: number;
  /** scale images inside from 1.04 → 1 (default true) */
  zoomImages?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  onReveal?: () => void;
  [data: `data-${string}`]: unknown;
}

export function Reveal({
  as: Tag = 'div',
  children,
  y = 24,
  delay = 0,
  stagger,
  amount = 0.35,
  duration = 0.8,
  zoomImages = true,
  className,
  style,
  id,
  onReveal,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const yCss = typeof y === 'number' ? `${y}px` : y;
  const onRevealRef = useRef(onReveal);
  useEffect(() => {
    onRevealRef.current = onReveal;
  }, [onReveal]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const play = () => {
      const targets = stagger !== undefined ? Array.from(el.querySelectorAll<HTMLElement>('[data-reveal-item]')) : [el];
      for (const t of targets) {
        t.style.opacity = '0';
        t.style.transform = `translate3d(0, ${yCss}, 0)`;
      }
      el.dataset.revealed = '';
      onRevealRef.current?.();
      targets.forEach((t, i) => {
        const d = delay + (stagger ?? 0) * i;
        animate(t, { opacity: [0, 1], transform: [`translate3d(0, ${yCss}, 0)`, 'translate3d(0, 0px, 0)'] }, { duration, delay: d, ease: EASE.soft }).finished.then(() => {
          t.style.transform = '';
          t.style.opacity = '';
        });
        if (zoomImages) {
          const imgs = t.querySelectorAll<HTMLElement>('img, video');
          if (imgs.length) animate(Array.from(imgs), { scale: [1.04, 1] }, { duration: duration * 1.4, delay: d, ease: EASE.soft });
        }
      });
    };
    const stop = inView(el, () => {
      stop();
      play();
    }, { amount });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      className={[styles.reveal, className].filter(Boolean).join(' ')}
      style={{ ['--reveal-y' as string]: yCss, ...style }}
      data-reveal-stagger={stagger !== undefined ? '' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
