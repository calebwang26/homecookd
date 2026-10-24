'use client';
// VERO letter animations (brief 5 "LetterArc", secondary spec 4.2 / 4.3).
//
//   <LetterArc as="h2" className="t-block" text={copy.inTheirWords.h2} accent={copy.inTheirWords.accent} />
//   <LetterArc as="span" variant="grow" trigger="load" text={'Cook it like'} />          // hero baseline grow
//   <LetterArc key={word} as="span" trigger="load" stagger={0.02} text={word} />       // rotating relation word
//
// arc  = unfurl off a wheel: per char opacity 0→1, scale .2→1, rotate 80°→0, x .22em→0, y .6em→0,
//        origin 0% 100%, 700ms expo, stagger min(.026, .55/n), plays when the top reaches 85% of the viewport.
// grow = hero: scale .3→1 (+ y .04em→0), origin 50% 100%, 600ms expo, 55ms stagger per line, every
//        line starts at .15s.
// Words never break (white-space: nowrap per word). aria-label holds the text; chars are aria-hidden.
// SSR / no-JS / reduced motion: final text.
import { inView, loadMotion } from '@/lib/motion/lazy';
import { useEffect, useRef, type CSSProperties, type ElementType } from 'react';
import { EASE } from '@/lib/motion/tokens';
import { splitText } from './SplitWords';
import styles from './motion.module.css';

export interface LetterArcProps {
  text: string;
  accent?: readonly string[];
  as?: ElementType;
  variant?: 'arc' | 'grow';
  trigger?: 'enter' | 'load';
  className?: string;
  style?: CSSProperties;
  id?: string;
  /** override the per-letter stagger (s) */
  stagger?: number;
  /** extra delay before the first letter (s) */
  delay?: number;
  /** stretch every letter's animation by this factor (1 = the default timing; the hero word uses ~2) */
  slow?: number;
  /** aria-label override (e.g. the hero keeps a fixed label while the word rotates) */
  label?: string;
  /** render without aria-label / as decorative (when the parent carries the label) */
  decorative?: boolean;
  onDone?: () => void;
}

export function LetterArc({
  text,
  accent,
  as: Tag = 'span',
  variant = 'arc',
  trigger = 'enter',
  className,
  style,
  id,
  stagger,
  delay = 0,
  slow = 1,
  label,
  decorative = false,
  onDone,
}: LetterArcProps) {
  const ref = useRef<HTMLElement>(null);
  const lines = splitText(text, accent);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const lineEls = Array.from(el.querySelectorAll<HTMLElement>('[data-line]'));
    const groups = lineEls.length ? lineEls.map((l) => Array.from(l.querySelectorAll<HTMLElement>('.c'))) : [Array.from(el.querySelectorAll<HTMLElement>('.c'))];
    const all = groups.flat();
    const n = all.length;

    let dead = false;
    const play = () =>
      loadMotion().then(({ animate }) => {
        if (dead) return;
        const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
        let last: Promise<unknown> = Promise.resolve();
        if (variant === 'arc') {
          const st = stagger ?? Math.min(0.026, 0.55 / Math.max(n, 1));
          for (const c of all) {
            c.style.opacity = '0';
            c.style.transformOrigin = '0% 100%';
            c.style.transform = `translate(${0.22 * fs}px, ${0.6 * fs}px) rotate(80deg) scale(0.2)`;
          }
          el.dataset.revealed = '';
          all.forEach((c, i) => {
            const d = delay + i * st;
            animate(c, { opacity: [0, 1] }, { duration: 0.18 * slow, delay: d, ease: 'linear' });
            last = animate(
              c,
              { x: [0.22 * fs, 0], y: [0.6 * fs, 0], rotate: [80, 0], scale: [0.2, 1] },
              { duration: 0.7 * slow, delay: d, ease: EASE.expo },
            ).finished;
          });
        } else {
          const st = stagger ?? 0.055;
          for (const c of all) {
            c.style.opacity = '0';
            c.style.transformOrigin = '50% 100%';
            c.style.transform = `translateY(${0.04 * fs}px) scale(0.3)`;
          }
          el.dataset.revealed = '';
          groups.forEach((g) =>
            g.forEach((c, i) => {
              const d = 0.15 + delay + i * st;
              animate(c, { opacity: [0, 1] }, { duration: 0.25 * slow, delay: d, ease: 'linear' });
              last = animate(c, { y: [0.04 * fs, 0], scale: [0.3, 1] }, { duration: 0.6 * slow, delay: d, ease: EASE.expo }).finished;
            }),
          );
        }
        last.then(() => {
          for (const c of all) {
            c.style.transform = '';
            c.style.opacity = '';
          }
          doneRef.current?.();
        });
      });

    if (trigger === 'load') {
      play();
      return () => {
        dead = true;
      };
    }
    const stop = inView(el, () => {
      stop();
      play();
    }, { margin: '0px 0px -15% 0px' });
    return () => {
      dead = true;
      stop();
    };
    // Plays once per mount; remount with a `key` to replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderWord = (w: { word: string; accent: boolean; index: number }) => {
    const chars = Array.from(w.word).map((ch, k) => (
      <span key={k} className="c" aria-hidden="true">
        {ch}
      </span>
    ));
    return (
      <span key={w.index} className="w" data-i={w.index} data-accent={w.accent || undefined}>
        {w.accent ? <em>{chars}</em> : chars}
      </span>
    );
  };
  const renderLine = (tokens: ReturnType<typeof splitText>[number]) =>
    tokens.flatMap((t, k) => (k < tokens.length - 1 ? [renderWord(t), ' '] : [renderWord(t)]));

  const a11yLabel = label ?? text.replace(/\s*\n\s*/g, ' ');
  // aria-label only works on headings; other tags get a visually hidden copy
  const labelled = typeof Tag === 'string' && /^h[1-6]$/.test(Tag);
  return (
    <Tag
      ref={ref}
      id={id}
      className={[styles.letterArc, className].filter(Boolean).join(' ')}
      style={style}
      aria-label={decorative || !labelled ? undefined : a11yLabel}
      aria-hidden={decorative ? true : undefined}
      data-letter-arc={variant}
    >
      {!decorative && !labelled ? <span className="sr-only">{a11yLabel}</span> : null}
      {lines.length > 1
        ? lines.map((tokens, i) => (
            <span key={i} data-line={i} style={{ display: 'block' }}>
              {renderLine(tokens)}
            </span>
          ))
        : renderLine(lines[0] ?? [])}
    </Tag>
  );
}
