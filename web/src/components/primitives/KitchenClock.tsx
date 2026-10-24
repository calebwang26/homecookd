// Caveat "kitchen clock" timestamp (brief 5 "KitchenClock"). Server-safe. Never essential info.
//
//   <KitchenClock time="Sun, 11:10 pm" />                          // cocoa on light
//   <KitchenClock time={copy.finalCta.clock} tone="chartreuse" /> // on forest
//   <KitchenClock time={copy.farApart.left.clock} tone="cream" /> // on photos
import type { CSSProperties } from 'react';
import styles from './KitchenClock.module.css';

export interface KitchenClockProps {
  time: string;
  tone?: 'cocoa' | 'cream' | 'chartreuse' | 'green';
  className?: string;
  style?: CSSProperties;
  as?: 'p' | 'span' | 'div';
}

export function KitchenClock({ time, tone = 'cocoa', className, style, as: Tag = 'p' }: KitchenClockProps) {
  return (
    <Tag className={[styles.clock, styles[tone], 't-hand', className].filter(Boolean).join(' ')} style={style}>
      <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.2c4.9-.2 8.7 3.6 8.8 8.6.1 5-3.8 8.9-8.7 9-5 .1-8.9-3.9-8.9-8.8 0-4.6 3.6-8.6 8.8-8.8z" />
        <path d="M12.1 7.3l-.1 5 3.3 2.1" />
      </svg>
      <span>{time}</span>
    </Tag>
  );
}
