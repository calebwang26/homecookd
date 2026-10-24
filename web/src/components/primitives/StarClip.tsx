'use client';
// 8-point star photo cut-out (brief 5 "StarClip", secondary spec 4.5).
//
//   <StarClip image={PHOTOS.grandpaGrandson.src} alt={PHOTOS.grandpaGrandson.alt} size="25vw" rotate={-8} />
//   <StarClip image={PHOTOS.abuelaTortillas.src} alt="…" size="25vw" rotate={12} ring="sun" focus="45% 35%" />
//   <StarClip image={…} alt="…" size="clamp(140px, 40vw, 220px)" rotate={-8} popOut={{ src: '/media/…png', alt: '' }} />
//
// Enter: scale .6 → 1, rotate −20° → final, 900ms expo, once (after `delay`). Static: final rotation.
// enter="fade" (the parent version, /teach): a plain fade-up of 20px at its final rotation instead.
import { animate, inView } from 'motion';
import { useEffect, useRef, type CSSProperties } from 'react';
import { EASE } from '@/lib/motion/tokens';
import { Img } from './Img';
import styles from './StarClip.module.css';

export const starClip = (n = 8, inner = 0.62, rot = 0): string =>
  'polygon(' +
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? 50 * inner : 50;
    const a = (Math.PI * i) / n - Math.PI / 2 + (rot * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`;
  }).join(',') +
  ')';

const STAR = starClip(8, 0.62, 0);

export interface StarClipProps {
  image: string;
  alt: string;
  /** CSS length (e.g. '25vw', '220px') */
  size: string;
  rotate?: number;
  ring?: 'sun' | 'chartreuse' | null;
  popOut?: { src: string; alt: string };
  focus?: string;
  /** image sizes hint */
  sizes?: string;
  delay?: number;
  /** 'spin' (default): the scale + rotate entrance; 'fade': opacity and a 20px rise only */
  enter?: 'spin' | 'fade';
  className?: string;
  style?: CSSProperties;
}

export function StarClip({ image, alt, size, rotate = 0, ring = null, popOut, focus, sizes, delay = 0, enter = 'spin', className, style }: StarClipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const stop = inView(el, () => {
      stop();
      if (enter === 'fade') {
        const at = (y: number) => `translateY(${y}px) rotate(${rotate}deg)`;
        el.style.transform = at(20);
        el.style.opacity = '0';
        el.dataset.revealed = '';
        animate(el, { opacity: [0, 1], transform: [at(20), at(0)] }, { duration: 0.8, delay, ease: EASE.soft });
        return;
      }
      el.style.transform = `rotate(-20deg) scale(0.6)`;
      el.style.opacity = '0';
      el.dataset.revealed = '';
      animate(el, { rotate: [-20, rotate], scale: [0.6, 1], opacity: [0, 1] }, { duration: 0.9, delay, ease: EASE.expo, opacity: { duration: 0.3, delay } });
    }, { amount: 0.3 });
    return stop;
  }, [rotate, delay, enter]);

  return (
    <div
      ref={ref}
      className={[styles.star, className].filter(Boolean).join(' ')}
      style={{ ['--size' as string]: size, ['--rotate' as string]: `${rotate}deg`, ['--clip' as string]: STAR, ...style }}
      data-ring={ring ?? undefined}
    >
      {ring ? <span className={styles.ring} aria-hidden="true" /> : null}
      <div className={styles.clip}>
        <Img src={image} alt={alt} fill sizes={sizes ?? size} focus={focus} />
      </div>
      {popOut ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.popOut} src={popOut.src} alt={popOut.alt} />
      ) : null}
    </div>
  );
}
