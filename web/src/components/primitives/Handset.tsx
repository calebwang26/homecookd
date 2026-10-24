'use client';
// A modern phone for the REAL screen recordings (titanium rim, black bezel, Dynamic Island,
// side buttons), optionally held in a real hand (a8 / VERO). Nothing is ever drawn on the screen.
//
//   <Handset width="300px"><AppClip … /></Handset>
//   <Handset width="300px" hand>{clips}</Handset>          // hand enters from the bottom-left
//
// The page's one phone (See it work, the recipe box, Questions), so every real recording sits in the
// same device. PhoneFrame's soft-white phone read as an illustration, and the hand-phone.png cutout is
// an iPhone 11 in a lavender bumper with a grey matte fringe on dark backgrounds. So this keeps the
// cutout's HAND only: a mirrored copy of hand-phone.png sits behind a CSS iPhone (same outline as the
// bumper, so the case never shows), its matte is choked 5px (no grey fringe on green; baked into
// hand-phone-choked.webp by scripts/media.mjs, since a live SVG filter crashed iPhones), and a
// second copy clipped to the thumb sits above the rim so the thumb overlaps the bezel.
//
// Geometry (all in % / cqw of the device width, measured from hand-phone.png, 1228×1789):
//   bumper outer box x 104–723.5, y 10–1212 → the device box is 620 px wide; the device keeps a
//   real iPhone aspect (620:1275) and its screen is inset 4.62cqw so the screen is exactly 780:1688.
import { useId, type CSSProperties, type ReactNode } from 'react';
import styles from './Handset.module.css';

export interface HandsetProps {
  children?: ReactNode;
  /** CSS length for the device width */
  width: string;
  hand?: boolean;
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Handset({ children, width, hand = false, shadow = true, className, style }: HandsetProps) {
  return (
    <div
      className={[styles.device, shadow ? styles.shadow : '', hand ? styles.held : '', className].filter(Boolean).join(' ')}
      style={{ ['--w' as string]: width, ...style }}
    >
      {hand ? <HeldHand layer="under" /> : null}
      <span className={styles.btnAction} aria-hidden="true" />
      <span className={styles.btnVolUp} aria-hidden="true" />
      <span className={styles.btnVolDown} aria-hidden="true" />
      <span className={styles.btnPower} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.screen}>{children}</div>
        <span className={styles.island} aria-hidden="true" />
      </div>
      {hand ? <HeldHand layer="thumb" /> : null}
    </div>
  );
}

const IMG = { src: '/media/_opt/stock/hand-phone-choked.webp', w: 1228, h: 1789 };

// The thumb's inner contour where it crosses the bumper (source px, before mirroring), nudged 1px
// into the thumb so no lavender anti-aliasing comes along. Right side closes outside the device.
const THUMB = [
  [740, 466],
  [719, 489],
  [713, 504],
  [709, 519],
  [709, 549],
  [712, 564],
  [715, 579],
  [714, 594],
  [715, 609],
  [724, 624],
  [729, 639],
  [736, 662],
  [790, 662],
  [790, 466],
]
  .map((p) => p.join(','))
  .join(' ');

/** The real hand from hand-phone.png, mirrored so it enters from the bottom-left. */
function HeldHand({ layer }: { layer: 'under' | 'thumb' }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clip = `thumb-${id}`;
  const mask = `nubs-${id}`;
  return (
    <svg
      className={[styles.hand, layer === 'thumb' ? styles.handThumb : ''].join(' ')}
      viewBox={`0 0 ${IMG.w} ${IMG.h}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {layer === 'thumb' ? (
          <clipPath id={clip} clipPathUnits="userSpaceOnUse">
            <polygon points={THUMB} />
          </clipPath>
        ) : (
          // The bumper's button nubs stick out past the device outline once mirrored: mask them.
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={IMG.w} height={IMG.h}>
            <rect width={IMG.w} height={IMG.h} fill="#fff" />
            <rect x="84" y="226" width="24" height="230" fill="#000" />
            <rect x="719" y="290" width="20" height="118" fill="#000" />
          </mask>
        )}
      </defs>
      <g clipPath={layer === 'thumb' ? `url(#${clip})` : undefined} mask={layer === 'under' ? `url(#${mask})` : undefined}>
        <image href={IMG.src} width={IMG.w} height={IMG.h} preserveAspectRatio="none" />
      </g>
    </svg>
  );
}
