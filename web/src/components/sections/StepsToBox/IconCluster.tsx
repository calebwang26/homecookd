'use client';
// a7 M14 icon cluster: kitchen line icons in white circles spawn as dots at scattered spots and
// drift into a loose cluster (motion, 40ms stagger, 600ms, once on enter). Decorative.
// Static (SSR, reduced motion, no JS): the settled cluster. Mobile shows the first 6.
import { animate, inView } from 'motion';
import { useEffect, useRef, type CSSProperties } from 'react';
import { KitchenIcon, type KitchenIconName } from '@/components/icons/Icons';
import { seeded } from '@/lib/deck/layouts';
import { EASE } from '@/lib/motion/tokens';
import styles from './StepsToBox.module.css';

// [icon, desktop x, y (px in a 348×214 box, scaled down in a narrower column), mobile x, y (52px bubbles in a 302×66 wave; first 6 only), rotate°]
const ICONS: [KitchenIconName, number, number, number, number, number][] = [
  ['whisk', 34, 0, 0, 10, -8],
  ['wooden-spoon', 0, 78, 50, 0, 10],
  ['pot', 84, 62, 100, 12, -4],
  ['chili', 168, 26, 150, 2, 9],
  ['garlic', 262, 58, 200, 14, -10],
  ['flame', 40, 150, 250, 4, 6],
  ['timer', 126, 142, 0, 0, -7],
  ['rolling-pin', 212, 118, 0, 0, 8],
  ['ladle', 284, 150, 0, 0, -5],
];

export function IconCluster({ className }: { className?: string }) {
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
    const rand = seeded(11);
    const stop = inView(
      el,
      () => {
        stop();
        const bubbles = Array.from(el.querySelectorAll<HTMLElement>('[data-bubble]'));
        bubbles.forEach((b) => {
          b.style.opacity = '0';
        });
        el.dataset.revealed = '';
        bubbles.forEach((b, i) => {
          const dx = (rand() - 0.5) * 140;
          const dy = (rand() - 0.5) * 110;
          animate(
            b,
            { opacity: [0, 1], x: [dx, 0], y: [dy, 0], scale: [0.14, 1] },
            { duration: 0.6, delay: i * 0.04, ease: EASE.expo, opacity: { duration: 0.25, delay: i * 0.04 } },
          ).finished.then(() => {
            b.style.transform = '';
            b.style.opacity = '';
          });
        });
      },
      { amount: 0.5 },
    );
    return stop;
  }, []);

  return (
    <div ref={ref} className={[styles.cluster, className].filter(Boolean).join(' ')} aria-hidden="true">
      {ICONS.map(([name, x, y, mx, my, r]) => (
        <span
          key={name}
          className={styles.bubble}
          data-bubble=""
          style={{ '--x': x, '--y': y, '--mx': `${mx}px`, '--my': `${my}px`, '--r': `${r}deg` } as CSSProperties}
        >
          <KitchenIcon name={name} size={30} />
        </span>
      ))}
    </div>
  );
}
