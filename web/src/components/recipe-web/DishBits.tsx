'use client';
// Small pieces of the locked recipe view that only the dish version has: her words with the English under
// them, the guess she replaced (struck through), and **bold** runs in a step line. Same looks as the card.
import { Fragment } from 'react';
import { boldRuns } from '@/lib/dish/text';
import type { Quote } from '@/lib/dish/types';
import s from './DishBits.module.css';

/** Her words as she said them; the English under them when she spoke another language. */
export function Her({ quote }: { quote: Quote }) {
  return (
    <>
      <span className={quote.english ? s.own : s.quote} dir="auto">
        “{quote.words}”
      </span>
      {quote.english && <span className={s.english}>“{quote.english}”</span>}
    </>
  );
}

/** The kid's guess her answer replaced. */
export function Was({ text, block }: { text: string; block?: boolean }) {
  return <s className={block ? `${s.was} ${s.wasBlock}` : s.was}>{text}</s>;
}

export function Bold({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <Fragment key={i}>{r.text}</Fragment>))}
    </>
  );
}
