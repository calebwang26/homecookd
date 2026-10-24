'use client';
// "Photo credits" disclosure for the footer's legal row. A native <details> (works without JS) whose
// panel opens as a small card above the row; with JS it also closes on Escape (focus returns to the
// summary) and on a click or tap outside. Each photographer's link carries a full accessible name
// ("<name> on Pexels (opens in a new tab)"), so it reads right even while the panel is shut.
import { useEffect, useRef } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { CREDIT_AUTHORS } from '@/content/credits';
import s from './Footer.module.css';

export function Credits() {
  const copy = useCopy();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.open) {
        el.open = false;
        el.querySelector('summary')?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  return (
    <details ref={ref} className={s.credits}>
      <summary className={s.summary}>
        {copy.footer.credits}
        <svg className={s.chev} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M3 5.25 7 9l4-3.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className={s.panel} data-lenis-prevent="">
        <p className={s.panelIntro}>
          {copy.footer.creditsIntro} {copy.footer.creditsThanks}
        </p>
        <ul role="list" className={s.authors}>
          {CREDIT_AUTHORS.map((a) => (
            <li key={a.author}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`${a.author} on Pexels (opens in a new tab)`}>
                <bdi>{a.author}</bdi>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
