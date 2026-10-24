'use client';
// The FAQ as native <details>/<summary>: keyboard, screen readers and no-JS all work for free.
// {R} follows the "Cooking with" picker (SSR says "Grandma").
import { useCopy } from '@/components/providers/CopyProvider';
import { useFill } from '@/components/providers/RelationProvider';
import { ChevronDownIcon } from '@/components/icons/Icons';
import styles from './Questions.module.css';

export function FaqList({ className }: { className?: string }) {
  const f = useFill();
  const copy = useCopy();
  return (
    <div className={[styles.faq, className].filter(Boolean).join(' ')}>
      {copy.questions.faq.map((item) => (
        <details key={item.q} className={styles.item}>
          <summary className={styles.q}>
            <span className={styles.qText}>{f(item.q)}</span>
            <span className={styles.chev} aria-hidden="true">
              <ChevronDownIcon size={22} stroke={2} />
            </span>
          </summary>
          <div className={styles.a}>
            <p className={`t-body ${styles.aText}`}>{f(item.a)}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
