// Phone for the REAL screen recordings only (brief 5 "PhoneFrame"). Never put drawn app UI in it.
// Server-safe.
//
//   <PhoneFrame width="clamp(260px, 21vw, 330px)"><AppClip name="web-miss" playWhenVisible label={APP_CLIPS['web-miss'].label} /></PhoneFrame>
//   <PhoneFrame width="300px" hand>…</PhoneFrame>      // a8 hand cutout (HAND_PHONE); the hand bleeds off the bottom-right
//   <PhoneFrame width="240px" tilt={-4} shadow={false}>…</PhoneFrame>
//
// `width` is the phone body's width in both modes, so layouts don't change when the hand is on.
// Default: a soft-white CSS phone (bezel --surface ≈10px at 300px, 1px hairline, radius 13.5%/6.2%,
// a small black dynamic-island pill, hairline side buttons); the screen is 780:1688 like the recordings.
// The screen is an inline-size container, so anything inside can size itself in cqw.
// Hand mode: the PNG sits ABOVE the screen so the fingers overlap the bezel; the screen is placed
// at HAND_PHONE.screen. The hand image overflows the box to the right and bottom; let your stage clip it.
import type { CSSProperties, ReactNode } from 'react';
import { HAND_PHONE } from '@/content/media';
import { Img } from './Img';
import styles from './PhoneFrame.module.css';

export interface PhoneFrameProps {
  children?: ReactNode;
  /** CSS length for the phone body width */
  width: string;
  hand?: boolean;
  /** degrees */
  tilt?: number;
  shadow?: boolean;
  className?: string;
  screenClassName?: string;
  style?: CSSProperties;
}

/**
 * A `sizes` value for an image `factor` × the phone width. The sizes attribute can't reliably take
 * clamp()/min()/var() everywhere, so those resolve to their largest px value (the upper bound).
 */
export function phoneSizes(width: string, factor = 1): string {
  const w = width.trim();
  const unit = /^([\d.]+)(px|vw|rem)$/.exec(w);
  if (unit) {
    const v = parseFloat(unit[1]) * factor;
    return unit[2] === 'rem' ? `${Math.round(v * 16)}px` : `${Math.round(v * 100) / 100}${unit[2]}`;
  }
  const px = Array.from(w.matchAll(/([\d.]+)px/g), (m) => parseFloat(m[1]));
  return `${Math.round((px.length ? Math.max(...px) : 360) * factor)}px`;
}

export function PhoneFrame({ children, width, hand = false, tilt = 0, shadow = true, className, screenClassName, style }: PhoneFrameProps) {
  const H = hand ? HAND_PHONE : null;

  if (H) {
    // Size the whole image from the phone-body width; position it so the body box = our box.
    const imgW = 100 / (H.body.width / 100); // % of our width
    const bodyAspect = (H.body.width * H.width) / (H.body.height * H.height); // body w / h
    const toBodyX = (pct: number) => ((pct - H.body.left) / H.body.width) * 100;
    const toBodyY = (pct: number) => ((pct - H.body.top) / H.body.height) * 100;
    const scr = {
      left: toBodyX(parseFloat(H.screen.left)),
      top: toBodyY(parseFloat(H.screen.top)),
      width: (parseFloat(H.screen.width) / H.body.width) * 100,
      height: (parseFloat(H.screen.height) / H.body.height) * 100,
    };
    return (
      <div
        className={[styles.phone, styles.hand, shadow ? styles.handShadow : '', className].filter(Boolean).join(' ')}
        style={{
          ['--w' as string]: width,
          ['--tilt' as string]: `${tilt + H.rotate}deg`,
          aspectRatio: `${bodyAspect}`,
          ...style,
        }}
      >
        <div
          className={[styles.handScreen, screenClassName].filter(Boolean).join(' ')}
          style={{
            left: `${scr.left - 0.8}%`,
            top: `${scr.top - 0.4}%`,
            width: `${scr.width + 1.6}%`,
            height: `${scr.height + 0.8}%`,
            borderRadius: H.radius,
          }}
        >
          {children}
        </div>
        <div
          className={styles.handImg}
          style={{
            width: `${imgW}%`,
            left: `${-(H.body.left / H.body.width) * 100}%`,
            top: `${-(H.body.top / H.body.height) * 100}%`,
            aspectRatio: `${H.width} / ${H.height}`,
          }}
          aria-hidden="true"
        >
          <Img src={H.src} alt="" fill sizes={phoneSizes(width, imgW / 100)} style={{ objectFit: 'contain' }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[styles.phone, styles.css, shadow ? styles.shadow : '', className].filter(Boolean).join(' ')}
      style={{ ['--w' as string]: width, ['--tilt' as string]: `${tilt}deg`, ...style }}
    >
      <div className={[styles.screen, screenClassName].filter(Boolean).join(' ')}>{children}</div>
      <span className={styles.island} aria-hidden="true" />
    </div>
  );
}
