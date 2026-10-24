'use client';
// The parent version's section heading (/teach, FEEDBACK-OCT16 C2): the whole H2 fades up 20px once
// as it enters (Reveal), instead of the kid site's per-word or per-letter builds. Final state with
// reduced motion or no JS. Used by See it work and the sections after it.
//
//   <PlainHeading id="far-apart-h2" className="t-statement" text={t.h2} accent={t.accent} />
//   <PlainHeading text={'Your handful.\nTheir ~½ cup.'} accent={['~½', 'cup.']} accentColor="var(--forest)" />
//
// "\n" starts a new line. The accent phrase (the words joined by spaces) is set in <em> in the
// accent color, on the last line that contains it.
import type { CSSProperties, ElementType } from 'react';
import { Reveal } from '@/components/motion/Reveal';

const LINE: CSSProperties = { display: 'block' };

function Line({ text, accent, color }: { text: string; accent: string | null; color: string }) {
  const i = accent ? text.lastIndexOf(accent) : -1;
  if (!accent || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <em style={{ color }}>{accent}</em>
      {text.slice(i + accent.length)}
    </>
  );
}

export function PlainHeading({
  text,
  accent = [],
  accentColor = 'var(--green)',
  as = 'h2',
  id,
  className,
  style,
}: {
  text: string;
  accent?: readonly string[];
  accentColor?: string;
  as?: ElementType;
  id?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const lines = text.split('\n').map((l) => l.trim());
  const phrase = accent.join(' ');
  // the accent goes on the last line that has it
  let accentLine = -1;
  if (phrase) for (let k = lines.length - 1; k >= 0 && accentLine < 0; k--) if (lines[k].includes(phrase)) accentLine = k;
  return (
    <Reveal as={as} id={id} className={className} style={style} y={20} zoomImages={false} amount={0.5}>
      {lines.length > 1
        ? lines.map((l, k) => (
            <span key={k} style={LINE}>
              <Line text={l} accent={k === accentLine ? phrase : null} color={accentColor} />
            </span>
          ))
        : <Line text={lines[0] ?? ''} accent={accentLine === 0 ? phrase : null} color={accentColor} />}
    </Reveal>
  );
}
