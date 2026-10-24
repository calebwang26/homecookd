'use client';
// Scrubbed a7 word fill (brief 5, "wordFill.ts"): ghost → ink per word in reading order, plus a
// tiny y .1em → 0. Never blur. Works on headings rendered by <SplitWords> (each word is a `.w`
// span; accent words carry [data-accent]).
//
//   const tl = gsap.timeline({ scrollTrigger: { ..., scrub: SCRUB } });   // timeline in 0–100 units
//   addWordFill(tl, brandLineEl, { at: 45, span: 30 });                    // fills over 45 → 75
//   addWordFill(tl, line2El, { at: 30, span: 46, to: 'green', accentTo: 'green' });
//   addWordFill(tl, el, { at: 'fill', span: 20, stagger: 1.2 });          // at a label
//
// Static CSS shows the final colors, so no-JS / reduced motion never sees ghost words. The start
// state is applied by the tween itself (immediateRender) only when the scene builds its timeline.
import { gsap } from './gsap';
import { HEX, type HexName } from './tokens';

export interface WordFillOptions {
  /** final color of plain words (token name or any CSS color). Default 'ink'. */
  to?: HexName | string;
  /** final color of accent words. Default 'green'. */
  accentTo?: HexName | string;
  /** start color of plain words. Default 'ghost'. */
  from?: HexName | string;
  /** start color of accent words. Default 'greenPale'. */
  accentFrom?: HexName | string;
  /** timeline position (number in timeline units, or a label) */
  at: number | string;
  /** total length of the fill in timeline units */
  span: number;
  /** delay between word starts (timeline units). Default: spreads the words evenly over span. */
  stagger?: number;
  /** add the y .1em → 0 drift. Default true. */
  rise?: boolean;
  /** word selector. Default '.w' */
  selector?: string;
}

const color = (c: string) => (c in HEX ? HEX[c as HexName] : c);

export function addWordFill(tl: gsap.core.Timeline, root: Element | string, opts: WordFillOptions): gsap.core.Timeline {
  const words = gsap.utils.toArray<HTMLElement>(opts.selector ?? '.w', root as Element);
  const n = words.length;
  if (!n) return tl;
  const stagger = opts.stagger ?? (n > 1 ? (opts.span * 0.7) / (n - 1) : 0);
  const dur = Math.max(opts.span - stagger * (n - 1), opts.span * 0.12);
  const to = color(opts.to ?? 'ink');
  const accentTo = color(opts.accentTo ?? 'green');
  const from = color(opts.from ?? 'ghost');
  const accentFrom = color(opts.accentFrom ?? 'greenPale');
  const rise = opts.rise ?? true;

  words.forEach((w, i) => {
    const accent = w.hasAttribute('data-accent');
    const pos = typeof opts.at === 'number' ? opts.at + i * stagger : `${opts.at}+=${i * stagger}`;
    tl.fromTo(
      w,
      { color: accent ? accentFrom : from, y: rise ? '0.1em' : 0 },
      { color: accent ? accentTo : to, y: 0, duration: dur, ease: 'none' },
      pos,
    );
  });
  return tl;
}
