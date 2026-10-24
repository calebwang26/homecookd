// Small non-interactive labels (brief 5 "Pill"): "▶ Watch", "● REC 0:42", "♥ Saved",
// "Lean it on anything", the moon chip. No hover, cursor default.
//
//   <Pill tone="white85" icon={<PlayIcon size={14} />}>Watch</Pill>
//   <Pill tone="rec">REC 0:42</Pill>                     // red pulsing dot is built in
//   <Pill tone="lavender" icon={<MoonIcon size={16} />}>All-day dish? Record in pieces.</Pill>
//   <Pill tone="outlineCream">For the one who cooks</Pill>
import type { CSSProperties, ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'white85' | 'sage' | 'lemon' | 'lavender' | 'rec' | 'outlineCream' | 'outlineInk' | 'chartreuse';

export interface PillProps {
  tone?: PillTone;
  icon?: ReactNode;
  children: ReactNode;
  /** compact (decorative cards) uses container-relative sizing */
  size?: 'md' | 'sm';
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean;
}

export function Pill({ tone = 'white85', icon, children, size = 'md', className, style, 'aria-hidden': ariaHidden }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone], styles[size], className].filter(Boolean).join(' ')} style={style} aria-hidden={ariaHidden}>
      {tone === 'rec' ? <span className={styles.recDot} aria-hidden="true" data-loop="" /> : null}
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
