'use client';
// The fake physics drop (brief 8.10, a7 M22): 12 ingredient stickers (8 on phones) stream in under
// the marquee 80ms apart, fall with gravity, bounce twice (restitution .35), roll into a
// precomputed pile along the panel floor, then the pot mascot drops last and says "you've got this!".
//
// Deterministic and once. Every sticker is absolutely positioned at its FINAL spot in CSS, so SSR,
// reduced motion and no-JS show the finished pile; the drop only animates transforms back to zero.
// `still` (the parent version, /teach): no drop; the resting pile fades up once, then the chip shows.
import { animate, inView } from 'motion';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { Chip } from '@/components/primitives/Chip';
import { EggMascot } from '@/components/primitives/EggMascot';
import { EASE } from '@/lib/motion/tokens';
import { Ingredient } from './stickers/Ingredients';
import { PILE_DESKTOP, PILE_MOBILE, type PileItem } from './pileData';
import s from './Measures.module.css';

/** position: t² (gravity, from rest) and its mirror (rising to an apex) as cubic beziers */
const FALL = [0.333, 0, 0.667, 0.333] as const;
const RISE = [0.333, 0.667, 0.667, 1] as const;
const STREAM = 0.08; // s between spawns
const RESTITUTION = 0.35;

interface DropOpts {
  /** fall distance (px) */
  d: number;
  /** horizontal roll-in distance (px) */
  drift: number;
  /** start rotation offset (deg) */
  spin: number;
  delay: number;
  g: number;
  e: number;
}

/** Returns the time (s, from now) at which the element first touches down, and when it settles. */
function drop(el: HTMLElement, { d, drift, spin, delay, g, e }: DropOpts): { land: number; settle: number } {
  const t0 = Math.sqrt((2 * d) / g);
  const t1 = e * t0;
  const t2 = e * e * t0;
  const h1 = e * e * d;
  const h2 = e ** 4 * d;
  const T = t0 + 2 * t1 + 2 * t2;
  const times = [0, t0, t0 + t1, t0 + 2 * t1, t0 + 2 * t1 + t2, T].map((v) => v / T);
  const r = parseFloat(el.dataset.r ?? '0');

  animate(el, { opacity: [0, 1], scale: [0.55, 1] }, { duration: 0.24, delay, ease: EASE.expo });
  animate(el, { y: [-d, 0, -h1, 0, -h2, 0] }, { duration: T, delay, times, ease: [FALL, RISE, FALL, RISE, FALL] as never });
  animate(el, { x: [-drift, 0] }, { duration: T, delay, ease: [0.3, 0.5, 0.3, 1] });
  animate(el, { rotate: [r - spin, r] }, { duration: T * 1.08, delay, ease: [0.2, 0.6, 0.3, 1] });
  return { land: delay + t0, settle: delay + T };
}

function itemStyle(it: PileItem): CSSProperties {
  return {
    ['--x' as string]: it.x,
    ['--y' as string]: it.y,
    ['--r' as string]: `${it.r}deg`,
  };
}

