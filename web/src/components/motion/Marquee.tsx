// CSS-only marquee (brief 5 "Marquee"). Server-safe.
//
//   <Marquee label={copy.measures.marqueeLabel} durationSec={50} gap="0.6em">
//     {phrases.map((p) => <span key={p.text}>{p.text}</span>)}
//   </Marquee>
//
// A duplicated track slides translateX(-50%) forever; the copy is aria-hidden and the `label` is
// rendered visually hidden (the first copy stays readable). Pauses on hover / focus-within and
// with the global PauseProvider (html[data-paused]). Reduced motion: no movement; the row becomes
// horizontally scrollable with scroll-snap.
import type { CSSProperties, ReactNode } from 'react';
import styles from './Marquee.module.css';

export interface MarqueeProps {
  children: ReactNode;
  durationSec?: number;
  direction?: 'left' | 'right';
  /** gap between items (and after the last item, so the loop is seamless) */
  gap?: string;
  /** fade the left/right edges */
  mask?: boolean;
  pauseOnHover?: boolean;
  /** accessible name of the row */
  label: string;
  className?: string;
  trackClassName?: string;
  style?: CSSProperties;
}

export function Marquee({
  children,
  durationSec = 45,
  direction = 'left',
  gap = '2rem',
  mask = true,
  pauseOnHover = true,
  label,
  className,
  trackClassName,
  style,
}: MarqueeProps) {
  return (
    <div
      className={[styles.root, mask ? styles.mask : '', pauseOnHover ? styles.hoverPause : '', className].filter(Boolean).join(' ')}
      style={{ ['--dur' as string]: `${durationSec}s`, ['--gap' as string]: gap, ...style }}
      data-direction={direction}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <div className={[styles.track, trackClassName].filter(Boolean).join(' ')} data-loop="">
        <div className={styles.group}>{children}</div>
        <div className={styles.group} aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
