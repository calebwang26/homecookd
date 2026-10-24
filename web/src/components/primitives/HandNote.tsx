// Caveat margin note + hand-drawn arrow (brief 5 "HandNote"). Server-safe. 1–2 per screen at most.
//
//   <HandNote arrow="left" tone="cream">real screen recordings, straight off our phones</HandNote>
//   <HandNote arrow="down" tone="green" rotate={-3}>six recipes, three cooks, so far</HandNote>
//   <HandNote arrow="right" tone="chartreuse">they'll love being asked.</HandNote>
import type { CSSProperties, ReactNode } from 'react';
import styles from './HandNote.module.css';

export interface HandNoteProps {
  children: ReactNode;
  arrow?: 'left' | 'right' | 'down' | 'up';
  tone?: 'cocoa' | 'cream' | 'chartreuse' | 'green';
  rotate?: number;
  className?: string;
  style?: CSSProperties;
  as?: 'p' | 'span' | 'div';
}

// One curvy arrow drawn pointing right; rotated/flipped for the other directions.
const ARROW = 'M4 26c10-14 26-19 44-14M40 5.5l8.5 6.6-9.6 4.6';

export function HandNote({ children, arrow, tone = 'cocoa', rotate = -2, className, style, as: Tag = 'p' }: HandNoteProps) {
  return (
    <Tag
      className={[styles.note, styles[tone], arrow ? styles[`arrow_${arrow}`] : '', 't-hand', className].filter(Boolean).join(' ')}
      style={{ ['--rot' as string]: `${rotate}deg`, ...style }}
    >
      <span className={styles.text}>{children}</span>
      {arrow ? (
        <svg className={styles.arrow} viewBox="0 0 54 32" aria-hidden="true" focusable="false">
          <path d={ARROW} />
        </svg>
      ) : null}
    </Tag>
  );
}
