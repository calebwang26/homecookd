// B0 section stub: the final id, background and approximate height, with a visible label so
// owners can see where their section sits. Replace the whole stub with the real section.
//
//   <Placeholder id="see-it-work" owner="B3" title="See it work" tone="green" heights={{ desktop: '250vh', mobile: '130svh' }} />
import type { CSSProperties, ElementType, ReactNode } from 'react';
import styles from './Placeholder.module.css';

export type PlaceholderTone = 'canvas' | 'green' | 'sun' | 'forest' | 'footer' | 'hero' | 'chartreuseInset';

export interface PlaceholderProps {
  id?: string;
  owner: string;
  title: string;
  notes?: ReactNode;
  tone?: PlaceholderTone;
  heights: { desktop: string; mobile: string };
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [data: `data-${string}`]: unknown;
}

export function Placeholder({ id, owner, title, notes, tone = 'canvas', heights, as: Tag = 'section', className, style, children, ...rest }: PlaceholderProps) {
  return (
    <Tag
      id={id}
      className={[styles.stub, styles[tone], className].filter(Boolean).join(' ')}
      style={{ ['--h-d' as string]: heights.desktop, ['--h-m' as string]: heights.mobile, ...style }}
      aria-label={title}
      {...rest}
    >
      <div className={styles.inner}>
        <p className={styles.label}>
          <span className={styles.owner}>{owner}</span> {title}
          {id ? <span className={styles.id}>#{id}</span> : null}
        </p>
        {notes ? <p className={styles.notes}>{notes}</p> : null}
        {children}
      </div>
    </Tag>
  );
}
