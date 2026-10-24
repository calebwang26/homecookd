// VERO scalloped seal (brief 5 "Sticker", secondary spec 4.5). Server-safe.
//
//   <Sticker lines={['Coming to', 'the app']} tone="sunOnCream" size={150} />
//   <Sticker lines={['Free', 'Early access']} tone="chartreuseOnForest" size={160} rotate={10} />
//   <Sticker lines={["That's", 'it.']} tone="creamOnSun" size={120} spin={false} />
//
// A cream disc holds a wavy seal: r(θ) = R·(1 − .07·(.5 − .5·cos(16θ))), 360 points. The ring
// spins 24s/turn (CSS, stopped by PauseProvider and reduced motion) while the text stays still.
// Text: Fraunces 800 uppercase 16px (scales with size). aria-label = the joined lines.
import type { CSSProperties } from 'react';
import styles from './Sticker.module.css';

export type StickerTone = 'sunOnCream' | 'chartreuseOnForest' | 'creamOnSun';

export interface StickerProps {
  lines: readonly [string, string?] | readonly string[];
  tone?: StickerTone;
  size?: number;
  spin?: boolean;
  rotate?: number;
  className?: string;
  style?: CSSProperties;
  /** render decorative (aria-hidden) when the same words exist elsewhere */
  decorative?: boolean;
}

/** Wavy seal path in a 200×200 box (R = 100 · .86 of the disc). */
export function sealPath(R = 86, bumps = 16, depth = 0.07, points = 360): string {
  const c = 100;
  let d = '';
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    const r = R * (1 - depth * (0.5 - 0.5 * Math.cos(bumps * t)));
    const x = c + r * Math.cos(t);
    const y = c + r * Math.sin(t);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

const SEAL = sealPath();

export function Sticker({ lines, tone = 'sunOnCream', size = 170, spin = true, rotate = -8, className, style, decorative = false }: StickerProps) {
  const text = lines.filter(Boolean) as string[];
  return (
    <span
      className={[styles.sticker, styles[tone], className].filter(Boolean).join(' ')}
      style={{ ['--size' as string]: `${size}px`, ['--rotate' as string]: `${rotate}deg`, ...style }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : text.join(' ')}
      aria-hidden={decorative ? true : undefined}
    >
      <svg className={[styles.ring, spin ? styles.spin : ''].join(' ')} viewBox="0 0 200 200" aria-hidden="true" focusable="false" data-loop={spin ? '' : undefined}>
        <circle cx="100" cy="100" r="99" className={styles.disc} />
        <path d={SEAL} className={styles.seal} />
        <circle cx="100" cy="100" r="66" className={styles.inner} />
      </svg>
      <span className={styles.text} aria-hidden="true">
        {text.map((l, i) => (
          <span key={i} className={styles.line}>
            {l}
          </span>
        ))}
      </span>
    </span>
  );
}
