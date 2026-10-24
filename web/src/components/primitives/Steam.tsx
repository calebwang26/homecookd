// Three wavy steam squiggles (brief 5 "Steam", ported from the app's SteamSwirl). Server-safe.
//
//   <Steam size={60} />                         // cream, drifting (paused by PauseProvider)
//   <Steam size={40} color="green" still />
//   <Steam size={72} once />                    // rises once (2s) then stops (the footer's final "e")
import type { CSSProperties } from 'react';
import styles from './Steam.module.css';

export interface SteamProps {
  color?: 'cream' | 'white' | 'green' | 'cocoa' | 'ink';
  size?: number;
  still?: boolean;
  /** rise once, then stop */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
}

const COLOR = { cream: 'var(--cream)', white: '#fff', green: 'var(--green)', cocoa: 'var(--cocoa)', ink: 'var(--ink)' };

export function Steam({ color = 'cream', size = 60, still = false, once = false, className, style }: SteamProps) {
  return (
    <svg
      width={size}
      height={(size * 40) / 60}
      viewBox="0 0 60 40"
      className={[styles.steam, still ? '' : once ? styles.once : styles.drift, className].filter(Boolean).join(' ')}
      style={{ color: COLOR[color], ...style }}
      aria-hidden="true"
      focusable="false"
      data-loop={still || once ? undefined : ''}
    >
      <path d="M12 36c-6-8 6-12 0-22" />
      <path d="M30 36c-6-8 6-12 0-24" />
      <path d="M48 36c-6-8 6-12 0-22" />
    </svg>
  );
}
