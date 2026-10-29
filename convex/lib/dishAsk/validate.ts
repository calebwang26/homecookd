// Pure checks for the `miss` function (no Deno globals, no network), so tests can call them directly:
// the request fields, and what the models send back (DISH-I-MISS-SPEC.md §3): Claude's draft and
// merge, and Gemini's transcripts of the audio.
//
// The models' answers are never trusted as they come:
// - Draft: the sizes, the short titles and substeps, and the 3 questions must hold, or the call is
//   retried with these errors. Easy slips are fixed in place instead: a guessed amount gets its "~", a
//   "stated" amount or time nobody gave becomes a guess, servings is always "1" (Tonight's version), a
//   cost that isn't a rough "~$N" of at most $40 becomes null, stray "**" go, bad `uses` indexes drop, a
//   "Ready when" line moves to the end of its step, a substep's fuller wording is cut to fit (or
//   dropped when it leaves out the line's amounts, heat or times), a question that asks two
//   things (", or …", ", and …") keeps the first, and one that ends on the dish's name loses it.
// - Transcripts: one per clip sent, each once, within the size limit, or the call is retried.
// - Merge: Claude only says what her answers change (by ref), and the server writes Mom's version from
//   the draft, with all her answers each time. So everything she didn't settle keeps its draft value and
//   its ask, the questions never change, a line is hers only when it points at a clip she answered and
//   its amounts, heat and times are in her words there (else it keeps the draft's), her "Ready when"
//   takes the guessed one's place, a tip is kept only when its words are in her transcript, and
//   something is removed only when her own words name it with a "no" or "never". The card stays one
//   serving, and its cost changes only when her answers add or remove an ingredient.

import type {
  MissIngredient,
  MissLine,
  MissQuestion,
  MissRecipe,
  MissStep,
  QuestionId,
  Relation,
  Status,
  MissQuote,
} from "./types";

export const RELATIONS: readonly Relation[] = ["mom", "dad", "grandma", "grandpa", "auntie", "uncle"];
export const RELATION_LABEL: Record<Relation, string> = {
  mom: "Mom",
  dad: "Dad",
  grandma: "Grandma",
  grandpa: "Grandpa",
  auntie: "Auntie",
  uncle: "Uncle",
};
/** Every question id: q1–q3 the card's suggestions (linked to its gaps), q4–q6 the kid's own. */
export const QUESTION_IDS: readonly QuestionId[] = ["q1", "q2", "q3", "q4", "q5", "q6"];
export const SUGGESTION_IDS: readonly QuestionId[] = ["q1", "q2", "q3"];
export const OWN_IDS: readonly QuestionId[] = ["q4", "q5", "q6"];

export const LIMITS = {
  dish: 200,
  dishName: 80,
  kidName: 40,
  ingredients: [3, 12],
  versionIngredients: 14,
  steps: [2, 6],
  lines: [1, 3],
  /** characters as read, without the "**" */
  lineText: 80,
  lineDetail: 160,
  title: 40,
  titleWords: 5,
  question: 90,
  /** a question the kid asks (POST /cards/ask), after trimming */
  asked: [3, 120],
  /** asked at once (unanswered), and in all */
  askOpen: 3,
  askTotal: 6,
  name: 80,
  amount: 40,
  tip: 200,
  /** a change's quote (her words that settled it), as read */
  quote: 120,
  fact: 30,
  words: 5000,
  /** dollars: a one-person card over this is a wrong estimate, so it's dropped */
  cost: 40,
  /** minutes: a card slower than this is kept (honest), and logged */
  longTime: 45,
} as const;

/** Tonight's version: every card, and Mom's version of it, is one serving. */
export const SERVINGS = "1";

export const isRelation = (v: unknown): v is Relation => typeof v === "string" && (RELATIONS as string[]).includes(v);
export const isQuestionId = (v: unknown): v is QuestionId =>
  typeof v === "string" && (QUESTION_IDS as string[]).includes(v);
export const isSuggestionId = (v: unknown): v is QuestionId =>
  typeof v === "string" && (SUGGESTION_IDS as string[]).includes(v);

/** A question as the kid typed it: control characters out (a line break becomes a space), spaces collapsed, trimmed. */
export const askedText = (s: string) =>
  s.replace(/[\t\n\r\v\f\u2028\u2029]/g, " ").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// File types

/** A content type without its parameters: "audio/webm;codecs=opus" → "audio/webm". */
export const baseType = (t: string) => t.split(";")[0].trim().toLowerCase();

/** Mom's clips: the content types /asks/voice accepts (the `miss-voice` bucket's list) → file extension. */
export const VOICE_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

