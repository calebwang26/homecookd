// The dish ask's Convex validators, limits and error shape (docs/build/DISH-ASK-SPEC.md), shared by the schema,
// convex/dishAsks.ts and the routes (lib/dishAskRoutes.ts). The recipe types themselves are lib/dishAsk/types.ts;
// these validators hold the same shapes, so a recipe that passes lib/dishAsk/validate.ts can be stored as it is.
import { ConvexError, type Infer, v } from "convex/values";
import type { MissRecipe } from "./dishAsk/types";

export const relationV = v.union(
  v.literal("mom"),
  v.literal("dad"),
  v.literal("grandma"),
  v.literal("grandpa"),
  v.literal("auntie"),
  v.literal("uncle"),
);
export const questionIdV = v.union(v.literal("q1"), v.literal("q2"), v.literal("q3"), v.literal("q4"), v.literal("q5"), v.literal("q6"));
const statusV = v.union(v.literal("stated"), v.literal("guessed"), v.literal("unknown"), v.literal("mom"));
const linkV = v.union(questionIdV, v.null());
const maybeText = v.union(v.string(), v.null());

export const questionV = v.object({ id: questionIdV, text: v.string() });
const tipV = v.object({ words: v.string(), english: maybeText, clip: questionIdV });
/** A short piece of her answer, word for word in her language, and its English (null when she spoke English). */
const quoteV = v.object({ words: v.string(), english: maybeText });
const ingredientFields = { name: v.string(), amount: v.string(), status: statusV, ask: linkV, clip: linkV };
const lineFields = { text: v.string(), detail: maybeText, status: statusV, ask: linkV, clip: linkV };
/** Mom's version only, on what her answer changed: the guess's value it replaced, and her words that settled it. */
const changeFields = { was: v.optional(maybeText), quote: v.optional(v.union(quoteV, v.null())) };
const shownChangeFields = { was: maybeText, quote: v.union(quoteV, v.null()), isGuess: v.boolean() };
const recipeFields = { dish: v.string(), servings: maybeText, time: maybeText, cost: maybeText, questions: v.array(questionV) };

/** A recipe as stored: the kid's guess or Mom's version (MissRecipe). */
export const recipeV = v.object({
  ...recipeFields,
  ingredients: v.array(v.object({ ...ingredientFields, ...changeFields })),
  steps: v.array(
    v.object({
      title: v.string(),
      lines: v.array(v.object({ ...lineFields, ...changeFields })),
      uses: v.array(v.number()),
      tip: v.union(tipV, v.null()),
    }),
  ),
});

/** A recipe as the pages get it: each ingredient and line says whether it's the kid's guess, and `was`/`quote` are null when unset. */
export const shownRecipeV = v.object({
  ...recipeFields,
  ingredients: v.array(v.object({ ...ingredientFields, ...shownChangeFields })),
  steps: v.array(
    v.object({
      title: v.string(),
      lines: v.array(v.object({ ...lineFields, ...shownChangeFields })),
      uses: v.array(v.number()),
      tip: v.union(tipV, v.null()),
    }),
  ),
});

export type StoredRecipe = Infer<typeof recipeV>;
export type ShownRecipe = Infer<typeof shownRecipeV>;

export const cardStatusV = v.union(v.literal("draft"), v.literal("asked"), v.literal("answered"));
export const VIAS = ["copy", "sms", "instagram", "whatsapp", "more"] as const;
export const viaV = v.union(v.literal("copy"), v.literal("sms"), v.literal("instagram"), v.literal("whatsapp"), v.literal("more"));

/** One of her clips as Mom's page plays it back. */
export const clipV = v.object({ id: questionIdV, audioUrl: maybeText, durationS: v.number() });

export const answerV = v.object({
  id: questionIdV,
  words: v.string(),
  english: maybeText,
  audioUrl: maybeText,
  durationS: v.number(),
});

