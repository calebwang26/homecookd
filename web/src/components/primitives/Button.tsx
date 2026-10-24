// VERO pill button (brief 5 "Button").
//
//   <Button href="#early-access" variant="hero" size="lg" arrow>Get early access</Button>
//   <Button variant="primary" size="md" type="submit" arrow>Get early access</Button>
//   <Button href="#see-it-work" variant="soft" size="md">See the real app</Button>
//   <Button variant="outlineCream" size="md" onClick={share}>Send this to Grandma</Button>
//
// Label + a filled circle with an arrow inset 8px on the right (52px on lg, 44px on md, 36px on sm).
// Hover: the circle slides 4px, the label 2px. Focus: 3px ring with 3px offset (chartreuse on the
// dark variants). Heights: lg 68, md 60, sm 48.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowRightIcon } from '@/components/icons/Icons';
import styles from './Button.module.css';

export type ButtonVariant = 'hero' | 'primary' | 'soft' | 'outlineCream' | 'outlineInk' | 'black';
export type ButtonSize = 'lg' | 'md' | 'sm';

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** show the arrow circle */
  arrow?: boolean;
  /** a leading icon (e.g. <PlayIcon />) */
  icon?: ReactNode;
  /** stretch to the container width (mobile CTAs) */
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = Common &
  (
    | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'>)
    | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>)
  );

const DARK: ButtonVariant[] = ['outlineCream', 'hero'];

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', arrow = false, icon, block, className, children, ...rest } = props;
  const cls = [styles.btn, styles[variant], styles[size], arrow ? styles.withArrow : '', block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ');
  const label = <span className={styles.label}>{children}</span>;
  const inner = (
    <>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {label}
      {arrow ? (
        <span className={styles.circle} aria-hidden="true">
          <ArrowRightIcon size={size === 'lg' ? 22 : 20} stroke={2} />
        </span>
      ) : null}
    </>
  );
  const theme = DARK.includes(variant) ? 'dark' : undefined;

  if (rest.href !== undefined) {
    const { href, ...a } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return (
      <a href={href} className={cls} data-theme={theme} {...a}>
        {inner}
      </a>
    );
  }
  const b = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={b.type ?? 'button'} className={cls} data-theme={theme} {...b}>
      {inner}
    </button>
  );
}