export function Pile({ spawnFrom, still = false }: { spawnFrom: RefObject<HTMLElement | null>; still?: boolean }) {
  const copy = useCopy();
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const squashRef = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      root.dataset.revealed = '';
      return;
    }
    const timers: number[] = [];

    // the parent version: the pile is already resting; it fades up 16px as one, once
    const fadeIn = () => {
      root.dataset.revealed = '';
      const els = [...Array.from(root.querySelectorAll<HTMLElement>('[data-item]')), ...(mascotRef.current ? [mascotRef.current] : [])];
      els.forEach((el) => {
        const r = parseFloat(el.dataset.r ?? '0');
        el.style.opacity = '0';
        animate(el, { opacity: [0, 1], y: [16, 0], rotate: [r, r] }, { duration: 0.8, ease: EASE.soft });
      });
      timers.push(window.setTimeout(() => setLanded(true), 700));
    };

    const play = () => {
      const items = Array.from(root.querySelectorAll<HTMLElement>('[data-item]')).filter((el) => el.offsetParent !== null);
      const mascot = mascotRef.current;
      const rootRect = root.getBoundingClientRect();
      const H = rootRect.height;
      const vw = window.innerWidth / 100;
      const spawnEl = spawnFrom.current;
      const spawnTop = spawnEl ? spawnEl.getBoundingClientRect().bottom - rootRect.top - 8 : H * 0.18;
      // gravity tuned so a fall of 62% of the panel takes ~0.6s (a7 lands in ~1.5s total)
      const g = (2 * 0.62 * H) / (0.6 * 0.6);

      // pin the start pose, then release the CSS gate
      for (const el of [...items, ...(mascot ? [mascot] : [])]) el.style.opacity = '0';
      root.dataset.revealed = '';

      let lastSettle = 0;
      items.forEach((el, i) => {
        const d = Math.max(el.offsetTop - spawnTop, 24);
        const { settle } = drop(el, {
          d,
          drift: parseFloat(el.dataset.drift ?? '2') * vw,
          spin: parseFloat(el.dataset.spin ?? '90'),
          delay: 0.05 + i * STREAM,
          g,
          e: RESTITUTION,
        });
        lastSettle = Math.max(lastSettle, settle);
      });

      if (mascot) {
        const delay = 0.05 + items.length * STREAM + 0.32;
        const d = Math.max(mascot.offsetTop - spawnTop + mascot.offsetHeight * 0.2, 24);
        const { land } = drop(mascot, { d, drift: parseFloat(mascot.dataset.drift ?? '2') * vw, spin: -24, delay, g, e: 0.28 });
        const squash = squashRef.current;
        if (squash) {
          animate(
            squash,
            { scaleY: [1, 0.82, 1.06, 0.98, 1], scaleX: [1, 1.14, 0.96, 1.01, 1] },
            { duration: 0.6, delay: land - 0.01, ease: 'easeOut' },
          );
        }
        timers.push(window.setTimeout(() => setLanded(true), (land + 0.32) * 1000));
      }
    };

    const stop = inView(
      sentinel,
      () => {
        stop();
        if (still) fadeIn();
        else play();
      },
      { amount: 0.8 },
    );
    return () => {
      stop();
      timers.forEach(clearTimeout);
    };
  }, [spawnFrom, still]);

  return (
    <div ref={rootRef} className={s.pile} aria-hidden="true">
      <div ref={sentinelRef} className={s.sentinel} />
      {PILE_DESKTOP.map((it) => (
        <div
          key={`d-${it.id}`}
          className={[s.sticker, s.desk].join(' ')}
          data-item=""
          data-anchor={it.anchor}
          data-r={it.r}
          data-spin={it.spin}
          data-drift={it.drift}
          style={itemStyle(it)}
        >
          <Ingredient id={it.id} className={s.art} />
        </div>
      ))}
      {PILE_MOBILE.map((it) => (
        <div
          key={`m-${it.id}`}
          className={[s.sticker, s.mob].join(' ')}
          data-item=""
          data-anchor={it.anchor}
          data-r={it.r}
          data-spin={it.spin}
          data-drift={it.drift}
          style={itemStyle(it)}
        >
          <Ingredient id={it.id} className={s.art} />
        </div>
      ))}

      <div ref={mascotRef} className={s.mascot} data-r="0" data-drift="2">
        <div ref={squashRef} className={s.squash}>
          <EggMascot size={120} mood={landed ? 'made-it' : 'hello'} className={s.mascotSvg} />
        </div>
      </div>
      {copy.measures.mascotChip ? (
        <div className={s.mascotChip}>
          <Chip tone="cream" tail="br" shown={landed} rotate={-5} aria-hidden>
            {copy.measures.mascotChip}
          </Chip>
        </div>
      ) : null}
    </div>
  );
}
