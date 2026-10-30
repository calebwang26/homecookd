'use client';
// The egg as a progress bar while the kid's recipe is written (Caleb, Oct 30): the smiling egg fills with
// yolk from the bottom. The server sends no progress, so the fill eases toward 92% while it waits and
// tops up to 100% (with the made-it grin) once the card is back (`done`). The kit's egg (public/brand/mascot),
// drawn inline so the yolk can rise inside the white.
import { useEffect, useState } from 'react';

import s from './miss.module.css';

const WHITE =
  'M100 18 C138 14 172 34 180 68 C188 100 176 120 182 142 C186 168 160 188 128 184 C108 182 96 190 74 186 C40 180 16 156 20 122 C22 102 12 86 22 62 C34 32 66 20 100 18 Z';
// Where the white starts and ends (the fill's 0% and 100%).
const TOP = 14;
const BOTTOM = 190;
// A gentle wave twice the egg's width, slid sideways one period at a time.
const WAVE = 'M0 6 Q25 0 50 6 T100 6 T150 6 T200 6 T250 6 T300 6 T350 6 T400 6 V400 H0 Z';

/** 0..0.92 over the wait: quick at first, then slower, never full on its own. */
function eased(ms: number) {
  return 0.92 * (1 - Math.exp(-ms / 7000));
}

export function EggFill({ size = 140, done = false, label }: { size?: number; done?: boolean; label: string }) {
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (done) return;
    const start = performance.now();
    const timer = window.setInterval(() => setWaited(eased(performance.now() - start)), 120);
    return () => window.clearInterval(timer);
  }, [done]);
  const p = done ? 1 : waited;
  const y = BOTTOM - p * (BOTTOM - TOP);

  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <clipPath id="egg-white">
            <path d={WHITE} />
          </clipPath>
        </defs>
        <path d={WHITE} fill="#FFFFFF" />
        <g clipPath="url(#egg-white)">
          <g className={s.eggFillLevel} style={{ transform: `translateY(${y - 6}px)` }}>
            <path className={s.eggFillWave} d={WAVE} fill="#F7C47C" />
          </g>
        </g>
        <path d={WHITE} fill="none" stroke="#1F2430" strokeWidth={10} strokeLinejoin="round" />
        <circle cx="96" cy="98" r="42" fill="#F2A23A" stroke="#1F2430" strokeWidth={10} />
        <path d="M68 86 Q70 76 80 70" fill="none" stroke="#FFFFFF" strokeWidth={8} strokeLinecap="round" />
        {done ? (
          <>
            <path d="M77 102 Q83 93 89 102" fill="none" stroke="#1F2430" strokeWidth={6} strokeLinecap="round" />
            <path d="M103 102 Q109 93 115 102" fill="none" stroke="#1F2430" strokeWidth={6} strokeLinecap="round" />
            <path d="M84 112 Q96 130 108 112 Z" fill="#1F2430" stroke="#1F2430" strokeWidth={5} strokeLinejoin="round" />
          </>
        ) : (
          <>
            <circle cx="84" cy="100" r="6" fill="#1F2430" />
            <circle cx="110" cy="100" r="6" fill="#1F2430" />
            <path d="M87 114 Q97 124 107 114" fill="none" stroke="#1F2430" strokeWidth={6} strokeLinecap="round" />
          </>
        )}
      </svg>
    </div>
  );
}
