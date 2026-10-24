// Split a heading into words (brief 5 "SplitWords"). Server-safe; no motion by itself.
//
//   <SplitWords as="h2" className="t-statement" text={copy.passDown.h2} accent={copy.passDown.accent} />
//   <SplitWords as="p" text={'Set up the camera.\nRecord.\nDone.'} accent={['Record.']} accentStyle="color" />
//   <SplitWords as="p" text="You call home: how much?" accent={['how', 'much?']}
//     slot={{ afterWord: 4, node: <span className={s.callSlot} /> }} />
//
// Output: <Tag aria-label={text}> (headings; other tags get a visually hidden copy of the text
// instead, because aria-label is ignored on generic elements) with one <span class="w" aria-hidden data-i={n}> per word
// (inline-block, never broken), accent words carry [data-accent] and wrap their text in <em>
// (accentStyle="italic", default) or <span class="accentColor"> (accentStyle="color").
// "\n" starts a new line: each line is <span class="line" data-line={i}> (display block).
// Final colors come from CSS: words inherit `color`; accent words use var(--accent, var(--green)).
// Scrubbed scenes animate `.w` with addWordFill(); WordReveal animates them on enter.
import type { CSSProperties, ElementType, ReactNode } from 'react';
import styles from './SplitWords.module.css';

export interface SplitWordsProps {
  text: string;
  /** exact words to accent, matched as a contiguous phrase first, then word by word */
  accent?: readonly string[];
  /** 'italic' → <em> (Fraunces WONK italic), 'color' → upright, accent color only */
  accentStyle?: 'italic' | 'color';
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  id?: string;
  /** an inline element measured as a "word" (a7 M12 inline thumbnail), inserted after word index `afterWord` (0-based) */
  slot?: { afterWord: number; node: ReactNode };
  /** extra attributes for the root (data-*, etc.) */
  rootProps?: Record<string, unknown>;
  /** class added to every word span */
  wordClassName?: string;
}

export interface SplitToken {
  word: string;
  accent: boolean;
  index: number;
}

/** Split text into lines of word tokens and mark the accent words. */
export function splitText(text: string, accent: readonly string[] = []): SplitToken[][] {
  const lines = text.split('\n').map((l) => l.trim().split(/\s+/).filter(Boolean));
  const flat = lines.flat();
  const marked = new Array(flat.length).fill(false);
  if (accent.length) {
    // contiguous phrase match first (last occurrence wins, e.g. "In their words. In yours.")
    let found = -1;
    for (let i = 0; i + accent.length <= flat.length; i++) {
      if (accent.every((a, k) => flat[i + k] === a)) found = i;
    }
    if (found >= 0) for (let k = 0; k < accent.length; k++) marked[found + k] = true;
    else flat.forEach((w, i) => (marked[i] = accent.includes(w)));
  }
  let n = 0;
  return lines.map((ws) => ws.map((word) => ({ word, accent: marked[n], index: n++ })));
}

export function SplitWords({
  text,
  accent,
  accentStyle = 'italic',
  as: Tag = 'span',
  className,
  style,
  id,
  slot,
  rootProps,
  wordClassName,
}: SplitWordsProps) {
  const lines = splitText(text, accent);
  const multiline = lines.length > 1;
  const label = text.replace(/\s*\n\s*/g, ' ');
  const labelled = typeof Tag === 'string' && /^h[1-6]$/.test(Tag);
  const wc = [styles.w, 'w', wordClassName].filter(Boolean).join(' ');

  const renderLine = (tokens: SplitToken[]) =>
    tokens.map((t, k) => (
      <span key={t.index} style={{ display: 'contents' }}>
        <span className={wc} aria-hidden="true" data-i={t.index} data-accent={t.accent || undefined}>
          {t.accent ? accentStyle === 'italic' ? <em>{t.word}</em> : <span className={styles.accentColor}>{t.word}</span> : t.word}
        </span>
        {slot && slot.afterWord === t.index ? (
          <>
            {' '}
            <span className={styles.slot} data-slot="" aria-hidden="true">
              {slot.node}
            </span>
          </>
        ) : null}
        {k < tokens.length - 1 ? ' ' : null}
      </span>
    ));

  return (
    <Tag
      id={id}
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      aria-label={labelled ? label : undefined}
      data-split=""
      {...rootProps}
    >
      {labelled ? null : <span className="sr-only">{label}</span>}
      {multiline
        ? lines.map((tokens, i) => (
            <span key={i} className={`${styles.line} line`} data-line={i}>
              {renderLine(tokens)}
            </span>
          ))
        : renderLine(lines[0] ?? [])}
    </Tag>
  );
}
