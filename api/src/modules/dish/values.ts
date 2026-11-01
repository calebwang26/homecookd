// The dish ask's limits, shapes and errors (docs/build/DISH-ASK-SPEC.md, convex/lib/dishAskValues.ts). The website reads `{error, code}`
// with these statuses, and the sentences are shown to people, so none of them can change without changing the site.
import { createHash } from "node:crypto";
import type { MissQuestion, MissRecipe, QuestionId, Relation } from "./recipe/types.js";
import { LIMITS } from "./recipe/validate.js";
import type { Limit } from "../../rateLimit.js";

// ---------------------------------------------------------------------------------------------
// Tokens

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const TOKEN = /^[0-9A-Za-z]{22}$/;

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** 22 random base62 characters (rejection sampling, so no modulo bias): a kid token or a file id. */
export function randomBase62(length = 22): string {
  const limit = 256 - (256 % BASE62.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += BASE62[b % BASE62.length];
    }
  }
  return out;
}

/** The ask token: the first 22 base62 digits of sha256("ask:" + kidToken), so the kid's link can always rebuild it. */
export function askTokenFor(kidToken: string): string {
  let n = BigInt(`0x${sha256Hex(`ask:${kidToken}`)}`);
  let digits = "";
  while (n > 0n) {
    digits = BASE62[Number(n % 62n)] + digits;
    n /= 62n;
  }
  return digits.padStart(43, "0").slice(0, 22);
}

// ---------------------------------------------------------------------------------------------
// Limits

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** The voice note types, and Mom's clips' (Chrome's and Firefox's MediaRecorder, Safari and iPhone). */
export const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"];
/** What Mom may speak, for Ink. */
export const LANGS = ["en", "hi", "mr", "gu", "ta", "te", "pa", "ur", "bn", "zh", "ko", "es", "tl", "ar", "pt", "vi"];
export const VIAS = ["copy", "sms", "instagram", "whatsapp", "more"] as const;

export const MB = 1024 * 1024;
export const JSON_BYTES = 64 * 1024;
export const PHOTO_BYTES = 5 * MB;
export const VOICE_BYTES = 3 * MB;
export const CLIP_BYTES = 5 * MB;
export const MAX_PHOTOS = 3;
export const MESSAGE_CHARS = 500;
/** Mom's clips: 120 s, and up to 125 s is taken (timer slack) and saved as 120. */
export const MAX_CLIP_S = 120;
export const CLIP_SLACK_S = 5;
/** The kid's voice note to Mom is at most a minute (the page stops recording there). */
export const KID_VOICE_S = 60;
export const MAX_EDITS = 20;
export const LIMITS_WORDS = LIMITS.words;
/** Merges: at most 5 tries per round of new answers, at least 3 minutes apart (a try is at most 2 minutes). */
export const MAX_MERGES = 5;
export const MERGE_STALE_MS = 3 * 60_000;
/** Answers left this long without Send (she closed the tab) count as sent, unless the kid asked since. */
export const ABANDONED_MS = 20 * 60_000;
/** An upload not on a card by then is deleted (nobody saved it). */
export const ORPHAN_MS = 60 * 60_000;
/** C4: an anonymous card's ip_key goes after this long. */
export const IP_KEY_DAYS = 90;

/** TODO(caleb): the daily model budget, in dollars. Over it, no new cards today. */
export const DAILY_BUDGET_USD = 10;
/** TODO(caleb): how far past the budget Mom's transcription, translation and merge may still go. */
export const MOM_OVERAGE_USD = 1;

/** "2026-10-29": the UTC day the budget counts in. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const RATE = {
  cards: { bucket: "dish-cards", max: 6, windowS: 10 * MINUTE },
  cardsDay: { bucket: "dish-cards-day", max: 30, windowS: DAY },
  badTokens: { bucket: "dish-bad", max: 20, windowS: 10 * MINUTE },
  files: { bucket: "dish-files", max: 30, windowS: 10 * MINUTE },
  ask: { bucket: "dish-ask", max: 30, windowS: 10 * MINUTE },
  answer: { bucket: "dish-answer", max: 30, windowS: 10 * MINUTE },
  /** Translating one card's page into one language (keyed by card and language, not IP): her 2-second polls never pay for more
   *  than 3 tries an hour when Claude fails or a reload lands mid-translation. */
  momLang: { bucket: "dish-mom-lang", max: 3, windowS: 60 * MINUTE },
} satisfies Record<string, Limit>;

// ---------------------------------------------------------------------------------------------
// Where the pages live: homecookd.app, or a test site while 1.0 is in App Review (convex/lib/webOrigin.ts).

const DEFAULT_ORIGIN = "https://homecookd.app";

export function webOrigin(): string {
  const o = process.env.DISH_WEB_ORIGIN?.trim();
  return o && /^https:\/\/[a-z0-9.-]+$/.test(o) ? o : DEFAULT_ORIGIN;
}

export const askUrlOf = (askToken: string) => `${webOrigin()}/a?t=${askToken}`;

// ---------------------------------------------------------------------------------------------
// Shapes

export type StoredRecipe = MissRecipe;
export type ShownRecipe = Omit<MissRecipe, "ingredients" | "steps"> & {
  ingredients: (MissRecipe["ingredients"][number] & { was: string | null; quote: Quote | null; isGuess: boolean })[];
  steps: (Omit<MissRecipe["steps"][number], "lines"> & {
    lines: (MissRecipe["steps"][number]["lines"][number] & { was: string | null; quote: Quote | null; isGuess: boolean })[];
  })[];
};
type Quote = { words: string; english: string | null };

