// Word spans for the scrubbed headings (the pass-down heading). Each word is `<span class="w">`
// (inline-block, never broken) so addWordFill() can colour it; accent words carry [data-accent] and
// render in <em>. The accent phrase is kept on one line. Server-safe; the parent heading carries the
// aria-label and these are aria-hidden.
import type { ReactNode } from 'react';
import s from './DeckFilm.module.css';

export interface WordsProps {
  text: string;
  /** exact words to accent (matched as a contiguous phrase) */
  accent?: readonly string[];
  /** wrap accent words in <em> (default) or leave them upright */
  italic?: boolean;
  /** a line break (`<br>`) after the word with this index; hidden on phones so the line wraps freely */
  breakAfter?: number;
}

export function Words({ text, accent = [], italic = true, breakAfter }: WordsProps) {
  const words = text.trim().split(/\s+/);
  let start = -1;
  if (accent.length) {
    for (let i = 0; i + accent.length <= words.length; i++) {
      if (accent.every((a, k) => words[i + k] === a)) start = i;
    }
  }
  const end = start >= 0 ? start + accent.length - 1 : -1;

  const word = (w: string, i: number) => {
    const acc = start >= 0 && i >= start && i <= end;
    return (
      <span key={`w${i}`} className={`w ${s.w}`} data-accent={acc || undefined} aria-hidden="true">
        {acc && italic ? <em>{w}</em> : w}
      </span>
    );
  };
  const gap = (i: number): ReactNode =>
    i === breakAfter ? [' ', <br key={`b${i}`} className={s.brk} />] : i < words.length - 1 ? ' ' : null;

  const out: ReactNode[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i === start && end > start) {
      const run: ReactNode[] = [];
      for (let k = start; k <= end; k++) {
        run.push(word(words[k], k));
        if (k < end) run.push(' ');
      }
      out.push(
        <span key={`g${i}`} className={s.group}>
          {run}
        </span>,
        gap(end),
      );
      i = end;
      continue;
    }
    out.push(word(words[i], i), gap(i));
  }
  return <>{out}</>;
}

/** Split `text` around `part` (first occurrence) → [before, part, after]. */
export function around(text: string, part: string): [string, string, string] {
  const i = text.indexOf(part);
  if (i < 0) return [text, '', ''];
  return [text.slice(0, i).trim(), part, text.slice(i + part.length).trim()];
}
