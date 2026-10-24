'use client';
// Final CTA H2 (brief 8.12): "Ask them to teach you." → "Ask {R} to teach you." once a relation is
// picked (nav picker or ?for=). Two lines, VERO letter unfurl; it replays when the relation changes.
// The parent version (/teach): the same two lines, fading up once (PlainHeading).
import type { CSSProperties } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { PlainHeading } from '@/components/sections/SeeItWork/PlainHeading';
import { fill } from '@/lib/relation';
import { useRelation } from '@/components/providers/RelationProvider';
import { LetterArc } from '@/components/motion/LetterArc';

export function CtaHeading({ id, className }: { id: string; className?: string }) {
  const T = useCopy().finalCta;
  const parent = useAudience() === 'parent';
  const { relation, explicit } = useRelation();
  const text = explicit ? fill(T.h2Explicit, relation) : T.h2Default;
  // break before the accent phrase when it ends the heading: "Ask Grandma to / teach you."
  const acc = T.accent.join(' ');
  const lines = text.endsWith(` ${acc}`) ? `${text.slice(0, -acc.length - 1)}\n${acc}` : text;
  if (parent) return <PlainHeading id={id} className={className} text={lines} accent={T.accent} accentColor="var(--chartreuse)" />;
  return (
    <LetterArc
      key={lines}
      as="h2"
      id={id}
      className={className}
      text={lines}
      accent={T.accent}
      style={{ ['--accent' as string]: 'var(--chartreuse)' } as CSSProperties}
    />
  );
}