export type CardStatus = "draft" | "asked" | "answered";

export type Card = {
  dish: string;
  relation: Relation;
  kidName: string | null;
  status: CardStatus;
  guess: ShownRecipe;
  version: ShownRecipe | null;
  answers: { id: QuestionId; words: string; english: string | null; audioUrl: string | null; durationS: number }[];
  merging: boolean;
  asked: MissQuestion[];
  message: string;
  kidVoiceUrl: string | null;
  kidVoiceS: number | null;
  photoUrls: string[];
  askUrl: string | null;
  askedAt: number | null;
  openedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  filmingDay: number | null;
};

export type Ask = {
  dish: string;
  relation: Relation;
  kidName: string | null;
  message: string;
  kidVoiceUrl: string | null;
  kidVoiceS: number | null;
  guess: ShownRecipe;
  inLang: { lang: string; guess: ShownRecipe; questions: MissQuestion[]; message: string; version: ShownRecipe | null } | null;
  photoUrls: string[];
  questions: MissQuestion[];
  answered: QuestionId[];
  clips: { id: QuestionId; audioUrl: string | null; durationS: number }[];
  finished: boolean;
  version: ShownRecipe | null;
  merging: boolean;
};

function changeOf(x: object): { was: string | null; quote: Quote | null } {
  const c = x as { was?: string | null; quote?: Quote | null };
  return { was: c.was ?? null, quote: c.quote ? { words: c.quote.words, english: c.quote.english ?? null } : null };
}

/** Exactly the stored fields of a recipe (a model's answer may carry more). */
export function storedRecipe(r: MissRecipe): StoredRecipe {
  return {
    dish: r.dish,
    servings: r.servings,
    time: r.time,
    cost: r.cost,
    ingredients: r.ingredients.map((i) => ({ name: i.name, amount: i.amount, status: i.status, ask: i.ask, clip: i.clip, ...changeOf(i) })),
    steps: r.steps.map((s) => ({
      title: s.title,
      lines: s.lines.map((l) => ({ text: l.text, detail: l.detail, short: l.short ?? null, status: l.status, ask: l.ask, clip: l.clip, ...changeOf(l) })),
      uses: [...s.uses],
      tip: s.tip ? { words: s.tip.words, english: s.tip.english, clip: s.tip.clip } : null,
    })),
    questions: r.questions.map((q) => ({ id: q.id, text: q.text })),
  };
}

/** A stored recipe as the model layer takes it (`was` and `quote` null where unset). */
export function missRecipe(r: StoredRecipe): MissRecipe {
  return {
    ...r,
    ingredients: r.ingredients.map((i) => ({ ...i, ...changeOf(i) })),
    steps: r.steps.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, ...changeOf(l) })) })),
  };
}

/** A stored recipe as the pages get it: isGuess on each ingredient and line, `was` and `quote` null where unset. */
export function shownRecipe(r: StoredRecipe): ShownRecipe {
  const isGuess = (status: string) => status === "guessed" || status === "unknown";
  return {
    ...r,
    ingredients: r.ingredients.map((i) => ({ ...i, ...changeOf(i), isGuess: isGuess(i.status) })),
    steps: r.steps.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, ...changeOf(l), isGuess: isGuess(l.status) })) })),
  };
}

/** Every word of a recipe a person reads, for the word filter. */
export function recipeTexts(r: StoredRecipe): string[] {
  return [
    r.dish,
    r.time ?? "",
    r.cost ?? "",
    ...r.ingredients.flatMap((i) => [i.name, i.amount, i.was ?? "", i.quote?.words ?? "", i.quote?.english ?? ""]),
    ...r.steps.flatMap((s) => [
      s.title,
      ...s.lines.flatMap((l) => [l.text, l.detail ?? "", l.was ?? "", l.quote?.words ?? "", l.quote?.english ?? ""]),
      s.tip?.words ?? "",
      s.tip?.english ?? "",
    ]),
    ...r.questions.map((q) => q.text),
  ];
}

// ---------------------------------------------------------------------------------------------
// Errors

export type FailCode =
  | "bad_request"
  | "origin"
  | "not_found"
  | "closed"
  | "too_large"
  | "bad_type"
  | "not_a_dish"
  | "words"
  | "rate"
  | "budget"
  | "model"
  | "not_set_up"
  | "storage";

/** Thrown inside tx(), it rolls the work back, as a ConvexError did. */
export class DishFail extends Error {
  constructor(
    readonly status: number,
    readonly code: FailCode,
    readonly sentence: string,
  ) {
    super(code); // never the sentence: it can't reach a log by accident
    this.name = "DishFail";
  }
}

export const fail = (status: number, code: FailCode, sentence: string) => new DishFail(status, code, sentence);
export const badRequest = (sentence: string) => fail(400, "bad_request", sentence);
export const NOT_FOUND = "This link doesn't work anymore.";
export const FILE_GONE = "That file doesn't work anymore. Add it again.";
export const notFound = (sentence = NOT_FOUND) => fail(404, "not_found", sentence);
export const WORDS = "Some of those words can't be used here. Try other words.";
export const SORRY = "Something went wrong on our side. Please try again.";
export const TOO_MANY = "Too many tries. Please wait a few minutes and try again.";
export const BUDGET = "homecookd has made all the recipes it can today. Try again tomorrow.";
