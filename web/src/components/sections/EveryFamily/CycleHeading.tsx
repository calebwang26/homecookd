'use client';
// "A few minutes a day with *Mom*." (kid) / "Back in the kitchen with your *mom*." (parent), brief 8.7.
// The heading builds per word on enter (a7 M2, the same numbers as WordReveal), then the italic word
// keeps cycling, 2.4s apart, through copy.everyFamily.cycle (kid: Mom → Dad → Grandma → Grandpa →
// Auntie → Uncle; parent: mom → dad → son → daughter → grandma → grandpa), looping (Caleb, Oct 17):
// the outgoing word fades out, the incoming one plays the VERO LetterArc unfurl. It holds while
// paused or offscreen and never runs under reduced motion. Once a cook is picked (picker, ?for=,
// storage) it stops for good on copy.everyFamily.explicitWord: kid "Dad.", parent "kids." or
// "grandkids." (QA B22).
// The accessible name is fixed while it cycles (the moving word is aria-hidden and never announced),
// and names the picked word once it holds.
//
// The cycling word sits on its own line, so its changing width never reflows line one.
import { animate, inView } from 'motion';
import { useEffect, useRef, useState } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { LetterArc } from '@/components/motion/LetterArc';
import { usePause } from '@/components/providers/PauseProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { fill } from '@/lib/relation';
import { EASE, HEX } from '@/lib/motion/tokens';
import { MQ, matches } from '@/lib/motion/media';
import s from './EveryFamily.module.css';

const HOLD_MS = 2400;

export function CycleHeading({ id }: { id: string }) {
  const c = useCopy().everyFamily;
  const LEAD = c.h2.split(' ').slice(0, -1); // "A few minutes a day with"
  const CYCLE = c.cycle;
  const ref = useRef<HTMLHeadingElement>(null);
  const wordRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0); // swaps so far; the word is CYCLE[step % length]
  const [ready, setReady] = useState(false); // revealed + allowed to cycle
  const [visible, setVisible] = useState(false);
  const { paused } = usePause();
  const { relation, explicit } = useRelation();

  // a7 M2 per-word build (same timing and colors as WordReveal)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      el.dataset.revealed = '';
      return;
    }
    const words = Array.from(el.querySelectorAll<HTMLElement>('[data-w]'));
    const stop = inView(
      el,
      () => {
        stop();
        const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
        const blurOn = !matches(MQ.mobile); // animated blur is too heavy for phones
        for (const w of words) {
          const acc = w.hasAttribute('data-accent');
          w.style.opacity = '0';
          w.style.transform = `translateY(${0.3 * fs}px)`;
          if (blurOn) w.style.filter = 'blur(8px)';
          w.style.color = acc ? HEX.greenPale : HEX.ghost;
        }
        el.dataset.revealed = '';
        let last: Promise<unknown> = Promise.resolve();
        words.forEach((w, i) => {
          const acc = w.hasAttribute('data-accent');
          const d = i * 0.08;
          animate(w, { opacity: [0, 1], y: [0.3 * fs, 0], ...(blurOn ? { filter: ['blur(8px)', 'blur(0px)'] } : {}) }, { duration: 0.55, ease: EASE.quart, delay: d });
          last = animate(w, { color: [acc ? HEX.greenPale : HEX.ghost, acc ? HEX.green : HEX.ink] }, { duration: 0.6, ease: EASE.quart, delay: d + 0.12 }).finished;
        });
        last.then(() => {
          for (const w of words) {
            w.style.filter = '';
            w.style.transform = '';
            w.style.color = '';
            w.style.opacity = '';
          }
          setReady(true);
        });
      },
      { amount: 0.6 },
    );
    return stop;
  }, []);

  // only cycle while the heading is on screen
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || paused || !visible || explicit) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const w = wordRef.current;
      const next = () => !cancelled && setStep((n) => n + 1);
      if (!w) return next();
      animate(w, { opacity: 0, y: -6 }, { duration: 0.35, ease: 'easeOut' }).finished.then(next);
    }, HOLD_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ready, paused, visible, step, explicit]);

  const word = `${explicit ? fill(c.explicitWord, relation) : CYCLE[step % CYCLE.length]}.`;

  return (
    <h2 ref={ref} id={id} className={['t-statement', s.h2].join(' ')} aria-label={explicit ? `${LEAD.join(' ')} ${word}` : c.ariaLabel}>
      <span className={s.h2Line} aria-hidden="true">
        {LEAD.map((w, i) => (
          <span key={i}>
            <span className={s.w} data-w="">
              {w}
            </span>
            {i < LEAD.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
      <span className={s.h2Line} aria-hidden="true">
        <span className={[s.w, s.cycle].join(' ')} data-w="" data-accent="">
          <em key={explicit ? `picked-${word}` : step} ref={wordRef}>
            {step === 0 || explicit ? word : <LetterArc as="span" text={word} trigger="load" stagger={0.03} decorative />}
          </em>
        </span>
      </span>
    </h2>
  );
}
