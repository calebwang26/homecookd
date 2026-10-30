// The homecookd logo, from the brand kit (docs/brand/, copied byte-identical to public/brand/). Never
// typed as live text, never redrawn or recolored. Kit rules (BRAND-HANDOFF section 6):
//   <Logo height={32} />                  headers and footers: the horizontal lockup (mark + wordmark), and on
//                                         phones under 360px wide the mark alone
//   <Logo variant="mark" size={24} />     the mark alone; the file follows the rendered size:
//                                         64px and up mark.svg, 24 to 63px mark-small.svg, 23px and under mark-tiny.svg
//   <Logo reversed />                     on ink or dark grounds (lockup-horizontal-reversed.svg, mark-reversed.svg)
// Server-safe. The wordmark's own text is outlined in the SVG, so it renders the same everywhere.
import styles from './Logo.module.css';

const LOCKUP_RATIO = 12058 / 2342; // lockup-horizontal.svg viewBox

export function markFile(size: number, reversed = false): string {
  if (reversed) return '/brand/mark-reversed.svg';
  if (size >= 64) return '/brand/mark.svg';
  if (size >= 24) return '/brand/mark-small.svg';
  return '/brand/mark-tiny.svg';
}

export interface LogoProps {
  variant?: 'lockup' | 'mark';
  /** lockup: its height in px. */
  height?: number;
  /** mark: its width and height in px. */
  size?: number;
  reversed?: boolean;
  className?: string;
}

export function Logo({ variant = 'lockup', height = 32, size = 32, reversed = false, className }: LogoProps) {
  if (variant === 'mark') {
    // eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from public/brand, no loader
    return <img src={markFile(size, reversed)} width={size} height={size} alt="homecookd" className={[styles.mark, className].filter(Boolean).join(' ')} />;
  }
  const w = Math.round(height * LOCKUP_RATIO);
  const markSize = Math.round(height * 1.1);
  const cls = [styles.logo, className].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from public/brand, no loader */}
      <img className={styles.lockup} src={reversed ? '/brand/lockup-horizontal-reversed.svg' : '/brand/lockup-horizontal.svg'} width={w} height={height} alt="homecookd" />
      {/* eslint-disable-next-line @next/next/no-img-element -- the mark alone under 360px wide (CSS swaps the two) */}
      <img className={styles.markOnly} src={markFile(markSize, reversed)} width={markSize} height={markSize} alt="homecookd" />
    </span>
  );
}
