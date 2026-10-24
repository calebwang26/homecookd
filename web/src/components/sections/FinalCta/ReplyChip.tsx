'use client';
// The abuela star answers the H2: typing dots, then a speech bubble pops from her star once the
// stars have landed. Decorative (aria-hidden); SSR / reduced motion: simply visible.
// Chip in controlled mode (`shown`), timed from the parent's in-view so it answers after the stars land.
import { inView } from 'motion';
import { useEffect, useRef, useState } from 'react';
import { Chip } from '@/components/primitives/Chip';

export function ReplyChip({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- static final state, client only
      setShown(true);
      return;
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const stop = inView(
      el,
      () => {
        stop();
        t = setTimeout(() => setShown(true), 1300);
      },
      { amount: 0.5 },
    );
    return () => {
      stop();
      clearTimeout(t);
    };
  }, []);

  return (
    <span ref={ref} className={className} aria-hidden="true">
      <Chip tone="sun" tail="br" shown={shown} typing wobble rotate={-5}>
        {text}
      </Chip>
    </span>
  );
}
