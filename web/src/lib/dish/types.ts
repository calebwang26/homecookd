// The "dish ask" contract (docs/build/DISH-ASK-SPEC.md §3, the Convex /dish/* routes). The kid's page
// (/miss) gets a Card, Mom's page (/a) gets an Ask. convex/lib/dishAsk/types.ts is the server's copy.
import type { Relation } from '@/lib/relation';

export type { Relation };

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
  photoUrls: string[];
  askUrl: string;
  askedAt: number | null;
  openedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
};

export type InLang = { lang: string; guess: Recipe; questions: Question[]; message: string };

export type Ask = {
  dish: string;
  relation: Relation;
  kidName: string | null;
  message: string;
  kidVoiceUrl: string | null;
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
