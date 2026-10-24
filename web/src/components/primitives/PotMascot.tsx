// The homecookd pot mascot, ported from app/src/components/icons.tsx (brief 5 "PotMascot"). Server-safe.
//
//   <PotMascot size={48} />                       // smile
//   <PotMascot size={88} mood="happy" steam />     // closed happy eyes, steam curls drift (paused by PauseProvider)
//   <PotMascot size={40} mood="talk" title="homecookd" />
//
// Colors are the app's own (the brown outline is an allowed accent). Decorative unless `title` is set.
import type { CSSProperties } from 'react';
import styles from './PotMascot.module.css';

export interface PotMascotProps {
  size?: number;
  mood?: 'smile' | 'happy' | 'talk';
  steam?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function PotMascot({ size = 48, mood = 'smile', steam = false, title, className, style }: PotMascotProps) {
  const h = (size * 92) / 100;
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 100 92"
      className={[styles.pot, steam ? styles.steaming : '', className].filter(Boolean).join(' ')}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g className={styles.steam} data-loop={steam ? '' : undefined}>
        <path className={styles.curl} d="M38 22c-4-5 4-8 0-13" />
        <path className={styles.curl} d="M52 20c-4-5 4-8 0-13" />
        <path className={styles.curl} d="M66 22c-4-5 4-8 0-13" />
      </g>
      <path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill="#F6BFA8" stroke="#6E5A4C" strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M22 52h-8M78 52h8" stroke="#6E5A4C" strokeWidth={5} strokeLinecap="round" />
      <ellipse cx={50} cy={42} rx={31} ry={7} fill="#F2A98F" stroke="#6E5A4C" strokeWidth={3.5} />
      <circle cx={50} cy={33} r={4.5} fill="#6E5A4C" />
      {mood === 'happy' ? (
        <path d="M36 59q4-4 8 0M56 59q4-4 8 0" fill="none" stroke="#4A3B30" strokeWidth={3} strokeLinecap="round" />
      ) : (
        <>
          <circle cx={40} cy={59} r={3.6} fill="#4A3B30" />
          <circle cx={60} cy={59} r={3.6} fill="#4A3B30" />
        </>
      )}
      <ellipse cx={33} cy={66} rx={5} ry={3} fill="#FFB8AE" />
      <ellipse cx={67} cy={66} rx={5} ry={3} fill="#FFB8AE" />
      {mood === 'talk' ? (
        <ellipse cx={50} cy={67} rx={4} ry={3.2} fill="#C0645C" />
      ) : (
        <path d="M45 65q5 5 10 0" fill="none" stroke="#4A3B30" strokeWidth={3} strokeLinecap="round" />
      )}
    </svg>
  );
}
