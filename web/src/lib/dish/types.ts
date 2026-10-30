// The "dish ask" contract (docs/build/DISH-ASK-SPEC.md §3, the Convex /dish/* routes). The kid's page
// (/miss) gets a Card, Mom's page (/a) gets an Ask. convex/lib/dishAsk/types.ts is the server's copy.
import type { Relation as KinRelation } from '@/lib/relation';

/** Who makes the dish; `none` = a craving tied to no one (DISH-ASK-SPEC §10): asking is off until the kid picks someone. */
export type Relation = KinRelation | 'none';

/** q1–q3: suggested with the card (linked to its gaps through `ask`); q4–q6: the kid's own. */
export type QuestionId = 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6';

/** stated: the kid gave it · guessed: our estimate, starts with "~" · unknown: amount "" · mom: her answer settled it */
export type Status = 'stated' | 'guessed' | 'unknown' | 'mom';

/** Her words, word for word in her language, plus the English (null when she spoke English). */
export type Quote = { words: string; english: string | null };

export type Ingredient = {
  name: string;
  amount: string;
  status: Status;
  isGuess: boolean;
  ask: QuestionId | null;
  clip: QuestionId | null;
  /** Mom's version only: the guess's amount it replaced (struck through); null for a new one */
  was: string | null;
  quote: Quote | null;
};

export type Line = {
  text: string;
  /** A short form of about 6 words ("Scramble eggs soft."); absent → show `text` (no cutting on the client). */
  short?: string | null;
  detail: string | null;
  status: Status;
  isGuess: boolean;
  ask: QuestionId | null;
  clip: QuestionId | null;
  was: string | null;
  quote: Quote | null;
};

export type Step = {
  title: string;
  lines: Line[];
  uses: number[];
  tip: { words: string; english: string | null; clip: QuestionId } | null;
};

export type Question = { id: QuestionId; text: string };

/** A part of the guess, as DISH-ASK-SPEC §10 points at it: an index into `ingredients`, or into `steps[step].lines`. */
export type PartRef = { kind: 'ingredient'; index: number } | { kind: 'line'; step: number; line: number };

/** cards/ask: a suggested question (id + text), the kid's words, or just a part (`about`; the server writes the question). */
export type AskItem = { id?: QuestionId; text?: string; about?: PartRef };

/** cards/update `edits`: what the kid remembers differently. The part becomes `status: 'stated'`. */
export type Edit = { kind: 'ingredient'; index: number; name?: string; amount?: string } | { kind: 'line'; step: number; line: number; text?: string };

export type Recipe = {
  dish: string;
  servings: string | null;
  time: string | null;
  cost: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  questions: Question[];
};

export type Answer = { id: QuestionId; words: string; english: string | null; audioUrl: string | null; durationS: number };

export type CardStatus = 'draft' | 'asked' | 'answered';

export type Card = {
  dish: string;
  relation: Relation;
  kidName: string | null;
  status: CardStatus;
  guess: Recipe;
  version: Recipe | null;
  answers: Answer[];
  merging: boolean;
  asked: Question[];
  message: string;
  kidVoiceUrl: string | null;
  /** its length in seconds, as the page measured it (cards/update `voiceNoteS`) */
  kidVoiceS: number | null;
  photoUrls: string[];
  /** null while `relation` is `none`: asking is off until the kid picks someone */
  askUrl: string | null;
  askedAt: number | null;
  openedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
};

/** Her version translated too, once merged; her quotes and tips stay as she said them. */
export type InLang = { lang: string; guess: Recipe; questions: Question[]; message: string; version?: Recipe | null };

export type Ask = {
  dish: string;
  relation: Relation;
  kidName: string | null;
  message: string;
  kidVoiceUrl: string | null;
  kidVoiceS: number | null;
  guess: Recipe;
  inLang: InLang | null;
  photoUrls: string[];
  questions: Question[];
  answered: QuestionId[];
  clips: { id: QuestionId; audioUrl: string | null; durationS: number }[];
  finished: boolean;
  version: Recipe | null;
  merging: boolean;
};

export type FileKind = 'photo' | 'voice';
export type SendVia = 'copy' | 'sms' | 'instagram' | 'whatsapp' | 'more';
