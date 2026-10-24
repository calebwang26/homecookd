'use client';
// Speech-bubble chip (brief 5 "Chip", a7 M7).
//
//   <Chip tone="forest" tail="bl" pop typing wobble rotate={-6}>Grandma</Chip>      // pops on first view
//   <Chip tone="sun" tail="br" shown={progress > 0.72} typing wobble rotate={5}>Dad</Chip>  // controlled (scrub scenes)
//   <Chip tone="cream" tail="bc" popKey={activeId}>{quote}</Chip>                   // replays when popKey changes
//   <Chip tone="green">Delivered ✓</Chip>                                           // static
//
// The spring (stiffness 500, damping 18) runs on an inner wrapper with transform-origin at the tail
// tip, so a GSAP scene can move the outer element freely (engine rule). `typing` shows a small "…"
// bubble for 600ms first. `wobble` is a CSS loop (rotate ±3°, y ±3px, 3.6s, random phase), stopped
// by PauseProvider and reduced motion. SSR / reduced motion: the chip is simply visible.
import { inView, motionNow } from '@/lib/motion/lazy';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { SPRING as SPRINGS } from '@/lib/motion/tokens';
import styles from './Chip.module.css';

export type ChipTone = 'forest' | 'sun' | 'green' | 'tomato' | 'cream' | 'black';

export interface ChipProps {
  tone?: ChipTone;
  tail?: 'bl' | 'bc' | 'br' | null;
  /** pop (spring) the first time it's ≥ 60% in view */
  pop?: boolean;
  /** controlled visibility: pops in when it becomes true, shrinks out when false */
  shown?: boolean;
  /** changing this replays the pop */
  popKey?: string | number;
  typing?: boolean;
  wobble?: boolean;
  /** resting rotation in degrees */
  rotate?: number;
  /** delay before the pop (s) */
  delay?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** render as a different element (e.g. 'li', 'p') */
  as?: 'span' | 'div' | 'p' | 'li';
  'aria-hidden'?: boolean;
  /** seeds the wobble phase; defaults to the text of string/number children (children may be elements) */
  phaseKey?: string;
}

const SPRING = SPRINGS.chip;

function hashPhase(node: ReactNode, key?: string): number {
  // never stringify elements (their _owner is circular in dev)
  const s = key ?? (typeof node === 'string' ? node : typeof node === 'number' ? String(node) : 'chip');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3600) / 1000; // 0–3.6s
}

export function Chip({
  tone = 'cream',
  tail = 'bl',
  pop = false,
  shown,
  popKey,
  typing = false,
  wobble = false,
  rotate = 0,
  delay = 0,
  children,
  className,
  style,
  as: Tag = 'span',
  'aria-hidden': ariaHidden,
  phaseKey,
}: ChipProps) {
  const rootRef = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const dotsRef = useRef<HTMLSpanElement>(null);
  const firstKey = useRef(true);
  const visible = useRef(false);
  // in-flight pop animations; popOut() stops them so a quick in → out never leaves the chip visible
  const running = useRef<{ stop: () => void }[]>([]);
  const stopRunning = () => {
    running.current.forEach((a) => a.stop());
    running.current = [];
  };
  const controlled = shown !== undefined;
  const gated = pop || controlled;

  const motionOn = () =>
    document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const popIn = () => {
    const root = rootRef.current;
    const p = popRef.current;
    if (!root || !p) return;
    visible.current = true;
    // Motion loads after first paint (src/lib/motion/lazy.ts); in the rare case it isn't here yet,
    // the chip simply appears
    const animate = motionNow()?.animate;
    if (!motionOn() || !animate) {
      root.dataset.revealed = '';
      p.style.transform = '';
      p.style.opacity = '';
      return;
    }
    stopRunning();
    p.style.transform = 'scale(0)';
    p.style.opacity = '0';
    root.dataset.revealed = '';
    const dots = dotsRef.current;
    const mainDelay = delay + (typing && dots ? 0.6 : 0);
    if (typing && dots) {
      // hidden until the delay is over (the keyframes only apply once the animation starts)
      dots.style.transform = 'scale(0)';
      dots.style.opacity = '0';
      dots.style.display = 'flex';
      running.current.push(animate(dots, { scale: [0, 1], opacity: [0, 1] }, { ...SPRING, delay }));
      // The fade-out starts on a timer, not as a second delayed animate(): a later animate() on the
      // same values stops the earlier one, and a stopped animation never resolves `finished`, which
      // left the dots displayed (and their CSS loop running) for good.
      const t = window.setTimeout(() => {
        const out = animate(dots, { scale: 0, opacity: 0 }, { duration: 0.15 });
        running.current.push(out);
        out.finished.then(() => {
          dots.style.display = '';
        });
      }, Math.max(0, mainDelay - 0.05) * 1000);
      running.current.push({ stop: () => window.clearTimeout(t) });
    }
    running.current.push(
      animate(p, { scale: [0, 1], opacity: [0, 1] }, { ...SPRING, delay: mainDelay, opacity: { duration: 0.15, delay: mainDelay } }),
    );
  };

  const popOut = () => {
    const p = popRef.current;
    if (!p || !visible.current) return;
    visible.current = false;
    stopRunning();
    const dots = dotsRef.current;
    if (dots) dots.style.display = '';
    const animate = motionNow()?.animate;
    if (!motionOn() || !animate) {
      p.style.opacity = '0';
      return;
    }
    running.current.push(animate(p, { scale: 0.6, opacity: 0 }, { duration: 0.2, ease: [0.4, 0, 1, 1] }));
  };

  useEffect(
    () => () => {
      stopRunning();
      if (dotsRef.current) dotsRef.current.style.display = '';
    },
    [],
  );

  // uncontrolled: first time in view
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !pop || controlled) return;
    if (!motionOn()) {
      root.dataset.revealed = '';
      visible.current = true;
      return;
    }
    const stop = inView(root, () => {
      stop();
      popIn();
    }, { amount: 0.6 });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // controlled
  useEffect(() => {
    if (!controlled) return;
    if (shown) popIn();
    else if (visible.current || !rootRef.current?.dataset.revealed) {
      const root = rootRef.current;
      if (root && !root.dataset.revealed && motionOn()) {
        // initial hidden state: keep the CSS gate, nothing to animate
        return;
      }
      popOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // replay on popKey change
  useEffect(() => {
    if (popKey === undefined) return;
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    popIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popKey]);

  return (
    <Tag
      ref={rootRef as never}
      className={[styles.chip, styles[tone], tail ? styles[`tail_${tail}`] : styles.noTail, className].filter(Boolean).join(' ')}
      style={{ ['--rot' as string]: `${rotate}deg`, ['--phase' as string]: `-${hashPhase(children, phaseKey)}s`, ...style }}
      data-pop={gated ? '' : undefined}
      aria-hidden={ariaHidden}
    >
      {typing ? (
        <span ref={dotsRef} className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <span ref={popRef} className={styles.pop}>
        <span className={[styles.wobble, wobble ? styles.wobbling : ''].join(' ')} data-loop={wobble ? '' : undefined}>
          <span className={styles.bubble}>
            {children}
            {tail ? (
              <svg className={styles.tail} viewBox="0 0 20 12" aria-hidden="true" focusable="false">
                <path d="M0 0h20C15 2 11 6 9.5 12 8.5 7 5 2.5 0 0z" />
              </svg>
            ) : null}
          </span>
        </span>
      </span>
    </Tag>
  );
}
