'use client';
// The footer wordmark (brief 8.13, a3 Savor): "homecookd" grows out of its own thickest strokes.
//
//   <FooterWordmark />                               // green on --footer-bg, steam rises when done
//   <FooterWordmark ink="var(--forest)" bg="var(--butter)" steam={false} />
//
// How it works: each letter is an overlap-free outline (traced from Fraunces 800 · SOFT 100 · opsz 144
// by scripts/wordmark.gen.ts) filled in `ink` and stroked in `bg`, with the stroke painted over
// the fill. A round-joined stroke of width w erodes the letter by w/2 (a disk), so a wide stroke hides
// it, and shrinking the stroke to 0 makes the stems and bowls appear first as thin pointed slivers,
// with hairlines, joins and serifs arriving last. Letters start 0.13s apart, left → right (≈2.1s).
// Earlier letters paint on top, so a later letter's wider stroke never bites a finished neighbour.
//
// Live text with -webkit-text-stroke (the brief's first option) cuts notches through the "e", "o" and
// "d" mid-animation in Chrome and Safari, because the variable font keeps overlapping contours.
//
// The SVG's viewBox is the word's ink box, so `width: 100%` fits it edge to edge exactly.
// Static (SSR, no JS, reduced motion): the finished wordmark. The hidden start state exists only
// under html[data-motion="on"]. Needs a solid `bg` behind it (no pattern).
import { useRef, useState, type CSSProperties } from 'react';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/motion/gsap';
import { Steam } from '@/components/primitives/Steam';
import { WORDMARK } from '@/components/sections/Footer/wordmark.data';
import styles from './FooterWordmark.module.css';

export interface FooterWordmarkProps {
  /** accessible name */
  label?: string;
  /** letter color (CSS color) */
  ink?: string;
  /** the solid background behind the wordmark (CSS color); the erosion stroke uses it */
  bg?: string;
  /** three steam squiggles rise once over the last "o" (of "cook") after the word lands */
  steam?: boolean;
  className?: string;
  style?: CSSProperties;
}

const { width: W, height: H, maxStroke: MAX, letters: LETTERS } = WORDMARK;
// a3 Savor: each letter swells over ~0.8s, next letter ~0.13s later; whole word (9 letters) ≈ 2.1s.
const DURATION = 1.05;
const STAGGER = 0.13;
const EASE = 'sine.inOut';
// Steam sits over the last x-height letter (no ascender above it: the second "o" of "cook"):
// centred on it, ~80% of its width, a little above its x-height.
const POT = LETTERS.reduce<(typeof LETTERS)[number]>((pot, l) => (l.box[1] > H * 0.25 ? l : pot), LETTERS[0]);
const STEAM_W = POT.box[2] * 0.8;
const STEAM_H = (STEAM_W * 40) / 60;
const STEAM_STYLE: CSSProperties = {
  left: `${((POT.box[0] + (POT.box[2] - STEAM_W) / 2) / W) * 100}%`,
  top: `${((POT.box[1] - STEAM_H - POT.box[3] * 0.1) / H) * 100}%`,
  width: `${(STEAM_W / W) * 100}%`,
};

export function FooterWordmark({ label = 'homecookd', ink, bg, steam = true, className, style }: FooterWordmarkProps) {
  const root = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState(false);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (document.documentElement.dataset.motion !== 'on' || el.hasAttribute('data-revealed')) return;
        // Paths are painted last-letter-first; animate them first-letter-first.
        const paths = Array.from(el.querySelectorAll<SVGPathElement>('path[data-i]')).sort(
          (a, b) => Number(a.dataset.i) - Number(b.dataset.i),
        );
        gsap.set(paths, { strokeWidth: MAX });
        const tl = gsap.timeline({
          paused: true,
          onComplete: () => {
            el.setAttribute('data-revealed', '');
            setLanded(true);
          },
        });
        paths.forEach((p, i) => {
          tl.to(
            p,
            {
              strokeWidth: 0,
              duration: DURATION,
              ease: EASE,
              // Drop the stroke entirely once a letter lands, so no 0-width hairline can remain.
              onComplete: () => p.classList.add(styles.done),
            },
            i * STAGGER,
          );
        });
        // Start once the whole word is on screen (the brief's "top 85%" fires with only the top
        // third of the word visible at 1440×900, and the footer is the end of the page).
        const st = ScrollTrigger.create({
          trigger: el,
          start: 'bottom 98%',
          once: true,
          // The last thing on the page: measure after every pinned scene above has its spacer.
          refreshPriority: -1,
          onEnter: () => tl.play(),
        });
        // Already past the start when created (e.g. restored scroll at the bottom): play right away.
        const raf = requestAnimationFrame(() => {
          if (st.isActive) tl.play();
        });
        return () => {
          cancelAnimationFrame(raf);
          st.kill();
          tl.kill();
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const vars = {
    '--wm-max': `${MAX}px`,
    ...(ink ? { '--wm-ink': ink } : null),
    ...(bg ? { '--wm-bg': bg } : null),
    ...style,
  } as CSSProperties;

  return (
    <div ref={root} className={[styles.root, className].filter(Boolean).join(' ')} style={vars} data-wordmark="">
      <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} focusable="false">
        {LETTERS.map((_, k) => {
          const i = LETTERS.length - 1 - k;
          return <path key={i} data-i={i} className={styles.letter} d={LETTERS[i].d} />;
        })}
      </svg>
      {steam && landed ? (
        <span className={styles.steam} style={STEAM_STYLE} aria-hidden="true">
          <Steam color="green" once />
        </span>
      ) : null}
    </div>
  );
}
