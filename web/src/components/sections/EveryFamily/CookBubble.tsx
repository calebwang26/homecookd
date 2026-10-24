'use client';
// The bubble that pops over (or under) an opened cloud tile: who taught it, their own words, and
// our ~estimate. A local cousin of the shared Chip (cream tone) that can point up as well as down
// and nudges itself back inside the viewport while its tail keeps pointing at the tile.
// Kept local on purpose: it flips above/below its tile and shifts its tail, which only the cloud needs.
import { animate } from 'motion';
import { useLayoutEffect, useRef } from 'react';
import type { Recipe } from '@/content/types';
import { possessive } from '@/components/primitives/RecipeCard';
import { SPRING } from '@/lib/motion/tokens';
import s from './EveryFamily.module.css';

export function CookBubble({ recipe, below }: { recipe: Recipe; below: boolean }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const pop = popRef.current;
    if (!wrap || !pop) return;
    // keep 16px clear of the viewport edges (reset first: effects can run twice in dev)
    wrap.style.setProperty('--shift', '0px');
    const r = wrap.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const m = 16;
    const dx = r.left < m ? m - r.left : r.right > vw - m ? vw - m - r.right : 0;
    if (dx) wrap.style.setProperty('--shift', `${Math.round(dx)}px`);

    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) return;
    animate(pop, { scale: [0.3, 1], opacity: [0, 1] }, { ...SPRING.chip, opacity: { duration: 0.14 } });
  }, []);

  return (
    <span ref={wrapRef} className={[s.bubbleWrap, below ? s.below : s.above].join(' ')}>
      <span ref={popRef} className={s.bubblePop}>
        <span className={s.bubble}>
          <span className={s.bTitle}>{possessive(recipe)}</span>
          {recipe.feelOriginal ? (
            <>
              <span className={s.bQuote} lang={recipe.feelOriginal.lang}>
                “{recipe.feelOriginal.text}”
              </span>
              <span className={s.bEnglish}>{recipe.feelQuote}</span>
            </>
          ) : (
            <span className={s.bQuote}>“{recipe.feelQuote}”</span>
          )}
          <span className={s.bEstimate}>{recipe.estimate}</span>
          <svg className={s.bTail} viewBox="0 0 20 12" aria-hidden="true" focusable="false">
            <path d="M0 0h20C15 2 11 6 10 12 9 6 5 2 0 0z" />
          </svg>
        </span>
      </span>
    </span>
  );
}