/** Gemini's name for a stored clip, by extension (iPhone's AAC-in-MP4 is audio/mp4). */
export const GEMINI_AUDIO: Record<string, string> = {
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mp3",
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** The picture types Claude reads (the web always sends JPEG, redrawn at 1600 px). */
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};
const AUDIO_TYPES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(VOICE_EXT).map(([type, ext]) => [type, GEMINI_AUDIO[ext]])),
  "audio/mp3": "audio/mp3",
  "audio/x-aac": "audio/aac",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/opus": "audio/ogg",
  "audio/flac": "audio/flac",
  "audio/x-flac": "audio/flac",
  "audio/aiff": "audio/aiff",
  "audio/x-aiff": "audio/aiff",
};

/** An attachment's type as Claude (a picture) or Gemini (a voice note) names it; null when that kind can't be this type. */
export function attachmentType(kind: "photo" | "text" | "voice", mime: string): string | null {
  return (kind === "voice" ? AUDIO_TYPES : IMAGE_TYPES)[baseType(mime)] ?? null;
}

/** Decoded size of standard base64 (no data: prefix, no line breaks), or -1 when it isn't base64. */
export function base64Bytes(data: string): number {
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return -1;
  return (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// "Word for word": the same letters and digits in the same order, ignoring case, spaces and
// punctuation (so “Don’t” matches "dont", and 一点糖。 matches 一点糖). Number words count as digits.

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  fifteen: "15",
  twenty: "20",
  thirty: "30",
};

export function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w)
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

/** Whether `excerpt` appears word for word in `source` (at least `min` letters or digits). */
export function verbatimIn(excerpt: string, source: string, min = 2): boolean {
  const e = norm(excerpt);
  return e.length >= min && norm(source).includes(e);
}

/** The numbers in a text, number words as digits: "two eggs, 1/2 tsp" → ["2", "1", "2"]. */
export function numbersOf(s: string): string[] {
  return s.normalize("NFKC").toLowerCase().replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w).match(/\d+/g) ?? [];
}

/**
 * Whether an amount is in her words: each of its parts ("a little, if the tomatoes are sour") word for
 * word in `source`.
 */
export function amountIn(amount: string, source: string): boolean {
  const parts = amount.split(/[,;]/).filter((p) => norm(p));
  return parts.length > 0 && parts.every((p) => verbatimIn(p, source, 1));
}

/**
 * Whether a line of hers says only what she said, as far as the server can tell: its bold amounts,
 * heat and times are word for word in `source`, and so is every number in it. (A "Ready when" line's
 * bold is her cue, which may be said in other words: only its numbers count.)
 */
