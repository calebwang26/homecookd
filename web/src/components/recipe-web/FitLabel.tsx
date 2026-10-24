'use client';
// A pill label that never truncates: "Hear Miles · 0:24" at the pill's font when it fits, else the
// same words 1 px smaller, else `short` ("Hear Miles"). Measured against the pill's own width
// (layout widths, not transformed rects), so it re-checks on resize and once fonts load.
import { useLayoutEffect, useRef, useState } from 'react';
import ui from './RecipeWeb.module.css';

type Fit = 'full' | 'tight' | 'short';

export function FitLabel({ full, short }: { full: string; short: string }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<Fit>('full');

  useLayoutEffect(() => {
    const m = measure.current;
    const btn = m?.parentElement;
    if (!m || !btn) return;
    const check = () => {
      const cs = getComputedStyle(btn);
      const gap = parseFloat(cs.columnGap) || 0;
      let avail = btn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      for (const c of Array.from(btn.children)) {
        if (c === m || c.hasAttribute('data-fit-label')) continue;
        const w = c instanceof HTMLElement ? c.offsetWidth : parseFloat(getComputedStyle(c).width) || 0;
        avail -= w + gap;
      }
      // Exact text width, with any press/enter transform on the pill divided back out.
      const scale = btn.offsetWidth ? btn.getBoundingClientRect().width / btn.offsetWidth : 1;
      const w = m.getBoundingClientRect().width / (scale || 1);
      const fs = parseFloat(cs.fontSize) || 15;
      setFit(w <= avail ? 'full' : (w * (fs - 1)) / fs <= avail ? 'tight' : 'short');
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(btn);
    document.fonts?.ready.then(check).catch(() => {});
    return () => ro.disconnect();
  }, [full]);

  return (
    <>
      <span data-fit-label="" className={fit === 'tight' ? ui.fitTight : undefined}>
        {fit === 'short' ? short : full}
      </span>
      <span ref={measure} className={ui.fitMeasure} aria-hidden="true">
        {full}
      </span>
    </>
  );
}
