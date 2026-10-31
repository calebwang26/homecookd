'use client';
// a7 M2 per-word headline build, on enter (brief 5 "WordReveal").
//
//   <WordReveal as="h2" className="t-h2" text={copy.questions.h2} accent={copy.questions.accent} />
//   <WordReveal as="h2" className="t-h2" tone="cream" text={copy.seeItWork.h2} accent={copy.seeItWork.accent} />
//   <WordReveal as="h1" className="t-hero" stagger={0.1} trigger="load" text="..." />
//   <WordReveal as="p" className="t-lead" stagger={0.02} text="..." />          // M4 paragraph variant
//
// Each word: opacity 0→1, y .3em→0, blur 8px→0 (550ms, quart), then its color ghost→ink delayed
// 120ms (cream tone: muted-inverse→cream; accent words: pale accent→accent). Sets data-revealed.
// SSR / no-JS / reduced motion: final text and colors (hidden state only under html[data-motion="on"]).
import { animate } from 'motion';
import { useEffect, useRef, type CSSProperties, type ElementType } from 'react';
import { inView } from 'motion';
import { EASE, HEX, STAGGER, type HexName } from '@/lib/motion/tokens';
import { MQ, matches } from '@/lib/motion/media';
import { SplitWords } from './SplitWords';
import styles from './motion.module.css';

export interface WordRevealProps {
  text: string;
  accent?: readonly string[];
  accentStyle?: 'italic' | 'color';
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  id?: string;
  /** seconds between words (a7: hero .1, headings .07, paragraphs .02) */
  stagger?: number;
  delay?: number;
  tone?: 'ink' | 'cream';
  /** override the final accent color (token name). Defaults: ink tone → green, cream tone → chartreuse */
  accentColor?: HexName;
  /** fraction of the element in view before it plays */
  amount?: number;
  /** 'enter' (default) plays on scroll into view; 'load' plays on mount */
  trigger?: 'enter' | 'load';
  /** blur the words in (a7). Turn off for long paragraphs (> 20 words) to stay cheap. */
  blur?: boolean;
  onDone?: () => void;
}

const PALE: Partial<Record<HexName, string>> = {
  green: HEX.greenPale,
  chartreuse: HEX.chartreusePale,
  forest: '#8FAE9E',
  sun: '#C9A64E',
  tomato: '#E9B3A3',
};

export function WordReveal({
  text,
  accent,
  accentStyle,
  as = 'h2',
  className,
  style,
  id,
  stagger = STAGGER.word,
  delay = 0,
  tone = 'ink',
  accentColor,
  amount = 0.6,
  trigger = 'enter',
  blur = true,
  onDone,
}: WordRevealProps) {
  const ref = useRef<HTMLElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const accentName: HexName = accentColor ?? (tone === 'cream' ? 'chartreuse' : 'green');
  const finalColor = tone === 'cream' ? HEX.cream : HEX.ink;
  const startColor = tone === 'cream' ? HEX.mutedInverse : HEX.ghost;
  const accentFinal = HEX[accentName];
  const accentStart = PALE[accentName] ?? startColor;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const motionOn = root.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const words = Array.from(el.querySelectorAll<HTMLElement>('.w'));
    const play = () => {
      const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
      // animated filter: blur() is a filter layer per word, too heavy for phones
      const blurOn = blur && !matches(MQ.mobile);
      // pin the start state inline, then release the CSS gate
      for (const w of words) {
        const acc = w.hasAttribute('data-accent');
        w.style.opacity = '0';
        w.style.transform = `translateY(${0.3 * fs}px)`;
        if (blurOn) w.style.filter = 'blur(8px)';
        w.style.color = acc ? accentStart : startColor;
      }
      el.dataset.revealed = '';
      let last: Promise<unknown> = Promise.resolve();
      words.forEach((w, i) => {
        const acc = w.hasAttribute('data-accent');
        const d = delay + i * stagger;
        animate(
          w,
          { opacity: [0, 1], y: [0.3 * fs, 0], ...(blurOn ? { filter: ['blur(8px)', 'blur(0px)'] } : {}) },
          { duration: 0.55, ease: EASE.quart, delay: d },
        );
        last = animate(w, { color: [acc ? accentStart : startColor, acc ? accentFinal : finalColor] }, {
          duration: 0.6,
          ease: EASE.quart,
          delay: d + 0.12,
        }).finished;
      });
      last.then(() => {
        for (const w of words) {
          w.style.filter = '';
          w.style.transform = '';
          w.style.color = '';
          w.style.opacity = '';
        }
        doneRef.current?.();
      });
    };
    if (trigger === 'load') {
      play();
      return;
    }
    const stop = inView(el, () => {
      stop();
      play();
    }, { amount });
    return stop;
    // Colors are derived from props that don't change after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SplitWords
      as={as}
      id={id}
      text={text}
      accent={accent}
      accentStyle={accentStyle}
      className={[styles.wordReveal, tone === 'cream' ? styles.cream : styles.ink, className].filter(Boolean).join(' ')}
      style={{ ['--accent' as string]: `var(--${kebab(accentName)})`, ...style }}
      rootProps={{ ref, 'data-word-reveal': '' }}
    />
  );
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
