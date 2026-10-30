// "The dish I miss" data contract (docs/build/DISH-I-MISS-SPEC.md). Mirrors web/src/lib/miss/types.ts
// (the shapes the routes return), so change both together. Relation is spelled out here because the
// web imports it from '@/lib/relation'.

export type Relation = "mom" | "dad" | "grandma" | "grandpa" | "auntie" | "uncle" | "none"; // none: no one in particular

/**
 * q1–q3: the 3 questions suggested with the card, linked to its gaps through `ask`.
 * q4–q6: questions the kid wrote themselves (no gap link).
 */
export type QuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6";

/**
 * Where a value on the card came from.
 *   stated   the kid said it, or an attachment shows it
 *   guessed  our guess: its text starts with "~"
 *   unknown  nobody knows yet: amount is ""
 *   mom      the cook's answer replaced it (only in the merged version)
 */
export type Status = "stated" | "guessed" | "unknown" | "mom";

export type MissIngredient = {
  name: string; // plain: "kosher salt", "tomatoes, in wedges"
  amount: string; // "4" | "~3 medium" | "" (unknown) | "two big spoons" (mom: her words)
  status: Status;
  /** the question that would settle it ("Ask Mom" on the best guess) */
  ask: QuestionId | null;
  /** the answer whose clip backs it (play button on Mom's version) */
  clip: QuestionId | null;
  /** Mom's version, on what her answer changed: the guess's amount it replaced (null for a new one) */
  was?: string | null;
  /** Mom's version: her words that settled it */
  quote?: MissQuote | null;
};

export type MissLine = {
  /**
   * one short substep, about 6–10 words and at most 80 characters; amounts, heat and time in **bold**.
   * A step's doneness cue is its last line: "Ready when **the eggs are just set**".
   */
  text: string; // "Fry the tomatoes on **medium-high** until saucy"
  /**
   * the same substep in fuller words, shown in its place on a tap: at most 160 characters, bold as in
   * text; null when it would add nothing
   */
  detail: string | null; // "Fry on **medium-high**, pressing the wedges, until they break down into a sauce"
  status: Status;
  ask: QuestionId | null;
  clip: QuestionId | null;
  /** Mom's version, on what her answer changed: the guess's line it replaced (null for a new line) */
  was?: string | null;
  quote?: MissQuote | null;
};

/** A short piece of her answer, word for word in her language, plus its English (null when she spoke English). */
export type MissQuote = { words: string; english: string | null };

/** The cook's own words for a step, verbatim from her answer, plus an English version when she spoke another language. */
export type MissTip = { words: string; english: string | null; clip: QuestionId };

export type MissStep = {
  title: string; // at most 5 words: "Scramble the eggs"
  lines: MissLine[]; // 1–3
  /** the ingredients this step uses: indexes into `ingredients`, sorted, no repeats */
  uses: number[];
  tip: MissTip | null; // only on the merged version
};

export type MissQuestion = { id: QuestionId; text: string };

export type MissRecipe = {
  /** the dish alone, no possessive, lowercase except proper nouns: "tomato egg" */
  dish: string;
  /** Tonight's version: every card is sized for one person cooking tonight in a dorm or small kitchen */
  servings: string | null; // "1"
  time: string | null; // "~20 min" (the honest time; longer only when the dish truly can't be faster)
  /** rough grocery cost of the whole recipe, always an estimate: "~$3"; null when it can't be judged */
  cost: string | null;
  ingredients: MissIngredient[];
  steps: MissStep[];
  questions: MissQuestion[]; // exactly 3 suggestions (q1–q3); the kid picks, edits or replaces them
};

export type MissAnswer = {
  id: QuestionId;
  words: string; // what she said, verbatim, in her language ("" when there's no version)
  english: string | null; // null when she spoke English
  audio_url: string | null; // signed, about an hour; null while the file is missing
  duration_s: number;
};

export type CardStatus = "draft" | "asked" | "answered";

/**
 * What the kid's page shows. `version` is Mom's version once her answers are merged, and `answers` come
 * with it. 'answered' with `version` null means no version will come (no words were heard, or every
 * merge failed): `answers` then carry only her clips, with words "" and english null.
 */
export type MissCard = {
  relation: Relation;
  kid_name: string | null;
  status: CardStatus;
  draft: MissRecipe;
  version: MissRecipe | null;
  answers: MissAnswer[];
  /**
   * what Mom has been asked, in order (0–6): her answered questions first, then the ones the kid chose
   * last, worded as the kid sent them. A suggestion keeps its id (and its gap) even when reworded.
   */
  asked: MissQuestion[];
  /** the link that goes to Mom: https://homecookd.app/a?t=<ask token> */
  ask_url: string;
  created_at: string;
};

/** What Mom's page gets. Never carries the kid token or the draft. */
export type MissAsk = {
  dish: string;
  relation: Relation;
  kid_name: string | null;
  /** the asked questions she hasn't answered yet, in order (1–3 while the link is open) */
  questions: MissQuestion[];
  answered: QuestionId[];
  finished: boolean;
};

/** Something from home, sent with the dish and never stored. `data` is base64 without a data: prefix. */
export type Attachment = { kind: "photo" | "text" | "voice"; mime: string; data: string };

export type SignedUpload = {
  path: string;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  max_bytes: number;
  expires_in_s: number;
};