export function lineIn(line: string, source: string): boolean {
  const bold = isReady(line) ? [] : [...line.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
  const said = new Set(numbersOf(source));
  return bold.every((b) => verbatimIn(b, source, 1)) && numbersOf(plain(line)).every((n) => said.has(n));
}

/** Words that rule something out: "no", "never", "don't", "without"… */
const NEGATION =
  /(^|[^\p{L}])(no|not|never|without|none|nothing|skip|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|isn'?t|aren'?t)(?![\p{L}])/iu;
export const negates = (s: string) => NEGATION.test(s.normalize("NFKC").replace(/[’‘`]/g, "'"));

/** Words that never name a thing on the card (so "no, not in the pan" names nothing, nor "I add it"). */
const NOT_A_NAME = new Set(
  ("the a an and or of in on to with for at it its into onto over under until then from by your you them they " +
    "this that is are be when ready about each some more less very just all any one two half " +
    "tbsp tsp tablespoon tablespoons teaspoon teaspoons cup cups min mins minute minutes sec secs second seconds " +
    "hour hours low medium high heat pinch dash handful little bit lot add put use make get let keep cook")
    .split(" "),
);
const wordsOf = (s: string) => (plain(s).normalize("NFKC").toLowerCase().match(/\p{L}+/gu) ?? []);
/** "tomato" and "tomatoes", "egg" and "eggs" are the same word here. */
const sameWord = (a: string, b: string) => a === b || [a, b].some((x, i) => [x + "s", x + "es"].includes(i ? a : b));

/**
 * Whether her words name a thing on the card: an ingredient by its name (before any comma: "tomatoes,
 * in wedges" is named by "tomato"), a line by any word in it that isn't small or a measure.
 */
export function namesIt(excerpt: string, thing: string, ingredient: boolean): boolean {
  const name = ingredient ? thing.split(",")[0] : thing;
  const keys = wordsOf(name).filter((w) => w.length >= 3 && !NOT_A_NAME.has(w));
  const said = wordsOf(excerpt);
  return keys.some((k) => said.some((w) => sameWord(k, w)));
}

// ---------------------------------------------------------------------------------------------
// Small readers for untrusted JSON

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** "~ 3 medium" → "~3 medium"; adds the "~" when it's missing. */
const tilde = (s: string) => `~${s.replace(/^~\s*/, "")}`;

// ---------------------------------------------------------------------------------------------
// Bold: a substep puts **…** around an amount, the heat or a time, and the pages render it in 700.

/** Text as it reads, without the "**" (names, amounts and titles are never bold). */
export const plain = (s: string) => s.replaceAll("**", "").replace(/\s+/g, " ").trim();

/** At most n characters, cut at a word, with "…" when cut. */
export function cutAt(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1).replace(/\s+\S*$/, "");
  return `${cut || t.slice(0, n - 1)}…`;
}

/** Paired "**" stay; an unpaired one (the last) and an empty pair go. */
export function cleanBold(s: string): string {
  const parts = s.split("**");
  if (parts.length % 2 === 0) parts.splice(-2, 2, parts[parts.length - 2] + parts[parts.length - 1]);
  return parts
    .map((p, i) => (i % 2 === 0 || !p.trim() ? p : p.replace(/^(\s*)(.*?)(\s*)$/s, "$1**$2**$3")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Substeps: a short line, its fuller wording (`detail`, shown in its place on a tap), and the step's
// doneness cue as its last line, "Ready when **the eggs are just set**".

const READY = /^ready when\b[\s:,-]*/i;
export const isReady = (t: string) => READY.test(plain(t));

/** "ready when the eggs are just set." → "Ready when **the eggs are just set**"; any other line as it is. */
export function readyText(t: string): string {
  const cue = plain(t).replace(READY, "").replace(/[.!。]+$/u, "").trim();
  return isReady(t) && cue ? `Ready when **${cue}**` : t;
}

/** A step's lines: 1 to 3 substeps, and its "Ready when" line may come on top, as a 4th. */
export function linesFit(lines: MissLine[]): boolean {
  const ready = lines.filter((l) => isReady(l.text)).length;
  const [min, max] = LIMITS.lines;
  return lines.length >= min && ready <= 1 && lines.length - ready <= max;
}

/** The "Ready when" line goes last in its step, and a step has one at most: hers over a guess. */
export function readyLast(lines: MissLine[]): MissLine[] {
  const ready = lines.filter((l) => isReady(l.text));
  const keep = ready.find((l) => l.status === "mom") ?? ready.at(-1);
  return keep ? [...lines.filter((l) => !isReady(l.text)), keep] : lines;
}

/**
 * A substep's fuller wording: bold as in its text, cut at a word to 160 characters as read. null when
 * it adds nothing (empty, or the line again), or when it leaves out one of the line's bold amounts,
 * heat or times: it replaces the line on a tap, so the kid would lose them. (A "Ready when" line's
 * bold is its cue, which the fuller wording may say in other words.)
 */
export function cleanDetail(v: unknown, lineText: string): string | null {
  let d = cleanBold(text(v));
  if (plain(d).length > LIMITS.lineDetail) {
    let cut = "";
    for (const word of d.split(" ")) {
      if (plain(`${cut} ${word}`).length > LIMITS.lineDetail) break;
      cut = `${cut} ${word}`;
    }
    d = cleanBold(cut.replace(/[\s,;:–—-]+$/u, ""));
  }
  const bold = isReady(lineText) ? [] : [...lineText.matchAll(/\*\*(.+?)\*\*/g)].map((m) => norm(m[1]));
  return norm(d) && norm(d) !== norm(lineText) && bold.every((b) => norm(d).includes(b)) ? d : null;
}

/** The model's ingredient numbers (1 = the first) → `uses`: indexes in range, no repeats, sorted. */
export function usesOf(v: unknown, count: number): number[] {
  const n = (Array.isArray(v) ? v : []).filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= count);
  return [...new Set(n.map((x) => x - 1))].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Draft

export type DraftCheck =
  | { ok: true; notADish: true }
  | { ok: true; notADish: false; recipe: MissRecipe }
  | { ok: false; errors: string[] };

/**
 * The words Claude says it read in each picture attachment (server-only: never stored or returned).
 * They only back the honesty checks: an amount or time is "stated" only when someone wrote or said it.
 */
export function heardWords(raw: unknown, count: number): string[] {
  const out = Array.from({ length: count }, () => "");
  const list = isObj(raw) && Array.isArray(raw.heard) ? raw.heard : [];
  for (const h of list) {
    if (!isObj(h)) continue;
    const i = Number(h.attachment) - 1;
    if (Number.isInteger(i) && i >= 0 && i < count && typeof h.words === "string") {
      out[i] = `${out[i]} ${h.words}`.trim().slice(0, LIMITS.words * 2);
    }
  }
  return out;
}

/**
 * One thing per question: "Do you brown the beef first, or with the onions?" → "Do you brown the beef
 * first?" (kept as it is when the first part would be too short to stand alone).
 */
export function oneQuestion(q: string): string {
  const m = q.match(/^(.{12,}?)\s*,\s+(or|and)\s+\S/iu);
  return m ? `${m[1].replace(/[\s,;:–—-]+$/u, "")}?` : q;
}

/**
 * Mom knows which dish, so a question doesn't end on its name: "How much ketchup do you put in the
 * tomato egg?" → "How much ketchup do you put in?", "When do you add the sugar to the tomato egg?" →
 * "When do you add the sugar?" (kept as it is when too little would be left).
 */
export function withoutDish(q: string, dish: string): string {
  const name = dish.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const m = name && q.match(new RegExp(`^(.+?)\\s+(in|into|to|for)\\s+(?:the\\s+|your\\s+)?${name}\\s*([?.!]?)$`, "iu"));
  if (!m || m[1].length < 12) return q;
  return `${m[1]}${/^in/i.test(m[2]) ? " in" : ""}${m[3] || "?"}`;
}

/** "Mom's tomato egg." → "tomato egg" */
export function cleanDishName(s: string): string {
  return text(s)
    .replace(
      /^(my\s+|our\s+)?(mom|mum|mommy|mama|mother|dad|daddy|papa|father|grandma|granny|nana|grandmother|grandpa|grandfather|auntie|aunt|uncle)['’]?s\s+/i,
      "",
    )
    .replace(/[.!?。！？]+$/u, "")
    .trim();
}

/** An ingredient amount and its status, made consistent (port of the pipeline's _check_estimate). */
export function settleAmount(
  status: unknown,
  amount: unknown,
  sourceWords: string,
): { status: Status; amount: string } {
  let a = plain(text(amount));
  if (/^(unknown|\?+|n\/a|none given)$/i.test(a)) a = "";
  if (!a) return { status: "unknown", amount: "" };
  if (status === "stated" && !a.startsWith("~") && verbatimIn(a, sourceWords, 1)) {
    return { status: "stated", amount: a };
  }
  // A guess, an "unknown" that still names an amount, or a "stated" amount the kid never gave.
  return { status: "guessed", amount: tilde(a) };
}

const lineStatus = (v: unknown): Status => (v === "stated" ? "stated" : "guessed");

/** A total time: "~" unless the kid or an attachment said it. */
function settleTime(v: unknown, sourceWords: string): string | null {
  const t = plain(text(v));
  if (!t || t.length > LIMITS.fact) return null;
  return t.startsWith("~") || !verbatimIn(t, sourceWords) ? tilde(t) : t;
}

/**
 * The rough grocery cost of the whole recipe, always an estimate: "~$3", "~$3.50". "$3", "about $3" and
 * "~ $3.00" become "~$3"; anything else (a range, words, $0, over $40) is null.
 */
export function settleCost(v: unknown): string | null {
  const t = plain(text(v)).replace(/^(about|around|roughly|approx\.?|approximately)\s+/i, "").replace(/^~\s*/, "");
  const m = t.match(/^\$\s*(\d{1,4}(?:\.\d{1,2})?)$/);
  const n = m ? Number(m[1]) : 0;
  if (!(n > 0) || n > LIMITS.cost) return null;
  return `~$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** A total time in minutes: "~20 min" → 20, "~1 hr 15 min" → 75, "~20-25 min" → 25; null when it can't be read. */
export function minutesOf(time: string | null): number | null {
  const t = (time ?? "").toLowerCase();
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const m = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  return h || m ? Math.round(Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0)) : null;
}

/** `said`: the kid's words, what Claude read in the pictures and what Gemini heard in the voice notes: the only grounds for "stated". */
export function checkDraft(raw: unknown, said: string): DraftCheck {
  if (!isObj(raw)) return { ok: false, errors: ["The answer must be a JSON object."] };
  if (raw.not_a_dish === true) return { ok: true, notADish: true };
  const r = raw.recipe;
  if (!isObj(r)) return { ok: false, errors: ["recipe is missing (or set not_a_dish to true)."] };
  const errors: string[] = [];
  const ask = (v: unknown): QuestionId | null => (isSuggestionId(v) ? v : null);

  const dish = cleanDishName(text(r.dish));
  if (!dish) errors.push("dish is empty.");
  if (dish.length > LIMITS.dishName) errors.push(`dish must be at most ${LIMITS.dishName} characters.`);

  const rawIngredients = Array.isArray(r.ingredients) ? r.ingredients : [];
  const [minI, maxI] = LIMITS.ingredients;
  if (rawIngredients.length < minI || rawIngredients.length > maxI) {
    errors.push(`ingredients: need ${minI} to ${maxI}, got ${rawIngredients.length}.`);
  }
  const ingredients: MissIngredient[] = rawIngredients.map((x, i) => {
    const o = isObj(x) ? x : {};
    const name = plain(text(o.name));
    if (!name || name.length > LIMITS.name) {
      errors.push(`ingredients[${i}].name must be 1 to ${LIMITS.name} characters.`);
    }
    const { status, amount } = settleAmount(o.status, o.amount, said);
    if (amount.length > LIMITS.amount) {
      errors.push(`ingredients[${i}].amount must be at most ${LIMITS.amount} characters.`);
    }
    return { name, amount, status, ask: ask(o.ask), clip: null };
  });

  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  const [minS, maxS] = LIMITS.steps;
  if (rawSteps.length < minS || rawSteps.length > maxS) {
    errors.push(`steps: need ${minS} to ${maxS}, got ${rawSteps.length}.`);
  }
  const steps: MissStep[] = rawSteps.map((x, i) => {
    const o = isObj(x) ? x : {};
    const title = plain(text(o.title));
    if (!title || title.length > LIMITS.title || title.split(" ").length > LIMITS.titleWords) {
      errors.push(`steps[${i}].title must be 1 to ${LIMITS.titleWords} words and ${LIMITS.title} characters.`);
    }
    const rawLines = Array.isArray(o.lines) ? o.lines : [];
    const lines: MissLine[] = rawLines.map((y, j) => {
      const l = isObj(y) ? y : {};
      const t = readyText(cleanBold(text(l.text)));
      const length = plain(t).length;
      if (!length || length > LIMITS.lineText) {
        errors.push(`steps[${i}].lines[${j}].text must be 1 to ${LIMITS.lineText} characters (got ${length}).`);
      }
      return { text: t, detail: cleanDetail(l.detail, t), status: lineStatus(l.status), ask: ask(l.ask), clip: null };
    });
    if (lines.filter((l) => isReady(l.text)).length > 1) {
      errors.push(`steps[${i}]: at most one "Ready when" line, the last one.`);
    } else if (!linesFit(lines)) {
      // A "Ready when" line on top of 3 substeps is kept as the 4th: cheaper than a retry.
      const [minL, maxL] = LIMITS.lines;
      errors.push(`steps[${i}].lines: need ${minL} to ${maxL}, plus the "Ready when" line, got ${lines.length}.`);
    }
    return { title, lines: readyLast(lines), uses: usesOf(o.uses, ingredients.length), tip: null };
  });

  const rawQuestions = Array.isArray(r.questions) ? r.questions : [];
  const questions: MissQuestion[] = [];
  for (const x of rawQuestions) {
    const o = isObj(x) ? x : {};
    if (isSuggestionId(o.id) && !questions.some((q) => q.id === o.id)) {
      questions.push({ id: o.id, text: withoutDish(oneQuestion(text(o.text)), dish) });
    }
  }
  questions.sort((a, b) => a.id.localeCompare(b.id));
  if (rawQuestions.length !== 3 || questions.length !== 3) {
    errors.push("questions: need exactly 3, with ids q1, q2 and q3.");
  }
  for (const q of questions) {
    if (!q.text || q.text.length > LIMITS.question) {
      errors.push(`question ${q.id} must be 1 to ${LIMITS.question} characters (got ${q.text.length}).`);
    }
  }
  const used = new Set([...ingredients.map((x) => x.ask), ...steps.flatMap((s) => s.lines.map((l) => l.ask))]);
  for (const q of questions) {
    if (!used.has(q.id)) errors.push(`question ${q.id} is not set as ask on any ingredient or line.`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    notADish: false,
    recipe: {
      dish,
      servings: SERVINGS,
      time: settleTime(r.time, said),
      cost: settleCost(r.cost),
      ingredients,
      steps,
      questions,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Merge

/** What was said in one clip: word for word in the language spoken, and English when it wasn't English. */
export type Heard<Id extends string = string> = { id: Id; words: string; english: string | null };
export type HeardAnswer = Heard<QuestionId>;

export type HeardCheck<Id extends string> = { ok: true; heard: Heard<Id>[] } | { ok: false; errors: string[] };

/**
 * The transcripts of the clips in `ids`: exactly one each, sorted by id (field names the list in
 * errors). A transcript for a clip that wasn't sent is an error, unless it's empty (harmless).
 */
export function checkHeard<Id extends string>(
  list: unknown,
  ids: readonly Id[],
  field: string,
  max: number,
): HeardCheck<Id> {
  const errors: string[] = [];
  const heard: Heard<Id>[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const o = isObj(x) ? x : {};
    const id = o.id as Id;
    if (typeof o.id !== "string" || !ids.includes(id)) {
      if (!text(o.words)) continue;
      errors.push(`${field}: ${JSON.stringify(o.id ?? null)} is not one of the clips (${ids.join(", ")}).`);
      continue;
    }
    if (heard.some((a) => a.id === id)) {
      errors.push(`${field}: ${id} is listed twice.`);
      continue;
    }
    if (typeof o.words !== "string") {
      errors.push(`${field}: ${id} needs words (use "" when there is no speech).`);
      continue;
    }
    const words = text(o.words);
    if (words.length > max) errors.push(`${field}: ${id} words must be at most ${max} characters.`);
    let english = text(o.english).slice(0, max) || null;
    if (!words || (english && norm(english) === norm(words))) english = null;
    heard.push({ id, words, english });
  }
  for (const id of ids) if (!heard.some((a) => a.id === id)) errors.push(`${field}: ${id} is missing.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, heard: heard.sort((a, b) => a.id.localeCompare(b.id)) };
}

export type MergeCheck =
  | { ok: true; version: MissRecipe; answers: HeardAnswer[]; dropped: string[] }
  | { ok: false; errors: string[] };

/** The refs the merge prompt shows: ingredients i1…, lines s<step>.<line> (both from 1). */
export const ingredientRef = (i: number) => `i${i + 1}`;
export const lineRef = (step: number, line: number) => `s${step + 1}.${line + 1}`;

/**
 * Mom's version: the draft with only what her answers settle changed. It is rebuilt from the draft
 * each time, with all of her answers: `raw.answers` are the transcripts of the clips in `clips`, and
 * the rest is Claude's merge. Broken transcripts (a missing one, an unknown id) are errors. A change
 * that doesn't hold up is dropped and named in `dropped` for the log:
 * - an unknown ref, or a clip she didn't give;
 * - an amount, or a line's bold amount, heat, time or any number, that isn't in her words in the clip
 *   it cites, or an ingredient or line that isn't about what she was asked or said there (none of its
 *   words are in `questions`' text or her answer): it isn't hers, so it keeps the draft's (and its ask);
 * - a tip that isn't word for word in her answer;
 * - a removal whose words aren't hers word for word, or don't name the thing with a "no" or "never";
 * - a new cost when no ingredient was added or removed, or one that isn't a rough "~$N".
 * Servings stays the draft's "1" whatever she cooks for (her amounts stay in her words).
 */
export function applyMerge(
  draft: MissRecipe,
  raw: unknown,
  clips: QuestionId[],
  questions: MissQuestion[] = [],
): MergeCheck {
  if (!isObj(raw)) return { ok: false, errors: ["The answer must be a JSON object."] };
  const dropped: string[] = [];
  const heard = checkHeard(raw.answers, clips, "answers", LIMITS.words);
  if (!heard.ok) return heard;
  const answers = heard.heard;

  const said = new Map(answers.filter((a) => a.words).map((a) => [a.id, a]));
  /** Her words in one clip, and their English (amounts and lines are written in English). */
  const heardIn = (clip: QuestionId) => `${said.get(clip)!.words}\n${said.get(clip)!.english ?? ""}`;
  /** What one answer is about: the question she was asked ("How much ketchup?") and her words ("Two big spoons"). */
  const aboutIn = (clip: QuestionId) => `${questions.find((q) => q.id === clip)?.text ?? ""}\n${heardIn(clip)}`;
  /** Her words that settled a change: Claude's quote when it's word for word in that answer, else the answer's start. */
  const quoteOf = (o: Obj, clip: QuestionId): MissQuote => {
    const answer = said.get(clip)!;
    const words = plain(text(o.quote)).replace(/^["“'‘「]+|["”'’」]+$/gu, "").trim();
    if (words && words.length <= LIMITS.quote && verbatimIn(words, answer.words)) {
      const english = answer.english ? plain(text(o.quote_english)) : "";
      return { words, english: answer.english ? (english && english.length <= LIMITS.quote * 2 ? english : cutAt(answer.english, LIMITS.quote)) : null };
    }
    return { words: cutAt(answer.words, LIMITS.quote), english: answer.english ? cutAt(answer.english, LIMITS.quote) : null };
  };
  const clipOf = (v: unknown, what: string): QuestionId | null => {
    if (isQuestionId(v) && said.has(v)) return v;
    dropped.push(`${what}: clip ${JSON.stringify(v ?? null)} is not an answer she gave`);
    return null;
  };

  // A JSON copy: a recipe is plain JSON, and Convex's runtime doesn't list structuredClone.
  const version: MissRecipe = JSON.parse(JSON.stringify(draft));
  /** Refs a change was made to (or tried, and was refused): nothing else may change or remove them. */
  const touched = new Set<string>();
  /** Ingredients she added: with a removal, the only thing that lets the cost change. */
  let added = 0;

  for (const x of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    const o = isObj(x) ? x : {};
    const ref = text(o.ref);
    const clip = clipOf(o.clip, `ingredient ${ref}`);
    if (!clip) continue;
    const name = plain(text(o.name));
    const amount = plain(text(o.amount));
    if (!amount || amount.length > LIMITS.amount || name.length > LIMITS.name) {
      dropped.push(`ingredient ${ref}: amount must be 1 to ${LIMITS.amount} characters, name at most ${LIMITS.name}`);
      continue;
    }
    const at = Number(ref.match(/^i(\d+)$/)?.[1]) - 1;
    const hers = amountIn(amount, heardIn(clip)) &&
      namesIt(aboutIn(clip), name || draft.ingredients[at]?.name || "", true);
    if (!hers) {
      dropped.push(
        `ingredient ${ref}: ${JSON.stringify(amount)} is not in her answer to ${clip}, so it keeps the draft's`,
      );
      if (draft.ingredients[at]) touched.add(ref);
      continue;
    }
    const was = ref === "new" ? null : (draft.ingredients[at]?.amount ?? null);
    const mine: MissIngredient = { name, amount, status: "mom", ask: null, clip, was, quote: quoteOf(o, clip) };
    if (ref === "new" && name && version.ingredients.length < LIMITS.versionIngredients) {
      version.ingredients.push(mine);
      added++;
      // The step she adds it in lists it too (the newest index, so `uses` stays sorted).
      const step = Number.isInteger(o.step) ? version.steps[(o.step as number) - 1] : undefined;
      if (step) step.uses = [...step.uses, version.ingredients.length - 1];
    } else if (version.ingredients[at] && draft.ingredients[at] && !touched.has(ref)) {
      touched.add(ref);
      version.ingredients[at] = { ...mine, name: name || draft.ingredients[at].name };
    } else {
      dropped.push(`ingredient ${ref}: unknown or repeated ref, or no room for a new one`);
    }
  }

  for (const x of Array.isArray(raw.lines) ? raw.lines : []) {
    const o = isObj(x) ? x : {};
    const ref = text(o.ref);
    const clip = clipOf(o.clip, `line ${ref}`);
    if (!clip) continue;
    const t = readyText(cleanBold(text(o.text)));
    if (!plain(t) || plain(t).length > LIMITS.lineText) {
      dropped.push(`line ${ref}: text must be 1 to ${LIMITS.lineText} characters`);
      continue;
    }
    const m = ref.match(/^s(\d+)\.(\d+|new)$/);
    const s = m ? Number(m[1]) - 1 : -1;
    const step = version.steps[s];
    // Her "Ready when" takes the guessed one's place, even when it comes as a new line.
    const ready = m?.[2] === "new" && isReady(t) ? draft.steps[s]?.lines.findIndex((l) => isReady(l.text)) ?? -1 : -1;
    const at = ready >= 0 ? ready : m && m[2] !== "new" ? Number(m[2]) - 1 : -1;
    if (!lineIn(t, heardIn(clip)) || !namesIt(aboutIn(clip), t, false)) {
      dropped.push(`line ${ref}: it says what her answer to ${clip} doesn't, so it keeps the draft's`);
      if (draft.steps[s]?.lines[at]) touched.add(lineRef(s, at));
      continue;
    }
    let detail = cleanDetail(o.detail, t);
    if (detail && !lineIn(detail, heardIn(clip))) {
      dropped.push(`line ${ref}: its detail says what she didn't`);
      detail = null;
    }
    const was = at >= 0 ? (draft.steps[s]?.lines[at]?.text ?? null) : null;
    const mine: MissLine = { text: t, detail, status: "mom", ask: null, clip, was, quote: quoteOf(o, clip) };
    if (step && at < 0 && m?.[2] === "new" && linesFit([...step.lines, mine])) {
      step.lines.push(mine);
    } else if (step && step.lines[at] && !touched.has(lineRef(s, at))) {
      touched.add(lineRef(s, at));
      step.lines[at] = mine;
    } else {
      dropped.push(`line ${ref}: unknown or repeated ref, or the step is full`);
    }
  }

  for (const x of Array.isArray(raw.tips) ? raw.tips : []) {
    const o = isObj(x) ? x : {};
    const n = Number(o.step);
    const clip = clipOf(o.clip, `tip on step ${n}`);
    if (!clip) continue;
    const step = Number.isInteger(n) ? version.steps[n - 1] : undefined;
    const words = plain(text(o.words)).replace(/^["“'‘「]+|["”'’」]+$/gu, "").trim();
    const answer = said.get(clip)!;
    if (!step || step.tip) {
      dropped.push(`tip on step ${n}: no such step, or it already has one`);
    } else if (!words || words.length > LIMITS.tip || !verbatimIn(words, answer.words)) {
      dropped.push(`tip on step ${n}: not word for word in her answer to ${clip}`);
    } else {
      const english = answer.english ? plain(text(o.english)) : "";
      step.tip = { words, english: english && english.length <= LIMITS.tip * 2 ? english : null, clip };
    }
  }

  // A time she gave replaces the guess, but only if it's in her words. Servings stays the draft's.
  const allWords = answers.map((a) => a.words).join("\n");
  const time = plain(text(raw.time));
  if (time && time.length <= LIMITS.fact) {
    if (verbatimIn(time.replace(/^~\s*/, ""), allWords)) version.time = time;
    else dropped.push("time: not in her words");
  }

  // What she rules out ("no, I never put sugar in it") goes, in any of her answers, and nothing else
  // ever does: an ingredient or line nothing above changed, when her words, word for word, name it
  // with a "no" or "never". A step keeps at least one line.
  const inHerWords = (w: string) =>
    answers.some((a) => verbatimIn(w, a.words, 4) || (!!a.english && verbatimIn(w, a.english, 4)));
  const goneIngredients = new Set<number>();
  const goneLines = version.steps.map(() => new Set<number>());
  for (const x of Array.isArray(raw.remove) ? raw.remove : []) {
    const o = isObj(x) ? x : {};
    const ref = text(o.ref);
    const words = text(o.words);
    const i = ref.match(/^i(\d+)$/);
    const l = ref.match(/^s(\d+)\.(\d+)$/);
    const [s, j] = l ? [Number(l[1]) - 1, Number(l[2]) - 1] : [-1, -1];
    const ingredient = i ? draft.ingredients[Number(i[1]) - 1] : undefined;
    const line = l ? draft.steps[s]?.lines[j] : undefined;
    if (!(ingredient ?? line) || touched.has(ref)) {
      dropped.push(`remove ${ref}: unknown, or changed above`);
    } else if (!inHerWords(words)) {
      dropped.push(`remove ${ref}: not word for word in her answers`);
    } else if (!negates(words) || !namesIt(words, ingredient ? ingredient.name : line!.text, !!ingredient)) {
      dropped.push(`remove ${ref}: her words don't rule it out by name`);
    } else if (l && version.steps[s].lines.length - goneLines[s].size <= 1) {
      dropped.push(`remove ${ref}: a step keeps at least one line`);
    } else {
      touched.add(ref);
      if (i) goneIngredients.add(Number(i[1]) - 1);
      else goneLines[s].add(j);
    }
  }
  version.steps.forEach((step, s) => (step.lines = readyLast(step.lines.filter((_, j) => !goneLines[s].has(j)))));
  if (goneIngredients.size) {
    // `uses` holds indexes, so they shift past what's gone.
    const moved = new Map<number, number>();
    version.ingredients.forEach((_, k) => !goneIngredients.has(k) && moved.set(k, moved.size));
    version.ingredients = version.ingredients.filter((_, k) => moved.has(k));
    for (const step of version.steps) step.uses = step.uses.filter((k) => moved.has(k)).map((k) => moved.get(k)!);
  }

  // The cost is the draft's estimate unless she added or took out an ingredient: then Claude's new one.
  const cost = text(raw.cost);
  const newCost = settleCost(cost);
  if (cost && newCost !== draft.cost) {
    if (!added && !goneIngredients.size) dropped.push("cost: no ingredient was added or removed");
    else if (!newCost) dropped.push(`cost: ${JSON.stringify(cost.slice(0, LIMITS.fact))} is not a rough "~$N"`);
    else version.cost = newCost;
  }

  version.questions = draft.questions.map((q) => ({ ...q }));
  return { ok: true, version, answers, dropped };
}