/** What the kid's page gets (spec §3 Card). */
export const cardV = v.object({
  dish: v.string(),
  relation: relationV,
  kidName: maybeText,
  status: cardStatusV,
  guess: shownRecipeV,
  version: v.union(shownRecipeV, v.null()),
  answers: v.array(answerV),
  merging: v.boolean(),
  asked: v.array(questionV),
  message: v.string(),
  kidVoiceUrl: maybeText,
  photoUrls: v.array(v.string()),
  askUrl: v.string(),
  askedAt: v.union(v.number(), v.null()),
  openedAt: v.union(v.number(), v.null()),
  finishedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
});

/** What Mom's page gets (spec §3 Ask): never the kid token. */
export const askV = v.object({
  dish: v.string(),
  relation: relationV,
  kidName: maybeText,
  message: v.string(),
  kidVoiceUrl: maybeText,
  guess: shownRecipeV,
  /** The same in the page's language (peek's `lang`), or null: English. Ids, statuses, `uses` and ** unchanged. */
  inLang: v.union(v.object({ lang: v.string(), guess: shownRecipeV, questions: v.array(questionV), message: v.string() }), v.null()),
  photoUrls: v.array(v.string()),
  questions: v.array(questionV),
  answered: v.array(questionIdV),
  clips: v.array(clipV),
  finished: v.boolean(),
  version: v.union(shownRecipeV, v.null()),
  merging: v.boolean(),
});

export type Card = Infer<typeof cardV>;
export type Ask = Infer<typeof askV>;

type Quote = Infer<typeof quoteV>;
type Change = { was?: string | null; quote?: Quote | null };

/** `was` and `quote` as stored: null when the model layer left them out. */
function changeOf(x: object): { was: string | null; quote: Quote | null } {
  const c = x as Change;
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
      lines: s.lines.map((l) => ({ text: l.text, detail: l.detail, status: l.status, ask: l.ask, clip: l.clip, ...changeOf(l) })),
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
  } as MissRecipe;
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
// Limits

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** The voice note types, and Mom's clips' (Chrome's and Firefox's MediaRecorder, Safari and iPhone). */
export const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"];
/** What Mom may speak, for Ink. */
export const LANGS = ["en", "hi", "mr", "gu", "ta", "te", "pa", "ur", "bn", "zh", "ko", "es", "tl", "ar", "pt", "vi"];

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
/** Merges: at most 5 tries per round of new answers, at least 3 minutes apart (a try is at most 2 minutes). */
export const MAX_MERGES = 5;
export const MERGE_STALE_MS = 3 * 60_000;
/** Answers left this long without Send (she closed the tab) count as sent, unless the kid asked since. */
export const ABANDONED_MS = 20 * 60_000;
/** An upload not on a card by then is deleted (nobody saved it). */
export const ORPHAN_MS = 60 * 60_000;

/** TODO(caleb): the daily model budget, in dollars. Over it, no new cards today. */
export const DAILY_BUDGET_USD = 10;
/** TODO(caleb): how far past the budget Mom's transcription, translation and merge may still go. */
export const MOM_OVERAGE_USD = 1;

/** "2026-10-29": the UTC day the budget counts in. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Errors: `{error, code}` with the spec's statuses. Mutations throw these as ConvexError, so nothing they
// started is written, and the routes send them as they are.

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
  | "model"
  | "not_set_up";
export type FailData = { status: number; code: FailCode; error: string };

export const fail = (status: number, code: FailCode, error: string) => new ConvexError<FailData>({ status, code, error });
export const badRequest = (error: string) => fail(400, "bad_request", error);
export const NOT_FOUND = "This link doesn't work anymore.";
export const notFound = (error = NOT_FOUND) => fail(404, "not_found", error);
export const WORDS = "Some of those words can't be used here. Try other words.";

export function failOf(e: unknown): FailData | null {
  if (!(e instanceof ConvexError)) return null;
  const d = e.data as Partial<FailData> | null;
  return d && typeof d === "object" && typeof d.status === "number" && typeof d.code === "string" && typeof d.error === "string"
    ? (d as FailData)
    : null;
}
